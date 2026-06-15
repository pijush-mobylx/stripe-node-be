import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../user/user.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string): Promise<{ access_token: string; userId: string }> {
    const user = await this.userModel.findOne({ email: email.toLowerCase() }).exec();
    if (!user) {
      throw new UnauthorizedException(`No user found with email: ${email}`);
    }

    const payload = { sub: user._id.toString(), email: user.email };
    const access_token = this.jwtService.sign(payload);

    return { access_token, userId: user._id.toString() };
  }
}
