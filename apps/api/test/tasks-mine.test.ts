import { beforeAll, describe, expect, it } from 'vitest';
import { apiClient, createProject, tokenFor, USER_A, USER_B, WORKER_2_A, PM_A } from './setup';

const admin = apiClient(tokenFor(USER_A.authId));
const adminB = apiClient(tokenFor(USER_B.authId));
const worker = apiClient(tokenFor(WORKER_2_A.authId));

/** Lists come back enveloped as { data: [...], meta: {...} }; return both. */
async function ok(p: Promise<{ status: number; data: any; error: any; raw: any }>) {
  const res = await p;
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.error)}`);
  return Array.isArray(res.data) ? { data: res.data, meta: res.raw.meta } : res.data;
}

/** Other suites assign tasks to the same user, so assertions stay scoped to this project. */
let projectId = '';
let before: { today: number; open: number; overdue: number };
const mine = async (q = '') => ok(worker.get(`/tasks/mine${q}`));
const ours = (res: any) => res.data.filter((t: any) => t.project.id === projectId).map((t: any) => t.title);
const add = (body: Record<string, unknown>) =>
  ok(admin.post(`/projects/${projectId}/tasks`, { assignedTo: WORKER_2_A.id, ...body }));

describe('GET /tasks/mine (PRD §3.2 "Mes tâches")', () => {
  beforeAll(async () => {
    before = (await mine()).meta.counts;
    projectId = await createProject(admin, 'Mes tâches');
    await add({ title: 'En cours', status: 'in_progress', priority: 'normal' });
    await add({ title: 'En retard', plannedStart: '2020-01-01', plannedEnd: '2020-01-10', priority: 'low' });
    await add({ title: 'Fenêtre courante', plannedStart: '2020-01-01', plannedEnd: '2099-01-01', priority: 'urgent' });
    await add({ title: 'Future', plannedStart: '2099-01-01', plannedEnd: '2099-02-01' });
    await add({ title: 'Sans dates' });
    await add({ title: 'Terminée', status: 'done' });
    await add({ title: "Pour quelqu'un d'autre", assignedTo: PM_A.id });
  });

  it('open view: own open tasks, sorted in_progress → overdue → by planned end', async () => {
    const res = await mine('?limit=200');
    expect(ours(res)).toEqual(['En cours', 'En retard', 'Fenêtre courante', 'Future', 'Sans dates']);
    const late = res.data.find((t: any) => t.title === 'En retard' && t.project.id === projectId);
    expect(late.overdue).toBe(true);
    expect(late.project.reference).toBeTruthy();
    const c = res.meta.counts;
    expect({ today: c.today - before.today, open: c.open - before.open, overdue: c.overdue - before.overdue })
      .toEqual({ today: 4, open: 5, overdue: 1 });
    // No other people's tasks, no money fields.
    expect(JSON.stringify(res)).not.toContain("quelqu'un");
    expect(JSON.stringify(res)).not.toContain('Cents');
  });

  it('today view drops future todos; done view returns recent finished work', async () => {
    expect(ours(await mine('?view=today&limit=200'))).toEqual(['En cours', 'En retard', 'Fenêtre courante', 'Sans dates']);
    expect(ours(await mine('?view=done&limit=200'))).toEqual(['Terminée']);
    expect((await worker.get('/tasks/mine?view=nope')).status).toBe(400);
  });

  it('pagination works and other companies never see these tasks', async () => {
    const page1 = await mine('?limit=2&page=1');
    expect(page1.data).toHaveLength(2);
    expect(page1.meta).toMatchObject({ page: 1, limit: 2 });
    expect(page1.meta.total).toBeGreaterThanOrEqual(5);
    const titles = new Set(['En cours', 'En retard', 'Fenêtre courante', 'Future', 'Sans dates']);
    const other = await ok(adminB.get('/tasks/mine?limit=200'));
    expect(other.data.filter((t: any) => titles.has(t.title))).toEqual([]);
  });

  it('the assignee updates status and progress from the list (existing task route)', async () => {
    const res = await mine('?limit=200');
    const task = res.data.find((t: any) => t.title === 'Sans dates' && t.project.id === projectId);
    const upd = await ok(worker.patch(`/projects/${task.project.id}/tasks/${task.id}`, { status: 'in_progress', progressPercent: 40 }));
    expect(upd).toMatchObject({ status: 'in_progress', progressPercent: 40 });
  });
});
