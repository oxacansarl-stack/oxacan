import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [JwtModule.register({ global: true, secret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me-32chars!!', signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '8h' } })],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  controllers: [AuthController],
})
export class AuthModule {}
