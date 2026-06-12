import type { CreateSessionDto, SessionResult } from '../dto/create-session.dto';
import type { CreateCheckoutSessionDto, ProviderPayload } from '../dto/checkout-session.dto';
import type {
  CreateSubscriptionDto,
  SubscriptionResult,
  RenewalResult,
} from '../dto/create-subscription.dto';
import type { RefundDto, RefundResult } from '../dto/refund.dto';
import type { WebhookVerifyDto, WebhookEvent } from '../dto/webhook.dto';
import type { PaymentStatusResult } from '../dto/payment-status.dto';

export interface IPaymentProvider {
  /** Provider identifier e.g. "stripe", "razorpay", "paytm" */
  readonly providerName: string;

  /**
   * Create a payment intent / order session.
   * Returns a client secret the frontend uses to confirm the payment.
   */
  createSession(dto: CreateSessionDto): Promise<SessionResult>;

  /**
   * Create a hosted Checkout Session.
   * Returns a normalized ProviderPayload; frontend redirects to `url`.
   */
  createCheckoutSession(dto: CreateCheckoutSessionDto): Promise<ProviderPayload>;

  /**
   * Fetch the canonical status of a payment order by provider ID.
   * Accepts either a Checkout Session ID or a PaymentIntent ID.
   * Used by ReconciliationScheduler to heal stale INITIATED orders.
   */
  getPaymentOrderStatus(providerOrderId: string): Promise<PaymentStatusResult>;

  /**
   * Create a recurring subscription for a customer.
   * trialDays is applied when present.
   */
  createSubscription(dto: CreateSubscriptionDto): Promise<SubscriptionResult>;

  /**
   * Issue a full or partial refund against a payment intent.
   */
  refundPayment(dto: RefundDto): Promise<RefundResult>;

  /**
   * Fetch the current status of a payment intent from the provider.
   */
  getStatus(providerIntentId: string): Promise<PaymentStatusResult>;

  /**
   * Cancel a subscription.
   * atPeriodEnd=true cancels at the end of the billing cycle (default).
   * atPeriodEnd=false cancels immediately.
   */
  cancelSubscription(
    providerSubId: string,
    atPeriodEnd?: boolean,
  ): Promise<{ status: string; cancelAtPeriodEnd: boolean }>;

  /**
   * Renew / resume a subscription (e.g. after a failed payment retry).
   */
  renewSubscription(
    providerSubId: string,
    newProviderPmId?: string,
  ): Promise<RenewalResult>;

  /**
   * Verify webhook signature and parse the raw body into a typed event.
   * Throws if the signature is invalid.
   */
  verifyWebhook(dto: WebhookVerifyDto): Promise<WebhookEvent>;
}

export const PAYMENT_PROVIDER = Symbol('IPaymentProvider');
