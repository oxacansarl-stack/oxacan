import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OxacanError } from '@oxacan/shared-types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVITE_TIMEOUT_MS = 10_000;

export interface InvitedAuthUser {
  id: string;
  email: string;
}

/** Supabase already has a confirmed account for this email, so it will not send an invitation. */
export class AuthEmailExistsError extends Error {
  constructor() {
    super('A confirmed Supabase account already exists for this email');
    this.name = 'AuthEmailExistsError';
  }
}

/**
 * Server-side client for the Supabase Auth admin API. Uses the service role key, which must never
 * reach the browser. Only the invite endpoint is needed: it creates the auth user and emails them
 * a link to set up their account. For a user who was invited but has not accepted yet, Supabase
 * re-sends the invitation and returns the same user, so calling it again is safe (resend, retry).
 */
@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger(SupabaseAdminService.name);

  constructor(private readonly config: ConfigService) {}

  private settings(): { url: string; key: string } | null {
    const url = this.config.get<string>('SUPABASE_URL')?.trim().replace(/\/+$/, '');
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    return url && key ? { url, key } : null;
  }

  /** Fails before anything is written when invitations cannot be sent at all. */
  assertConfigured(): void {
    if (!this.settings()) {
      throw new OxacanError(
        'INVITE_NOT_CONFIGURED',
        'Email invitations are not configured on this server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
        503,
      );
    }
  }

  /** Where the invitation link lands after Supabase verifies it. Must be allow-listed in Supabase. */
  private redirectUrl(): string | undefined {
    const explicit = this.config.get<string>('INVITE_REDIRECT_URL')?.trim();
    if (explicit) return explicit;
    return this.config.get<string>('WEB_URL')?.split(',')[0]?.trim() || undefined;
  }

  /** POST {SUPABASE_URL}/auth/v1/invite. `metadata` becomes the user's user_metadata ({{ .Data.* }} in the email template). */
  async inviteUserByEmail(email: string, metadata: Record<string, unknown>): Promise<InvitedAuthUser> {
    this.assertConfigured();
    const settings = this.settings()!;

    const endpoint = new URL(`${settings.url}/auth/v1/invite`);
    const redirectTo = this.redirectUrl();
    if (redirectTo) endpoint.searchParams.set('redirect_to', redirectTo);

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: settings.key,
          Authorization: `Bearer ${settings.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, data: metadata }),
        redirect: 'error',
        signal: AbortSignal.timeout(INVITE_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(`Supabase invite request failed: ${(err as Error).message}`);
      throw inviteFailed();
    }

    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;

    if (res.ok && typeof body?.id === 'string' && UUID_RE.test(body.id)) {
      return { id: body.id, email: typeof body.email === 'string' ? body.email : email };
    }
    if (res.status === 422 && isEmailExists(body)) throw new AuthEmailExistsError();
    if (res.status === 429) {
      throw new OxacanError('RATE_LIMITED', 'Too many invitation emails were sent. Try again later.', 429, {
        rule: 'INVITE_RATE_LIMITED',
      });
    }

    // No email address in the log: status and Supabase's error code are enough to diagnose.
    this.logger.warn(
      `Supabase invite rejected: HTTP ${res.status} ${String(body?.error_code ?? body?.code ?? '')}`.trim(),
    );
    throw inviteFailed();
  }
}

function isEmailExists(body: Record<string, unknown> | null): boolean {
  if (!body) return false;
  if (body.error_code === 'email_exists' || body.error_code === 'user_already_exists') return true;
  const msg = String(body.msg ?? body.message ?? body.error_description ?? '');
  return /already (been )?registered|already exists/i.test(msg);
}

function inviteFailed(): OxacanError {
  return new OxacanError(
    'INVITE_FAILED',
    'The invitation email could not be sent. Please try again.',
    502,
  );
}
