import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ProvisioningOutboxDocument = HydratedDocument<ProvisioningOutbox>;

export enum ProvisioningType {
  ACTIVATE_SUBSCRIPTION = 'ACTIVATE_SUBSCRIPTION',
  SEND_RECEIPT          = 'SEND_RECEIPT',
  GRANT_ENTITLEMENT     = 'GRANT_ENTITLEMENT',
}

export enum OutboxStatus {
  PENDING    = 'PENDING',
  PROCESSING = 'PROCESSING',
  DONE       = 'DONE',
  FAILED     = 'FAILED',
}

@Schema({ timestamps: true, toJSON: { virtuals: true } })
export class ProvisioningOutbox {
  @Prop({ required: true, unique: true })
  jobId: string;

  @Prop({ required: true, enum: ProvisioningType })
  provisioningType: ProvisioningType;

  @Prop({ enum: OutboxStatus, default: OutboxStatus.PENDING })
  status: OutboxStatus;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ default: 5 })
  maxRetries: number;

  @Prop({ default: null })
  lastError: string | null;

  @Prop({ default: null })
  processedAt: Date | null;

  @Prop({ type: Object, default: {} })
  payload: Record<string, unknown>;
}

export const ProvisioningOutboxSchema = SchemaFactory.createForClass(ProvisioningOutbox);
ProvisioningOutboxSchema.index({ status: 1 });
