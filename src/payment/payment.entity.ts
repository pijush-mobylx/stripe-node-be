import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { Plan } from '../plan/plan.entity';
import { Subscription } from '../subscription/subscription.entity';

export enum PaymentType {
  ONE_TIME = 'ONE_TIME',
  SUBSCRIPTION = 'SUBSCRIPTION',
  MARKETPLACE_ORDER = 'MARKETPLACE_ORDER', // declared — implementation deferred
}

export enum PaymentStatus {
  INITIATED    = 'initiated',
  SUCCESS      = 'success',
  FAILED       = 'failed',
  NEEDS_REVIEW = 'needs_review',
  EXPIRED      = 'expired',
  REFUNDED     = 'refunded',   // retained for future refund flow
}

@Entity('payments')
export class Payment {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @ApiProperty({ enum: PaymentType })
  @Column({ type: 'enum', enum: PaymentType })
  type: PaymentType;

  // ── one-time only ──────────────────────────────────────────
  @ApiProperty({ nullable: true })
  @Column({ nullable: true })
  orderId: string | null;

  // ── subscription only ──────────────────────────────────────
  @ManyToOne(() => Subscription, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @Column({ name: 'subscription_id', nullable: true })
  subscriptionId: string | null;

  @ManyToOne(() => Plan, { nullable: true })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @Column({ name: 'plan_id', nullable: true })
  planId: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  billingPeriodStart: Date | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  billingPeriodEnd: Date | null;

  @ApiProperty({ nullable: true })
  @Column({ nullable: true })
  invoiceId: string | null;

  // ── provider ───────────────────────────────────────────────
  @ApiProperty({ example: 'stripe' })
  @Column()
  providerName: string;

  @ApiProperty()
  @Column({ unique: true })
  providerIntentId: string;

  /** Amount in cents */
  @ApiProperty()
  @Column()
  amount: number;

  @ApiProperty({ enum: PaymentStatus })
  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.INITIATED })
  status: PaymentStatus;

  @ApiProperty()
  @Column({ default: false })
  frozen: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
