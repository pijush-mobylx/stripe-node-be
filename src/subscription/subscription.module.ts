import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Subscription, SubscriptionSchema } from './subscription.schema';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { Plan, PlanSchema } from '../plan/plan.schema';
import { User, UserSchema } from '../user/user.schema';
import { AuditLog, AuditLogSchema } from '../audit-log/audit-log.schema';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: User.name, schema: UserSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
    PaymentProviderModule,
  ],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService, MongooseModule],
})
export class SubscriptionModule {}
