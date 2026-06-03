import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class CancelSubscriptionDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Cancel at end of billing period (default). false = cancel immediately.',
  })
  @IsBoolean()
  @IsOptional()
  atPeriodEnd?: boolean;
}
