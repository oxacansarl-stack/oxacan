import { createHmac } from 'node:crypto';

/**
 * The RLS session context (company, user, bypass) is signed with a secret the database role
 * cannot read. The database only honours a context whose signature matches (see migration
 * SignedTenantContext1727500000019), so a SQL injection that calls set_config() cannot switch
 * to another company or turn the bypass on.
 */
export function contextSignature(secret: string, companyId: string, userId: string, bypass: 'on' | 'off'): string {
  return createHmac('sha256', secret).update(`${companyId}|${userId}|${bypass}`).digest('hex');
}

/** RLS_CONTEXT_SECRET from the environment; the API refuses to start without a strong one. */
export function contextSecret(): string {
  const secret = process.env.RLS_CONTEXT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('RLS_CONTEXT_SECRET must be set to a random value of at least 32 characters');
  }
  return secret;
}

/** Parameters for SET_CONTEXT_SQL-style statements: company, user, bypass, signature. */
export function signedContext(secret: string, companyId = '', userId = '', bypass: 'on' | 'off' = 'off') {
  return [companyId, userId, bypass, contextSignature(secret, companyId, userId, bypass)];
}

export const SET_CONTEXT_SQL = `SELECT set_config('app.company_id', $1, false),
       set_config('app.user_id', $2, false),
       set_config('app.rls_bypass', $3, false),
       set_config('app.context_sig', $4, false)`;

/** Same, scoped to the current transaction (for scripts that run as the schema owner). */
export const SET_LOCAL_CONTEXT_SQL = SET_CONTEXT_SQL.replace(/false\)/g, 'true)');
