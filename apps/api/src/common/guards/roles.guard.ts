import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OFFICE_ROLES, ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    // Only @Public() routes reach here without a user; JwtAuthGuard rejects the rest.
    if (!user) return true;

    const allowed = requiredRoles?.length ? requiredRoles : OFFICE_ROLES;
    if (!allowed.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
