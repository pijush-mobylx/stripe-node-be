import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProvisioningOutbox, ProvisioningOutboxSchema } from './provisioning-outbox.schema';
import { ProvisioningOutboxPoller } from './provisioning-outbox.poller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ProvisioningOutbox.name, schema: ProvisioningOutboxSchema }]),
  ],
  providers: [ProvisioningOutboxPoller],
  exports: [MongooseModule],
})
export class ProvisioningOutboxModule {}
