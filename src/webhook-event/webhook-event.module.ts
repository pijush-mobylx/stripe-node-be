import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { WebhookEvent, WebhookEventSchema } from './webhook-event.schema';
import { WebhookHandlerFactory } from './webhook-handler.factory';
import { WebhookController } from './webhook.controller';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';
import { PaymentCallbackModule } from '../payment-callback/payment-callback.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: WebhookEvent.name, schema: WebhookEventSchema }]),
    PaymentProviderModule,
    PaymentCallbackModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookHandlerFactory],
  exports: [WebhookHandlerFactory],
})
export class WebhookEventModule {}
