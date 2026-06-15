import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReconciliationScheduler } from './reconciliation.scheduler';
import { Payment, PaymentSchema } from '../payment/payment.schema';
import { AuditLog, AuditLogSchema } from '../audit-log/audit-log.schema';
import { ProvisioningOutbox, ProvisioningOutboxSchema } from '../provisioning-outbox/provisioning-outbox.schema';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: ProvisioningOutbox.name, schema: ProvisioningOutboxSchema },
    ]),
    PaymentProviderModule,
  ],
  providers: [ReconciliationScheduler],
})
export class ReconciliationModule {}
