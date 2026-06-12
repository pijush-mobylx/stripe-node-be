import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WebhookEvent } from './webhook-event.entity';
import { WebhookHandlerFactory } from './webhook-handler.factory';
import { WebhookController } from './webhook.controller';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';
import { PaymentCallbackModule } from '../payment-callback/payment-callback.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent]),
    PaymentProviderModule,
    PaymentCallbackModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookHandlerFactory],
  exports: [WebhookHandlerFactory],
})
export class WebhookEventModule {}
