import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StripeProvider } from './providers/stripe.provider';
import { CCAvenueProvider } from './providers/ccavenue.provider';
import { PaymentProviderFactory } from './payment-provider.factory';
import { PaymentProviderConfig, PaymentProviderConfigSchema } from './payment-provider-config.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PaymentProviderConfig.name, schema: PaymentProviderConfigSchema }]),
  ],
  providers: [StripeProvider, CCAvenueProvider, PaymentProviderFactory],
  exports: [PaymentProviderFactory],
})
export class PaymentProviderModule {}
