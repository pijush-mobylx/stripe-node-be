import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProvisioningOutbox } from './provisioning-outbox.entity';
import { ProvisioningOutboxPoller } from './provisioning-outbox.poller';

@Module({
  imports: [TypeOrmModule.forFeature([ProvisioningOutbox])],
  providers: [ProvisioningOutboxPoller],
  exports: [TypeOrmModule],
})
export class ProvisioningOutboxModule {}
