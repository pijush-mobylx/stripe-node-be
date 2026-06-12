import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsUrl, IsUUID } from 'class-validator';
import { PaymentType } from '../payment.entity';

export class InitiatePaymentDto {
  @ApiProperty({ example: 'uuid-of-plan' })
  @IsUUID()
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
