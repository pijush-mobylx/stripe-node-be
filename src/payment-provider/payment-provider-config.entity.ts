import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('payment_provider_configs')
export class PaymentProviderConfig {
  /** e.g. "stripe", "ccavenue" — matches IPaymentProvider.providerName */
  @PrimaryColumn()
  providerName: string;

  @Column({ default: true })
  isActive: boolean;

  /** ISO-4217 currency codes this provider accepts, e.g. ["usd","eur","gbp"] */
  @Column({ type: 'jsonb', default: [] })
  supportedCurrencies: string[];

  /** Human-readable label shown in admin UI */
  @Column({ nullable: true })
  displayName: string | null;

  /** Arbitrary config flags (webhook URL, mode: 'live'|'test', etc.) */
  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
