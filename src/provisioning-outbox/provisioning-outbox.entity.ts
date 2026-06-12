import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ProvisioningType {
  ACTIVATE_SUBSCRIPTION = 'ACTIVATE_SUBSCRIPTION',
  SEND_RECEIPT          = 'SEND_RECEIPT',
  GRANT_ENTITLEMENT     = 'GRANT_ENTITLEMENT',
}

export enum OutboxStatus {
  PENDING    = 'PENDING',
  PROCESSING = 'PROCESSING',
  DONE       = 'DONE',
  FAILED     = 'FAILED',
}

@Index('IDX_outbox_status', ['status'])
@Entity('provisioning_outbox')
export class ProvisioningOutbox {
  /** Same UUID as the PaymentOrder that triggered this job. */
  @PrimaryColumn('uuid')
  jobId: string;

  @Column({ type: 'enum', enum: ProvisioningType })
  provisioningType: ProvisioningType;

  @Column({ type: 'enum', enum: OutboxStatus, default: OutboxStatus.PENDING })
  status: OutboxStatus;

  @Column({ default: 0 })
  retryCount: number;

  @Column({ default: 5 })
  maxRetries: number;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  /** Arbitrary payload passed to the provisioning handler. */
  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
