import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('plans')
export class Plan {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'Pro' })
  @Column()
  name: string;

  @ApiProperty({ example: 'stripe' })
  @Column()
  providerName: string;

  @ApiProperty()
  @Column({ unique: true })
  providerPlanId: string;

  /** Amount in cents */
  @ApiProperty({ example: 3000 })
  @Column()
  amount: number;

  @ApiProperty({ example: 'usd' })
  @Column({ length: 3 })
  currency: string;

  @ApiProperty({ example: 'month' })
  @Column()
  interval: string;

  @ApiProperty({ example: 1 })
  @Column({ default: 1 })
  intervalCount: number;

  @ApiProperty({ example: 14 })
  @Column({ default: 0 })
  trialDays: number;

  @ApiProperty({ example: { analytics: true, api: true } })
  @Column({ type: 'jsonb', default: {} })
  features: Record<string, unknown>;

  @ApiProperty()
  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
