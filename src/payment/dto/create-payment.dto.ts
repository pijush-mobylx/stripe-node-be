import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { PaymentType } from '../payment.entity';

export class CreatePaymentDto {
  @ApiProperty({ example: 'uuid-of-user' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: PaymentType, example: PaymentType.ONE_TIME })
  @IsEnum(PaymentType)
  type: PaymentType;

  @ApiProperty({ example: 3000, description: 'Amount in cents' })
  @IsInt()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 'usd' })
  @IsString()
  @Length(3, 3)
  currency: string;

  @ApiPropertyOptional({ example: 'Pro plan purchase' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'stripe' })
  @IsString()
  providerName: string;

  // ── ONE_TIME only ──────────────────────────────────────────────────────────
  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  orderId?: string;

  // ── SUBSCRIPTION only ──────────────────────────────────────────────────────
  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  subscriptionId?: string;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  planId?: string;
}
