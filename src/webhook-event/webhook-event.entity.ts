import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum WebhookStatus {
  PENDING = 'pending',
  PROCESSED = 'processed',
  FAILED = 'failed',
  IGNORED = 'ignored',
}

@Entity('webhook_events')
@Index('UQ_webhook_dedup', ['providerName', 'providerEventId'], { unique: true })
export class WebhookEvent {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column()
  providerEventId: string;

  @ApiProperty({ example: 'stripe' })
  @Column()
  providerName: string;

  @ApiProperty({ example: 'payment_intent.succeeded' })
  @Column()
  type: string;

  @ApiProperty({ enum: WebhookStatus })
  @Column({ type: 'enum', enum: WebhookStatus, default: WebhookStatus.PENDING })
  status: WebhookStatus;

  @ApiProperty()
  @Column({ type: 'jsonb' })
  rawPayload: Record<string, unknown>;

  @ApiProperty()
  @Column({ default: 0 })
  retryCount: number;

  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
