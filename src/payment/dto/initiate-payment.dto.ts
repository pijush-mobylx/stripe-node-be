import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsUrl } from 'class-validator';
import { PaymentType } from '../payment.schema';

export class InitiatePaymentDto {
  @ApiProperty({ example: '6650a1b2c3d4e5f6a7b8c9d0' })
  @IsMongoId()
  planId: string;

  @ApiProperty({ enum: PaymentType, example: PaymentType.ONE_TIME })
  @IsEnum(PaymentType)
  paymentType: PaymentType;

  @ApiProperty({ example: 'https://yourapp.com/payment/success' })
  @IsUrl({ require_tld: false })
  successUrl: string;

  @ApiPropertyOptional({ example: 'https://yourapp.com/payment/cancel' })
  @IsUrl({ require_tld: false })
  cancelUrl: string;
}
