import { describe, it, expect, beforeAll } from 'vitest';
import { apiClient, tokenFor, USER_A, BASE_URL } from './setup';

const api = apiClient(tokenFor(USER_A.authId));

const ids: Record<string, string> = {};

function ok<T>(res: { status: number; data: T; error: any }, expected = [200, 201]): T {
  if (!expected.includes(res.status)) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.error ?? res.data)}`);
  }
  return res.data;
}

function list<T = any>(data: any): T[] {
  // List endpoints currently return either { items, total } or { data, meta }.
  return Array.isArray(data) ? data : data?.items ?? data?.data ?? [];
}

describe('Business flow: client → offer → contract → project → field → invoice → accounting', () => {
  it('health check is public and healthy', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('healthy');
  });

  it('rejects requests without a token', async () => {
    const res = await apiClient().get('/clients');
    expect(res.status).toBe(401);
  });

  it('returns the authenticated profile', async () => {
    const me = ok(await api.get('/auth/profile'));
    expect(me.id).toBe(USER_A.id);
    expect(me.role).toBe('ADMIN');
  });

  describe('CRM', () => {
    it('creates and reads a client', async () => {
      const client = ok(await api.post('/clients', { name: 'Bau AG Zürich', email: 'info@bauag.ch' }));
      expect(client.id).toBeDefined();
      ids.client = client.id;
      const fetched = ok(await api.get(`/clients/${ids.client}`));
      expect(fetched.name).toBe('Bau AG Zürich');
    });
  });

  describe('Catalogue', () => {
    it('creates an article and finds it in the list', async () => {
      const article = ok(
        await api.post('/catalogue/articles', {
          npkNumber: '211.111.100',
          description: 'Béton C25/30 pompé',
          unit: 'm3',
          category: 'Gros-oeuvre',
        }),
      );
      ids.article = article.id;
      const articles = list(ok(await api.get('/catalogue/articles')));
      expect(articles.some((a: any) => a.id === ids.article)).toBe(true);
    });
  });

  describe('Offers', () => {
    it('creates a draft offer for the client', async () => {
      const offer = ok(
        await api.post('/offers', { projectName: 'Rénovation Villa Müller', clientId: ids.client }),
      );
      expect(offer.status).toBe('draft');
      ids.offer = offer.id;
    });

    it('adds a priced line and recalculates totals', async () => {
      ok(
        await api.post(`/offers/${ids.offer}/lines`, {
          canonicalArticleId: ids.article,
          description: 'Béton C25/30 pompé',
          unit: 'm3',
          quantity: 45,
          unitPriceCents: 28500,
        }),
      );
      const offer = ok(await api.post(`/offers/${ids.offer}/recalculate`));
      expect(offer.totalHtCents ?? offer.subtotalCents ?? offer.totalCents).toBeGreaterThan(0);
    });

    it('moves the offer through submitted → accepted', async () => {
      expect(ok(await api.patch(`/offers/${ids.offer}/status`, { status: 'submitted' })).status).toBe('submitted');
      expect(ok(await api.patch(`/offers/${ids.offer}/status`, { status: 'accepted' })).status).toBe('accepted');
    });
  });

  describe('Contracts and projects', () => {
    it('creates a contract from the accepted offer', async () => {
      const contract = ok(await api.post('/contracts/from-offer', { offerId: ids.offer }));
      ids.contract = contract.id;
    });

    it('rejects a second contract for a draft offer', async () => {
      const draft = ok(await api.post('/offers', { projectName: 'Other', clientId: ids.client }));
      const res = await api.post('/contracts/from-offer', { offerId: draft.id });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('signing the contract creates a project', async () => {
      ok(await api.patch(`/contracts/${ids.contract}/status`, { status: 'signed' }));
      const projects = list(ok(await api.get('/projects')));
      const project = projects.find((p: any) => p.contractId === ids.contract);
      expect(project).toBeDefined();
      ids.project = project.id;
      const detail = ok(await api.get(`/projects/${ids.project}`));
      expect(detail.id).toBe(ids.project);
    });
  });

  describe('Field operations', () => {
    it('clocks in and out on the project', async () => {
      const entry = ok(await api.post('/timekeeping/clock-in', { projectId: ids.project }));
      ids.timeEntry = entry.id;
      const out = ok(await api.post(`/timekeeping/clock-out/${ids.timeEntry}`));
      expect(out.endTime ?? out.clockOut ?? out.endedAt).toBeTruthy();
    });

    it('submits and approves the time entry', async () => {
      ok(await api.post('/timekeeping/submit', { entryIds: [ids.timeEntry] }));
      ok(await api.post('/timekeeping/approve', { entryIds: [ids.timeEntry] }));
      const entry = ok(await api.get(`/timekeeping/${ids.timeEntry}`));
      expect(entry.status).toBe('approved');
    });

    it('creates, submits and approves an expense', async () => {
      const expense = ok(
        await api.post('/expenses', {
          projectId: ids.project,
          date: '2026-09-29',
          category: 'material',
          description: 'Ciment CEM II 25kg x20',
          amountCents: 34000,
        }),
      );
      ids.expense = expense.id;
      ok(await api.post('/expenses/submit', { expenseIds: [ids.expense] }));
      ok(await api.post('/expenses/approve', { expenseIds: [ids.expense] }));
      const summary = ok(await api.get(`/expenses/summary/project/${ids.project}`));
      expect(JSON.stringify(summary)).toContain('34000');
    });

    it('creates a daily report and blocks a duplicate for the same day', async () => {
      const body = { projectId: ids.project, date: '2026-09-29', workDescription: 'Coulage fondations', weather: 'sunny' };
      const report = ok(await api.post('/daily-reports', body));
      ids.dailyReport = report.id;
      const dup = await api.post('/daily-reports', body);
      expect(dup.status).toBeGreaterThanOrEqual(400);
      expect(dup.status).toBeLessThan(500);
    });
  });

  describe('Invoicing', () => {
    it('creates an invoice with a gapless number and Swiss 5ct-rounded total', async () => {
      const invoice = ok(
        await api.post('/invoices', {
          projectId: ids.project,
          clientId: ids.client,
          type: 'invoice',
          lines: [{ description: 'Béton C25/30 pompé', unit: 'm3', quantity: 3, unitPriceCents: 28533 }],
        }),
      );
      ids.invoice = invoice.id;
      expect(invoice.invoiceNumber).toBeTruthy();
      expect(invoice.totalTtcCents).toBeGreaterThan(0);
      expect(invoice.totalTtcCents % 5).toBe(0);
    });

    it('numbers invoices sequentially without gaps', async () => {
      const second = ok(
        await api.post('/invoices', {
          projectId: ids.project,
          clientId: ids.client,
          type: 'invoice',
          lines: [{ description: 'Coffrage', unit: 'm2', quantity: 10, unitPriceCents: 4500 }],
        }),
      );
      const first = ok(await api.get(`/invoices/${ids.invoice}`));
      const seq = (n: string) => Number(String(n).match(/(\d+)$/)![1]);
      expect(seq(second.invoiceNumber)).toBe(seq(first.invoiceNumber) + 1);
    });

    it('sends the invoice and records a payment', async () => {
      ok(await api.patch(`/invoices/${ids.invoice}/status`, { status: 'sent' }));
      const payment = ok(
        await api.post(`/invoices/${ids.invoice}/payments`, {
          amountCents: 5000,
          paymentDate: '2026-10-15',
          paymentMethod: 'bank_transfer',
          reference: 'VIR-101',
        }),
      );
      ids.payment = payment.id;
      const invoice = ok(await api.get(`/invoices/${ids.invoice}`));
      expect(invoice.paidCents ?? invoice.amountPaidCents).toBe(5000);
    });
  });

  describe('Accounting', () => {
    beforeAll(async () => {
      ok(await api.post('/accounting/accounts/seed'));
    });

    it('rejects an unbalanced journal entry', async () => {
      const accounts = list(ok(await api.get('/accounting/accounts')));
      ids.accountA = accounts[0].id;
      ids.accountB = accounts[1].id;
      const res = await api.post('/accounting/entries', {
        entryDate: '2026-09-29',
        description: 'Unbalanced',
        lines: [
          { accountId: ids.accountA, debitCents: 1000, creditCents: 0 },
          { accountId: ids.accountB, debitCents: 0, creditCents: 900 },
        ],
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('creates and posts a balanced journal entry', async () => {
      const entry = ok(
        await api.post('/accounting/entries', {
          entryDate: '2026-09-29',
          description: 'Balanced',
          lines: [
            { accountId: ids.accountA, debitCents: 1000, creditCents: 0 },
            { accountId: ids.accountB, debitCents: 0, creditCents: 1000 },
          ],
        }),
      );
      ids.entry = entry.id;
      const posted = ok(await api.post(`/accounting/entries/${ids.entry}/post`));
      expect(posted.isPosted).toBe(true);
    });

    it('produces a balanced trial balance', async () => {
      const tb = ok(await api.get('/accounting/trial-balance'));
      const rows = list(tb.accounts ?? tb);
      const debit = rows.reduce((s: number, r: any) => s + Number(r.debitCents ?? r.totalDebitCents ?? 0), 0);
      const credit = rows.reduce((s: number, r: any) => s + Number(r.creditCents ?? r.totalCreditCents ?? 0), 0);
      expect(debit).toBe(credit);
    });

    it('rejects an expense with an unknown category as a 400', async () => {
      const res = await api.post('/expenses', {
        projectId: ids.project, date: '2026-09-29', category: 'bogus', description: 'x', amountCents: 100,
      });
      expect(res.status).toBe(400);
      expect(res.error?.code).toBe('VALIDATION_ERROR');
    });

    it('exports fiduciary data', async () => {
      const res = await api.get('/accounting/export/fiduciary?from=2026-01-01&to=2026-12-31');
      expect(res.status).toBe(200);
    });
  });

  describe('Client portal', () => {
    it('creates a token and serves the public view without financial data', async () => {
      const token = ok(await api.post('/portal/tokens', { projectId: ids.project }));
      ids.portalToken = token.token;
      const res = await apiClient().get(`/portal/view/${ids.portalToken}`);
      expect(res.status).toBe(200);
      expect(res.data.project.id).toBe(ids.project);
      expect(JSON.stringify(res.data)).not.toMatch(/Cents"/);
    });

    it('rejects an unknown portal token', async () => {
      const res = await apiClient().get('/portal/view/00000000-0000-4000-8000-000000000000');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('Remaining modules respond', () => {
    it.each([
      '/contracts', '/hr/teams', '/hr/employees', '/suppliers', '/purchase-orders', '/stock/locations',
      '/stock/items', '/stock/movements', '/vehicles', '/meetings', '/invoices/plus-values', '/plans',
      '/settings', '/notifications', '/notifications/unread-count', '/companies/me',
      `/projects/${'$project'}/tasks`, `/invoices/project/${'$project'}/summary`, '/timekeeping/summary/weekly',
    ])('GET %s', async (path) => {
      const res = await api.get(path.replace('$project', ids.project));
      expect(res.status, JSON.stringify(res.error)).toBe(200);
    });
  });
});
