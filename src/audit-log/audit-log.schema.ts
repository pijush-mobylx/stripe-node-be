import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { HydratedDocument } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ timestamps: { createdAt: 'timestamp', updatedAt: false }, toJSON: { virtuals: true } })
export class AuditLog {
  @ApiProperty()
  id: string;

  @Prop({ required: true })
  entityType: string;

  @Prop({ required: true })
  entityId: string;

  @Prop({ default: null })
  fromStatus: string | null;

  @Prop({ default: null })
  toStatus: string | null;

  @Prop({ required: true })
  triggeredBy: string;

  @Prop({ required: true })
  triggeredById: string;

  @Prop({ default: null })
  providerEventId: string | null;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  @Prop({ default: null })
  ipAddress: string | null;

  @ApiProperty()
  timestamp: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ entityType: 1, entityId: 1 });
