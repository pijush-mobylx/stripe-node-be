import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { HydratedDocument } from 'mongoose';

export type PlanDocument = HydratedDocument<Plan>;

@Schema({ timestamps: true, toJSON: { virtuals: true } })
export class Plan {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Pro' })
  @Prop({ required: true })
  name: string;

  @ApiProperty({ example: 'stripe' })
  @Prop({ required: true })
  providerName: string;

  @ApiProperty()
  @Prop({ required: true, unique: true })
  providerPlanId: string;

  @ApiProperty({ example: 3000 })
  @Prop({ required: true })
  amount: number;

  @ApiProperty({ example: 'usd' })
  @Prop({ required: true, maxlength: 3 })
  currency: string;

  @ApiProperty({ example: 'month' })
  @Prop({ required: true })
  interval: string;

  @ApiProperty({ example: 1 })
  @Prop({ default: 1 })
  intervalCount: number;

  @ApiProperty({ example: 0 })
  @Prop({ default: 0 })
  trialDays: number;

  @ApiProperty()
  @Prop({ type: Object, default: {} })
  features: Record<string, unknown>;

  @ApiProperty()
  @Prop({ default: true })
  isActive: boolean;
}

export const PlanSchema = SchemaFactory.createForClass(Plan);
