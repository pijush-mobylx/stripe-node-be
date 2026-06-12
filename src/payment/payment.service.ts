import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Payment, PaymentStatus, PaymentType } from './payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentProviderFactory } from '../payment-provider/payment-provider.factory';
import type { ProviderPayload } from '../payment-provider/dto/checkout-session.dto';
import { AuditLog } from '../audit-log/audit-log.entity';
import { Plan } from '../plan/plan.entity';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  // ─── initiatePayment (new gateway flow) ──────────────────────────────────

  async initiatePayment(userId: string, dto: InitiatePaymentDto): Promise<ProviderPayload> {
    const plan = await this.planRepo.findOne({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException(`Plan #${dto.planId} not found`);
    if (!plan.isActive) throw new BadRequestException(`Plan #${dto.planId} is inactive`);

    const provider = await this.providerFactory.getProviderByPlanConfig({
      providerName: plan.providerName,
      currency: plan.currency,
    });

    const payload = await provider.createCheckoutSession({
      userId,
      planId: plan.id,
      amount: plan.amount,
      currency: plan.currency,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });

    const payment = this.paymentRepo.create({
      userId,
      type: dto.paymentType,
      providerName: provider.providerName,
      providerIntentId: payload.sessionId,
      amount: plan.amount,
      status: PaymentStatus.INITIATED,
      frozen: false,
      planId: plan.id,
    });

    const saved = await this.paymentRepo.save(payment);

    await this.writeAudit({
      entityType: 'payment',
      entityId: saved.id,
      fromStatus: null,
      toStatus: PaymentStatus.INITIATED,
      triggeredBy: 'user',
      triggeredById: userId,
      metadata: { sessionId: payload.sessionId, planId: plan.id, currency: plan.currency },
    });

    this.logger.log(`Payment ${saved.id} initiated — session ${payload.sessionId}`);
    return payload;
  }

  // ─── createPayment ────────────────────────────────────────────────────────

  async createPayment(dto: CreatePaymentDto): Promise<Payment> {
    const provider = await this.providerFactory.getProvider(dto.providerName);

    const session = await provider.createSession({
      userId: dto.userId,
      secret: '',
      amount: dto.amount,
      currency: dto.currency,
      description: dto.description ?? '',
    });

    const payment = this.paymentRepo.create({
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

    const saved = await this.paymentRepo.save(payment);

    await this.writeAudit({
      entityType: 'payment',
      entityId: saved.id,
      fromStatus: null,
      toStatus: PaymentStatus.INITIATED,
      triggeredBy: 'user',
      triggeredById: dto.userId,
      metadata: { providerIntentId: session.providerIntentId, clientSecret: session.clientSecret },
    });

    this.logger.log(`Payment ${saved.id} created — intent ${session.providerIntentId}`);
    return saved;
  }

  // ─── retryPayment ─────────────────────────────────────────────────────────

  async retryPayment(paymentId: string): Promise<Payment> {
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
    payment.status = result.status as PaymentStatus;

    if (result.frozen) {
      payment.frozen = true;
    }

    const updated = await this.paymentRepo.save(payment);

    await this.writeAudit({
      entityType: 'payment',
      entityId: payment.id,
      fromStatus: prevStatus,
      toStatus: updated.status,
      triggeredBy: 'system',
      triggeredById: 'retry',
      metadata: { providerIntentId: payment.providerIntentId },
    });

    this.logger.log(`Retried payment ${paymentId} — status: ${updated.status}`);
    return updated;
  }

  // ─── getStatus ────────────────────────────────────────────────────────────

  async getStatus(paymentId: string): Promise<Payment> {
    return this.findOneOrFail(paymentId);
  }

  // ─── syncProviderStatus (sync provider knowledge) ─────────────────────────

  async syncProviderStatus(paymentId: string): Promise<Payment> {
    const payment = await this.findOneOrFail(paymentId);
    const provider = await this.providerFactory.getProvider(payment.providerName);

    const result = await provider.getStatus(payment.providerIntentId);

    const prevStatus = payment.status;
    payment.status = result.status as PaymentStatus;
    payment.frozen = result.frozen;

    const updated = await this.paymentRepo.save(payment);

    if (prevStatus !== updated.status) {
      await this.writeAudit({
        entityType: 'payment',
        entityId: payment.id,
        fromStatus: prevStatus,
        toStatus: updated.status,
        triggeredBy: 'system',
        triggeredById: 'sync',
        metadata: { providerIntentId: payment.providerIntentId },
      });
      this.logger.log(`Synced payment ${paymentId}: ${prevStatus} → ${updated.status}`);
    }

    return updated;
  }

  // ─── refundPayment ────────────────────────────────────────────────────────

  async refundPayment(paymentId: string, dto: RefundPaymentDto): Promise<Payment> {
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
    payment.status = PaymentStatus.REFUNDED;
    const updated = await this.paymentRepo.save(payment);

    await this.writeAudit({
      entityType: 'payment',
      entityId: payment.id,
      fromStatus: prevStatus,
      toStatus: PaymentStatus.REFUNDED,
      triggeredBy: 'user',
      triggeredById: payment.userId,
      metadata: { refundAmount: dto.amount, reason: dto.reason },
    });

    this.logger.log(`Payment ${paymentId} refunded`);
    return updated;
  }

  // ─── findAll ──────────────────────────────────────────────────────────────

  findAll(userId?: string): Promise<Payment[]> {
    const where = userId ? { userId } : {};
    return this.paymentRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  // ─── private helpers ──────────────────────────────────────────────────────

  private async findOneOrFail(id: string): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({ where: { id } });
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
    await this.auditRepo.save(
      this.auditRepo.create({
        entityType: data.entityType,
        entityId: data.entityId,
        fromStatus: data.fromStatus,
        toStatus: data.toStatus,
        triggeredBy: data.triggeredBy,
        triggeredById: data.triggeredById,
        metadata: data.metadata ?? {},
      }),
    );
  }
}
