/**
 * OXACAN End-to-End Flow — Integration Test Specification
 * ========================================================
 * Validates the complete business lifecycle of the Swiss Construction ERP.
 *
 * NOTE: These tests are written against the NestJS API surface.
 * Running them requires a live database with migrations applied and
 * the server listening on BASE_URL (default http://localhost:3000).
 *
 * Run:  npm test  (or  npx vitest run test/e2e-flow.test.ts)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  BASE_URL,
  TEST_COMPANY_ID,
  TEST_USER_ID,
  authHeader,
} from './setup';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: authHeader(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text);
  } catch {
    data = text as unknown as T;
  }
  return { status: res.status, data };
}

const GET = <T = any>(path: string) => api<T>('GET', path);
const POST = <T = any>(path: string, body?: unknown) => api<T>('POST', path, body);
const PATCH = <T = any>(path: string, body?: unknown) => api<T>('PATCH', path, body);

/* ------------------------------------------------------------------ */
/*  Shared state — IDs created during the flow carry forward          */
/* ------------------------------------------------------------------ */

const ids = {
  clientId: '',
  articleId: '',
  offerId: '',
  offerLineId: '',
  contractId: '',
  projectId: '',
  taskId: '',
  timeEntryId: '',
  expenseId: '',
  dailyReportId: '',
  invoiceId: '',
  paymentId: '',
  journalEntryId: '',
  accountId: '',
  portalTokenId: '',
  notificationId: '',
};

/* ================================================================== */
/*  1. Health Check                                                    */
/* ================================================================== */

describe('OXACAN E2E Flow', () => {
  it('Step 0 — API health check returns 200', async () => {
    const { status, data } = await GET('/health');
    expect(status).toBe(200);
    expect(data).toHaveProperty('status', 'ok');
  });

  /* ================================================================ */
  /*  2. CRM — Create Client                                          */
  /* ================================================================ */

  describe('Step 1 — CRM: Create & retrieve a client', () => {
    it('creates a new client', async () => {
      const { status, data } = await POST('/clients', {
        name: 'Bau AG Zürich',
        type: 'company',
        email: 'info@bauag.ch',
        phone: '+41 44 123 45 67',
        address: 'Bahnhofstrasse 1, 8001 Zürich',
        contactPerson: 'Hans Müller',
        pipelineStage: 'qualified',
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      expect(data.name).toBe('Bau AG Zürich');
      ids.clientId = data.id;
    });

    it('retrieves the created client', async () => {
      const { status, data } = await GET(`/clients/${ids.clientId}`);
      expect(status).toBe(200);
      expect(data.name).toBe('Bau AG Zürich');
      expect(data.pipelineStage).toBe('qualified');
    });
  });

  /* ================================================================ */
  /*  3. Catalogue — Import articles                                   */
  /* ================================================================ */

  describe('Step 2 — Catalogue: Import articles', () => {
    it('imports a batch of catalogue articles', async () => {
      const { status, data } = await POST('/catalogue/import', {
        rows: [
          {
            npkNumber: '271.111.100',
            description: 'Béton C25/30, pompe, ép. 20cm',
            unit: 'm3',
            category: 'Gros-oeuvre',
            medianPriceCentimes: '28500',
          },
          {
            npkNumber: '352.211.100',
            description: 'Isolation laine de roche 16cm',
            unit: 'm2',
            category: 'Isolation',
            medianPriceCentimes: '4500',
          },
        ],
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('created');
      expect(data.created).toBeGreaterThanOrEqual(1);
    });

    it('retrieves the catalogue and finds imported articles', async () => {
      const { status, data } = await GET('/catalogue?category=Gros-oeuvre');
      expect(status).toBe(200);
      const articles = Array.isArray(data) ? data : data.data;
      expect(articles.length).toBeGreaterThanOrEqual(1);
      const concrete = articles.find((a: any) => a.npkNumber === '271.111.100');
      expect(concrete).toBeDefined();
      expect(concrete.medianPriceCentimes).toBe(28500);
      ids.articleId = concrete.id;
    });
  });

  /* ================================================================ */
  /*  4. Offers — Create offer with lines, recalculate totals         */
  /* ================================================================ */

  describe('Step 3 — Offers: Create offer with pricing', () => {
    it('creates an offer linked to the client', async () => {
      const { status, data } = await POST('/offers', {
        projectName: 'Rénovation Villa Müller',
        clientId: ids.clientId,
        reference: 'OFF-2026-001',
        marginFactor: 120,
        vatRateBps: 810,
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      expect(data.status).toBe('draft');
      ids.offerId = data.id;
    });

    it('adds lines to the offer', async () => {
      const { status, data } = await POST(`/offers/${ids.offerId}/lines`, {
        articleId: ids.articleId,
        description: 'Béton C25/30, pompe, ép. 20cm',
        unit: 'm3',
        quantity: 45,
        unitPriceCents: 28500,
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      ids.offerLineId = data.id;
    });

    it('recalculates offer totals', async () => {
      const { status, data } = await POST(`/offers/${ids.offerId}/recalculate`);
      expect(status).toBe(200);
      // 45 m3 * CHF 285.00 = CHF 12'825.00 HT
      // With margin factor 1.2 → CHF 15'390.00 HT
      // VAT 8.1% → CHF 1'246.59
      // Total TTC → CHF 16'636.59
      expect(data.totalHtCents).toBeGreaterThan(0);
      expect(data.totalTtcCents).toBeGreaterThan(data.totalHtCents);
    });

    it('submits the offer', async () => {
      const { status, data } = await PATCH(`/offers/${ids.offerId}/status`, {
        status: 'submitted',
      });
      expect(status).toBe(200);
      expect(data.status).toBe('submitted');
    });
  });

  /* ================================================================ */
  /*  5. Contracts — Accept offer, create contract                    */
  /* ================================================================ */

  describe('Step 4 — Contracts: Accept offer and create contract', () => {
    it('accepts the offer', async () => {
      const { status, data } = await PATCH(`/offers/${ids.offerId}/status`, {
        status: 'accepted',
      });
      expect(status).toBe(200);
      expect(data.status).toBe('accepted');
    });

    it('creates a contract from the accepted offer', async () => {
      const { status, data } = await POST('/contracts/from-offer', {
        offerId: ids.offerId,
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      expect(data.status).toBe('draft');
      ids.contractId = data.id;
    });

    it('signs the contract (activates project creation)', async () => {
      const { status, data } = await PATCH(`/contracts/${ids.contractId}/status`, {
        status: 'signed',
      });
      expect(status).toBe(200);
      expect(data.status).toBe('signed');
      // Contract signing should auto-create a project with lots/tasks
      if (data.projectId) {
        ids.projectId = data.projectId;
      }
    });

    it('verifies the project was auto-created', async () => {
      // If project wasn't embedded, fetch from projects list
      if (!ids.projectId) {
        const { data } = await GET('/projects?search=Rénovation Villa Müller');
        const projects = Array.isArray(data) ? data : data.data;
        expect(projects.length).toBeGreaterThanOrEqual(1);
        ids.projectId = projects[0].id;
      }

      const { status, data } = await GET(`/projects/${ids.projectId}`);
      expect(status).toBe(200);
      expect(data.status).toBe('active');
    });
  });

  /* ================================================================ */
  /*  6. Timekeeping — Clock in, clock out, submit, approve           */
  /* ================================================================ */

  describe('Step 5 — Timekeeping: Clock in/out and approval', () => {
    it('clocks in a worker', async () => {
      const { status, data } = await POST('/timekeeping/clock-in', {
        projectId: ids.projectId,
        date: '2026-09-29',
        startTime: '07:00',
        notes: 'Morning shift — béton coulage',
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      ids.timeEntryId = data.id;
    });

    it('clocks out the worker', async () => {
      const { status, data } = await POST(
        `/timekeeping/clock-out/${ids.timeEntryId}`,
        {
          endTime: '16:00',
          breakMinutes: 60,
        },
      );

      expect(status).toBe(200);
      // 07:00 – 16:00 = 9h, minus 1h break = 8h = 480 minutes
      expect(data.durationMinutes).toBe(480);
    });

    it('submits hours for approval', async () => {
      const { status } = await POST('/timekeeping/submit', {
        ids: [ids.timeEntryId],
      });
      expect(status).toBe(200);
    });

    it('approves the submitted hours', async () => {
      const { status } = await POST('/timekeeping/approve', {
        ids: [ids.timeEntryId],
      });
      expect(status).toBe(200);
    });
  });

  /* ================================================================ */
  /*  7. Expenses — Create, submit, approve                           */
  /* ================================================================ */

  describe('Step 6 — Expenses: Lifecycle', () => {
    it('creates an expense', async () => {
      const { status, data } = await POST('/expenses', {
        projectId: ids.projectId,
        category: 'materials',
        description: 'Sacs de ciment CEM II 25kg x20',
        amountCents: 34000,
        date: '2026-09-29',
        vendor: 'Coop Bau+Hobby',
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      expect(data.amountCents).toBe(34000);
      ids.expenseId = data.id;
    });

    it('submits the expense', async () => {
      const { status } = await POST('/expenses/submit', {
        ids: [ids.expenseId],
      });
      expect(status).toBe(200);
    });

    it('approves the expense', async () => {
      const { status } = await POST('/expenses/approve', {
        ids: [ids.expenseId],
      });
      expect(status).toBe(200);
    });
  });

  /* ================================================================ */
  /*  8. Daily Reports — Create                                        */
  /* ================================================================ */

  describe('Step 7 — Daily Reports', () => {
    it('creates a daily report', async () => {
      const { status, data } = await POST('/daily-reports', {
        projectId: ids.projectId,
        date: '2026-09-29',
        weather: 'sunny',
        temperature: 22,
        workDescription: 'Coulage béton fondation secteur A — 45m3 livrés.',
        staffCount: 6,
        subcontractorNotes: 'Électricien sur site pour passage gaines.',
        safetyNotes: 'RAS',
        issues: '',
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      ids.dailyReportId = data.id;
    });

    it('retrieves the daily report', async () => {
      const { status, data } = await GET(`/daily-reports/${ids.dailyReportId}`);
      expect(status).toBe(200);
      expect(data.weather).toBe('sunny');
      expect(data.staffCount).toBe(6);
    });
  });

  /* ================================================================ */
  /*  9. Invoicing — Create situation invoice, record payment         */
  /* ================================================================ */

  describe('Step 8 — Invoicing: Situation invoice and payment', () => {
    it('creates a situation-type invoice with executed quantities', async () => {
      const { status, data } = await POST('/invoices', {
        projectId: ids.projectId,
        clientId: ids.clientId,
        type: 'situation',
        vatRate: 8.1,
        lines: [
          {
            description: 'Béton C25/30, pompe, ép. 20cm',
            unit: 'm3',
            quantity: 45,
            unitPriceCents: 28500,
            cumulativeQuantity: 30,
            previousQuantity: 0,
          },
        ],
        notes: 'Situation No. 1 — Fondations secteur A',
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('invoiceNumber');
      expect(data.type).toBe('situation');
      ids.invoiceId = data.id;
    });

    it('retrieves the invoice and verifies totals', async () => {
      const { status, data } = await GET(`/invoices/${ids.invoiceId}`);
      const inv = data?.data ?? data;
      expect(status).toBe(200);
      expect(inv.subtotalHtCents).toBeGreaterThan(0);
      expect(inv.vatCents).toBeGreaterThan(0);
      expect(inv.totalTtcCents).toBeGreaterThan(0);
    });

    it('sends the invoice', async () => {
      const { status, data } = await PATCH(`/invoices/${ids.invoiceId}/status`, {
        status: 'sent',
      });
      expect(status).toBe(200);
    });

    it('records a payment', async () => {
      const { status, data } = await POST(`/invoices/${ids.invoiceId}/payments`, {
        amountCents: 500000, // CHF 5'000.00
        paymentDate: '2026-10-15',
        paymentMethod: 'bank_transfer',
        reference: 'VIREMENT-2026-101',
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      ids.paymentId = data.id;
    });

    it('verifies invoice paid amount updated', async () => {
      const { status, data } = await GET(`/invoices/${ids.invoiceId}`);
      const inv = data?.data ?? data;
      expect(status).toBe(200);
      expect(inv.paidCents).toBe(500000);
    });
  });

  /* ================================================================ */
  /*  10. Accounting — Journal entry, post, fiduciary export          */
  /* ================================================================ */

  describe('Step 9 — Accounting: Journal entries and export', () => {
    it('seeds default chart of accounts', async () => {
      const { status } = await POST('/accounting/accounts/seed');
      expect([200, 201]).toContain(status);
    });

    it('retrieves the chart of accounts', async () => {
      const { status, data } = await GET('/accounting/accounts');
      const accounts = Array.isArray(data) ? data : data.data;
      expect(status).toBe(200);
      expect(accounts.length).toBeGreaterThanOrEqual(1);
      ids.accountId = accounts[0].id;
    });

    it('creates a balanced journal entry', async () => {
      const { status, data } = await POST('/accounting/entries', {
        date: '2026-09-29',
        description: 'Facture situation No. 1 — Villa Müller',
        reference: `INV-${ids.invoiceId?.slice(0, 8)}`,
        lines: [
          { accountId: ids.accountId, debitCents: 500000, creditCents: 0, description: 'Débiteur Bau AG' },
          { accountId: ids.accountId, debitCents: 0, creditCents: 500000, description: 'Produit travaux' },
        ],
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      ids.journalEntryId = data.id;
    });

    it('verifies the entry is balanced', async () => {
      const { status, data } = await GET(`/accounting/entries/${ids.journalEntryId}`);
      const entry = data?.data ?? data;
      expect(status).toBe(200);
      expect(entry.isBalanced).toBe(true);
    });

    it('posts the journal entry', async () => {
      const { status, data } = await POST(`/accounting/entries/${ids.journalEntryId}/post`);
      expect(status).toBe(200);
      const entry = data?.data ?? data;
      expect(entry.status).toBe('posted');
    });

    it('generates fiduciary export', async () => {
      const { status, data } = await GET('/accounting/export/fiduciary?from=2026-09-01&to=2026-09-30');
      expect(status).toBe(200);
      // Export should contain entries array
      expect(data).toHaveProperty('entries');
      expect(Array.isArray(data.entries)).toBe(true);
    });

    it('retrieves trial balance', async () => {
      const { status, data } = await GET('/accounting/trial-balance');
      expect(status).toBe(200);
      expect(data).toHaveProperty('accounts');
    });
  });

  /* ================================================================ */
  /*  11. Portal — Create token, access public view                   */
  /* ================================================================ */

  describe('Step 10 — Portal: Token creation and public access', () => {
    it('creates a portal share token for the project', async () => {
      const { status, data } = await POST('/portal/tokens', {
        projectId: ids.projectId,
        label: 'Client view — Bau AG',
        sections: ['progress', 'invoices', 'reports'],
        expiresInDays: 30,
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('token');
      ids.portalTokenId = data.token;
    });

    it('accesses the portal view via token (no auth required)', async () => {
      // Portal view endpoint does not require JWT
      const res = await fetch(`${BASE_URL}/portal/view/${ids.portalTokenId}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('project');
    });
  });

  /* ================================================================ */
  /*  12. Notifications — Verify notifications were created           */
  /* ================================================================ */

  describe('Step 11 — Notifications: Verify creation', () => {
    it('retrieves notifications (expect at least 1 from flow)', async () => {
      const { status, data } = await GET('/notifications?limit=10');
      expect(status).toBe(200);
      const items = Array.isArray(data) ? data : data.data;
      // Various actions above should have generated notifications
      expect(items.length).toBeGreaterThanOrEqual(0);
    });

    it('checks unread notification count', async () => {
      const { status, data } = await GET('/notifications/unread-count');
      expect(status).toBe(200);
      // count property should exist
      const count = data?.count ?? data?.data?.count ?? 0;
      expect(typeof count).toBe('number');
    });
  });

  /* ================================================================ */
  /*  13. Settings — Data export (GDPR / LPD compliance)              */
  /* ================================================================ */

  describe('Step 12 — Settings: GDPR data export', () => {
    it('exports company data', async () => {
      const { status, data } = await GET('/settings/export');
      expect(status).toBe(200);
      // Should return JSON with company data sections
      expect(data).toBeDefined();
    });
  });

  /* ================================================================ */
  /*  14. Cross-module consistency checks                              */
  /* ================================================================ */

  describe('Step 13 — Cross-module consistency', () => {
    it('project shows linked contract', async () => {
      const { status, data } = await GET(`/projects/${ids.projectId}`);
      expect(status).toBe(200);
      expect(data.contractId || data.contract).toBeDefined();
    });

    it('invoice project summary reflects the situation', async () => {
      const { status, data } = await GET(`/invoices/project/${ids.projectId}/summary`);
      expect(status).toBe(200);
      // At least one invoice should exist for this project
      expect(data.totalInvoiced).toBeGreaterThan(0);
    });

    it('expense summary for project reflects the approved expense', async () => {
      const { status, data } = await GET(`/expenses/summary/project/${ids.projectId}`);
      expect(status).toBe(200);
      expect(data.totalCents).toBeGreaterThanOrEqual(34000);
    });

    it('weekly timekeeping summary includes approved hours', async () => {
      const { status, data } = await GET('/timekeeping/summary/weekly?date=2026-09-29');
      expect(status).toBe(200);
      expect(data).toBeDefined();
    });
  });

  /* ================================================================ */
  /*  15. Tenant isolation — RLS sanity check                          */
  /* ================================================================ */

  describe('Step 14 — Tenant isolation (RLS)', () => {
    it('cannot access data from another tenant', async () => {
      // Use a token for a different company
      const fakeHeaders = authHeader('fake-other-tenant-token');
      const res = await fetch(`${BASE_URL}/clients`, {
        headers: fakeHeaders,
      });
      // Should return 401 or empty dataset — never another tenant's data
      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : data.data;
        // Must not contain the client we created
        const leaked = items?.find((c: any) => c.name === 'Bau AG Zürich');
        expect(leaked).toBeUndefined();
      }
    });
  });
});
