import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { WebhookHandlerFactory } from './webhook-handler.factory';

@ApiTags('webhooks')
@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookHandlerFactory: WebhookHandlerFactory) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook receiver' })
  @ApiResponse({ status: 200, schema: { example: { received: true } } })
  handleStripe(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    return this.webhookHandlerFactory.processWebhook(
      'stripe',
      req.body as Buffer,
      signature,
    );
  }

  // Generic route — ready for RazorPay / Paytm when added
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generic webhook receiver — routes by provider name' })
  @ApiParam({ name: 'provider', example: 'razorpay' })
  @ApiResponse({ status: 200, schema: { example: { received: true } } })
  handleProvider(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Headers('x-webhook-signature') signature: string,
  ): Promise<{ received: boolean }> {
    return this.webhookHandlerFactory.processWebhook(
      provider,
      req.body as Buffer,
      signature,
    );
  }
}
