import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentCallbackService } from './payment-callback.service';
import { ReceiptEmailListener } from './receipt-email.listener';
import { AnalyticsListener } from './analytics.listener';
import { WebhookEvent, WebhookEventSchema } from '../webhook-event/webhook-event.schema';
import { Payment, PaymentSchema } from '../payment/payment.schema';
import { AuditLog, AuditLogSchema } from '../audit-log/audit-log.schema';
import { ProvisioningOutbox, ProvisioningOutboxSchema } from '../provisioning-outbox/provisioning-outbox.schema';
import { User, UserSchema } from '../user/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WebhookEvent.name, schema: WebhookEventSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: ProvisioningOutbox.name, schema: ProvisioningOutboxSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [PaymentCallbackService, ReceiptEmailListener, AnalyticsListener],
  exports: [PaymentCallbackService],
})
export class PaymentCallbackModule {}
