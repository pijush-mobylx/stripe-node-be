import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsPositive,
  IsString,
  Length,
} from 'class-validator';
import { PaymentType } from '../payment.schema';

export class CreatePaymentDto {
  @ApiProperty({ example: '6650a1b2c3d4e5f6a7b8c9d0' })
  @IsMongoId()
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
  @IsMongoId()
  @IsOptional()
  orderId?: string;

  // ── SUBSCRIPTION only ──────────────────────────────────────────────────────
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  subscriptionId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  planId?: string;
}
