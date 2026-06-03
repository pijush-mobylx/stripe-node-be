import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './plan.entity';

@Injectable()
export class PlanService {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
  ) {}

  findAll(): Promise<Plan[]> {
    return this.planRepo.find({ where: { isActive: true }, order: { amount: 'ASC' } });
  }
}
