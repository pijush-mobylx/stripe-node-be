import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PAYMENT_SUCCESS_EVENT, PaymentSuccessEvent } from './payment-success.event';
import { AuditLog, AuditLogDocument } from '../audit-log/audit-log.schema';

@Injectable()
export class AnalyticsListener {
  private readonly logger = new Logger(AnalyticsListener.name);

  constructor(
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
  ) {}

  @OnEvent(PAYMENT_SUCCESS_EVENT, { async: true })
  async handlePaymentSuccess(event: PaymentSuccessEvent): Promise<void> {
    try {
      await this.auditModel.create({
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
      });

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
