export interface WebhookVerifyDto {
  rawBody: Buffer;
  signature: string;
}

export interface WebhookEvent {
  providerEventId: string;
  type: string;
  payload: Record<string, unknown>;
}
