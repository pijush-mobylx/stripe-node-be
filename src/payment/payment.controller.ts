import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Redirect,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('initiate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate payment — returns provider redirect URL' })
  initiate(
    @Request() req: { user: { userId: string } },
    @Body() dto: InitiatePaymentDto,
  ) {
    return this.paymentService.initiatePayment(req.user.userId, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create a payment intent' })
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentService.createPayment(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List payments (optionally filter by userId)' })
  @ApiQuery({ name: 'userId', required: false })
  findAll(@Query('userId') userId?: string) {
    return this.paymentService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment by ID' })
  @ApiParam({ name: 'id' })
  getStatus(@Param('id') id: string) {
    return this.paymentService.getStatus(id);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed payment — re-checks status from provider' })
  @ApiParam({ name: 'id' })
  retry(@Param('id') id: string) {
    return this.paymentService.retryPayment(id);
  }

  @Post(':id/sync')
  @ApiOperation({ summary: 'Sync payment status from provider' })
  @ApiParam({ name: 'id' })
  sync(@Param('id') id: string) {
    return this.paymentService.syncProviderStatus(id);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Refund a succeeded payment (full or partial)' })
  @ApiParam({ name: 'id' })
  refund(@Param('id') id: string, @Body() dto: RefundPaymentDto) {
    return this.paymentService.refundPayment(id, dto);
  }

  // ─── CCAvenue callback ────────────────────────────────────────────────────
  // CCAvenue POSTs application/x-www-form-urlencoded with `encResp` after payment.
  // We decrypt, update the payment, then redirect the user's browser to the frontend.

  @Post('ccavenue/callback')
  @HttpCode(HttpStatus.OK)
  @Redirect()
  @ApiOperation({ summary: 'CCAvenue payment callback — receives encrypted result and redirects to frontend' })
  async ccavenueCallback(@Body('encResp') encResp: string) {
    const result = await this.paymentService.handleCCAvenueCallback(encResp);
    return { url: result.redirectUrl, statusCode: HttpStatus.FOUND };
  }
}
