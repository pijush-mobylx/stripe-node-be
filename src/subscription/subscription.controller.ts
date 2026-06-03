import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { RenewSubscriptionDto } from './dto/renew-subscription.dto';
import { Subscription } from './subscription.entity';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new subscription for a user on a plan' })
  @ApiResponse({ status: 201, type: Subscription })
  createSub(@Body() dto: CreateSubscriptionDto): Promise<Subscription> {
    return this.subscriptionService.createSub(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List subscriptions (optionally filter by userId)' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiResponse({ status: 200, type: [Subscription] })
  findAll(@Query('userId') userId?: string): Promise<Subscription[]> {
    return this.subscriptionService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get subscription by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: Subscription })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Subscription> {
    return this.subscriptionService.findOne(id);
  }

  @Post(':id/subscribe')
  @ApiOperation({ summary: 'Upgrade or re-activate subscription to a new plan' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: Subscription })
  subscribe(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('planId', ParseUUIDPipe) planId: string,
  ): Promise<Subscription> {
    return this.subscriptionService.subscribe(id, planId);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a subscription (at period end by default)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: Subscription })
  cancelSub(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSubscriptionDto,
  ): Promise<Subscription> {
    return this.subscriptionService.cancelSub(id, dto);
  }

  @Post(':id/renew')
  @ApiOperation({ summary: 'Renew subscription billing cycle (called by webhook or manually)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: Subscription })
  renewSub(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenewSubscriptionDto,
  ): Promise<Subscription> {
    return this.subscriptionService.renewSub(id, dto);
  }
}
