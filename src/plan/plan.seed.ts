import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './plan.entity';

const PLANS: Partial<Plan>[] = [
  {
    providerPlanId: 'plan_basic',
    name: 'Basic',
    providerName: 'local',
    amount: 0,
    currency: 'usd',
    interval: 'month',
    intervalCount: 1,
    trialDays: 0,
    isActive: true,
    features: {
      maxProjects: 3,
      storagGb: 1,
      support: 'community',
      analytics: 'basic',
      apiAccess: 'public',
      customDomain: false,
      teamSeats: 1,
    },
  },
  {
    providerPlanId: 'plan_pro',
    name: 'Pro',
    providerName: 'local',
    amount: 3000,
    currency: 'usd',
    interval: 'month',
    intervalCount: 1,
    trialDays: 0,
    isActive: true,
    features: {
      maxProjects: 20,
      storageGb: 50,
      support: 'priority_email',
      analytics: 'advanced',
      apiAccess: 'full',
      customDomain: true,
      teamSeats: 5,
    },
  },
  {
    providerPlanId: 'plan_pro_plus',
    name: 'Pro Plus',
    providerName: 'local',
    amount: 5000,
    currency: 'usd',
    interval: 'month',
    intervalCount: 1,
    trialDays: 0,
    isActive: true,
    features: {
      maxProjects: -1,
      storageGb: 500,
      support: '24_7_dedicated',
      analytics: 'ai_powered',
      apiAccess: 'full_webhooks',
      customDomain: true,
      customDomainSsl: true,
      teamSeats: -1,
      earlyAccess: true,
      slaGuarantee: true,
    },
  },
];

@Injectable()
export class PlanSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlanSeeder.name);

  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
  ) {}

  async onApplicationBootstrap() {
    for (const seed of PLANS) {
      const exists = await this.planRepo.findOne({
        where: { providerPlanId: seed.providerPlanId },
      });
      if (!exists) {
        await this.planRepo.save(this.planRepo.create(seed));
        this.logger.log(`Seeded plan: ${seed.name}`);
      }
    }
  }
}
