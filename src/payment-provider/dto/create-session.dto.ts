export interface CreateSessionDto {
  userId: string;
  secret: string;
  amount: number;
  currency: string;
  description: string;
}

export interface SessionResult {
  providerIntentId: string;
  clientSecret: string;
  status: string;
}
