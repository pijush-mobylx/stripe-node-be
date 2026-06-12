import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ProvisioningOutbox,
  OutboxStatus,
  ProvisioningType,
} from './provisioning-outbox.entity';

/** Numeric lock key — must be unique across all advisory locks in this app. */
const OUTBOX_LOCK_KEY = 7_001_001;

@Injectable()
export class ProvisioningOutboxPoller {
  private readonly logger = new Logger(ProvisioningOutboxPoller.name);

  constructor(
    @InjectRepository(ProvisioningOutbox)
    private readonly outboxRepo: Repository<ProvisioningOutbox>,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async poll(): Promise<void> {
    const acquired = await this.tryAcquireLock();
    if (!acquired) {
      this.logger.debug('Outbox poller skipped — another instance holds the lock');
      return;
    }

    try {
      await this.processPendingJobs();
    } finally {
      await this.releaseLock();
    }
  }

  // ─── core ─────────────────────────────────────────────────────────────────

  private async processPendingJobs(): Promise<void> {
    const jobs = await this.outboxRepo.find({
      where: { status: OutboxStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: 50,
    });

    if (jobs.length === 0) return;

    this.logger.log(`Outbox poller processing ${jobs.length} job(s)`);

    for (const job of jobs) {
      await this.processJob(job);
    }
  }

  private async processJob(job: ProvisioningOutbox): Promise<void> {
    job.status = OutboxStatus.PROCESSING;
    await this.outboxRepo.save(job);

    try {
      await this.dispatch(job);

      job.status = OutboxStatus.DONE;
      job.processedAt = new Date();
      job.lastError = null;
      await this.outboxRepo.save(job);

      this.logger.log(`Outbox job ${job.jobId} (${job.provisioningType}) completed`);
    } catch (err) {
      job.retryCount += 1;
      job.lastError = (err as Error).message;
      job.status =
        job.retryCount >= job.maxRetries ? OutboxStatus.FAILED : OutboxStatus.PENDING;

      await this.outboxRepo.save(job);

      this.logger.warn(
        `Outbox job ${job.jobId} attempt ${job.retryCount}/${job.maxRetries} failed: ${job.lastError}`,
      );
    }
  }

  private async dispatch(job: ProvisioningOutbox): Promise<void> {
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
        throw new Error(`Unknown provisioningType: ${(job as ProvisioningOutbox).provisioningType}`);
    }
  }

  // ─── handlers (stubs — replaced when listeners are implemented in T-12/T-13) ──

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async activateSubscription(_job: ProvisioningOutbox): Promise<void> {
    // Implemented by SubscriptionActivationHandler (T-12)
    this.logger.debug(`ACTIVATE_SUBSCRIPTION stub for job ${_job.jobId}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendReceipt(_job: ProvisioningOutbox): Promise<void> {
    // Implemented by ReceiptEmailListener (T-13)
    this.logger.debug(`SEND_RECEIPT stub for job ${_job.jobId}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async grantEntitlement(_job: ProvisioningOutbox): Promise<void> {
    // Implemented by EntitlementHandler (T-14)
    this.logger.debug(`GRANT_ENTITLEMENT stub for job ${_job.jobId}`);
  }

  // ─── advisory lock ────────────────────────────────────────────────────────

  private async tryAcquireLock(): Promise<boolean> {
    const result = await this.dataSource.query<[{ pg_try_advisory_lock: boolean }]>(
      'SELECT pg_try_advisory_lock($1)',
      [OUTBOX_LOCK_KEY],
    );
    return result[0].pg_try_advisory_lock;
  }

  private async releaseLock(): Promise<void> {
    await this.dataSource.query('SELECT pg_advisory_unlock($1)', [OUTBOX_LOCK_KEY]);
  }
}
