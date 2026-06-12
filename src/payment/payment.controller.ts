import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { Payment } from './payment.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('initiate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate payment — returns provider redirect URL' })
  @ApiResponse({ status: 201, description: 'ProviderPayload with redirect URL' })
  initiate(
    @Request() req: { user: { userId: string } },
    @Body() dto: InitiatePaymentDto,
  ) {
    return this.paymentService.initiatePayment(req.user.userId, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create a payment intent' })
  @ApiResponse({ status: 201, type: Payment })
  create(@Body() dto: CreatePaymentDto): Promise<Payment> {
    return this.paymentService.createPayment(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List payments (optionally filter by userId)' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiResponse({ status: 200, type: [Payment] })
  findAll(@Query('userId') userId?: string): Promise<Payment[]> {
    return this.paymentService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: Payment })
  getStatus(@Param('id', ParseUUIDPipe) id: string): Promise<Payment> {
    return this.paymentService.getStatus(id);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed payment — re-checks status from provider' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: Payment })
  retry(@Param('id', ParseUUIDPipe) id: string): Promise<Payment> {
    return this.paymentService.retryPayment(id);
  }

  @Post(':id/sync')
  @ApiOperation({ summary: 'Sync payment status from provider' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: Payment })
  sync(@Param('id', ParseUUIDPipe) id: string): Promise<Payment> {
    return this.paymentService.syncProviderStatus(id);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Refund a succeeded payment (full or partial)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: Payment })
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
  ): Promise<Payment> {
    return this.paymentService.refundPayment(id, dto);
  }
}
