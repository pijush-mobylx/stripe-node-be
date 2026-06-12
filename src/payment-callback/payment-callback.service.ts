import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { WebhookEvent, WebhookStatus } from '../webhook-event/webhook-event.entity';
import { Payment, PaymentStatus } from '../payment/payment.entity';
import { AuditLog } from '../audit-log/audit-log.entity';
import { ProvisioningOutbox, OutboxStatus, ProvisioningType } from '../provisioning-outbox/provisioning-outbox.entity';
import { PAYMENT_SUCCESS_EVENT, PaymentSuccessEvent } from './payment-success.event';

/** Event types this pipeline handles — everything else is IGNORED. */
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
    @InjectRepository(WebhookEvent)
    private readonly webhookRepo: Repository<WebhookEvent>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(ProvisioningOutbox)
    private readonly outboxRepo: Repository<ProvisioningOutbox>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Runs the 6-step callback pipeline for an already-saved WebhookEvent record.
   * Called by WebhookHandlerFactory after signature verification + dedup insert.
   */
  async process(
    record: WebhookEvent,
    event: { providerEventId: string; type: string; payload: Record<string, unknown> },
  ): Promise<void> {
    // ── Step 1: Idempotency guard ─────────────────────────────────────────────
    if (record.status === WebhookStatus.PROCESSED) {
      this.logger.log(`Webhook ${record.providerEventId} already processed — skipping`);
      return;
    }

    // ── Step 2: Validate event type ───────────────────────────────────────────
    if (!HANDLED_EVENTS.has(event.type)) {
      await this.webhookRepo.update(record.id, { status: WebhookStatus.IGNORED });
      this.logger.debug(`Webhook ${event.type} ignored — not in handled set`);
      return;
    }

    // ── Step 3: Resolve provider order ID + expected status ───────────────────
    const { providerOrderId, targetStatus, amountFromProvider } =
      this.extractEventContext(event);

    // ── Step 4: Load payment + tamper check ───────────────────────────────────
    const payment = await this.paymentRepo.findOne({
      where: { providerIntentId: providerOrderId },
    });

    if (!payment) {
      await this.webhookRepo.update(record.id, {
        status: WebhookStatus.FAILED,
        lastError: `No payment found for providerIntentId=${providerOrderId}`,
      });
      throw new NotFoundException(
        `PaymentCallbackService: no payment for providerIntentId=${providerOrderId}`,
      );
    }

    if (
      amountFromProvider !== null &&
      amountFromProvider !== payment.amount
    ) {
      const msg = `Amount tamper detected: expected ${payment.amount}, got ${amountFromProvider}`;
      await this.webhookRepo.update(record.id, {
        status: WebhookStatus.FAILED,
        lastError: msg,
      });
      throw new UnprocessableEntityException(msg);
    }

    // Guard: don't re-process a terminal payment
    const terminalStatuses: PaymentStatus[] = [PaymentStatus.SUCCESS, PaymentStatus.FAILED, PaymentStatus.EXPIRED];
    if (terminalStatuses.includes(payment.status)) {
      await this.webhookRepo.update(record.id, { status: WebhookStatus.IGNORED });
      this.logger.warn(
        `Payment ${payment.id} already in terminal status ${payment.status} — ignoring webhook`,
      );
      return;
    }

    // ── Step 5: Atomic write — payment status + outbox + audit ────────────────
    await this.dataSource.transaction(async (manager) => {
      const prevStatus = payment.status;
      payment.status = targetStatus;
      await manager.save(payment);

      if (targetStatus === PaymentStatus.SUCCESS) {
        const outboxJob = manager.create(ProvisioningOutbox, {
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
          },
        });
        await manager.save(outboxJob);
      }

      await manager.save(
        manager.create(AuditLog, {
          entityType: 'payment',
          entityId: payment.id,
          fromStatus: prevStatus,
          toStatus: targetStatus,
          triggeredBy: 'webhook',
          triggeredById: record.providerName,
          providerEventId: event.providerEventId,
          metadata: { eventType: event.type, providerOrderId },
        }),
      );
    });

    // ── Step 6: Mark webhook PROCESSED ───────────────────────────────────────
    await this.webhookRepo.update(record.id, {
      status: WebhookStatus.PROCESSED,
      processedAt: new Date(),
    });

    this.logger.log(
      `Payment ${payment.id} → ${targetStatus} (webhook ${event.providerEventId})`,
    );

    // ── Step 7: Emit domain event ─────────────────────────────────────────────
    if (targetStatus === PaymentStatus.SUCCESS) {
      this.eventEmitter.emit(
        PAYMENT_SUCCESS_EVENT,
        new PaymentSuccessEvent(
          payment.id,
          payment.userId,
          payment.planId,
          payment.amount,
          'usd', // currency stored on plan; carried through in a future refactor
          payment.providerName,
          event.providerEventId,
        ),
      );
    }
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

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
