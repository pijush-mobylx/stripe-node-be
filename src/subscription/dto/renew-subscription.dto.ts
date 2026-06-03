import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RenewSubscriptionDto {
  @ApiPropertyOptional({ example: 'pm_new_payment_method_id', description: 'Optional new payment method to use on renewal.' })
  @IsString()
  @IsOptional()
  newProviderPmId?: string;
}
