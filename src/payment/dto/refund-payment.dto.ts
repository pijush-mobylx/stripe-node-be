import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class RefundPaymentDto {
  @ApiPropertyOptional({ example: 1500, description: 'Partial refund amount in cents. Omit for full refund.' })
  @IsInt()
  @IsPositive()
  @IsOptional()
  amount?: number;

  @ApiPropertyOptional({ example: 'duplicate', enum: ['duplicate', 'fraudulent', 'requested_by_customer'] })
  @IsString()
  @IsOptional()
  reason?: string;
}
