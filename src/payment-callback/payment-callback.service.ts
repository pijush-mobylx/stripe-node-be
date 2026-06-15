import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { WebhookEvent, WebhookEventDocument, WebhookStatus } from '../webhook-event/webhook-event.schema';
import { Payment, PaymentDocument, PaymentStatus } from '../payment/payment.schema';
import { AuditLog, AuditLogDocument } from '../audit-log/audit-log.schema';
import { ProvisioningOutbox, ProvisioningOutboxDocument, OutboxStatus, ProvisioningType } from '../provisioning-outbox/provisioning-outbox.schema';
import { PAYMENT_SUCCESS_EVENT, PaymentSuccessEvent } from './payment-success.event';

const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
]);

@Injectable()
export class PaymentCallbackService {
  private readonly logger = new Logger(PaymentCallbackService.name);

  constructor(
    @InjectModel(WebhookEvent.name) private readonly webhookModel: Model<WebhookEventDocument>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
    @InjectModel(ProvisioningOutbox.name) private readonly outboxModel: Model<ProvisioningOutboxDocument>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async process(
    record: WebhookEventDocument,
    event: { providerEventId: string; type: string; payload: Record<string, unknown> },
  ): Promise<void> {
    // ── Step 1: Idempotency guard ─────────────────────────────────────────────
    if (record.status === WebhookStatus.PROCESSED) {
      this.logger.log(`Webhook ${record.providerEventId} already processed — skipping`);
      return;
    }

    // ── Step 2: Validate event type ───────────────────────────────────────────
    if (!HANDLED_EVENTS.has(event.type)) {
      await this.webhookModel.findByIdAndUpdate(record._id, { status: WebhookStatus.IGNORED });
      this.logger.debug(`Webhook ${event.type} ignored — not in handled set`);
      return;
    }

    // ── Step 3: Resolve provider order ID + expected status ───────────────────
    const { providerOrderId, targetStatus, amountFromProvider } =
      this.extractEventContext(event);

    // ── Step 4: Load payment + tamper check ───────────────────────────────────
    const payment = await this.paymentModel.findOne({ providerIntentId: providerOrderId }).exec();

    if (!payment) {
      await this.webhookModel.findByIdAndUpdate(record._id, {
        status: WebhookStatus.FAILED,
        lastError: `No payment found for providerIntentId=${providerOrderId}`,
      });
      throw new NotFoundException(
        `PaymentCallbackService: no payment for providerIntentId=${providerOrderId}`,
      );
    }

    if (amountFromProvider !== null && amountFromProvider !== payment.amount) {
      const msg = `Amount tamper detected: expected ${payment.amount}, got ${amountFromProvider}`;
      await this.webhookModel.findByIdAndUpdate(record._id, {
        status: WebhookStatus.FAILED,
        lastError: msg,
      });
      throw new UnprocessableEntityException(msg);
    }

    const terminalStatuses: PaymentStatus[] = [
      PaymentStatus.SUCCESS,
      PaymentStatus.FAILED,
      PaymentStatus.EXPIRED,
    ];
    if (terminalStatuses.includes(payment.status)) {
      await this.webhookModel.findByIdAndUpdate(record._id, { status: WebhookStatus.IGNORED });
      this.logger.warn(
        `Payment ${payment._id} already in terminal status ${payment.status} — ignoring webhook`,
      );
      return;
    }

    // ── Step 5: Sequential write — payment status + outbox + audit ────────────
    const prevStatus = payment.status;
    payment.set({ status: targetStatus });
    await payment.save();

    if (targetStatus === PaymentStatus.SUCCESS) {
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
        },
      });
    }

    await this.auditModel.create({
      entityType: 'payment',
      entityId: payment._id.toString(),
      fromStatus: prevStatus,
      toStatus: targetStatus,
      triggeredBy: 'webhook',
      triggeredById: record.providerName,
      providerEventId: event.providerEventId,
      metadata: { eventType: event.type, providerOrderId },
    });

    // ── Step 6: Mark webhook PROCESSED ───────────────────────────────────────
    await this.webhookModel.findByIdAndUpdate(record._id, {
      status: WebhookStatus.PROCESSED,
      processedAt: new Date(),
    });

    this.logger.log(
      `Payment ${payment._id} → ${targetStatus} (webhook ${event.providerEventId})`,
    );

    // ── Step 7: Emit domain event ─────────────────────────────────────────────
    if (targetStatus === PaymentStatus.SUCCESS) {
      this.eventEmitter.emit(
        PAYMENT_SUCCESS_EVENT,
        new PaymentSuccessEvent(
          payment._id.toString(),
          payment.userId,
          payment.planId,
          payment.amount,
          'usd',
          payment.providerName,
          event.providerEventId,
        ),
      );
    }
  }

  private extractEventContext(event: {
    type: string;
    payload: Record<string, unknown>;
  }): { providerOrderId: string; targetStatus: PaymentStatus; amountFromProvider: number | null } {
    switch (event.type) {
      case 'checkout.session.completed':
        return {
          providerOrderId: event.payload['id'] as string,
          targetStatus: PaymentStatus.SUCCESS,
          amountFromProvider: (event.payload['amount_total'] as number) ?? null,
        };

      case 'checkout.session.expired':
        return {
          providerOrderId: event.payload['id'] as string,
          targetStatus: PaymentStatus.EXPIRED,
          amountFromProvider: null,
        };

      case 'payment_intent.succeeded':
        return {
          providerOrderId: event.payload['id'] as string,
          targetStatus: PaymentStatus.SUCCESS,
          amountFromProvider: (event.payload['amount'] as number) ?? null,
        };

      case 'payment_intent.payment_failed':
        return {
          providerOrderId: event.payload['id'] as string,
          targetStatus: PaymentStatus.FAILED,
          amountFromProvider: null,
        };

      default:
        throw new Error(`extractEventContext called for unhandled type: ${event.type}`);
    }
  }
}
