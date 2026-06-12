export const PAYMENT_SUCCESS_EVENT = 'payment.success';

export class PaymentSuccessEvent {
  constructor(
    public readonly paymentId: string,
    public readonly userId: string,
    public readonly planId: string | null,
    public readonly amount: number,
    public readonly currency: string,
    public readonly providerName: string,
    public readonly providerEventId: string,
  ) {}
}
