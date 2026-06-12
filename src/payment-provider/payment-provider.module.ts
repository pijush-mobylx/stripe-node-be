import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StripeProvider } from './providers/stripe.provider';
import { PaymentProviderFactory } from './payment-provider.factory';
import { PaymentProviderConfig } from './payment-provider-config.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentProviderConfig])],
  providers: [StripeProvider, PaymentProviderFactory],
  exports: [PaymentProviderFactory],
})
export class PaymentProviderModule {}
