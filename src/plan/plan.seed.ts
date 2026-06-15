import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Plan, PlanDocument } from './plan.schema';

const PLANS = [
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
      storageGb: 1,
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

  constructor(@InjectModel(Plan.name) private readonly planModel: Model<PlanDocument>) {}

  async onApplicationBootstrap() {
    for (const seed of PLANS) {
      const exists = await this.planModel.findOne({ providerPlanId: seed.providerPlanId });
      if (!exists) {
        await this.planModel.create(seed);
        this.logger.log(`Seeded plan: ${seed.name}`);
      } else {
        this.logger.log(`Plan already exists: ${seed.name}`);
      }
    }
  }
}
