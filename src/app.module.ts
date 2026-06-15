import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { UserModule } from './user/user.module';
import { PlanModule } from './plan/plan.module';
import { PaymentMethodModule } from './payment-method/payment-method.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { PaymentModule } from './payment/payment.module';
import { WebhookEventModule } from './webhook-event/webhook-event.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { PaymentProviderModule } from './payment-provider/payment-provider.module';
import { AuthModule } from './auth/auth.module';
import { ProvisioningOutboxModule } from './provisioning-outbox/provisioning-outbox.module';
import { PaymentCallbackModule } from './payment-callback/payment-callback.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    UserModule,
    PlanModule,
    PaymentMethodModule,
    SubscriptionModule,
    PaymentModule,
    WebhookEventModule,
    AuditLogModule,
    PaymentProviderModule,
    AuthModule,
    ProvisioningOutboxModule,
    PaymentCallbackModule,
    ReconciliationModule,
  ],
})
export class AppModule {}
