import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentCallbackService } from './payment-callback.service';
import { WebhookEvent } from '../webhook-event/webhook-event.entity';
import { Payment } from '../payment/payment.entity';
import { AuditLog } from '../audit-log/audit-log.entity';
import { ProvisioningOutbox } from '../provisioning-outbox/provisioning-outbox.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent, Payment, AuditLog, ProvisioningOutbox]),
  ],
  providers: [PaymentCallbackService],
  exports: [PaymentCallbackService],
})
export class PaymentCallbackModule {}
