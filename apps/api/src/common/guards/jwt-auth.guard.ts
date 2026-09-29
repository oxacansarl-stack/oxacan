import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, JWTVerifyGetKey } from 'jose';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppUser } from '../../modules/auth/entities/app-user.entity';
import { runAsSystem } from '../tenant/tenant-context';

export interface RequestUser {
  id: string;
  supabaseAuthId: string | null;
  email: string;
  companyId: string;
  role: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly issuer?: string;
  private readonly jwks?: JWTVerifyGetKey;
  private readonly devSecret?: Uint8Array;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
    @InjectRepository(AppUser)
    private readonly userRepo: Repository<AppUser>,
  ) {
    const supabaseUrl = config.get<string>('SUPABASE_URL');
    if (supabaseUrl) {
      this.issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
      this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    }
    const devTokens =
      config.get<string>('ALLOW_DEV_TOKENS') === 'true' && config.get<string>('NODE_ENV') !== 'production';
    const secret = config.get<string>('JWT_SECRET');
    if (devTokens && secret) this.devSecret = new TextEncoder().encode(secret);
  }

  /** Supabase session tokens (ES256/RS256 via JWKS); locally signed HS256 tokens only when dev tokens are enabled. */
  private async verifySubject(token: string): Promise<string> {
    const { alg } = decodeProtectedHeader(token);
    let sub: unknown;
    if ((alg === 'ES256' || alg === 'RS256') && this.jwks) {
      ({ payload: { sub } } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
      }));
    } else if (alg === 'HS256' && this.devSecret) {
      ({ payload: { sub } } = await jwtVerify(token, this.devSecret, { algorithms: ['HS256'] }));
    }
    if (typeof sub !== 'string' || !UUID_RE.test(sub)) throw new Error('invalid subject');
    return sub;
  }

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
    let subject: string;

    try {
      subject = await this.verifySubject(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await runAsSystem(() =>
      this.userRepo.findOne({
        where: { supabaseAuthId: subject, isActive: true },
      }),
    );
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
