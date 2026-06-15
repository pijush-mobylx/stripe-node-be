import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { HydratedDocument } from 'mongoose';

export type PaymentMethodDocument = HydratedDocument<PaymentMethod>;

@Schema({ timestamps: true, toJSON: { virtuals: true } })
export class PaymentMethod {
  @ApiProperty()
  id: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  providerName: string;

  @Prop({ required: true })
  providerPmId: string;

  @Prop({ required: true, maxlength: 4 })
  cardLast4: string;

  @Prop({ required: true })
  cardBrand: string;

  @Prop({ required: true })
  expMonth: number;

  @Prop({ required: true })
  expYear: number;

  @Prop({ required: true })
  methodType: string;

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ default: false })
  isExpired: boolean;
}

export const PaymentMethodSchema = SchemaFactory.createForClass(PaymentMethod);
PaymentMethodSchema.index({ userId: 1 });
