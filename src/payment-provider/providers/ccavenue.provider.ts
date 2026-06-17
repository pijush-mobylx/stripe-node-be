import * as crypto from 'crypto';
import {
  Injectable,
  Logger,
  NotImplementedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { IPaymentProvider } from '../interfaces/payment-provider.interface';
import type { CreateSessionDto, SessionResult } from '../dto/create-session.dto';
import type { CreateCheckoutSessionDto, ProviderPayload } from '../dto/checkout-session.dto';
import type {
  CreateSubscriptionDto,
  SubscriptionResult,
  RenewalResult,
} from '../dto/create-subscription.dto';
import type { RefundDto, RefundResult } from '../dto/refund.dto';
import type { WebhookVerifyDto, WebhookEvent } from '../dto/webhook.dto';
import type { PaymentStatusResult } from '../dto/payment-status.dto';

@Injectable()
export class CCAvenueProvider implements IPaymentProvider {
  readonly providerName = 'ccavenue';

  private readonly logger = new Logger(CCAvenueProvider.name);
  private readonly merchantId: string;
  private readonly accessCode: string;
  private readonly workingKey: string;
  private readonly paymentUrl: string;
  private readonly callbackBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.merchantId = config.getOrThrow<string>('CCAVENUE_MERCHANT_ID');
    this.accessCode = config.getOrThrow<string>('CCAVENUE_ACCESS_CODE');
    this.workingKey = config.getOrThrow<string>('CCAVENUE_WORKING_KEY');
    this.paymentUrl = config.getOrThrow<string>('CCAVENUE_PAYMENT_URL');
    this.callbackBaseUrl = config.getOrThrow<string>('CCAVENUE_CALLBACK_BASE_URL');
  }

  // ─── createCheckoutSession ────────────────────────────────────────────────
  // Returns FORM_POST action — frontend auto-submits the hidden form to CCAvenue.

  async createCheckoutSession(dto: CreateCheckoutSessionDto): Promise<ProviderPayload> {
    if (!dto.amount || !dto.currency) {
      throw new UnprocessableEntityException('CCAvenue requires amount and currency');
    }

    // CCAvenue expects actual currency amount, not smallest unit
    const amountFormatted = (dto.amount / 100).toFixed(2);
    const orderId = `WALLET-${dto.userId}-${Date.now()}`;
    const redirectUrl = `${this.callbackBaseUrl}/payments/ccavenue/callback`;

    const params = new URLSearchParams({
      merchant_id:  this.merchantId,
      order_id:     orderId,
      currency:     dto.currency.toUpperCase(),
      amount:       amountFormatted,
      redirect_url: redirectUrl,
      cancel_url:   dto.cancelUrl ?? redirectUrl,
      language:     'EN',
    });

    const encRequest = this.encrypt(params.toString());

    this.logger.log(`CCAvenue checkout created — order_id=${orderId} amount=${amountFormatted} ${dto.currency}`);

    return {
      provider: this.providerName,
      action: 'FORM_POST',
      url: this.paymentUrl,
      fields: {
        encRequest,
        access_code: this.accessCode,
      },
      sessionId: orderId,
    };
  }

  // ─── verifyWebhook ────────────────────────────────────────────────────────
  // CCAvenue callback: rawBody contains the `encResp` value (URL-encoded POST field).
  // Decrypts it and returns a normalized WebhookEvent.

  async verifyWebhook(dto: WebhookVerifyDto): Promise<WebhookEvent> {
    const encResp = dto.rawBody.toString('utf8').replace(/^encResp=/, '');

    let decrypted: string;
    try {
      decrypted = this.decrypt(encResp);
    } catch {
      this.logger.warn('CCAvenue callback decryption failed');
      throw new UnprocessableEntityException('CCAvenue: invalid encResp — decryption failed');
    }

    const parsed = new URLSearchParams(decrypted);
    const orderStatus = parsed.get('order_status') ?? '';
    const orderId     = parsed.get('order_id')     ?? '';
    const trackingId  = parsed.get('tracking_id')  ?? orderId;
    const amount      = parsed.get('amount')        ?? '0';
    const currency    = parsed.get('currency')      ?? 'INR';

    const eventType = this.resolveEventType(orderStatus);

    this.logger.log(`CCAvenue callback — order_id=${orderId} status=${orderStatus} tracking_id=${trackingId}`);

    return {
      providerEventId: trackingId,
      type: eventType,
      payload: {
        order_id:     orderId,
        order_status: orderStatus,
        tracking_id:  trackingId,
        amount,
        currency,
        ...Object.fromEntries(parsed.entries()),
      },
    };
  }

  // ─── getPaymentOrderStatus ────────────────────────────────────────────────
  // CCAvenue doesn't expose a status-check API in the standard integration.
  // Returns INITIATED so the reconciliation scheduler leaves it alone.

  async getPaymentOrderStatus(providerOrderId: string): Promise<PaymentStatusResult> {
    this.logger.debug(`CCAvenue getPaymentOrderStatus called for ${providerOrderId} — no API available`);
    return {
      providerIntentId: providerOrderId,
      status: 'initiated',
      amount: 0,
      currency: 'INR',
      frozen: false,
    };
  }

  async getStatus(providerIntentId: string): Promise<PaymentStatusResult> {
    return this.getPaymentOrderStatus(providerIntentId);
  }

  // ─── Not applicable for CCAvenue wallet top-up ───────────────────────────

  async createSession(_dto: CreateSessionDto): Promise<SessionResult> {
    throw new NotImplementedException('CCAvenue does not support createSession');
  }

  async createSubscription(_dto: CreateSubscriptionDto): Promise<SubscriptionResult> {
    throw new NotImplementedException('CCAvenue does not support subscriptions');
  }

  async cancelSubscription(_providerSubId: string): Promise<{ status: string; cancelAtPeriodEnd: boolean }> {
    throw new NotImplementedException('CCAvenue does not support subscriptions');
  }

  async renewSubscription(_providerSubId: string): Promise<RenewalResult> {
    throw new NotImplementedException('CCAvenue does not support subscriptions');
  }

  async refundPayment(_dto: RefundDto): Promise<RefundResult> {
    throw new NotImplementedException('CCAvenue refunds must be initiated from the merchant dashboard');
  }

  // ─── AES-128-ECB encryption ───────────────────────────────────────────────
  // Key = first 16 bytes of MD5(workingKey) — per CCAvenue integration guide.

  private getAesKey(): Buffer {
    return crypto.createHash('md5').update(this.workingKey).digest();
  }

  private encrypt(plaintext: string): string {
    const key = this.getAesKey();
    const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('hex');
  }

  private decrypt(cipherHex: string): string {
    const key = this.getAesKey();
    const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    decipher.setAutoPadding(true);
    const encrypted = Buffer.from(cipherHex, 'hex');
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  private resolveEventType(orderStatus: string): string {
    switch (orderStatus) {
      case 'Success':  return 'ccavenue.payment.success';
      case 'Aborted':  return 'ccavenue.payment.aborted';
      default:         return 'ccavenue.payment.failed';
    }
  }
}
