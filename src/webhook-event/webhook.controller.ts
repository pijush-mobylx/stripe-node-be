import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  RawBodyRequest,
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
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    return this.webhookHandlerFactory.processWebhook(
      'stripe',
      req.rawBody,
      signature,
    );
  }

  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generic webhook receiver — routes by provider name' })
  @ApiParam({ name: 'provider', example: 'razorpay' })
  @ApiResponse({ status: 200, schema: { example: { received: true } } })
  handleProvider(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-signature') signature: string,
  ): Promise<{ received: boolean }> {
    return this.webhookHandlerFactory.processWebhook(
      provider,
      req.rawBody,
      signature,
    );
  }
}
