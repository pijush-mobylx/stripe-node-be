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

export enum SubscriptionStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  UNPAID = 'unpaid',
  INCOMPLETE = 'incomplete',
  INCOMPLETE_EXPIRED = 'incomplete_expired',
  PAUSED = 'paused',
}

@Entity('subscriptions')
export class Subscription {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @ApiProperty({ example: 'stripe' })
  @Column()
  providerName: string;

  @ApiProperty()
  @Column({ unique: true })
  providerSubId: string;

  @ApiProperty()
  @Column()
  providerCustomerId: string;

  @ApiProperty()
  @Column()
  providerPmId: string;

  @ManyToOne(() => Plan, { nullable: true })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @Column({ name: 'plan_id', nullable: true })
  planId: string;

  @ApiProperty()
  @Column()
  planName: string;

  /** Plan amount in cents at time of subscription */
  @ApiProperty()
  @Column()
  planAmount: number;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  currentPeriodStart: Date;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  currentPeriodEnd: Date;

  @ApiProperty()
  @Column({ default: false })
  cancelAtPeriodEnd: boolean;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  trialEnd: Date | null;

  @ApiProperty({ enum: SubscriptionStatus })
  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.INCOMPLETE })
  status: SubscriptionStatus;

  @ApiProperty()
  @Column({ default: 0 })
  failedAttempts: number;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
