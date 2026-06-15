import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PaymentProviderConfigDocument = HydratedDocument<PaymentProviderConfig>;

@Schema({ timestamps: true, toJSON: { virtuals: true } })
export class PaymentProviderConfig {
  /** e.g. "stripe", "ccavenue" — matches IPaymentProvider.providerName */
  @Prop({ required: true, unique: true, lowercase: true })
  providerName: string;

  @Prop({ default: true })
  isActive: boolean;

  /** ISO-4217 currency codes this provider accepts, e.g. ["usd","eur","gbp"] */
  @Prop({ type: [String], default: [] })
  supportedCurrencies: string[];

  @Prop({ default: null })
  displayName: string | null;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;
}

export const PaymentProviderConfigSchema = SchemaFactory.createForClass(PaymentProviderConfig);
