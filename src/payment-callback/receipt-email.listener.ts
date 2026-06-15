import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PAYMENT_SUCCESS_EVENT, PaymentSuccessEvent } from './payment-success.event';
import { User, UserDocument } from '../user/user.schema';

@Injectable()
export class ReceiptEmailListener {
  private readonly logger = new Logger(ReceiptEmailListener.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  @OnEvent(PAYMENT_SUCCESS_EVENT, { async: true })
  async handlePaymentSuccess(event: PaymentSuccessEvent): Promise<void> {
    try {
      const user = await this.userModel.findById(event.userId).exec();
      if (!user) {
        this.logger.warn(`ReceiptEmailListener: user ${event.userId} not found`);
        return;
      }

      // TODO: replace with real mailer (e.g. SendGrid, SES)
      this.logger.log(
        `[RECEIPT] To: ${user.email} | Payment: ${event.paymentId} | ` +
        `Amount: ${event.amount} | Provider: ${event.providerName}`,
      );
    } catch (err) {
      this.logger.error(
        `ReceiptEmailListener failed for payment ${event.paymentId}: ${(err as Error).message}`,
      );
    }
  }
}
