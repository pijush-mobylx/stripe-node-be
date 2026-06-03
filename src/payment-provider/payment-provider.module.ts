import { Module } from '@nestjs/common';
import { StripeProvider } from './providers/stripe.provider';
import { PaymentProviderFactory } from './payment-provider.factory';

@Module({
  providers: [StripeProvider, PaymentProviderFactory],
  exports: [PaymentProviderFactory],
})
export class PaymentProviderModule {}
