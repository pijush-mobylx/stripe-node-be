import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Plan } from './plan/plan.entity';
import * as dotenv from 'dotenv';
dotenv.config();

const plans = [
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

async function seed() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: [Plan],
    synchronize: true,
  });

  await ds.initialize();
  const repo = ds.getRepository(Plan);

  for (const plan of plans) {
    const exists = await repo.findOne({ where: { providerPlanId: plan.providerPlanId } });
    if (exists) {
      console.log(`⏭  Already exists: ${plan.name}`);
    } else {
      await repo.save(repo.create(plan));
      console.log(`✅ Seeded: ${plan.name}`);
    }
  }

  await ds.destroy();
  console.log('Done.');
}

seed().catch((e) => { console.error(e); process.exit(1); });
