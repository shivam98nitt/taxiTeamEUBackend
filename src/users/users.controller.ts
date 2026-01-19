import { Controller, Patch, Body, Req, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('onboarding')
  @UseGuards(JwtAuthGuard)
  async completeOnboarding(@Req() req, @Body() dto: OnboardingDto) {
    const userId = req.user.userId;
    const user = await this.usersService.completeOnboarding(userId, dto);

    return { user };
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@Req() req, @Body() dto: UpdateProfileDto) {
    const userId = req.user.userId;
    const user = await this.usersService.updateProfile(userId, dto);

    return { user };
  }
}
