import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { WebhookEvent, WebhookStatus } from './webhook-event.entity';
import { PaymentProviderFactory } from '../payment-provider/payment-provider.factory';
import { StripeEventHandler } from './handlers/stripe-event.handler';

type EventHandlerFn = (type: string, payload: Record<string, unknown>) => Promise<void>;

@Injectable()
export class WebhookHandlerFactory {
  private readonly logger = new Logger(WebhookHandlerFactory.name);
  private readonly handlerRegistry = new Map<string, EventHandlerFn>();

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookRepo: Repository<WebhookEvent>,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly stripeHandler: StripeEventHandler,
  ) {
    this.handlerRegistry.set('stripe', (type, payload) =>
      this.stripeHandler.handle(type, payload),
    );
    // RazorPay and Paytm handlers registered here later:
    // this.handlerRegistry.set('razorpay', (type, payload) => this.razorpayHandler.handle(type, payload));
  }

  // ─── processWebhook ───────────────────────────────────────────────────────
  // Entry point called by the controller for each inbound webhook request

  async processWebhook(
    providerName: string,
    rawBody: Buffer,
    signature: string,
  ): Promise<{ received: boolean }> {
    // 1. Verify signature via the correct provider
    const provider = this.providerFactory.getProvider(providerName);
    const event = await provider.verifyWebhook({ rawBody, signature });

    // 2. Idempotency — deduplicate by (providerName + providerEventId)
    const record = await this.saveEventRecord(providerName, event);
    if (!record) {
      this.logger.log(`Duplicate webhook ignored: ${event.providerEventId}`);
      return { received: true };
    }

    // 3. Dispatch to the appropriate handler
    try {
      const handler = this.handlerRegistry.get(providerName.toLowerCase());

      if (!handler) {
        throw new NotFoundException(`No handler registered for provider "${providerName}"`);
      }

      await handler(event.type, event.payload);

      await this.webhookRepo.update(record.id, {
        status: WebhookStatus.PROCESSED,
        processedAt: new Date(),
      });

      this.logger.log(`Webhook ${event.providerEventId} (${event.type}) processed`);
    } catch (err) {
      await this.webhookRepo.update(record.id, {
        status: WebhookStatus.FAILED,
        retryCount: record.retryCount + 1,
        lastError: (err as Error).message,
      });

      this.logger.error(
        `Webhook ${event.providerEventId} failed: ${(err as Error).message}`,
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
