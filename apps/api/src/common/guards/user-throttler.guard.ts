import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limits per signed-in user rather than per IP: a site office puts many users behind one
 * NAT address. Anonymous requests (health, public portal) are still limited per IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
  }
}
