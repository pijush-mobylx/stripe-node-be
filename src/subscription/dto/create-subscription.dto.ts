import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateSubscriptionDto {
  @ApiProperty({ example: 'uuid-of-user' })
  @IsUUID()
  userId: string;

  @ApiProperty({ example: 'uuid-of-plan' })
  @IsUUID()
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
