import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres'),
        database: config.get<string>('DB_NAME', 'stripe_node_db'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: true,
        logging: true,
      }),
    }),
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
  ],
})
export class AppModule {}
