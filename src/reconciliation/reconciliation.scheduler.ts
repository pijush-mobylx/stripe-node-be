import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';

import { Payment, PaymentStatus } from '../payment/payment.entity';
import { AuditLog } from '../audit-log/audit-log.entity';
import { ProvisioningOutbox, OutboxStatus, ProvisioningType } from '../provisioning-outbox/provisioning-outbox.entity';
import { PaymentProviderFactory } from '../payment-provider/payment-provider.factory';

/** Minutes an INITIATED order must be stale before reconciliation attempts to heal it. */
const STALE_THRESHOLD_MINUTES = 30;

/** Batch size per reconciliation run. */
const BATCH_SIZE = 100;

/** Advisory lock key — must be unique across all pg_advisory_lock calls in this app. */
const RECONCILIATION_LOCK_KEY = 7_001_002;

/** Maps provider-returned status strings → internal PaymentStatus. */
const PROVIDER_STATUS_MAP: Record<string, PaymentStatus | null> = {
  success:   PaymentStatus.SUCCESS,
  complete:  PaymentStatus.SUCCESS,
  paid:      PaymentStatus.SUCCESS,
  succeeded: PaymentStatus.SUCCESS,
  expired:   PaymentStatus.EXPIRED,
  canceled:  PaymentStatus.EXPIRED,
  failed:    PaymentStatus.FAILED,
  initiated: null, // still in-flight — leave alone
};

@Injectable()
export class ReconciliationScheduler {
  private readonly logger = new Logger(ReconciliationScheduler.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(ProvisioningOutbox)
    private readonly outboxRepo: Repository<ProvisioningOutbox>,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcile(): Promise<void> {
    const acquired = await this.tryAcquireLock();
    if (!acquired) {
      this.logger.debug('Reconciliation skipped — another instance holds the lock');
      return;
    }

    try {
      await this.runReconciliation();
    } finally {
      await this.releaseLock();
    }
  }

  // ─── core ─────────────────────────────────────────────────────────────────

  private async runReconciliation(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1_000);

    const stale = await this.paymentRepo.find({
      where: { status: PaymentStatus.INITIATED, createdAt: LessThan(cutoff) },
      order: { createdAt: 'ASC' },
      take: BATCH_SIZE,
    });

    if (stale.length === 0) {
      this.logger.debug('Reconciliation: no stale INITIATED payments found');
      return;
    }

    this.logger.log(`Reconciliation: healing ${stale.length} stale payment(s)`);

    for (const payment of stale) {
      await this.healPayment(payment);
    }
  }

  private async healPayment(payment: Payment): Promise<void> {
    try {
      const provider = this.providerFactory.getProvider(payment.providerName);
      const result = await provider.getPaymentOrderStatus(payment.providerIntentId);

      const targetStatus = PROVIDER_STATUS_MAP[result.status] ?? null;

      if (targetStatus === null) {
        this.logger.debug(
          `Reconciliation: payment ${payment.id} still in-flight (${result.status}) — skipping`,
        );
        return;
      }

      if (targetStatus === payment.status) return; // already correct

      await this.dataSource.transaction(async (manager) => {
        const prev = payment.status;
        payment.status = targetStatus;
        if (result.frozen) payment.frozen = true;
        await manager.save(payment);

        if (targetStatus === PaymentStatus.SUCCESS) {
          // Only write outbox if one doesn't already exist for this job
          const exists = await this.outboxRepo.findOne({ where: { jobId: payment.id } });
          if (!exists) {
            await manager.save(
              manager.create(ProvisioningOutbox, {
                jobId: payment.id,
                provisioningType: ProvisioningType.ACTIVATE_SUBSCRIPTION,
                status: OutboxStatus.PENDING,
                retryCount: 0,
                maxRetries: 5,
                lastError: null,
                processedAt: null,
                payload: {
                  userId: payment.userId,
                  planId: payment.planId,
                  paymentId: payment.id,
                  providerName: payment.providerName,
                  healedByReconciliation: true,
                },
              }),
            );
          }
        }

        await manager.save(
          manager.create(AuditLog, {
            entityType: 'payment',
            entityId: payment.id,
            fromStatus: prev,
            toStatus: targetStatus,
            triggeredBy: 'reconciliation',
            triggeredById: 'scheduler',
            metadata: {
              providerStatus: result.status,
              providerIntentId: payment.providerIntentId,
            },
          }),
        );
      });

      this.logger.log(
        `Reconciliation healed payment ${payment.id}: INITIATED → ${targetStatus}`,
      );
    } catch (err) {
      // Per-payment isolation — one bad provider call never stops the rest
      this.logger.error(
        `Reconciliation failed for payment ${payment.id}: ${(err as Error).message}`,
      );
    }
  }

  // ─── advisory lock ────────────────────────────────────────────────────────

  private async tryAcquireLock(): Promise<boolean> {
    const result = await this.dataSource.query<[{ pg_try_advisory_lock: boolean }]>(
      'SELECT pg_try_advisory_lock($1)',
      [RECONCILIATION_LOCK_KEY],
    );
    return result[0].pg_try_advisory_lock;
  }

  private async releaseLock(): Promise<void> {
    await this.dataSource.query('SELECT pg_advisory_unlock($1)', [RECONCILIATION_LOCK_KEY]);
  }
}
