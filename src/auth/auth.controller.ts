import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';
import { AuthService } from './auth.service';

export class LoginDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;
}

export class LoginResponse {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  access_token: string;

  @ApiProperty({ example: 'uuid-of-user' })
  userId: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login by email — returns JWT access token' })
  @ApiResponse({ status: 200, type: LoginResponse })
  @ApiResponse({ status: 401, description: 'User not found' })
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto.email);
  }
}
