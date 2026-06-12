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
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentProviderFactory } from '../payment-provider/payment-provider.factory';
import { AuditLog } from '../audit-log/audit-log.entity';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  // ─── createPayment ────────────────────────────────────────────────────────

  async createPayment(dto: CreatePaymentDto): Promise<Payment> {
    const provider = this.providerFactory.getProvider(dto.providerName);

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

    const provider = this.providerFactory.getProvider(payment.providerName);
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
    const provider = this.providerFactory.getProvider(payment.providerName);

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

    const provider = this.providerFactory.getProvider(payment.providerName);

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
