import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'subscription' })
  @Column()
  entityType: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  entityId: string;

  @ApiProperty({ nullable: true, example: 'active' })
  @Column({ nullable: true })
  fromStatus: string | null;

  @ApiProperty({ nullable: true, example: 'canceled' })
  @Column({ nullable: true })
  toStatus: string | null;

  @ApiProperty({ example: 'user' })
  @Column()
  triggeredBy: string;

  @ApiProperty()
  @Column()
  triggeredById: string;

  @ApiProperty({ nullable: true })
  @Column({ nullable: true })
  providerEventId: string | null;

  @ApiProperty()
  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  /** Stored as text — INET not supported natively in TypeORM */
  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  ipAddress: string | null;

  @CreateDateColumn({ name: 'timestamp' })
  timestamp: Date;
}
