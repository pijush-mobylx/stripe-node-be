import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from './subscription.entity';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { Plan } from '../plan/plan.entity';
import { User } from '../user/user.entity';
import { AuditLog } from '../audit-log/audit-log.entity';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, Plan, User, AuditLog]),
    PaymentProviderModule,
  ],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
