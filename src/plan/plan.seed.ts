import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './plan.entity';

const PLANS: Partial<Plan>[] = [

  
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
