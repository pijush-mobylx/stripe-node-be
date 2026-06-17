import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Payment, PaymentDocument, PaymentStatus } from './payment.schema';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentProviderFactory } from '../payment-provider/payment-provider.factory';
import type { ProviderPayload } from '../payment-provider/dto/checkout-session.dto';
import { AuditLog, AuditLogDocument } from '../audit-log/audit-log.schema';
import { Plan, PlanDocument } from '../plan/plan.schema';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
    @InjectModel(Plan.name) private readonly planModel: Model<PlanDocument>,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly config: ConfigService,
  ) {}

  // ─── initiatePayment ──────────────────────────────────────────────────────

  async initiatePayment(userId: string, dto: InitiatePaymentDto): Promise<ProviderPayload> {
    const plan = await this.planModel.findById(dto.planId).exec();
    if (!plan) throw new NotFoundException(`Plan #${dto.planId} not found`);
    if (!plan.isActive) throw new BadRequestException(`Plan #${dto.planId} is inactive`);

    const provider = await this.providerFactory.getProviderByPlanConfig({
      providerName: plan.providerName,
      currency: plan.currency,
    });

    const payload = await provider.createCheckoutSession({
      userId,
      planId: plan._id.toString(),
      providerPlanId: plan.providerPlanId,
      paymentType: dto.paymentType,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      amount: plan.amount,
      currency: plan.currency,
    });

    const saved = await this.paymentModel.create({
      userId,
      type: dto.paymentType,
      providerName: provider.providerName,
      providerIntentId: payload.sessionId,
      amount: plan.amount,
      status: PaymentStatus.INITIATED,
      frozen: false,
      planId: plan._id.toString(),
    });

    await this.writeAudit({
      entityType: 'payment',
      entityId: saved._id.toString(),
      fromStatus: null,
      toStatus: PaymentStatus.INITIATED,
      triggeredBy: 'user',
      triggeredById: userId,
      metadata: { sessionId: payload.sessionId, planId: plan._id.toString(), currency: plan.currency },
    });

    this.logger.log(`Payment ${saved._id} initiated — session ${payload.sessionId}`);
    return payload;
  }

  // ─── createPayment ────────────────────────────────────────────────────────

  async createPayment(dto: CreatePaymentDto): Promise<PaymentDocument> {
    const provider = await this.providerFactory.getProvider(dto.providerName);

    const session = await provider.createSession({
      userId: dto.userId,
      secret: '',
      amount: dto.amount,
      currency: dto.currency,
      description: dto.description ?? '',
    });

    const saved = await this.paymentModel.create({
      userId: dto.userId,
      type: dto.type,
      providerName: dto.providerName,
      providerIntentId: session.providerIntentId,
      amount: dto.amount,
      status: PaymentStatus.INITIATED,
      frozen: false,
      orderId: dto.orderId ?? null,
      subscriptionId: dto.subscriptionId ?? null,
      planId: dto.planId ?? null,
    });

    await this.writeAudit({
      entityType: 'payment',
      entityId: saved._id.toString(),
      fromStatus: null,
      toStatus: PaymentStatus.INITIATED,
      triggeredBy: 'user',
      triggeredById: dto.userId,
      metadata: { providerIntentId: session.providerIntentId, clientSecret: session.clientSecret },
    });

    this.logger.log(`Payment ${saved._id} created — intent ${session.providerIntentId}`);
    return saved;
  }

  // ─── retryPayment ─────────────────────────────────────────────────────────

  async retryPayment(paymentId: string): Promise<PaymentDocument> {
    const payment = await this.findOneOrFail(paymentId);

    if (payment.frozen) {
      throw new BadRequestException('Payment is frozen and cannot be retried.');
    }
    if (payment.status === PaymentStatus.SUCCESS) {
      throw new BadRequestException('Payment already succeeded.');
    }

    const provider = await this.providerFactory.getProvider(payment.providerName);
    const result = await provider.getStatus(payment.providerIntentId);

    const prevStatus = payment.status;
    payment.set({ status: result.status as PaymentStatus, ...(result.frozen ? { frozen: true } : {}) });
    await payment.save();

    await this.writeAudit({
      entityType: 'payment',
      entityId: payment._id.toString(),
      fromStatus: prevStatus,
      toStatus: payment.status,
      triggeredBy: 'system',
      triggeredById: 'retry',
      metadata: { providerIntentId: payment.providerIntentId },
    });

    this.logger.log(`Retried payment ${paymentId} — status: ${payment.status}`);
    return payment;
  }

  // ─── getStatus ────────────────────────────────────────────────────────────

  async getStatus(paymentId: string): Promise<PaymentDocument> {
    return this.findOneOrFail(paymentId);
  }

  // ─── syncProviderStatus ───────────────────────────────────────────────────

  async syncProviderStatus(paymentId: string): Promise<PaymentDocument> {
    const payment = await this.findOneOrFail(paymentId);
    const provider = await this.providerFactory.getProvider(payment.providerName);

    const result = await provider.getStatus(payment.providerIntentId);

    const prevStatus = payment.status;
    payment.set({ status: result.status as PaymentStatus, frozen: result.frozen });
    await payment.save();

    if (prevStatus !== payment.status) {
      await this.writeAudit({
        entityType: 'payment',
        entityId: payment._id.toString(),
        fromStatus: prevStatus,
        toStatus: payment.status,
        triggeredBy: 'system',
        triggeredById: 'sync',
        metadata: { providerIntentId: payment.providerIntentId },
      });
      this.logger.log(`Synced payment ${paymentId}: ${prevStatus} → ${payment.status}`);
    }

    return payment;
  }

  // ─── refundPayment ────────────────────────────────────────────────────────

  async refundPayment(paymentId: string, dto: RefundPaymentDto): Promise<PaymentDocument> {
    const payment = await this.findOneOrFail(paymentId);

    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException('Only succeeded payments can be refunded.');
    }

    const provider = await this.providerFactory.getProvider(payment.providerName);

    await provider.refundPayment({
      providerIntentId: payment.providerIntentId,
      amount: dto.amount,
      reason: dto.reason,
    });

    const prevStatus = payment.status;
    payment.set({ status: PaymentStatus.REFUNDED });
    await payment.save();

    await this.writeAudit({
      entityType: 'payment',
      entityId: payment._id.toString(),
      fromStatus: prevStatus,
      toStatus: PaymentStatus.REFUNDED,
      triggeredBy: 'user',
      triggeredById: payment.userId,
      metadata: { refundAmount: dto.amount, reason: dto.reason },
    });

    this.logger.log(`Payment ${paymentId} refunded`);
    return payment;
  }

  // ─── handleCCAvenueCallback ───────────────────────────────────────────────
  // Called when CCAvenue redirects the user's browser back after payment.
  // Decrypts the encResp, updates the payment record, returns a frontend redirect URL.

  async handleCCAvenueCallback(encResp: string): Promise<{ redirectUrl: string }> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:5173');

    const provider = await this.providerFactory.getProvider('ccavenue');
    let event: Awaited<ReturnType<typeof provider.verifyWebhook>>;

    try {
      event = await provider.verifyWebhook({
        rawBody: Buffer.from(encResp),
        signature: '',
      });
    } catch (err) {
      this.logger.error(`CCAvenue callback decryption error: ${(err as Error).message}`);
      return { redirectUrl: `${frontendUrl}/payment/failed` };
    }

    const orderId    = event.payload['order_id']     as string;
    const trackingId = event.payload['tracking_id']  as string;
    const orderStatus = event.payload['order_status'] as string;

    const payment = await this.paymentModel.findOne({ providerIntentId: orderId }).exec();

    if (!payment) {
      this.logger.warn(`CCAvenue callback: no payment for order_id=${orderId}`);
      return { redirectUrl: `${frontendUrl}/payment/failed` };
    }

    const terminalStatuses: PaymentStatus[] = [PaymentStatus.SUCCESS, PaymentStatus.FAILED, PaymentStatus.EXPIRED];
    if (terminalStatuses.includes(payment.status)) {
      this.logger.log(`CCAvenue callback: payment ${payment._id} already in terminal state — skipping`);
      const destination = payment.status === PaymentStatus.SUCCESS ? 'success' : 'failed';
      return { redirectUrl: `${frontendUrl}/payment/${destination}` };
    }

    const targetStatus =
      orderStatus === 'Success' ? PaymentStatus.SUCCESS :
      orderStatus === 'Aborted' ? PaymentStatus.EXPIRED :
      PaymentStatus.FAILED;

    const prevStatus = payment.status;
    payment.set({ status: targetStatus });
    await payment.save();

    await this.writeAudit({
      entityType: 'payment',
      entityId: payment._id.toString(),
      fromStatus: prevStatus,
      toStatus: targetStatus,
      triggeredBy: 'ccavenue_callback',
      triggeredById: trackingId,
      metadata: { orderStatus, trackingId, orderId },
    });

    this.logger.log(`CCAvenue payment ${payment._id}: ${prevStatus} → ${targetStatus} (tracking=${trackingId})`);

    const destination = targetStatus === PaymentStatus.SUCCESS ? 'success' : 'failed';
    return { redirectUrl: `${frontendUrl}/payment/${destination}?orderId=${orderId}` };
  }

  // ─── findAll ──────────────────────────────────────────────────────────────

  findAll(userId?: string): Promise<PaymentDocument[]> {
    const filter = userId ? { userId } : {};
    return this.paymentModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  // ─── private helpers ──────────────────────────────────────────────────────

  private async findOneOrFail(id: string): Promise<PaymentDocument> {
    const payment = await this.paymentModel.findById(id).exec();
    if (!payment) throw new NotFoundException(`Payment #${id} not found`);
    return payment;
  }

  private async writeAudit(data: {
    entityType: string;
    entityId: string;
    fromStatus: string | null;
    toStatus: string;
    triggeredBy: string;
    triggeredById: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.auditModel.create({
      entityType: data.entityType,
      entityId: data.entityId,
      fromStatus: data.fromStatus,
      toStatus: data.toStatus,
      triggeredBy: data.triggeredBy,
      triggeredById: data.triggeredById,
      metadata: data.metadata ?? {},
    });
  }
}
