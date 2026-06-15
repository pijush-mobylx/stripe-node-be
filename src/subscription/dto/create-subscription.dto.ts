import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString } from 'class-validator';

export class CreateSubscriptionDto {
  @ApiProperty({ example: '6650a1b2c3d4e5f6a7b8c9d0' })
  @IsMongoId()
  userId: string;

  @ApiProperty({ example: '6650a1b2c3d4e5f6a7b8c9d1' })
  @IsMongoId()
  planId: string;

  @ApiProperty({ example: 'cus_stripe_customer_id' })
  @IsString()
  providerCustomerId: string;

  @ApiProperty({ example: 'pm_stripe_payment_method_id' })
  @IsString()
  providerPmId: string;

  @ApiPropertyOptional({ example: 'stripe' })
  @IsString()
  @IsOptional()
  providerName?: string;
}
