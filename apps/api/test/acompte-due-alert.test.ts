import { describe, expect, it } from 'vitest';
import { apiClient, createProject, tokenFor, USER_A } from './setup';

const admin = apiClient(tokenFor(USER_A.authId));

async function ok(p: Promise<{ status: number; data: any; error: any }>) {
  const res = await p;
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.error)}`);
  return res.data;
}

async function dueReminders(contractId: string): Promise<any[]> {
  const list = await ok(admin.get('/notifications?limit=200'));
  const items: any[] = Array.isArray(list) ? list : list?.data ?? [];
  return items.filter((n) => n.type === 'acompte_due' && n.referenceId === contractId);
}

describe('Acompte "à émettre" reminder (PRD §15.6)', () => {
  it('reminds once about a planned acompte that is due and not issued, and not about future ones', async () => {
    const projectId = await createProject(admin, 'Acompte due reminder');
    const { contractId } = await ok(admin.get(`/projects/${projectId}`));

    await ok(admin.post(`/contracts/${contractId}/acompte-schedule`, { dueDate: '2026-09-01', label: 'Acompte au démarrage', amountHtCents: 50_000 }));
    // Another project's future acompte must not be reminded yet.
    const futureProjectId = await createProject(admin, 'Acompte future reminder');
    const { contractId: futureContractId } = await ok(admin.get(`/projects/${futureProjectId}`));
    await ok(admin.post(`/contracts/${futureContractId}/acompte-schedule`, { dueDate: '2099-01-01', amountHtCents: 10_000 }));

    await ok(admin.post('/alerts/run'));
    await ok(admin.post('/alerts/run'));

    const reminders = await dueReminders(contractId);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].title).toMatch(/Acompte à émettre/);
    expect(reminders[0].body).toContain('Acompte au démarrage');
    expect(await dueReminders(futureContractId)).toHaveLength(0);
  });
});
