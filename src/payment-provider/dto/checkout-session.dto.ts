export interface CreateCheckoutSessionDto {
  userId: string;
  planId: string;
  /** Stripe Price ID (price_xxx) — fetched from Plan.providerPlanId, never sent by client. */
  providerPlanId: string;
  /** ONE_TIME → mode: 'payment' | SUBSCRIPTION → mode: 'subscription' */
  paymentType: string;
  successUrl: string;
  cancelUrl: string;
  /** Amount in smallest currency unit (paise/cents). Required for CCAvenue. */
  amount?: number;
  /** ISO-4217 currency code e.g. "INR". Required for CCAvenue. */
  currency?: string;
  metadata?: Record<string, string>;
}

/** Normalized response — frontend switches on `action`, never on `provider`. */
export interface ProviderPayload {
  provider: string;
  action: 'REDIRECT' | 'FORM_POST';
  url: string;
  /** Only present for FORM_POST providers (e.g. CCAvenue). */
  fields?: Record<string, string>;
  sessionId: string;
}
