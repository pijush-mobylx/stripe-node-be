export interface RefundDto {
  providerIntentId: string;
  amount?: number;
  reason?: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: string;
  amount: number;
}
