import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { WebhookEvent, WebhookStatus } from './webhook-event.entity';
import { PaymentProviderFactory } from '../payment-provider/payment-provider.factory';
import { PaymentCallbackService } from '../payment-callback/payment-callback.service';

@Injectable()
export class WebhookHandlerFactory {
  private readonly logger = new Logger(WebhookHandlerFactory.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookRepo: Repository<WebhookEvent>,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly callbackService: PaymentCallbackService,
  ) {}

  // ─── processWebhook ───────────────────────────────────────────────────────

  async processWebhook(
    providerName: string,
    rawBody: Buffer,
    signature: string,
  ): Promise<{ received: boolean }> {
    // 1. Verify signature
    const provider = await this.providerFactory.getProvider(providerName);
    const event = await provider.verifyWebhook({ rawBody, signature });

    // 2. Dedup insert — unique index on (providerName, providerEventId)
    const record = await this.saveEventRecord(providerName, event);
    if (!record) {
      this.logger.log(`Duplicate webhook ignored: ${event.providerEventId}`);
      return { received: true };
    }

    // 3. 6-step pipeline (idempotency → validate → tamper → atomic write → mark → emit)
    try {
      await this.callbackService.process(record, event);
    } catch (err) {
      // callbackService already updated the record status; just rethrow for HTTP 500
      this.logger.error(
        `Webhook ${event.providerEventId} pipeline failed: ${(err as Error).message}`,
      );
      throw err;
    }

    return { received: true };
  }

  // ─── saveEventRecord ──────────────────────────────────────────────────────
  // Returns null if a duplicate — the unique index on (providerName, providerEventId)
  // prevents double processing

  private async saveEventRecord(
    providerName: string,
    event: { providerEventId: string; type: string; payload: Record<string, unknown> },
  ): Promise<WebhookEvent | null> {
    try {
      const record = this.webhookRepo.create({
        providerName,
        providerEventId: event.providerEventId,
        type: event.type,
        rawPayload: event.payload,
        status: WebhookStatus.PENDING,
        retryCount: 0,
        lastError: null,
        processedAt: null,
      });
      return await this.webhookRepo.save(record);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as { code?: string }).code === '23505') {
        return null; // duplicate — already processed
      }
      throw err;
    }
  }
}
