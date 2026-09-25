import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { CurrentUser, Public, Roles } from './jwt-auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import type { JwtPayload } from './auth.types';

const Bootstrap = z.object({ companyName: z.string().min(1), email: z.string().email(), password: z.string().min(8), fullName: z.string().min(1) });
const Login = z.object({ email: z.string().email(), password: z.string().min(1) });
const Invite = z.object({ email: z.string().email(), password: z.string().min(8), fullName: z.string().min(1), role: z.enum(['DIRIGEANT', 'CHEF_PROJET', 'TECHNICIEN', 'CLIENT']) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post('bootstrap') bootstrap(@Body(new ZodPipe(Bootstrap)) b: z.infer<typeof Bootstrap>) { return this.auth.bootstrapTenant(b); }
  @Public() @Post('login') login(@Body(new ZodPipe(Login)) b: z.infer<typeof Login>) { return this.auth.login(b.email, b.password); }
  @Roles('DIRIGEANT') @Post('users') invite(@CurrentUser() u: JwtPayload, @Body(new ZodPipe(Invite)) b: z.infer<typeof Invite>) { return this.auth.inviteUser(u.tenantId, b); }
  @Get('me') me(@CurrentUser() u: JwtPayload) { return u; }
}
