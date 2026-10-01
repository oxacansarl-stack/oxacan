import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import {
  apiClient, appRoleClient, setSignedContext, tokenFor, ApiResult,
  USER_A, TEAM_A, MOCK_SUPABASE_URL,
} from './setup';

// A company of its own, so seat counts are not affected by the other suites' fixtures.
const COMPANY_C = 'cccccccc-0000-4000-8000-000000000001';
const ADMIN_C = { id: 'cccccccc-0000-4000-8000-000000000002', authId: 'cccccccc-0000-4000-8000-000000000003' };
const PM_C = { id: 'cccccccc-0000-4000-8000-000000000012', authId: 'cccccccc-0000-4000-8000-000000000013' };
const TEAM_C = 'cccccccc-0000-4000-8000-000000000050';

const admin = apiClient(tokenFor(ADMIN_C.authId));
let db: Client;

interface MockInvite {
  email: string;
  data: Record<string, unknown> | null;
  redirectTo: string | null;
  userId: string;
}

async function mock(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${MOCK_SUPABASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.status === 204 ? null : res.json();
}

async function invitesFor(email: string): Promise<MockInvite[]> {
  const { invites } = await mock('/__mock/invites');
  return (invites as MockInvite[]).filter((i) => i.email === email);
}

async function setSeats(n: number) {
  await db.query('UPDATE subscription SET saas_seat_count = $1 WHERE company_id = $2', [n, COMPANY_C]);
}

async function usersWithEmail(email: string): Promise<any[]> {
  const { rows } = await db.query('SELECT * FROM app_user WHERE company_id = $1 AND lower(email) = $2', [COMPANY_C, email]);
  return rows;
}

/** Error details of a failed call ({ rule, ... } for business-rule errors). */
const details = (r: ApiResult): Record<string, any> | undefined => (r.error as any)?.details;

const employee = (email: string, extra: Record<string, unknown> = {}) => ({
  email,
  firstName: 'Test',
  lastName: 'Employé',
  role: 'WORKER',
  ...extra,
});

beforeAll(async () => {
  db = await appRoleClient();
  await setSignedContext(db, '', '', 'on');
  await db.query(`INSERT INTO company (id, name) VALUES ($1, 'Test Bau C AG')`, [COMPANY_C]);
  for (const [u, email, role] of [
    [ADMIN_C, 'admin-c@test.local', 'ADMIN'],
    [PM_C, 'pm-c@test.local', 'PROJECT_MANAGER'],
  ] as const) {
    await db.query(
      `INSERT INTO app_user (id, company_id, supabase_auth_id, email, first_name, last_name, role, licence_tier)
       VALUES ($1, $2, $3, $4, 'Test', $5, $5, 'saas')`,
      [u.id, COMPANY_C, u.authId, email, role],
    );
  }
  await db.query(`INSERT INTO team (id, company_id, name) VALUES ($1, $2, 'Équipe Sud')`, [TEAM_C, COMPANY_C]);
  // 4 saas seats, 2 taken by the admin and the project manager (seeded as saas); 1 application
  // seat for the office user created (and deactivated) by the licence-default test.
  await db.query(
    `INSERT INTO subscription (company_id, stripe_customer_id, tier, status, saas_seat_count, application_seat_count)
     VALUES ($1, 'cus_test_c', 'equipe', 'active', 4, 1)`,
    [COMPANY_C],
  );
});

afterAll(async () => {
  await db?.end();
});

describe('Employees: create and invite (PRD §18.2, §19.1)', () => {
  let annaId = '';
  let annaAuthId = '';
  let oneMoreId = '';
  let retryId = '';

  it('is reserved to administrators', async () => {
    const pm = apiClient(tokenFor(PM_C.authId));
    expect((await pm.post('/hr/employees', employee('pm-made@example.test'))).status).toBe(403);
    expect((await pm.post(`/hr/employees/${PM_C.id}/invite`)).status).toBe(403);
    expect((await pm.post(`/hr/employees/${ADMIN_C.id}/deactivate`)).status).toBe(403);
    expect((await pm.post(`/hr/employees/${ADMIN_C.id}/reactivate`)).status).toBe(403);
    expect(await invitesFor('pm-made@example.test')).toHaveLength(0);
  });

  it('validates the payload', async () => {
    expect((await admin.post('/hr/employees', employee('not-an-email'))).status).toBe(400);
    expect((await admin.post('/hr/employees', employee('x@example.test', { role: 'OWNER' }))).status).toBe(400);
    expect((await admin.post('/hr/employees', employee('x@example.test', { firstName: '  ' }))).status).toBe(400);
    expect((await admin.post('/hr/employees', employee('x@example.test', { hourlyRateCents: -1 }))).status).toBe(400);
    expect((await admin.post('/hr/employees', employee('x@example.test', { isAdmin: true }))).status).toBe(400);
    expect(await invitesFor('x@example.test')).toHaveLength(0);
  });

  it('creates the employee, lower-cases the email, invites them and links the Supabase user', async () => {
    const res = await admin.post('/hr/employees', {
      email: '  Anna.Muster@Example.TEST ',
      firstName: 'Anna',
      lastName: 'Muster',
      role: 'WORKER',
      phone: '+41 79 000 00 00',
      hourlyRateCents: 4550,
      cctCode: 'CN-SOR',
      hireDate: '2026-10-01',
      teamId: TEAM_C,
    });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      email: 'anna.muster@example.test',
      firstName: 'Anna',
      role: 'WORKER',
      licenceTier: 'saas',
      hourlyRateCents: 4550,
      isActive: true,
    });

    const [invite] = await invitesFor('anna.muster@example.test');
    expect(invite).toBeDefined();
    expect(invite.data).toMatchObject({ first_name: 'Anna', last_name: 'Muster', company_name: 'Test Bau C AG' });
    expect(res.data.supabaseAuthId).toBe(invite.userId);
    annaId = res.data.id;
    annaAuthId = invite.userId;

    const team = await admin.get(`/hr/teams/${TEAM_C}`);
    expect(team.data.members.map((m: any) => m.userId)).toContain(annaId);

    // The invited user signs in with their Supabase account and resolves to the new app_user.
    const profile = await apiClient(tokenFor(annaAuthId)).get('/auth/profile');
    expect(profile.status).toBe(200);
    expect(profile.data).toMatchObject({ id: annaId, companyId: COMPANY_C, role: 'WORKER' });
  });

  it('defaults office roles to the "application" licence', async () => {
    // Seat-neutral: deactivated straight away.
    const res = await admin.post('/hr/employees', employee('office.pm@example.test', { role: 'PROJECT_MANAGER' }));
    expect(res.status).toBe(201);
    expect(res.data.licenceTier).toBe('application');
    expect((await admin.post(`/hr/employees/${res.data.id}/deactivate`)).status).toBe(200);
  });

  it('rejects duplicate emails (case-insensitive) and emails used by another account', async () => {
    const dup = await admin.post('/hr/employees', employee('ANNA.MUSTER@example.test'));
    expect(dup.status).toBe(422);
    expect(details(dup)?.rule).toBe('EMAIL_TAKEN');

    // Belongs to company A: one Supabase login maps to exactly one app_user.
    const elsewhere = await admin.post('/hr/employees', employee('Worker1-A@test.local'));
    expect(elsewhere.status).toBe(422);
    expect(details(elsewhere)?.rule).toBe('EMAIL_ALREADY_REGISTERED');
    expect(await invitesFor('worker1-a@test.local')).toHaveLength(0);

    // Supabase already has a confirmed account for this address.
    const confirmed = await admin.post('/hr/employees', employee('someone@already-registered.test'));
    expect(confirmed.status).toBe(422);
    expect(details(confirmed)?.rule).toBe('EMAIL_ALREADY_REGISTERED');
    expect(await usersWithEmail('someone@already-registered.test')).toHaveLength(0);
  });

  it('rejects a team from another company before inviting anyone', async () => {
    const res = await admin.post('/hr/employees', employee('wrong.team@example.test', { teamId: TEAM_A }));
    expect(res.status).toBe(404);
    expect(await invitesFor('wrong.team@example.test')).toHaveLength(0);
    expect(await usersWithEmail('wrong.team@example.test')).toHaveLength(0);
  });

  it('leaves nothing behind when Supabase fails, and the retry succeeds', async () => {
    const before = (await admin.get('/subscription/seats')).data.used;
    await mock('/__mock/invite-failures', { count: 1 });

    const failed = await admin.post('/hr/employees', employee('retry.me@example.test', { teamId: TEAM_C }));
    expect(failed.status).toBe(502);
    expect(failed.error?.code).toBe('INVITE_FAILED');
    expect(await usersWithEmail('retry.me@example.test')).toHaveLength(0);
    expect((await admin.get('/subscription/seats')).data.used).toBe(before);

    const retried = await admin.post('/hr/employees', employee('retry.me@example.test', { teamId: TEAM_C }));
    expect(retried.status).toBe(201);
    expect(await usersWithEmail('retry.me@example.test')).toHaveLength(1);
    retryId = retried.data.id;
  });

  it('enforces subscription seats on create, and again on reactivation', async () => {
    // admin + PM + Anna + retry.me = 4 of 4 seats.
    const seats = await admin.get('/subscription/seats');
    expect(seats.data.byTier.saas).toMatchObject({ used: 4, total: 4, available: 0 });

    const full = await admin.post('/hr/employees', employee('one.more@example.test'));
    expect(full.status).toBe(422);
    expect(details(full)).toMatchObject({ rule: 'SEAT_LIMIT_REACHED', used: 4, total: 4 });
    expect(await invitesFor('one.more@example.test')).toHaveLength(0);

    // Deactivation frees the seat immediately and cuts API access.
    const off = await admin.post(`/hr/employees/${annaId}/deactivate`);
    expect(off.status).toBe(200);
    expect(off.data.isActive).toBe(false);
    expect((await apiClient(tokenFor(annaAuthId)).get('/auth/profile')).status).toBe(401);

    const taken = await admin.post('/hr/employees', employee('one.more@example.test'));
    expect(taken.status).toBe(201);
    oneMoreId = taken.data.id;

    // Reactivating Anna needs a seat again, by either route.
    const again = await admin.post(`/hr/employees/${annaId}/reactivate`);
    expect(again.status).toBe(422);
    expect(details(again)?.rule).toBe('SEAT_LIMIT_REACHED');
    const viaPut = await admin.put(`/hr/employees/${annaId}`, { isActive: true });
    expect(viaPut.status).toBe(422);
    expect(details(viaPut)?.rule).toBe('SEAT_LIMIT_REACHED');

    // Saving an active employee with isActive: true is not a reactivation.
    expect((await admin.put(`/hr/employees/${oneMoreId}`, { isActive: true, hourlyRateCents: 4000 })).status).toBe(200);

    await setSeats(5);
    const back = await admin.post(`/hr/employees/${annaId}/reactivate`);
    expect(back.status).toBe(200);
    expect(back.data.isActive).toBe(true);
    expect((await apiClient(tokenFor(annaAuthId)).get('/auth/profile')).status).toBe(200);
  });

  it('cannot hand out the last seat twice under concurrent requests', async () => {
    await setSeats(6); // 5 used, 1 free
    const results = await Promise.all(
      ['race.1@example.test', 'race.2@example.test', 'race.3@example.test'].map((e) =>
        admin.post('/hr/employees', employee(e)),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const rejected = results.filter((r) => r.status !== 201);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(details(r)?.rule).toBe('SEAT_LIMIT_REACHED');
    expect((await admin.get('/subscription/seats')).data.byTier.saas).toMatchObject({ used: 6, total: 6 });
  });

  it('resends an invitation to the same Supabase user, and relinks an unlinked account', async () => {
    const res = await admin.post(`/hr/employees/${annaId}/invite`);
    expect(res.status).toBe(200);
    const sent = await invitesFor('anna.muster@example.test');
    expect(sent).toHaveLength(2);
    expect(sent[1].userId).toBe(annaAuthId);

    // e.g. an account whose first invite never completed: the resend links it.
    const [before] = await usersWithEmail('one.more@example.test');
    await db.query('UPDATE app_user SET supabase_auth_id = NULL WHERE id = $1', [oneMoreId]);
    const relinked = await admin.post(`/hr/employees/${oneMoreId}/invite`);
    expect(relinked.status).toBe(200);
    expect(relinked.data.supabaseAuthId).toBe(before.supabase_auth_id);
    expect((await usersWithEmail('one.more@example.test'))[0].supabase_auth_id).toBe(before.supabase_auth_id);
  });

  it('does not resend once the invitation is accepted, nor to a deactivated employee', async () => {
    await mock('/__mock/confirm', { email: 'anna.muster@example.test' });
    const accepted = await admin.post(`/hr/employees/${annaId}/invite`);
    expect(accepted.status).toBe(422);
    expect(details(accepted)?.rule).toBe('INVITE_ALREADY_ACCEPTED');

    expect((await admin.post(`/hr/employees/${retryId}/deactivate`)).status).toBe(200);
    const inactive = await admin.post(`/hr/employees/${retryId}/invite`);
    expect(inactive.status).toBe(422);
    expect(details(inactive)?.rule).toBe('USER_INACTIVE');
  });

  it('reports a Supabase rate limit without creating the employee', async () => {
    const res = await admin.post('/hr/employees', employee('busy@rate-limited.test'));
    expect(res.status).toBe(429);
    expect(await usersWithEmail('busy@rate-limited.test')).toHaveLength(0);
  });

  it('does not let an administrator deactivate themselves', async () => {
    const direct = await admin.post(`/hr/employees/${ADMIN_C.id}/deactivate`);
    expect(direct.status).toBe(422);
    expect(details(direct)?.rule).toBe('CANNOT_DEACTIVATE_SELF');
    const viaPut = await admin.put(`/hr/employees/${ADMIN_C.id}`, { isActive: false });
    expect(viaPut.status).toBe(422);
    expect(details(viaPut)?.rule).toBe('CANNOT_DEACTIVATE_SELF');
  });

  it('keeps employees tenant-scoped', async () => {
    const foreign = apiClient(tokenFor(USER_A.authId));
    expect((await foreign.post(`/hr/employees/${annaId}/deactivate`)).status).toBe(404);
    expect((await foreign.post(`/hr/employees/${retryId}/reactivate`)).status).toBe(404);
    expect((await foreign.post(`/hr/employees/${annaId}/invite`)).status).toBe(404);
  });

  it('blocks new users for a company without subscription seats', async () => {
    // Company A has no subscription row.
    const res = await apiClient(tokenFor(USER_A.authId)).post('/hr/employees', employee('no.seat@example.test'));
    expect(res.status).toBe(422);
    expect(details(res)).toMatchObject({ rule: 'SEAT_LIMIT_REACHED', total: 0 });
    expect(await invitesFor('no.seat@example.test')).toHaveLength(0);
  });
});
