import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import express from 'express';
import { apiClient, appRoleClient, setSignedContext, tokenFor, BASE_URL, USER_A } from './setup';
import { TRUSTED_PROXIES } from '../src/common/middleware/trust-proxy';
import { requestIdFrom } from '../src/common/middleware/request-context.middleware';
import { grantsSeats, seatAvailability, SubscriptionSeats } from '../src/modules/subscription/seat-rules';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;

/** Raw fetch, for headers. Anonymous calls pass their own client IP: a rate-limit bucket of their own. */
function call(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return fetch(`${BASE_URL}${path}`, { method: init.method ?? 'GET', headers: init.headers, body: init.body });
}

/* ─────────────── Seat rules (PRD §4.1, §18.2) ─────────────── */

describe('seat rules', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const sub = (over: Partial<SubscriptionSeats> = {}): SubscriptionSeats => ({
    status: 'active',
    saasSeatCount: 5,
    applicationSeatCount: 2,
    trialEndsAt: null,
    currentPeriodEnd: null,
    ...over,
  });

  it('counts each licence tier against its own seats', () => {
    const seats = seatAvailability(sub(), { saas: 5, application: 1 }, undefined, now);
    expect(seats.byTier).toEqual({
      saas: { used: 5, total: 5, available: 0 },
      application: { used: 1, total: 2, available: 1 },
    });
    // A free application seat is no use for a worker.
    expect(seatAvailability(sub(), { saas: 5, application: 1 }, 'saas', now)).toMatchObject({
      licenceTier: 'saas', used: 5, total: 5, available: 0,
    });
    expect(seatAvailability(sub(), { saas: 5, application: 1 }, 'application', now)).toMatchObject({
      licenceTier: 'application', used: 1, total: 2, available: 1,
    });
    // Without a tier: both added up.
    expect(seatAvailability(sub(), { saas: 5, application: 1 }, undefined, now)).toMatchObject({
      licenceTier: null, used: 6, total: 7, available: 1, subscriptionActive: true, subscriptionStatus: 'active',
    });
  });

  it('grants no seats without a subscription in force', () => {
    expect(seatAvailability(null, { saas: 1 }, 'saas', now)).toMatchObject({
      total: 0, available: -1, subscriptionActive: false, subscriptionStatus: null,
    });
    for (const status of ['cancelled', 'paused']) {
      expect(seatAvailability(sub({ status }), { saas: 1 }, 'saas', now)).toMatchObject({
        total: 0, available: -1, subscriptionActive: false, subscriptionStatus: status,
      });
    }
    expect(grantsSeats(sub({ status: 'past_due' }), now)).toBe(true);
  });

  it('ends a trial at trial_ends_at, and a billing period after the grace period', () => {
    expect(grantsSeats(sub({ status: 'trialing' }), now)).toBe(true);
    expect(grantsSeats(sub({ status: 'trialing', trialEndsAt: new Date(now.getTime() + DAY) }), now)).toBe(true);
    expect(grantsSeats(sub({ status: 'trialing', trialEndsAt: new Date(now.getTime() - 1) }), now)).toBe(false);
    expect(grantsSeats(sub({ currentPeriodEnd: new Date(now.getTime() - 6 * DAY) }), now)).toBe(true);
    expect(grantsSeats(sub({ currentPeriodEnd: new Date(now.getTime() - 8 * DAY) }), now)).toBe(false);
  });

  it('treats a missing seat count as zero', () => {
    expect(seatAvailability(sub({ saasSeatCount: null }), {}, 'saas', now)).toMatchObject({ total: 0, available: 0 });
  });
});

describe('GET /subscription/seats and adding users', () => {
  const COMPANY = '5ea70000-0000-4000-8000-000000000001';
  const ADMIN = { id: '5ea70000-0000-4000-8000-000000000002', authId: '5ea70000-0000-4000-8000-000000000003' };
  const PM = { id: '5ea70000-0000-4000-8000-000000000012', authId: '5ea70000-0000-4000-8000-000000000013' };
  const admin = apiClient(tokenFor(ADMIN.authId));
  let db: Client;

  beforeAll(async () => {
    db = await appRoleClient();
    await setSignedContext(db, '', '', 'on');
    await db.query(`INSERT INTO company (id, name) VALUES ($1, 'Test Seats AG')`, [COMPANY]);
    for (const [u, email, role, tier] of [
      [ADMIN, 'admin-seats@test.local', 'ADMIN', 'application'],
      [PM, 'pm-seats@test.local', 'PROJECT_MANAGER', 'application'],
    ] as const) {
      await db.query(
        `INSERT INTO app_user (id, company_id, supabase_auth_id, email, first_name, last_name, role, licence_tier)
         VALUES ($1, $2, $3, $4, 'Test', $5, $5, $6)`,
        [u.id, COMPANY, u.authId, email, role, tier],
      );
    }
    await db.query(
      `INSERT INTO subscription (company_id, stripe_customer_id, tier, status, saas_seat_count, application_seat_count)
       VALUES ($1, 'cus_test_seats', 'equipe', 'active', 3, 2)`,
      [COMPANY],
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  it('reports seats per licence tier', async () => {
    const res = await admin.get('/subscription/seats');
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      used: 2,
      total: 5,
      available: 3,
      subscriptionStatus: 'active',
      subscriptionActive: true,
      byTier: {
        saas: { used: 0, total: 3, available: 3 },
        application: { used: 2, total: 2, available: 0 },
      },
    });
  });

  it('a cancelled or expired subscription has no seats, so no user can be added', async () => {
    for (const [status, trialEndsAt] of [['cancelled', null], ['trialing', new Date(Date.now() - DAY)]] as const) {
      await db.query('UPDATE subscription SET status = $1, trial_ends_at = $2 WHERE company_id = $3', [
        status, trialEndsAt, COMPANY,
      ]);
      const seats = await admin.get('/subscription/seats');
      expect(seats.data).toMatchObject({ used: 2, total: 0, subscriptionActive: false, subscriptionStatus: status });

      const res = await admin.post('/hr/employees', {
        email: `seat.${status}@example.test`, firstName: 'No', lastName: 'Seat', role: 'WORKER',
      });
      expect(res.status).toBe(422);
      expect((res.error as any)?.details).toMatchObject({ rule: 'SEAT_LIMIT_REACHED', total: 0 });
    }
    await db.query(`UPDATE subscription SET status = 'active', trial_ends_at = NULL WHERE company_id = $1`, [COMPANY]);
  });
});

/* ─────────────── Request id ─────────────── */

describe('X-Request-Id', () => {
  it('accepts a well-formed incoming id and replaces anything else', () => {
    expect(requestIdFrom('0f8c2a6e-5b1d-4c33-9a8e-1d2f3a4b5c6d')).toBe('0f8c2a6e-5b1d-4c33-9a8e-1d2f3a4b5c6d');
    expect(requestIdFrom('01HZX3J5K8Q2W7V9T4R6Y1M0NB')).toBe('01HZX3J5K8Q2W7V9T4R6Y1M0NB');
    for (const bad of [undefined, '', 'short', 'has space in it', 'x'.repeat(129), 'id\r\nSet-Cookie: a=b', '<script>alert(1)</script>']) {
      expect(requestIdFrom(bad)).toMatch(UUID_RE);
    }
  });

  it('is generated when absent, echoed when valid, and returned on every response', async () => {
    const generated = await call('/health');
    expect(generated.headers.get('x-request-id')).toMatch(UUID_RE);

    const mine = `test-${randomUUID()}`;
    const echoed = await call('/health', { headers: { 'X-Request-Id': mine } });
    expect(echoed.headers.get('x-request-id')).toBe(mine);

    const replaced = await call('/health', { headers: { 'X-Request-Id': 'not valid!' } });
    expect(replaced.headers.get('x-request-id')).toMatch(UUID_RE);
  });

  it('is part of error bodies', async () => {
    const id = `test-${randomUUID()}`;
    const res = await call('/subscription/seats', { headers: { 'X-Request-Id': id, 'X-Forwarded-For': '203.0.113.40' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('x-request-id')).toBe(id);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: 'UNAUTHORIZED', requestId: id });
  });

  it('stays out of the replayable body of a request with an Idempotency-Key', async () => {
    const res = await call('/clients', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenFor(USER_A.authId)}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('x-request-id')).toMatch(UUID_RE);
    expect((await res.json()).error.requestId).toBeUndefined();
  });
});

/* ─────────────── Client IP behind the proxies ─────────────── */

describe('trust proxy', () => {
  const app = express();
  app.set('trust proxy', TRUSTED_PROXIES);
  /** req.ip as Express computes it, for a request from `peer` carrying X-Forwarded-For `xff`. */
  const clientIp = (peer: string, xff?: string): string => {
    const req = Object.create(express.request);
    req.app = app;
    req.socket = { remoteAddress: peer };
    req.headers = xff ? { 'x-forwarded-for': xff } : {};
    return req.ip;
  };

  it('resolves the client through edge → Caddy → API', () => {
    // Caddy (private network) forwards "<client>, <edge>".
    expect(clientIp('fd12:3456::1', '198.51.100.7, 100.64.0.9')).toBe('198.51.100.7');
    expect(clientIp('10.1.2.3', '198.51.100.7, 100.64.0.9')).toBe('198.51.100.7');
    expect(clientIp('::ffff:10.1.2.3', '198.51.100.7, 100.64.0.9')).toBe('198.51.100.7');
  });

  it('ignores whatever the client prepends, private addresses included', () => {
    expect(clientIp('fd12:3456::1', '1.2.3.4, 198.51.100.7, 100.64.0.9')).toBe('198.51.100.7');
    expect(clientIp('fd12:3456::1', '10.0.0.1, 127.0.0.1, 198.51.100.7, 100.64.0.9')).toBe('198.51.100.7');
  });

  it('never trusts a public peer', () => {
    expect(clientIp('198.51.100.7', '1.2.3.4')).toBe('198.51.100.7');
  });

  it('applies to the running API: anonymous rate-limit buckets follow the forwarded client', async () => {
    const remaining = async (xff: string) => {
      const res = await call(`/portal/view/${randomUUID()}`, { headers: { 'X-Forwarded-For': xff } });
      return Number(res.headers.get('x-ratelimit-remaining'));
    };
    const first = await remaining('203.0.113.71');
    expect(Number.isFinite(first)).toBe(true);
    // Same client, whatever it prepends: same bucket.
    expect(await remaining('192.0.2.1, 203.0.113.71')).toBe(first - 1);
    // A trusted (private) hop after the client is skipped: still the same client.
    expect(await remaining('203.0.113.71, 10.0.0.5')).toBe(first - 2);
    // Another client: a bucket of its own.
    expect(await remaining('203.0.113.72')).toBeGreaterThan(first - 2);
  });
});

/* ─────────────── Large bodies only after authentication ─────────────── */

describe('POST /catalogue/import body', () => {
  const json = (token: string | undefined, body: string, xff = '203.0.113.80') =>
    call('/catalogue/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': xff,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    });
  const token = tokenFor(USER_A.authId);

  it('is not read before authentication', async () => {
    // Not even parsed: an anonymous malformed body gets 401, not a JSON syntax error.
    expect((await json(undefined, '{"filename":')).status).toBe(401);
    expect((await json(undefined, JSON.stringify({ filename: 'x', pad: 'a'.repeat(2_000_000) }))).status).toBe(401);
    expect((await json('not-a-token', '{"filename":')).status).toBe(401);
  });

  it('is parsed with the 10 MB limit once authenticated', async () => {
    expect((await json(token, '{"filename":')).status).toBe(400);
    // Over Nest's default 100 kb, under 10 MB: reaches validation (unknown property), not 413.
    const big = await json(token, JSON.stringify({ filename: 'x.csv', pad: 'a'.repeat(300_000) }));
    expect(big.status).toBe(400);
    expect((await big.json()).error.code).toBe('VALIDATION_ERROR');
    expect((await json(token, JSON.stringify({ filename: 'x.csv', pad: 'a'.repeat(10_500_000) }))).status).toBe(413);
  });

  it('other routes keep the default 100 kb limit', async () => {
    const res = await call('/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'x', pad: 'a'.repeat(200_000) }),
    });
    expect(res.status).toBe(413);
  });
});
