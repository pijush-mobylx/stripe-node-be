import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Payment, PaymentStatus } from '../../payment/payment.entity';
import { Subscription, SubscriptionStatus } from '../../subscription/subscription.entity';
import { User } from '../../user/user.entity';
import { AuditLog } from '../../audit-log/audit-log.entity';

@Injectable()
export class StripeEventHandler {
  private readonly logger = new Logger(StripeEventHandler.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async handle(type: string, payload: Record<string, unknown>): Promise<void> {
    switch (type) {
      case 'payment_intent.succeeded':
        return this.onPaymentIntentSucceeded(payload);
      case 'payment_intent.payment_failed':
        return this.onPaymentIntentFailed(payload);
      case 'customer.subscription.updated':
        return this.onSubscriptionUpdated(payload);
      case 'customer.subscription.deleted':
        return this.onSubscriptionDeleted(payload);
      case 'invoice.paid':
        return this.onInvoicePaid(payload);
      case 'invoice.payment_failed':
        return this.onInvoicePaymentFailed(payload);
      default:
        this.logger.debug(`Unhandled Stripe event type: ${type}`);
    }
  }

  // ─── payment_intent.succeeded ─────────────────────────────────────────────

  private async onPaymentIntentSucceeded(payload: Record<string, unknown>): Promise<void> {
    const intentId = payload['id'] as string;
    const payment = await this.paymentRepo.findOne({ where: { providerIntentId: intentId } });
    if (!payment) {
      this.logger.warn(`payment_intent.succeeded — no payment found for intent ${intentId}`);
      return;
    }

    const prev = payment.status;
    payment.status = PaymentStatus.SUCCESS;
    await this.paymentRepo.save(payment);
    await this.audit('payment', payment.id, prev, PaymentStatus.SUCCESS, 'stripe_webhook', intentId);

    this.logger.log(`Payment ${payment.id} marked SUCCEEDED`);
  }

  // ─── payment_intent.payment_failed ────────────────────────────────────────

  private async onPaymentIntentFailed(payload: Record<string, unknown>): Promise<void> {
    const intentId = payload['id'] as string;
    const payment = await this.paymentRepo.findOne({ where: { providerIntentId: intentId } });
    if (!payment) return;

    const prev = payment.status;
    payment.status = PaymentStatus.FAILED;
    await this.paymentRepo.save(payment);
    await this.audit('payment', payment.id, prev, PaymentStatus.FAILED, 'stripe_webhook', intentId);

    this.logger.log(`Payment ${payment.id} marked FAILED`);
  }

  // ─── customer.subscription.updated ───────────────────────────────────────

  private async onSubscriptionUpdated(payload: Record<string, unknown>): Promise<void> {
    const providerSubId = payload['id'] as string;
    const sub = await this.subRepo.findOne({ where: { providerSubId } });
    if (!sub) {
      this.logger.warn(`subscription.updated — no sub found for ${providerSubId}`);
      return;
    }

    const prev = sub.status;
    sub.status = payload['status'] as SubscriptionStatus;
    sub.cancelAtPeriodEnd = payload['cancel_at_period_end'] as boolean;
    sub.currentPeriodStart = new Date((payload['current_period_start'] as number) * 1000);
    sub.currentPeriodEnd = new Date((payload['current_period_end'] as number) * 1000);

    if (payload['trial_end']) {
      sub.trialEnd = new Date((payload['trial_end'] as number) * 1000);
    }

    await this.subRepo.save(sub);
    await this.audit('subscription', sub.id, prev, sub.status, 'stripe_webhook', providerSubId);

    this.logger.log(`Subscription ${sub.id} updated → ${sub.status}`);
  }

  // ─── customer.subscription.deleted ───────────────────────────────────────

  private async onSubscriptionDeleted(payload: Record<string, unknown>): Promise<void> {
    const providerSubId = payload['id'] as string;
    const sub = await this.subRepo.findOne({ where: { providerSubId } });
    if (!sub) return;

    const prev = sub.status;
    sub.status = SubscriptionStatus.CANCELED;
    sub.cancelledAt = new Date();
    await this.subRepo.save(sub);

    await this.userRepo.update(sub.userId, { isPremium: false, plan: 'basic' });
    await this.audit('subscription', sub.id, prev, SubscriptionStatus.CANCELED, 'stripe_webhook', providerSubId);

    this.logger.log(`Subscription ${sub.id} deleted → CANCELED, user downgraded`);
  }

  // ─── invoice.paid ─────────────────────────────────────────────────────────

  private async onInvoicePaid(payload: Record<string, unknown>): Promise<void> {
    const providerSubId = payload['subscription'] as string;
    if (!providerSubId) return;

    const sub = await this.subRepo.findOne({ where: { providerSubId } });
    if (!sub) return;

    const prev = sub.status;
    sub.status = SubscriptionStatus.ACTIVE;
    sub.failedAttempts = 0;
    sub.nextRetryAt = null;
    sub.currentPeriodStart = new Date((payload['period_start'] as number) * 1000);
    sub.currentPeriodEnd = new Date((payload['period_end'] as number) * 1000);
    await this.subRepo.save(sub);

    await this.userRepo.update(sub.userId, { isPremium: true });
    await this.audit('subscription', sub.id, prev, SubscriptionStatus.ACTIVE, 'stripe_webhook', providerSubId, {
      invoiceId: payload['id'],
    });

    this.logger.log(`Subscription ${sub.id} renewed via invoice.paid`);
  }

  // ─── invoice.payment_failed ───────────────────────────────────────────────

  private async onInvoicePaymentFailed(payload: Record<string, unknown>): Promise<void> {
    const providerSubId = payload['subscription'] as string;
    if (!providerSubId) return;

    const sub = await this.subRepo.findOne({ where: { providerSubId } });
    if (!sub) return;

    const prev = sub.status;
    sub.status = SubscriptionStatus.PAST_DUE;
    sub.failedAttempts += 1;
    // Retry in 3 days
    const retryAt = new Date();
    retryAt.setDate(retryAt.getDate() + 3);
    sub.nextRetryAt = retryAt;

    await this.subRepo.save(sub);
    await this.audit('subscription', sub.id, prev, SubscriptionStatus.PAST_DUE, 'stripe_webhook', providerSubId, {
      failedAttempts: sub.failedAttempts,
      nextRetryAt: retryAt,
    });

    this.logger.warn(`Subscription ${sub.id} PAST_DUE — attempt #${sub.failedAttempts}`);
  }

  // ─── audit helper ─────────────────────────────────────────────────────────

  private async audit(
    entityType: string,
    entityId: string,
    fromStatus: string,
    toStatus: string,
    triggeredBy: string,
    providerEventId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({
        entityType,
        entityId,
        fromStatus,
        toStatus,
        triggeredBy,
        triggeredById: 'webhook',
        providerEventId,
        metadata,
      }),
    );
  }
}
