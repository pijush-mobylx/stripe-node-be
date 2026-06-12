import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PAYMENT_SUCCESS_EVENT, PaymentSuccessEvent } from './payment-success.event';
import { AuditLog } from '../audit-log/audit-log.entity';

@Injectable()
export class AnalyticsListener {
  private readonly logger = new Logger(AnalyticsListener.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  @OnEvent(PAYMENT_SUCCESS_EVENT, { async: true })
  async handlePaymentSuccess(event: PaymentSuccessEvent): Promise<void> {
    try {
      await this.auditRepo.save(
        this.auditRepo.create({
          entityType: 'analytics',
          entityId: event.paymentId,
          fromStatus: null,
          toStatus: 'success',
          triggeredBy: 'event',
          triggeredById: event.providerName,
          providerEventId: event.providerEventId,
          metadata: {
            userId: event.userId,
            planId: event.planId,
            amount: event.amount,
            currency: event.currency,
            providerName: event.providerName,
          },
        }),
      );

      // TODO: forward to external analytics sink (Segment, Mixpanel, etc.)
      this.logger.log(
        `[ANALYTICS] payment.success recorded — payment ${event.paymentId} ` +
        `user ${event.userId} amount ${event.amount}`,
      );
    } catch (err) {
      this.logger.error(
        `AnalyticsListener failed for payment ${event.paymentId}: ${(err as Error).message}`,
      );
    }
  }
}
