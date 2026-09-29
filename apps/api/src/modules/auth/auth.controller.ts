import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: RequestUser) {
    const appUser = await this.authService.findById(user.id);
    return {
      id: appUser!.id,
      email: appUser!.email,
      firstName: appUser!.firstName,
      lastName: appUser!.lastName,
      role: appUser!.role,
      companyId: appUser!.companyId,
    };
  }
}
