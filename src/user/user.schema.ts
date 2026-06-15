import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, toJSON: { virtuals: true } })
export class User {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'john@example.com' })
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @ApiProperty({ example: 'John Doe' })
  @Prop({ required: true, trim: true })
  name: string;

  @ApiProperty({ example: false })
  @Prop({ default: false })
  isPremium: boolean;

  @ApiProperty({ example: 'basic', enum: ['basic', 'pro', 'pro_plus'] })
  @Prop({ default: 'basic' })
  plan: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
