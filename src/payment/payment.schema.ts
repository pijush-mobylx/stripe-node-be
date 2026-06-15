import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { HydratedDocument } from 'mongoose';

export type PaymentDocument = HydratedDocument<Payment>;

export enum PaymentType {
  ONE_TIME           = 'ONE_TIME',
  SUBSCRIPTION       = 'SUBSCRIPTION',
  MARKETPLACE_ORDER  = 'MARKETPLACE_ORDER',
}

export enum PaymentStatus {
  INITIATED    = 'initiated',
  SUCCESS      = 'success',
  FAILED       = 'failed',
  NEEDS_REVIEW = 'needs_review',
  EXPIRED      = 'expired',
  REFUNDED     = 'refunded',
}

@Schema({ timestamps: true, toJSON: { virtuals: true } })
export class Payment {
  @ApiProperty()
  id: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, enum: PaymentType })
  type: PaymentType;

  // ── one-time only ──────────────────────────────────────────
  @Prop({ default: null })
  orderId: string | null;

  // ── subscription only ──────────────────────────────────────
  @Prop({ default: null })
  subscriptionId: string | null;

  @Prop({ default: null })
  planId: string | null;

  @Prop({ default: null })
  billingPeriodStart: Date | null;

  @Prop({ default: null })
  billingPeriodEnd: Date | null;

  @Prop({ default: null })
  invoiceId: string | null;

  // ── provider ───────────────────────────────────────────────
  @Prop({ required: true })
  providerName: string;

  @Prop({ required: true, unique: true })
  providerIntentId: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ enum: PaymentStatus, default: PaymentStatus.INITIATED })
  status: PaymentStatus;

  @Prop({ default: false })
  frozen: boolean;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ userId: 1 });
PaymentSchema.index({ providerIntentId: 1 }, { unique: true });
