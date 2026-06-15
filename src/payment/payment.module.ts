import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from './payment.schema';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';
import { AuditLog, AuditLogSchema } from '../audit-log/audit-log.schema';
import { Plan, PlanSchema } from '../plan/plan.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Plan.name, schema: PlanSchema },
    ]),
    PaymentProviderModule,
    AuthModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService, MongooseModule],
})
export class PaymentModule {}
