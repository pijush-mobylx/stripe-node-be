import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StripeProvider } from './providers/stripe.provider';
import type { IPaymentProvider } from './interfaces/payment-provider.interface';

export interface PlanProviderConfig {
  providerName: string;
  currency: string;
}

@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);
  private readonly registry = new Map<string, IPaymentProvider>();

  constructor(private readonly stripeProvider: StripeProvider) {
    this.register(stripeProvider);
  }

  private register(provider: IPaymentProvider): void {
    this.registry.set(provider.providerName, provider);
    this.logger.log(`Registered payment provider: ${provider.providerName}`);
  }

  /**
   * Returns a provider by name (e.g. "stripe", "razorpay", "paytm").
   * Throws NotFoundException if the provider is not registered.
   */
  getProvider(name: string): IPaymentProvider {
    const provider = this.registry.get(name.toLowerCase());
    if (!provider) {
      throw new NotFoundException(
        `Payment provider "${name}" is not registered. Available: ${[...this.registry.keys()].join(', ')}`,
      );
    }
    return provider;
  }

  /**
   * Returns a provider based on plan config + currency.
   * Falls back to "stripe" when no specific mapping is configured.
   * Extend this method when RazorPay (INR) or Paytm are added.
   */
  getProviderByPlanConfig(config: PlanProviderConfig): IPaymentProvider {
    const name = this.resolveProviderName(config);
    return this.getProvider(name);
  }

  /**
   * Lists all registered provider names — useful for health checks.
   */
  getRegisteredProviders(): string[] {
    return [...this.registry.keys()];
  }

  // ─── private ──────────────────────────────────────────────────────────────

  private resolveProviderName(config: PlanProviderConfig): string {
    if (config.providerName) return config.providerName.toLowerCase();

    // Currency-based fallback routing (extend as new providers are added)
    const currencyMap: Record<string, string> = {
      inr: 'razorpay',   // placeholder — registered once RazorPay is added
      usd: 'stripe',
      eur: 'stripe',
      gbp: 'stripe',
    };

    const resolved = currencyMap[config.currency.toLowerCase()] ?? 'stripe';
    this.logger.debug(`Resolved provider "${resolved}" for currency "${config.currency}"`);
    return resolved;
  }
}
