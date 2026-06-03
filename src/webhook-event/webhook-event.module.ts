import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WebhookEvent } from './webhook-event.entity';
import { WebhookHandlerFactory } from './webhook-handler.factory';
import { WebhookController } from './webhook.controller';
import { StripeEventHandler } from './handlers/stripe-event.handler';

import { Payment } from '../payment/payment.entity';
import { Subscription } from '../subscription/subscription.entity';
import { User } from '../user/user.entity';
import { AuditLog } from '../audit-log/audit-log.entity';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent, Payment, Subscription, User, AuditLog]),
    PaymentProviderModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookHandlerFactory, StripeEventHandler],
  exports: [WebhookHandlerFactory],
})
export class WebhookEventModule {}
