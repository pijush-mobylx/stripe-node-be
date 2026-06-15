import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Payment, PaymentDocument, PaymentStatus } from '../../payment/payment.schema';
import { Subscription, SubscriptionDocument, SubscriptionStatus } from '../../subscription/subscription.schema';
import { User, UserDocument } from '../../user/user.schema';
import { AuditLog, AuditLogDocument } from '../../audit-log/audit-log.schema';

@Injectable()
export class StripeEventHandler {
  private readonly logger = new Logger(StripeEventHandler.name);

  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Subscription.name) private readonly subModel: Model<SubscriptionDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
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

  private async onPaymentIntentSucceeded(payload: Record<string, unknown>): Promise<void> {
    const intentId = payload['id'] as string;
    const payment = await this.paymentModel.findOne({ providerIntentId: intentId }).exec();
    if (!payment) {
      this.logger.warn(`payment_intent.succeeded — no payment found for intent ${intentId}`);
      return;
    }

    const prev = payment.status;
    payment.set({ status: PaymentStatus.SUCCESS });
    await payment.save();
    await this.audit('payment', payment._id.toString(), prev, PaymentStatus.SUCCESS, 'stripe_webhook', intentId);

    this.logger.log(`Payment ${payment._id} marked SUCCEEDED`);
  }

  private async onPaymentIntentFailed(payload: Record<string, unknown>): Promise<void> {
    const intentId = payload['id'] as string;
    const payment = await this.paymentModel.findOne({ providerIntentId: intentId }).exec();
    if (!payment) return;

    const prev = payment.status;
    payment.set({ status: PaymentStatus.FAILED });
    await payment.save();
    await this.audit('payment', payment._id.toString(), prev, PaymentStatus.FAILED, 'stripe_webhook', intentId);

    this.logger.log(`Payment ${payment._id} marked FAILED`);
  }

  private async onSubscriptionUpdated(payload: Record<string, unknown>): Promise<void> {
    const providerSubId = payload['id'] as string;
    const sub = await this.subModel.findOne({ providerSubId }).exec();
    if (!sub) {
      this.logger.warn(`subscription.updated — no sub found for ${providerSubId}`);
      return;
    }

    const prev = sub.status;
    sub.set({
      status: payload['status'] as SubscriptionStatus,
      cancelAtPeriodEnd: payload['cancel_at_period_end'] as boolean,
      currentPeriodStart: new Date((payload['current_period_start'] as number) * 1000),
      currentPeriodEnd: new Date((payload['current_period_end'] as number) * 1000),
      ...(payload['trial_end'] ? { trialEnd: new Date((payload['trial_end'] as number) * 1000) } : {}),
    });
    await sub.save();
    await this.audit('subscription', sub._id.toString(), prev, sub.status, 'stripe_webhook', providerSubId);

    this.logger.log(`Subscription ${sub._id} updated → ${sub.status}`);
  }

  private async onSubscriptionDeleted(payload: Record<string, unknown>): Promise<void> {
    const providerSubId = payload['id'] as string;
    const sub = await this.subModel.findOne({ providerSubId }).exec();
    if (!sub) return;

    const prev = sub.status;
    sub.set({ status: SubscriptionStatus.CANCELED, cancelledAt: new Date() });
    await sub.save();

    await this.userModel.findByIdAndUpdate(sub.userId, { isPremium: false, plan: 'basic' });
    await this.audit('subscription', sub._id.toString(), prev, SubscriptionStatus.CANCELED, 'stripe_webhook', providerSubId);

    this.logger.log(`Subscription ${sub._id} deleted → CANCELED, user downgraded`);
  }

  private async onInvoicePaid(payload: Record<string, unknown>): Promise<void> {
    const providerSubId = payload['subscription'] as string;
    if (!providerSubId) return;

    const sub = await this.subModel.findOne({ providerSubId }).exec();
    if (!sub) return;

    const prev = sub.status;
    sub.set({
      status: SubscriptionStatus.ACTIVE,
      failedAttempts: 0,
      nextRetryAt: null,
      currentPeriodStart: new Date((payload['period_start'] as number) * 1000),
      currentPeriodEnd: new Date((payload['period_end'] as number) * 1000),
    });
    await sub.save();

    await this.userModel.findByIdAndUpdate(sub.userId, { isPremium: true });
    await this.audit('subscription', sub._id.toString(), prev, SubscriptionStatus.ACTIVE, 'stripe_webhook', providerSubId, {
      invoiceId: payload['id'],
    });

    this.logger.log(`Subscription ${sub._id} renewed via invoice.paid`);
  }

  private async onInvoicePaymentFailed(payload: Record<string, unknown>): Promise<void> {
    const providerSubId = payload['subscription'] as string;
    if (!providerSubId) return;

    const sub = await this.subModel.findOne({ providerSubId }).exec();
    if (!sub) return;

    const prev = sub.status;
    const newFailedAttempts = sub.failedAttempts + 1;
    const retryAt = new Date();
    retryAt.setDate(retryAt.getDate() + 3);

    sub.set({
      status: SubscriptionStatus.PAST_DUE,
      failedAttempts: newFailedAttempts,
      nextRetryAt: retryAt,
    });
    await sub.save();
    await this.audit('subscription', sub._id.toString(), prev, SubscriptionStatus.PAST_DUE, 'stripe_webhook', providerSubId, {
      failedAttempts: newFailedAttempts,
      nextRetryAt: retryAt,
    });

    this.logger.warn(`Subscription ${sub._id} PAST_DUE — attempt #${newFailedAttempts}`);
  }

  private async audit(
    entityType: string,
    entityId: string,
    fromStatus: string,
    toStatus: string,
    triggeredBy: string,
    providerEventId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.auditModel.create({
      entityType,
      entityId,
      fromStatus,
      toStatus,
      triggeredBy,
      triggeredById: 'webhook',
      providerEventId,
      metadata,
    });
  }
}
