import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { RenewSubscriptionDto } from './dto/renew-subscription.dto';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new subscription for a user on a plan' })
  createSub(@Body() dto: CreateSubscriptionDto) {
    return this.subscriptionService.createSub(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List subscriptions (optionally filter by userId)' })
  @ApiQuery({ name: 'userId', required: false })
  findAll(@Query('userId') userId?: string) {
    return this.subscriptionService.findAll(userId);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  findOne(@Param('id') id: string) {
    return this.subscriptionService.findOne(id);
  }

  @Post(':id/subscribe')
  @ApiOperation({ summary: 'Upgrade or re-activate subscription to a new plan' })
  @ApiParam({ name: 'id' })
  subscribe(@Param('id') id: string, @Body('planId') planId: string) {
    return this.subscriptionService.subscribe(id, planId);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a subscription (at period end by default)' })
  @ApiParam({ name: 'id' })
  cancelSub(@Param('id') id: string, @Body() dto: CancelSubscriptionDto) {
    return this.subscriptionService.cancelSub(id, dto);
  }

  @Post(':id/renew')
  @ApiOperation({ summary: 'Renew subscription billing cycle' })
  @ApiParam({ name: 'id' })
  renewSub(@Param('id') id: string, @Body() dto: RenewSubscriptionDto) {
    return this.subscriptionService.renewSub(id, dto);
  }
}
