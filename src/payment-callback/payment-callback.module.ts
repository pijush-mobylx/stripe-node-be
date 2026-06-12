import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentCallbackService } from './payment-callback.service';
import { ReceiptEmailListener } from './receipt-email.listener';
import { AnalyticsListener } from './analytics.listener';
import { WebhookEvent } from '../webhook-event/webhook-event.entity';
import { Payment } from '../payment/payment.entity';
import { AuditLog } from '../audit-log/audit-log.entity';
import { ProvisioningOutbox } from '../provisioning-outbox/provisioning-outbox.entity';
import { User } from '../user/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent, Payment, AuditLog, ProvisioningOutbox, User]),
  ],
  providers: [PaymentCallbackService, ReceiptEmailListener, AnalyticsListener],
  exports: [PaymentCallbackService],
})
export class PaymentCallbackModule {}
