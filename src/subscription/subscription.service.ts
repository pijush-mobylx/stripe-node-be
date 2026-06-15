import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Subscription, SubscriptionDocument, SubscriptionStatus } from './subscription.schema';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { RenewSubscriptionDto } from './dto/renew-subscription.dto';
import { Plan, PlanDocument } from '../plan/plan.schema';
import { User, UserDocument } from '../user/user.schema';
import { AuditLog, AuditLogDocument } from '../audit-log/audit-log.schema';
import { PaymentProviderFactory } from '../payment-provider/payment-provider.factory';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectModel(Subscription.name) private readonly subModel: Model<SubscriptionDocument>,
    @InjectModel(Plan.name) private readonly planModel: Model<PlanDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  // ─── createSub ────────────────────────────────────────────────────────────

  async createSub(dto: CreateSubscriptionDto): Promise<SubscriptionDocument> {
    const plan = await this.planModel.findById(dto.planId);
    if (!plan) throw new NotFoundException(`Plan #${dto.planId} not found`);
    if (!plan.isActive) throw new BadRequestException('Plan is not active');

    await this.ensureUserExists(dto.userId);

    const providerName = dto.providerName ?? plan.providerName;
    const provider = await this.providerFactory.getProvider(providerName);

    const result = await provider.createSubscription({
      userId: dto.userId,
      providerCustomerId: dto.providerCustomerId,
      providerPlanId: plan.providerPlanId,
      providerPmId: dto.providerPmId,
      trialDays: plan.trialDays,
    });

    const saved = await this.subModel.create({
      userId: dto.userId,
      providerName,
      providerSubId: result.providerSubId,
      providerCustomerId: result.providerCustomerId,
      providerPmId: dto.providerPmId,
      planId: (plan as PlanDocument & { _id: { toString(): string } })._id.toString(),
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

    await this.writeAudit({
      entityId: saved.id,
      fromStatus: null,
      toStatus: saved.status,
      triggeredBy: 'user',
      triggeredById: dto.userId,
      metadata: { planId: saved.planId, providerSubId: result.providerSubId },
    });

    await this.userModel.findByIdAndUpdate(dto.userId, {
      isPremium: true,
      plan: this.planKeyFromName(plan.name),
    });

    this.logger.log(`Subscription ${saved.id} created for user ${dto.userId} on plan ${plan.name}`);
    return saved;
  }

  // ─── subscribe ────────────────────────────────────────────────────────────

  async subscribe(subscriptionId: string, newPlanId: string): Promise<SubscriptionDocument> {
    const sub = await this.findOneOrFail(subscriptionId);
    const plan = await this.planModel.findById(newPlanId);
    if (!plan) throw new NotFoundException(`Plan #${newPlanId} not found`);

    const provider = await this.providerFactory.getProvider(sub.providerName);
    const result = await provider.renewSubscription(sub.providerSubId);

    const prevStatus = sub.status;
    sub.set({
      planId: (plan as PlanDocument & { _id: { toString(): string } })._id.toString(),
      planName: plan.name,
      planAmount: plan.amount,
      status: result.status as SubscriptionStatus,
      currentPeriodStart: result.currentPeriodStart,
      currentPeriodEnd: result.currentPeriodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      failedAttempts: 0,
      nextRetryAt: null,
    });
    await sub.save();

    await this.writeAudit({
      entityId: sub.id,
      fromStatus: prevStatus,
      toStatus: sub.status,
      triggeredBy: 'user',
      triggeredById: sub.userId,
      metadata: { newPlanId },
    });

    await this.userModel.findByIdAndUpdate(sub.userId, {
      isPremium: true,
      plan: this.planKeyFromName(plan.name),
    });

    this.logger.log(`Subscription ${sub.id} upgraded to plan ${plan.name}`);
    return sub;
  }

  // ─── cancelSub ────────────────────────────────────────────────────────────

  async cancelSub(subscriptionId: string, dto: CancelSubscriptionDto): Promise<SubscriptionDocument> {
    const sub = await this.findOneOrFail(subscriptionId);
    if (sub.status === SubscriptionStatus.CANCELED) {
      throw new BadRequestException('Subscription is already cancelled.');
    }

    const atPeriodEnd = dto.atPeriodEnd ?? true;
    const provider = await this.providerFactory.getProvider(sub.providerName);
    const result = await provider.cancelSubscription(sub.providerSubId, atPeriodEnd);

    const prevStatus = sub.status;
    sub.set({
      status: atPeriodEnd ? (result.status as SubscriptionStatus) : SubscriptionStatus.CANCELED,
      cancelAtPeriodEnd: result.cancelAtPeriodEnd,
      cancelledAt: atPeriodEnd ? null : new Date(),
    });
    await sub.save();

    await this.writeAudit({
      entityId: sub.id,
      fromStatus: prevStatus,
      toStatus: sub.status,
      triggeredBy: 'user',
      triggeredById: sub.userId,
      metadata: { atPeriodEnd },
    });

    if (!atPeriodEnd) {
      await this.userModel.findByIdAndUpdate(sub.userId, { isPremium: false, plan: 'basic' });
    }

    this.logger.log(`Subscription ${sub.id} cancelled (atPeriodEnd=${atPeriodEnd})`);
    return sub;
  }

  // ─── renewSub ─────────────────────────────────────────────────────────────

  async renewSub(subscriptionId: string, dto: RenewSubscriptionDto): Promise<SubscriptionDocument> {
    const sub = await this.findOneOrFail(subscriptionId);
    const provider = await this.providerFactory.getProvider(sub.providerName);
    const result = await provider.renewSubscription(sub.providerSubId, dto.newProviderPmId);

    const prevStatus = sub.status;
    sub.set({
      status: result.status as SubscriptionStatus,
      currentPeriodStart: result.currentPeriodStart,
      currentPeriodEnd: result.currentPeriodEnd,
      failedAttempts: 0,
      nextRetryAt: null,
      ...(dto.newProviderPmId ? { providerPmId: dto.newProviderPmId } : {}),
    });
    await sub.save();

    await this.writeAudit({
      entityId: sub.id,
      fromStatus: prevStatus,
      toStatus: sub.status,
      triggeredBy: 'system',
      triggeredById: 'auto-renew',
      metadata: { newPeriodEnd: result.currentPeriodEnd },
    });

    this.logger.log(`Subscription ${sub.id} renewed — next period ends ${result.currentPeriodEnd}`);
    return sub;
  }

  // ─── queries ──────────────────────────────────────────────────────────────

  findAll(userId?: string): Promise<SubscriptionDocument[]> {
    const filter = userId ? { userId } : {};
    return this.subModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  findOne(id: string): Promise<SubscriptionDocument> {
    return this.findOneOrFail(id);
  }

  // ─── private helpers ──────────────────────────────────────────────────────

  private async findOneOrFail(id: string): Promise<SubscriptionDocument> {
    const sub = await this.subModel.findById(id).exec();
    if (!sub) throw new NotFoundException(`Subscription #${id} not found`);
    return sub;
  }

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException(`User #${userId} not found`);
  }

  private planKeyFromName(name: string): string {
    const map: Record<string, string> = { Basic: 'basic', Pro: 'pro', 'Pro Plus': 'pro_plus' };
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
    await this.auditModel.create({
      entityType: 'subscription',
      ...data,
      metadata: data.metadata ?? {},
    });
  }
}
