export interface CreateCheckoutSessionDto {
  userId: string;
  planId: string;
  amount: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
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
