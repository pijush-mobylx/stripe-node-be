import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PAYMENT_SUCCESS_EVENT, PaymentSuccessEvent } from './payment-success.event';
import { User } from '../user/user.entity';

@Injectable()
export class ReceiptEmailListener {
  private readonly logger = new Logger(ReceiptEmailListener.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  @OnEvent(PAYMENT_SUCCESS_EVENT, { async: true })
  async handlePaymentSuccess(event: PaymentSuccessEvent): Promise<void> {
    try {
      const user = await this.userRepo.findOne({ where: { id: event.userId } });
      if (!user) {
        this.logger.warn(`ReceiptEmailListener: user ${event.userId} not found`);
        return;
      }

      // TODO: replace with real mailer (e.g. SendGrid, SES) when email service is wired
      this.logger.log(
        `[RECEIPT] To: ${user.email} | Payment: ${event.paymentId} | ` +
        `Amount: ${event.amount} | Provider: ${event.providerName}`,
      );
    } catch (err) {
      // Listener failures must never crash the main pipeline — log and swallow
      this.logger.error(
        `ReceiptEmailListener failed for payment ${event.paymentId}: ${(err as Error).message}`,
      );
    }
  }
}
