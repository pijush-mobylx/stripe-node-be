import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Payment, PaymentDocument, PaymentStatus } from '../payment/payment.schema';
import { AuditLog, AuditLogDocument } from '../audit-log/audit-log.schema';
import { ProvisioningOutbox, ProvisioningOutboxDocument, OutboxStatus, ProvisioningType } from '../provisioning-outbox/provisioning-outbox.schema';
import { PaymentProviderFactory } from '../payment-provider/payment-provider.factory';

const STALE_THRESHOLD_MINUTES = 30;
const BATCH_SIZE = 100;

const PROVIDER_STATUS_MAP: Record<string, PaymentStatus | null> = {
  success:   PaymentStatus.SUCCESS,
  complete:  PaymentStatus.SUCCESS,
  paid:      PaymentStatus.SUCCESS,
  succeeded: PaymentStatus.SUCCESS,
  expired:   PaymentStatus.EXPIRED,
  canceled:  PaymentStatus.EXPIRED,
  failed:    PaymentStatus.FAILED,
  initiated: null,
};

@Injectable()
export class ReconciliationScheduler {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private isRunning = false;

  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
    @InjectModel(ProvisioningOutbox.name) private readonly outboxModel: Model<ProvisioningOutboxDocument>,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcile(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Reconciliation skipped — previous run still in progress');
      return;
    }

    this.isRunning = true;
    try {
      await this.runReconciliation();
    } finally {
      this.isRunning = false;
    }
  }

  private async runReconciliation(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1_000);

    const stale = await this.paymentModel
      .find({ status: PaymentStatus.INITIATED, createdAt: { $lt: cutoff } })
      .sort({ createdAt: 1 })
      .limit(BATCH_SIZE)
      .exec();

    if (stale.length === 0) {
      this.logger.debug('Reconciliation: no stale INITIATED payments found');
      return;
    }

    this.logger.log(`Reconciliation: healing ${stale.length} stale payment(s)`);

    for (const payment of stale) {
      await this.healPayment(payment);
    }
  }

  private async healPayment(payment: PaymentDocument): Promise<void> {
    try {
      const provider = await this.providerFactory.getProvider(payment.providerName);
      const result = await provider.getPaymentOrderStatus(payment.providerIntentId);

      const targetStatus = PROVIDER_STATUS_MAP[result.status] ?? null;

      if (targetStatus === null) {
        this.logger.debug(
          `Reconciliation: payment ${payment._id} still in-flight (${result.status}) — skipping`,
        );
        return;
      }

      if (targetStatus === payment.status) return;

      const prev = payment.status;
      payment.set({ status: targetStatus, ...(result.frozen ? { frozen: true } : {}) });
      await payment.save();

      if (targetStatus === PaymentStatus.SUCCESS) {
        const exists = await this.outboxModel.findOne({ jobId: payment._id.toString() }).exec();
        if (!exists) {
          await this.outboxModel.create({
            jobId: payment._id.toString(),
            provisioningType: ProvisioningType.ACTIVATE_SUBSCRIPTION,
            status: OutboxStatus.PENDING,
            retryCount: 0,
            maxRetries: 5,
            lastError: null,
            processedAt: null,
            payload: {
              userId: payment.userId,
              planId: payment.planId,
              paymentId: payment._id.toString(),
              providerName: payment.providerName,
              healedByReconciliation: true,
            },
          });
        }
      }

      await this.auditModel.create({
        entityType: 'payment',
        entityId: payment._id.toString(),
        fromStatus: prev,
        toStatus: targetStatus,
        triggeredBy: 'reconciliation',
        triggeredById: 'scheduler',
        metadata: {
          providerStatus: result.status,
          providerIntentId: payment.providerIntentId,
        },
      });

      this.logger.log(
        `Reconciliation healed payment ${payment._id}: INITIATED → ${targetStatus}`,
      );
    } catch (err) {
      this.logger.error(
        `Reconciliation failed for payment ${payment._id}: ${(err as Error).message}`,
      );
    }
  }
}
