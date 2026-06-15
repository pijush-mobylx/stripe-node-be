import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Plan, PlanSchema } from './plan.schema';
import { PlanSeeder } from './plan.seed';
import { PlanService } from './plan.service';
import { PlanController } from './plan.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Plan.name, schema: PlanSchema }])],
  controllers: [PlanController],
  providers: [PlanSeeder, PlanService],
  exports: [MongooseModule],
})
export class PlanModule {}
