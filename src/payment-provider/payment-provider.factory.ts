import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StripeProvider } from './providers/stripe.provider';
import { CCAvenueProvider } from './providers/ccavenue.provider';
import type { IPaymentProvider } from './interfaces/payment-provider.interface';
import { PaymentProviderConfig, PaymentProviderConfigDocument } from './payment-provider-config.schema';

export interface PlanProviderConfig {
  providerName: string;
  currency: string;
}

interface CacheEntry {
  isActive: boolean;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);
  private readonly registry = new Map<string, IPaymentProvider>();
  private readonly configCache = new Map<string, CacheEntry>();

  constructor(
    private readonly stripeProvider: StripeProvider,
    private readonly ccavenueProvider: CCAvenueProvider,
    @InjectModel(PaymentProviderConfig.name)
    private readonly configModel: Model<PaymentProviderConfigDocument>,
  ) {
    this.register(stripeProvider);
    this.register(ccavenueProvider);
  }

  private register(provider: IPaymentProvider): void {
    this.registry.set(provider.providerName, provider);
    this.logger.log(`Registered payment provider: ${provider.providerName}`);
  }

  async getProvider(name: string): Promise<IPaymentProvider> {
    const key = name.toLowerCase();
    const provider = this.registry.get(key);
    if (!provider) {
      throw new NotFoundException(
        `Payment provider "${name}" is not registered. Available: ${[...this.registry.keys()].join(', ')}`,
      );
    }
    await this.assertActive(key);
    return provider;
  }

  async getProviderByPlanConfig(config: PlanProviderConfig): Promise<IPaymentProvider> {
    const name = this.resolveProviderName(config);
    return this.getProvider(name);
  }

  getRegisteredProviders(): string[] {
    return [...this.registry.keys()];
  }

  private async assertActive(providerName: string): Promise<void> {
    const cached = this.configCache.get(providerName);
    if (cached && Date.now() < cached.expiresAt) {
      if (!cached.isActive) this.throwInactive(providerName);
      return;
    }

    const config = await this.configModel.findOne({ providerName }).exec();

    const isActive = config ? config.isActive : true;

    this.configCache.set(providerName, {
      isActive,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    if (!isActive) this.throwInactive(providerName);
  }

  private throwInactive(providerName: string): never {
    throw new ServiceUnavailableException(
      `Payment provider "${providerName}" is currently disabled`,
    );
  }

  private resolveProviderName(config: PlanProviderConfig): string {
    if (config.providerName) return config.providerName.toLowerCase();

    const currencyMap: Record<string, string> = {
      inr: 'razorpay',
      usd: 'stripe',
      eur: 'stripe',
      gbp: 'stripe',
    };

    const resolved = currencyMap[config.currency.toLowerCase()] ?? 'stripe';
    this.logger.debug(`Resolved provider "${resolved}" for currency "${config.currency}"`);
    return resolved;
  }
}
