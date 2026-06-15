import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ProvisioningOutbox,
  ProvisioningOutboxDocument,
  OutboxStatus,
  ProvisioningType,
} from './provisioning-outbox.schema';

@Injectable()
export class ProvisioningOutboxPoller {
  private readonly logger = new Logger(ProvisioningOutboxPoller.name);
  private isRunning = false;

  constructor(
    @InjectModel(ProvisioningOutbox.name)
    private readonly outboxModel: Model<ProvisioningOutboxDocument>,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async poll(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Outbox poller skipped — previous run still in progress');
      return;
    }

    this.isRunning = true;
    try {
      await this.processPendingJobs();
    } finally {
      this.isRunning = false;
    }
  }

  private async processPendingJobs(): Promise<void> {
    const jobs = await this.outboxModel
      .find({ status: OutboxStatus.PENDING })
      .sort({ createdAt: 1 })
      .limit(50)
      .exec();

    if (jobs.length === 0) return;

    this.logger.log(`Outbox poller processing ${jobs.length} job(s)`);

    for (const job of jobs) {
      await this.processJob(job);
    }
  }

  private async processJob(job: ProvisioningOutboxDocument): Promise<void> {
    job.set({ status: OutboxStatus.PROCESSING });
    await job.save();

    try {
      await this.dispatch(job);

      job.set({ status: OutboxStatus.DONE, processedAt: new Date(), lastError: null });
      await job.save();

      this.logger.log(`Outbox job ${job.jobId} (${job.provisioningType}) completed`);
    } catch (err) {
      const newRetryCount = job.retryCount + 1;
      job.set({
        retryCount: newRetryCount,
        lastError: (err as Error).message,
        status: newRetryCount >= job.maxRetries ? OutboxStatus.FAILED : OutboxStatus.PENDING,
      });
      await job.save();

      this.logger.warn(
        `Outbox job ${job.jobId} attempt ${newRetryCount}/${job.maxRetries} failed: ${(err as Error).message}`,
      );
    }
  }

  private async dispatch(job: ProvisioningOutboxDocument): Promise<void> {
    switch (job.provisioningType) {
      case ProvisioningType.ACTIVATE_SUBSCRIPTION:
        await this.activateSubscription(job);
        break;
      case ProvisioningType.SEND_RECEIPT:
        await this.sendReceipt(job);
        break;
      case ProvisioningType.GRANT_ENTITLEMENT:
        await this.grantEntitlement(job);
        break;
      default:
        throw new Error(`Unknown provisioningType: ${job.provisioningType}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async activateSubscription(_job: ProvisioningOutboxDocument): Promise<void> {
    this.logger.debug(`ACTIVATE_SUBSCRIPTION stub for job ${_job.jobId}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendReceipt(_job: ProvisioningOutboxDocument): Promise<void> {
    this.logger.debug(`SEND_RECEIPT stub for job ${_job.jobId}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async grantEntitlement(_job: ProvisioningOutboxDocument): Promise<void> {
    this.logger.debug(`GRANT_ENTITLEMENT stub for job ${_job.jobId}`);
  }
}
