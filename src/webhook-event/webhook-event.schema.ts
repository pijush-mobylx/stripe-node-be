import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { HydratedDocument } from 'mongoose';

export type WebhookEventDocument = HydratedDocument<WebhookEvent>;

export enum WebhookStatus {
  PENDING   = 'pending',
  PROCESSED = 'processed',
  FAILED    = 'failed',
  IGNORED   = 'ignored',
}

@Schema({ timestamps: true, toJSON: { virtuals: true } })
export class WebhookEvent {
  @ApiProperty()
  id: string;

  @Prop({ required: true })
  providerEventId: string;

  @Prop({ required: true })
  providerName: string;

  @Prop({ required: true })
  type: string;

  @Prop({ enum: WebhookStatus, default: WebhookStatus.PENDING })
  status: WebhookStatus;

  @Prop({ type: Object, required: true })
  rawPayload: Record<string, unknown>;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ default: null })
  lastError: string | null;

  @Prop({ default: null })
  processedAt: Date | null;
}

export const WebhookEventSchema = SchemaFactory.createForClass(WebhookEvent);
// Dedup index — same as the Postgres unique constraint
WebhookEventSchema.index({ providerName: 1, providerEventId: 1 }, { unique: true });
