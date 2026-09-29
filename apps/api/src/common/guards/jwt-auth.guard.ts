import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppUser } from '../../modules/auth/entities/app-user.entity';

export interface RequestUser {
  id: string;
  supabaseAuthId: string | null;
  email: string;
  companyId: string;
  role: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    @InjectRepository(AppUser)
    private readonly userRepo: Repository<AppUser>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing authorization token');
    }

    const token = authHeader.slice(7);
    let payload: { sub: string };

    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.userRepo.findOne({
      where: { supabaseAuthId: payload.sub, isActive: true },
    });
    if (!user) {
      throw new UnauthorizedException('User not found or deactivated');
    }

    request.user = {
      id: user.id,
      supabaseAuthId: user.supabaseAuthId,
      email: user.email,
      companyId: user.companyId,
      role: user.role,
    } as RequestUser;

    return true;
  }
}
