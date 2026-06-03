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

@Entity('payment_methods')
export class PaymentMethod {
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
  @Column()
  providerPmId: string;

  @ApiProperty({ example: '4242' })
  @Column({ length: 4 })
  cardLast4: string;

  @ApiProperty({ example: 'visa' })
  @Column()
  cardBrand: string;

  @ApiProperty({ example: 12 })
  @Column()
  expMonth: number;

  @ApiProperty({ example: 2027 })
  @Column()
  expYear: number;

  @ApiProperty({ example: 'card' })
  @Column()
  methodType: string;

  @ApiProperty()
  @Column({ default: false })
  isDefault: boolean;

  @ApiProperty()
  @Column({ default: false })
  isExpired: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
