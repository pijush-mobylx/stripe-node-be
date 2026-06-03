import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PlanService } from './plan.service';
import { Plan } from './plan.entity';

@ApiTags('plans')
@Controller('plans')
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Get()
  @ApiOperation({ summary: 'Get all active plans' })
  @ApiResponse({ status: 200, type: [Plan] })
  findAll(): Promise<Plan[]> {
    return this.planService.findAll();
  }
}
