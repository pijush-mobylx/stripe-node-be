import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Plan, PlanDocument } from './plan.schema';

@Injectable()
export class PlanService {
  constructor(@InjectModel(Plan.name) private readonly planModel: Model<PlanDocument>) {}

  findAll(): Promise<PlanDocument[]> {
    return this.planModel.find({ isActive: true }).sort({ amount: 1 }).exec();
  }
}
