import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Subscription, SubscriptionStatus } from './subscription.entity';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { RenewSubscriptionDto } from './dto/renew-subscription.dto';
import { Plan } from '../plan/plan.entity';
import { User } from '../user/user.entity';
import { AuditLog } from '../audit-log/audit-log.entity';
import { PaymentProviderFactory } from '../payment-provider/payment-provider.factory';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  // ─── createSub ────────────────────────────────────────────────────────────
  // Validates user + plan, calls provider, persists subscription record

  async createSub(dto: CreateSubscriptionDto): Promise<Subscription> {
    const plan = await this.planRepo.findOne({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException(`Plan #${dto.planId} not found`);
    if (!plan.isActive) throw new BadRequestException('Plan is not active');

    await this.ensureUserExists(dto.userId);

    const providerName = dto.providerName ?? plan.providerName;
    const provider = this.providerFactory.getProvider(providerName);

    const result = await provider.createSubscription({
      userId: dto.userId,
      providerCustomerId: dto.providerCustomerId,
      providerPlanId: plan.providerPlanId,
      providerPmId: dto.providerPmId,
      trialDays: plan.trialDays,
    });

    const sub = this.subRepo.create({
      userId: dto.userId,
      providerName,
      providerSubId: result.providerSubId,
      providerCustomerId: result.providerCustomerId,
      providerPmId: dto.providerPmId,
      planId: plan.id,
      planName: plan.name,
      planAmount: plan.amount,
      status: result.status as SubscriptionStatus,
      currentPeriodStart: result.currentPeriodStart,
      currentPeriodEnd: result.currentPeriodEnd,
      trialEnd: result.trialEnd,
      cancelAtPeriodEnd: result.cancelAtPeriodEnd,
      failedAttempts: 0,
      nextRetryAt: null,
      cancelledAt: null,
    });

    const saved = await this.subRepo.save(sub);

    await this.writeAudit({
      entityId: saved.id,
      fromStatus: null,
      toStatus: saved.status,
      triggeredBy: 'user',
      triggeredById: dto.userId,
      metadata: { planId: plan.id, providerSubId: result.providerSubId },
    });

    // Mark user as premium
    await this.userRepo.update(dto.userId, { isPremium: true, plan: this.planKeyFromName(plan.name) });

    this.logger.log(`Subscription ${saved.id} created for user ${dto.userId} on plan ${plan.name}`);
    return saved;
  }

  // ─── subscribe ────────────────────────────────────────────────────────────
  // Re-activates or upgrades an existing subscription to a new plan

  async subscribe(subscriptionId: string, newPlanId: string): Promise<Subscription> {
    const sub = await this.findOneOrFail(subscriptionId);
    const plan = await this.planRepo.findOne({ where: { id: newPlanId } });
    if (!plan) throw new NotFoundException(`Plan #${newPlanId} not found`);

    const provider = this.providerFactory.getProvider(sub.providerName);

    const result = await provider.renewSubscription(sub.providerSubId);

    const prevStatus = sub.status;
    sub.planId = plan.id;
    sub.planName = plan.name;
    sub.planAmount = plan.amount;
    sub.status = result.status as SubscriptionStatus;
    sub.currentPeriodStart = result.currentPeriodStart;
    sub.currentPeriodEnd = result.currentPeriodEnd;
    sub.cancelAtPeriodEnd = false;
    sub.cancelledAt = null;
    sub.failedAttempts = 0;
    sub.nextRetryAt = null;

    const updated = await this.subRepo.save(sub);

    await this.writeAudit({
      entityId: sub.id,
      fromStatus: prevStatus,
      toStatus: updated.status,
      triggeredBy: 'user',
      triggeredById: sub.userId,
      metadata: { newPlanId: plan.id },
    });

    await this.userRepo.update(sub.userId, { isPremium: true, plan: this.planKeyFromName(plan.name) });

    this.logger.log(`Subscription ${sub.id} upgraded to plan ${plan.name}`);
    return updated;
  }

  // ─── cancelSub ────────────────────────────────────────────────────────────

  async cancelSub(subscriptionId: string, dto: CancelSubscriptionDto): Promise<Subscription> {
    const sub = await this.findOneOrFail(subscriptionId);

    if (sub.status === SubscriptionStatus.CANCELED) {
      throw new BadRequestException('Subscription is already cancelled.');
    }

    const atPeriodEnd = dto.atPeriodEnd ?? true;
    const provider = this.providerFactory.getProvider(sub.providerName);

    const result = await provider.cancelSubscription(sub.providerSubId, atPeriodEnd);

    const prevStatus = sub.status;
    sub.status = result.status as SubscriptionStatus;
    sub.cancelAtPeriodEnd = result.cancelAtPeriodEnd;

    if (!atPeriodEnd) {
      sub.cancelledAt = new Date();
      sub.status = SubscriptionStatus.CANCELED;
    }

    const updated = await this.subRepo.save(sub);

    await this.writeAudit({
      entityId: sub.id,
      fromStatus: prevStatus,
      toStatus: updated.status,
      triggeredBy: 'user',
      triggeredById: sub.userId,
      metadata: { atPeriodEnd },
    });

    if (!atPeriodEnd) {
      await this.userRepo.update(sub.userId, { isPremium: false, plan: 'basic' });
    }

    this.logger.log(`Subscription ${sub.id} cancelled (atPeriodEnd=${atPeriodEnd})`);
    return updated;
  }

  // ─── renewSub ─────────────────────────────────────────────────────────────
  // Used by webhook handler on invoice.paid — auto-renew billing cycle

  async renewSub(subscriptionId: string, dto: RenewSubscriptionDto): Promise<Subscription> {
    const sub = await this.findOneOrFail(subscriptionId);
    const provider = this.providerFactory.getProvider(sub.providerName);

    const result = await provider.renewSubscription(sub.providerSubId, dto.newProviderPmId);

    const prevStatus = sub.status;
    sub.status = result.status as SubscriptionStatus;
    sub.currentPeriodStart = result.currentPeriodStart;
    sub.currentPeriodEnd = result.currentPeriodEnd;
    sub.failedAttempts = 0;
    sub.nextRetryAt = null;
    if (dto.newProviderPmId) sub.providerPmId = dto.newProviderPmId;

    const updated = await this.subRepo.save(sub);

    await this.writeAudit({
      entityId: sub.id,
      fromStatus: prevStatus,
      toStatus: updated.status,
      triggeredBy: 'system',
      triggeredById: 'auto-renew',
      metadata: { newPeriodEnd: result.currentPeriodEnd },
    });

    this.logger.log(`Subscription ${sub.id} renewed — next period ends ${result.currentPeriodEnd}`);
    return updated;
  }

  // ─── findAll ──────────────────────────────────────────────────────────────

  findAll(userId?: string): Promise<Subscription[]> {
    const where = userId ? { userId } : {};
    return this.subRepo.find({ where, relations: { plan: true }, order: { createdAt: 'DESC' } });
  }

  // ─── findOne ──────────────────────────────────────────────────────────────

  findOne(id: string): Promise<Subscription> {
    return this.findOneOrFail(id);
  }

  // ─── private helpers ──────────────────────────────────────────────────────

  private async findOneOrFail(id: string): Promise<Subscription> {
    const sub = await this.subRepo.findOne({ where: { id }, relations: { plan: true } });
    if (!sub) throw new NotFoundException(`Subscription #${id} not found`);
    return sub;
  }

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User #${userId} not found`);
  }

  private planKeyFromName(name: string): string {
    const map: Record<string, string> = {
      Basic: 'basic',
      Pro: 'pro',
      'Pro Plus': 'pro_plus',
    };
    return map[name] ?? 'basic';
  }

  private async writeAudit(data: {
    entityId: string;
    fromStatus: string | null;
    toStatus: string;
    triggeredBy: string;
    triggeredById: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({
        entityType: 'subscription',
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
