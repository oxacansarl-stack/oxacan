import { createHash, randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  BASE_URL, COMPANY_A, COMPANY_B, PM_A, USER_A, USER_B,
  apiClient, appRoleClient, createProject, setSignedContext, tokenFor,
} from './setup';

const tokenA = tokenFor(USER_A.authId);
const tokenB = tokenFor(USER_B.authId);

interface Sent {
  status: number;
  raw: any;
  replayed: boolean;
}

/** POST/PUT/… with an optional Idempotency-Key; returns the raw envelope as received. */
async function send(token: string, method: string, path: string, body: unknown, key?: string): Promise<Sent> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (key !== undefined) headers['Idempotency-Key'] = key;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: JSON.stringify(body) });
  const text = await res.text();
  let raw: any = text;
  try {
    raw = JSON.parse(text);
  } catch {
    /* empty body */
  }
  return { status: res.status, raw, replayed: res.headers.get('idempotent-replayed') === 'true' };
}

let db: Client;

async function countClients(name: string, companyId = COMPANY_A): Promise<number> {
  await setSignedContext(db, companyId);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM client WHERE name = $1', [name]);
  return rows[0].n;
}

beforeAll(async () => {
  db = await appRoleClient();
});

afterAll(async () => {
  await db.end();
});

describe('Idempotency-Key on mutating requests', () => {
  it('a retry with the same key returns the stored response without executing again', async () => {
    const key = randomUUID();
    const body = { name: `Idem replay ${key}` };
    const first = await send(tokenA, 'POST', '/clients', body, key);
    expect(first.status, JSON.stringify(first.raw)).toBe(201);
    expect(first.replayed).toBe(false);

    const retry = await send(tokenA, 'POST', '/clients', body, key);
    expect(retry.status).toBe(201);
    expect(retry.replayed).toBe(true);
    // The same envelope, including the original meta.timestamp (key order may differ: JSONB).
    expect(retry.raw).toEqual(first.raw);
    expect(await countClients(body.name)).toBe(1);
  });

  it('the key is case-insensitive', async () => {
    const key = randomUUID();
    const body = { name: `Idem case ${key}` };
    const first = await send(tokenA, 'POST', '/clients', body, key.toLowerCase());
    const retry = await send(tokenA, 'POST', '/clients', body, key.toUpperCase());
    expect(retry.replayed).toBe(true);
    expect(retry.raw.data.id).toBe(first.raw.data.id);
    expect(await countClients(body.name)).toBe(1);
  });

  it('requests without the header are not deduplicated', async () => {
    const body = { name: `Idem none ${randomUUID()}` };
    expect((await send(tokenA, 'POST', '/clients', body)).status).toBe(201);
    expect((await send(tokenA, 'POST', '/clients', body)).status).toBe(201);
    expect(await countClients(body.name)).toBe(2);
  });

  it('the same key with a different body or path is rejected with 422', async () => {
    const key = randomUUID();
    const name = `Idem mismatch ${key}`;
    expect((await send(tokenA, 'POST', '/clients', { name }, key)).status).toBe(201);

    const otherBody = await send(tokenA, 'POST', '/clients', { name: `${name} changed` }, key);
    expect(otherBody.status).toBe(422);
    expect(otherBody.raw.error.code).toBe('IDEMPOTENCY_KEY_MISMATCH');

    const otherPath = await send(tokenA, 'POST', '/timekeeping/clock-in', { name }, key);
    expect(otherPath.status).toBe(422);
    expect(otherPath.raw.error.code).toBe('IDEMPOTENCY_KEY_MISMATCH');

    expect(await countClients(name)).toBe(1);
    expect(await countClients(`${name} changed`)).toBe(0);
  });

  it('rejects a key that is not a UUID', async () => {
    const res = await send(tokenA, 'POST', '/clients', { name: 'Idem bad key' }, 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.raw.error.code).toBe('VALIDATION_ERROR');
    expect(await countClients('Idem bad key')).toBe(0);
  });

  it('keys are scoped per company and per user', async () => {
    const key = randomUUID();
    const body = { name: `Idem scope ${key}` };
    const a = await send(tokenA, 'POST', '/clients', body, key);
    const pm = await send(tokenFor(PM_A.authId), 'POST', '/clients', body, key);
    const b = await send(tokenB, 'POST', '/clients', body, key);
    for (const r of [a, pm, b]) {
      expect(r.status, JSON.stringify(r.raw)).toBe(201);
      expect(r.replayed).toBe(false);
    }
    expect(new Set([a.raw.data.id, pm.raw.data.id, b.raw.data.id]).size).toBe(3);
    expect(await countClients(body.name, COMPANY_A)).toBe(2);
    expect(await countClients(body.name, COMPANY_B)).toBe(1);
  });

  it('concurrent requests with one key execute once', async () => {
    const key = randomUUID();
    const body = { name: `Idem race ${key}` };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => send(tokenA, 'POST', '/clients', body, key)),
    );
    for (const r of results) {
      expect([201, 409]).toContain(r.status);
      if (r.status === 409) expect(r.raw.error.code).toBe('IDEMPOTENCY_KEY_IN_PROGRESS');
    }
    expect(results.filter((r) => r.status === 201 && !r.replayed)).toHaveLength(1);
    expect(await countClients(body.name)).toBe(1);
  });

  describe('stored state', () => {
    const name = `Idem pending ${randomUUID()}`;
    const key = randomUUID();
    // Same fingerprint the interceptor computes for a JSON body: sha256 of {"body":…} with sorted keys.
    const hash = createHash('sha256').update(JSON.stringify({ body: { name } })).digest('hex');

    it('a key whose first request is still running gets 409 IDEMPOTENCY_KEY_IN_PROGRESS', async () => {
      await setSignedContext(db, COMPANY_A, USER_A.id);
      await db.query(
        `INSERT INTO idempotency_key (company_id, user_id, key, method, path, request_hash)
         VALUES ($1, $2, $3, 'POST', '/clients', $4)`,
        [COMPANY_A, USER_A.id, key, hash],
      );
      const res = await send(tokenA, 'POST', '/clients', { name }, key);
      expect(res.status).toBe(409);
      expect(res.raw.error.code).toBe('IDEMPOTENCY_KEY_IN_PROGRESS');
      expect(await countClients(name)).toBe(0);
    });

    it('a pending key abandoned by a crashed request is taken over once stale', async () => {
      await setSignedContext(db, COMPANY_A, USER_A.id);
      await db.query(
        `UPDATE idempotency_key SET locked_at = now() - interval '10 minutes' WHERE company_id = $1 AND key = $2`,
        [COMPANY_A, key],
      );
      const res = await send(tokenA, 'POST', '/clients', { name }, key);
      expect(res.status).toBe(201);
      expect(res.replayed).toBe(false);
      expect(await countClients(name)).toBe(1);

      await setSignedContext(db, COMPANY_A, USER_A.id);
      const { rows } = await db.query(
        `SELECT status, response_status, response_body FROM idempotency_key WHERE company_id = $1 AND key = $2`,
        [COMPANY_A, key],
      );
      expect(rows[0].status).toBe('completed');
      expect(rows[0].response_status).toBe(201);
      expect(rows[0].response_body.data.id).toBe(res.raw.data.id);
    });

    it('an expired key is forgotten and the request executes again', async () => {
      await setSignedContext(db, COMPANY_A, USER_A.id);
      await db.query(
        `UPDATE idempotency_key SET expires_at = now() - interval '1 minute' WHERE company_id = $1 AND key = $2`,
        [COMPANY_A, key],
      );
      const res = await send(tokenA, 'POST', '/clients', { name }, key);
      expect(res.status).toBe(201);
      expect(res.replayed).toBe(false);
      expect(await countClients(name)).toBe(2);
    });

    it('another company cannot see the stored keys (RLS)', async () => {
      await setSignedContext(db, COMPANY_B);
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM idempotency_key WHERE company_id = $1`,
        [COMPANY_A],
      );
      expect(rows[0].n).toBe(0);
      await setSignedContext(db, COMPANY_A);
      const mine = await db.query(`SELECT count(*)::int AS n FROM idempotency_key WHERE key = $1`, [key]);
      expect(mine.rows[0].n).toBe(1);
    });
  });

  describe('offline replay of field actions (mobile queue)', () => {
    const b = apiClient(tokenB);
    let projectId: string;
    const clockInKey = randomUUID();
    let entryId: string;

    beforeAll(async () => {
      projectId = await createProject(b, 'Idempotency field project');
    });

    it('a clock-in replayed after a lost response returns the same entry, not OPEN_ENTRY_EXISTS', async () => {
      const body = { projectId, occurredAt: new Date(Date.now() - 60_000).toISOString() };
      const first = await send(tokenB, 'POST', '/timekeeping/clock-in', body, clockInKey);
      expect(first.status, JSON.stringify(first.raw)).toBe(201);
      entryId = first.raw.data.id;

      // The phone never saw the response and replays the queued action with the same key.
      const replay = await send(tokenB, 'POST', '/timekeeping/clock-in', body, clockInKey);
      expect(replay.status).toBe(201);
      expect(replay.replayed).toBe(true);
      expect(replay.raw.data.id).toBe(entryId);
    });

    it('4xx outcomes are stored and replayed too', async () => {
      // A genuinely new clock-in while one is open is refused by the business rule…
      const key = randomUUID();
      const body = { projectId };
      const refused = await send(tokenB, 'POST', '/timekeeping/clock-in', body, key);
      expect(refused.status).toBe(422);
      expect(refused.raw.error.details.rule).toBe('OPEN_ENTRY_EXISTS');
      // …and its retry gets the same refusal from the store.
      const again = await send(tokenB, 'POST', '/timekeeping/clock-in', body, key);
      expect(again.status).toBe(422);
      expect(again.replayed).toBe(true);
      expect(again.raw).toEqual(refused.raw);
    });

    it('a replayed clock-out does not hit ALREADY_CLOCKED_OUT', async () => {
      const key = randomUUID();
      const body = { occurredAt: new Date().toISOString() };
      const out = await send(tokenB, 'POST', `/timekeeping/clock-out/${entryId}`, body, key);
      expect(out.status, JSON.stringify(out.raw)).toBeLessThan(300);
      const replay = await send(tokenB, 'POST', `/timekeeping/clock-out/${entryId}`, body, key);
      expect(replay.status).toBe(out.status);
      expect(replay.replayed).toBe(true);
      expect(replay.raw.data.id).toBe(entryId);
    });
  });
});
