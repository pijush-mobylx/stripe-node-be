import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StripeLib = require('stripe');

import type { IPaymentProvider } from '../interfaces/payment-provider.interface';
import type { CreateSessionDto, SessionResult } from '../dto/create-session.dto';
import type {
  CreateSubscriptionDto,
  SubscriptionResult,
  RenewalResult,
} from '../dto/create-subscription.dto';
import type { RefundDto, RefundResult } from '../dto/refund.dto';
import type { WebhookVerifyDto, WebhookEvent } from '../dto/webhook.dto';
import type { PaymentStatusResult } from '../dto/payment-status.dto';

@Injectable()
export class StripeProvider implements IPaymentProvider {
  readonly providerName = 'stripe';

  private readonly stripe: ReturnType<typeof StripeLib>;
  private readonly webhookSecret: string;
  private readonly logger = new Logger(StripeProvider.name);

  constructor(private readonly config: ConfigService) {
    this.stripe = StripeLib(config.getOrThrow<string>('STRIPE_SECRET_KEY'), {
      apiVersion: '2026-05-27.dahlia',
    });
    this.webhookSecret = config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
  }

  // ─── createSession ────────────────────────────────────────────────────────

  async createSession(dto: CreateSessionDto): Promise<SessionResult> {
    const intent = await this.stripe.paymentIntents.create({
      amount: dto.amount,
      currency: dto.currency,
      description: dto.description,
      metadata: { userId: dto.userId },
    });

    this.logger.log(`Created PaymentIntent ${intent.id} for user ${dto.userId}`);

    return {
      providerIntentId: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status,
    };
  }

  // ─── createSubscription ───────────────────────────────────────────────────

  async createSubscription(dto: CreateSubscriptionDto): Promise<SubscriptionResult> {
    const params: Record<string, unknown> = {
      customer: dto.providerCustomerId,
      items: [{ price: dto.providerPlanId }],
      default_payment_method: dto.providerPmId,
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
      metadata: { userId: dto.userId },
    };

    if (dto.trialDays && dto.trialDays > 0) {
      params.trial_period_days = dto.trialDays;
    }

    const sub = await this.stripe.subscriptions.create(params);

    this.logger.log(`Created Subscription ${sub.id} for customer ${dto.providerCustomerId}`);

    return this.mapSubscription(sub);
  }

  // ─── refundPayment ────────────────────────────────────────────────────────

  async refundPayment(dto: RefundDto): Promise<RefundResult> {
    const params: Record<string, unknown> = {
      payment_intent: dto.providerIntentId,
    };
    if (dto.amount) params.amount = dto.amount;
    if (dto.reason) params.reason = dto.reason;

    const refund = await this.stripe.refunds.create(params);

    this.logger.log(`Refund ${refund.id} created for intent ${dto.providerIntentId}`);

    return {
      providerRefundId: refund.id,
      status: refund.status ?? 'unknown',
      amount: refund.amount,
    };
  }

  // ─── getStatus ────────────────────────────────────────────────────────────

  async getStatus(providerIntentId: string): Promise<PaymentStatusResult> {
    const intent = await this.stripe.paymentIntents.retrieve(providerIntentId);

    return {
      providerIntentId: intent.id,
      status: intent.status,
      amount: intent.amount,
      currency: intent.currency,
      frozen: intent.status === 'canceled',
    };
  }

  // ─── cancelSubscription ───────────────────────────────────────────────────

  async cancelSubscription(
    providerSubId: string,
    atPeriodEnd = true,
  ): Promise<{ status: string; cancelAtPeriodEnd: boolean }> {
    const sub = await this.stripe.subscriptions.update(providerSubId, {
      cancel_at_period_end: atPeriodEnd,
    });

    this.logger.log(`Subscription ${providerSubId} cancel_at_period_end=${atPeriodEnd}`);

    return {
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
  }

  // ─── renewSubscription ────────────────────────────────────────────────────

  async renewSubscription(
    providerSubId: string,
    newProviderPmId?: string,
  ): Promise<RenewalResult> {
    const params: Record<string, unknown> = {
      cancel_at_period_end: false,
    };
    if (newProviderPmId) params.default_payment_method = newProviderPmId;

    const sub = await this.stripe.subscriptions.update(providerSubId, params);

    this.logger.log(`Renewed subscription ${providerSubId}`);

    return {
      providerSubId: sub.id,
      status: sub.status,
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
    };
  }

  // ─── verifyWebhook ────────────────────────────────────────────────────────

  async verifyWebhook(dto: WebhookVerifyDto): Promise<WebhookEvent> {
    let event: { id: string; type: string; data: { object: Record<string, unknown> } };

    try {
      event = this.stripe.webhooks.constructEvent(
        dto.rawBody,
        dto.signature,
        this.webhookSecret,
      );
    } catch (err) {
      this.logger.warn(`Webhook signature verification failed: ${(err as Error).message}`);
      throw new UnprocessableEntityException('Invalid webhook signature');
    }

    this.logger.log(`Verified webhook event ${event.id} type=${event.type}`);

    return {
      providerEventId: event.id,
      type: event.type,
      payload: event.data.object,
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private mapSubscription(sub: {
    id: string;
    customer: string;
    status: string;
    current_period_start: number;
    current_period_end: number;
    trial_end: number | null;
    cancel_at_period_end: boolean;
  }): SubscriptionResult {
    return {
      providerSubId: sub.id,
      providerCustomerId: sub.customer,
      status: sub.status,
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
  }
}
