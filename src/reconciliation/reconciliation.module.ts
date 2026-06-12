import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReconciliationScheduler } from './reconciliation.scheduler';
import { Payment } from '../payment/payment.entity';
import { AuditLog } from '../audit-log/audit-log.entity';
import { ProvisioningOutbox } from '../provisioning-outbox/provisioning-outbox.entity';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, AuditLog, ProvisioningOutbox]),
    PaymentProviderModule,
  ],
  providers: [ReconciliationScheduler],
})
export class ReconciliationModule {}
