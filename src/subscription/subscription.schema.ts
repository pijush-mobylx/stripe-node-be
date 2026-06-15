import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { HydratedDocument } from 'mongoose';

export type SubscriptionDocument = HydratedDocument<Subscription>;

export enum SubscriptionStatus {
  TRIALING           = 'trialing',
  ACTIVE             = 'active',
  PAST_DUE           = 'past_due',
  CANCELED           = 'canceled',
  UNPAID             = 'unpaid',
  INCOMPLETE         = 'incomplete',
  INCOMPLETE_EXPIRED = 'incomplete_expired',
  PAUSED             = 'paused',
}

@Schema({ timestamps: true, toJSON: { virtuals: true } })
export class Subscription {
  @ApiProperty()
  id: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  providerName: string;

  @Prop({ required: true, unique: true })
  providerSubId: string;

  @Prop({ required: true })
  providerCustomerId: string;

  @Prop({ required: true })
  providerPmId: string;

  @Prop()
  planId: string;

  @Prop({ required: true })
  planName: string;

  @Prop({ required: true })
  planAmount: number;

  @Prop({ required: true })
  currentPeriodStart: Date;

  @Prop({ required: true })
  currentPeriodEnd: Date;

  @Prop({ default: false })
  cancelAtPeriodEnd: boolean;

  @Prop({ default: null })
  trialEnd: Date | null;

  @Prop({ enum: SubscriptionStatus, default: SubscriptionStatus.INCOMPLETE })
  status: SubscriptionStatus;

  @Prop({ default: 0 })
  failedAttempts: number;

  @Prop({ default: null })
  nextRetryAt: Date | null;

  @Prop({ default: null })
  cancelledAt: Date | null;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
SubscriptionSchema.index({ userId: 1 });
SubscriptionSchema.index({ providerSubId: 1 }, { unique: true });
