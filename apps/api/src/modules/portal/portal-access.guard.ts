import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessRuleError } from '@oxacan/shared-types';
import { runAsSystem, setTenant } from '../../common/tenant/tenant-context';
import { PortalToken } from './entities/portal-token.entity';

/** What a valid portal link gives access to: one project of one company, nothing else. */
export interface PortalContext {
  tokenId: string;
  companyId: string;
  projectId: string;
}

export interface PortalClientInfo {
  ip: string | null;
  userAgent: string | null;
}

/**
 * All public portal routes of one client IP share one throttle bucket (the global limit is 600 a
 * minute per route). A portal page needs a handful of calls, so 120 a minute is ample.
 */
export const PORTAL_THROTTLE = {
  default: {
    limit: 120,
    ttl: 60_000,
    generateKey: (_context: ExecutionContext, tracker: string, name: string) => `portal-public:${name}:${tracker}`,
  },
};

export const PORTAL_GUESS_MAX_FAILURES = 20;
export const PORTAL_GUESS_WINDOW_MS = 15 * 60_000;
const MAX_TRACKED = 10_000;

/**
 * Locks an IP out of the public portal once it has presented PORTAL_GUESS_MAX_FAILURES invalid
 * links within PORTAL_GUESS_WINDOW_MS (fixed window from the first failure). While locked out
 * nothing is looked up, so a correct guess is not even tested. In memory, per API instance, like
 * the throttler; bounded to MAX_TRACKED addresses.
 */
@Injectable()
export class PortalGuessLimiter {
  private readonly failures = new Map<string, { count: number; since: number }>();

  isBlocked(key: string, now = Date.now()): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (now - entry.since >= PORTAL_GUESS_WINDOW_MS) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= PORTAL_GUESS_MAX_FAILURES;
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.failures.get(key);
    if (entry && now - entry.since < PORTAL_GUESS_WINDOW_MS) {
      entry.count++;
      return;
    }
    this.failures.delete(key);
    if (this.failures.size >= MAX_TRACKED) this.prune(now);
    this.failures.set(key, { count: 1, since: now });
  }

  private prune(now: number) {
    for (const [k, e] of this.failures) {
      if (now - e.since >= PORTAL_GUESS_WINDOW_MS) this.failures.delete(k);
    }
    // Still full: drop the oldest windows (Map iterates in insertion order).
    for (const k of this.failures.keys()) {
      if (this.failures.size < MAX_TRACKED) break;
      this.failures.delete(k);
    }
  }
}

/**
 * Guards every public /portal/view/:token route: rejects locked-out IPs, resolves the link
 * (active, not expired), then scopes the request's database session to the link's company
 * (RLS) and exposes the link's project as the PortalContext. Every route must also filter by
 * that project: RLS only isolates companies.
 */
@Injectable()
export class PortalAccessGuard implements CanActivate {
  constructor(
    private readonly limiter: PortalGuessLimiter,
    @InjectRepository(PortalToken)
    private readonly tokenRepo: Repository<PortalToken>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    // Private data behind a credential in the URL: never cache.
    res.setHeader('Cache-Control', 'no-store');

    const ip: string = req.ip ?? 'unknown';
    if (this.limiter.isBlocked(ip)) {
      throw new HttpException('Too many invalid portal links. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const raw = req.params?.token;
    const portalToken =
      typeof raw === 'string' && raw.length > 0 && raw.length <= 200
        ? await runAsSystem(() => this.tokenRepo.findOne({ where: { token: raw } }))
        : null;
    if (!portalToken || !portalToken.isActive || !portalToken.expiresAt || portalToken.expiresAt <= new Date()) {
      this.limiter.recordFailure(ip);
      throw new BusinessRuleError('INVALID_TOKEN', 'This portal link is invalid or has expired.');
    }

    setTenant(portalToken.companyId);
    req.portal = {
      tokenId: portalToken.id,
      companyId: portalToken.companyId,
      projectId: portalToken.projectId,
    } satisfies PortalContext;
    // Lets the audit interceptor record the client's portal actions (no user: user_id stays null).
    req.companyId = portalToken.companyId;
    return true;
  }
}

/** The PortalContext resolved by PortalAccessGuard. */
export const Portal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PortalContext => ctx.switchToHttp().getRequest().portal,
);

/** The client's IP (as Express resolves it) and user agent, for the signature evidence. */
export const ClientInfo = createParamDecorator((_data: unknown, ctx: ExecutionContext): PortalClientInfo => {
  const req = ctx.switchToHttp().getRequest();
  const ua = req.headers?.['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua.slice(0, 500) : null };
});
