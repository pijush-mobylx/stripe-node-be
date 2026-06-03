export interface PaymentStatusResult {
  providerIntentId: string;
  status: string;
  amount: number;
  currency: string;
  frozen: boolean;
}
