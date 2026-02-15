import {
  Body,
  Controller,
  Post,
  Get,
  Req,
  Headers,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  // 1️⃣ Request OTP
  @Post('otp/request')
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto.phone);
  }

  // 2️⃣ Verify OTP
  @Post('otp/verify')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.phone, dto.otp);
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refresh_token);
  }

  @Post('logout')
  async logout(@Headers('authorization') authHeader?: string) {
    if (!authHeader) {
      // Already logged out
      return { success: true };
    }

    try {
      const token = authHeader.replace('Bearer ', '');
      const payload: any = this.authService['jwtService'].verify(token);
      return await this.authService.logout(payload.sub);
    } catch (err) {
      // Token invalid / expired → still logged out
      return { success: true };
    }
  }


  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Req() req) {
    return {
      message: 'You are authenticated',
      user: req.user,
    };
  }
}
