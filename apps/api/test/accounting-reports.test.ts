import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import {
  apiClient, tokenFor, createProject, appRoleClient, setSignedContext,
  COMPANY_A, USER_A, USER_B, PM_A, WORKER_1_A,
} from './setup';
import { parseBankStatement, parseXml, parseAmountToCents } from '../src/modules/accounting/bank-statement-parser';
import { suggestMatches, invoiceQrReference } from '../src/modules/accounting/bank-matching';
import { buildBalanceSheet, buildIncomeStatement } from '../src/modules/accounting/financial-statements';
import { expenseVat } from '../src/modules/accounting/accounting.service';

/**
 * PRD §16.2: bilan / compte de résultat from posted entries, bank reconciliation (camt.053 / CSV
 * import, suggested matches, confirmation through the invoicing payment), expense VAT in the
 * fiduciary frais_debours file, and the journal advisory lock.
 * Journal data lives in 2034 and expenses in 2032-05 so rows of other suites never mix in.
 */

const admin = apiClient(tokenFor(USER_A.authId));
const adminB = apiClient(tokenFor(USER_B.authId));
const pm = apiClient(tokenFor(PM_A.authId));

async function ok(p: Promise<{ status: number; data: any; error: any }>) {
  const res = await p;
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.error)}`);
  return res.data;
}

let db: Client;
const acc: Record<string, string> = {};

beforeAll(async () => {
  db = await appRoleClient();
  await setSignedContext(db, COMPANY_A, USER_A.id);
  await admin.post('/accounting/accounts/seed'); // may already exist
  const accounts: any[] = await ok(admin.get('/accounting/accounts?limit=500'));
  for (const a of accounts) acc[a.accountNumber] = a.id;
});

afterAll(async () => {
  await db?.end();
});

async function postedEntry(date: string, description: string, lines: [string, number, number][], post = true) {
  const entry = await ok(admin.post('/accounting/entries', {
    entryDate: date,
    description,
    lines: lines.map(([n, debitCents, creditCents]) => ({ accountId: acc[n], debitCents, creditCents })),
  }));
  if (post) await ok(admin.post(`/accounting/entries/${entry.id}/post`));
  return entry;
}

/* ═══════════════════════════════════════════════
   Chart of accounts seed
   ═══════════════════════════════════════════════ */

describe('seedDefaultAccounts', () => {
  it('adds the KMU equity accounts and stays idempotent', async () => {
    for (const n of ['1170', '2800', '2970', '2979']) expect(acc[n]).toBeTruthy();
    const accounts: any[] = await ok(admin.get('/accounting/accounts?limit=500'));
    expect(accounts.find((a) => a.accountNumber === '2800').type).toBe('equity');
    expect(await ok(admin.post('/accounting/accounts/seed'))).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════
   Financial statements
   ═══════════════════════════════════════════════ */

describe('financial statements (pure)', () => {
  const row = (accountNumber: string, accountType: string, pd: number, pc: number, prd = 0, prc = 0) => ({
    accountId: accountNumber, accountNumber, accountName: accountNumber, accountType,
    periodDebitCents: pd, periodCreditCents: pc, priorDebitCents: prd, priorCreditCents: prc,
  });

  it('groups by type and KMU class and balances through the unclosed result', () => {
    const rows = [
      row('1020', 'asset', 10000, 0, 5000, 0),
      row('1500', 'asset', 3000, 0),
      row('X-1', 'asset', 100, 0),
      row('2000', 'liability', 0, 3100),
      row('2800', 'equity', 0, 0, 0, 2000),
      row('3000', 'revenue', 0, 12000, 0, 4000),
      row('4200', 'expense', 2000, 0, 1000, 0),
    ];
    const bs = buildBalanceSheet(rows, '2034-12-31', '2034-01-01');
    expect(bs.assets.groups.map((g) => [g.code, g.totalCents])).toEqual([['10', 15000], ['14', 3000], ['other', 100]]);
    expect(bs.liabilities.groups.map((g) => [g.code, g.totalCents])).toEqual([['20', 3100]]);
    expect(bs.result).toEqual({ priorPeriodsCents: 3000, periodCents: 10000, totalCents: 13000 });
    expect(bs.equity.totalCents).toBe(15000);
    expect(bs.isBalanced).toBe(true);

    const is = buildIncomeStatement(rows, '2034-01-01', '2034-12-31');
    expect(is.sections.map((s) => [s.code, s.netCents])).toEqual([['3', 12000], ['4', -2000]]);
    expect(is.netResultCents).toBe(10000);
    expect(is.subtotals[0]).toMatchObject({ key: 'gross_profit_material', amountCents: 10000 });
  });
});

describe('GET /accounting/reports/*', () => {
  beforeAll(async () => {
    await postedEntry('2034-02-01', 'Apport en capital', [['1020', 100000, 0], ['2800', 0, 100000]]);
    await postedEntry('2034-03-01', 'Facture 2034', [['1100', 54050, 0], ['3000', 0, 50000], ['2200', 0, 4050]]);
    await postedEntry('2034-03-15', 'Achat matériel', [['4000', 20000, 0], ['1020', 0, 20000]]);
    await postedEntry('2034-03-20', 'Salaires', [['4200', 10000, 0], ['1020', 0, 10000]]);
    await postedEntry('2034-04-01', 'Brouillon non comptabilisé', [['4100', 999, 0], ['1020', 0, 999]], false);
  });

  it('builds the income statement of a period from posted entries only', async () => {
    const is = await ok(admin.get('/accounting/reports/income-statement?dateFrom=2034-01-01&dateTo=2034-12-31'));
    expect(is.revenue.totalCents).toBe(50000);
    expect(is.expense.totalCents).toBe(30000);
    expect(is.netResultCents).toBe(20000);
    expect(is.sections.map((s: any) => [s.code, s.netCents])).toEqual([['3', 50000], ['4', -30000]]);
    expect(is.subtotals.find((s: any) => s.key === 'gross_profit_material').amountCents).toBe(20000);
    expect(is.expense.accounts.map((a: any) => a.accountNumber)).not.toContain('4100');
    expect(is.unpostedEntryCount).toBeGreaterThanOrEqual(1);
  });

  it('builds a balanced balance sheet whose movement over the period is the posted entries', async () => {
    const before = await ok(admin.get('/accounting/reports/balance-sheet?dateTo=2033-12-31'));
    const after = await ok(admin.get('/accounting/reports/balance-sheet?dateFrom=2034-01-01&dateTo=2034-12-31'));
    expect(after.isBalanced).toBe(true);
    expect(after.differenceCents).toBe(0);
    expect(after.totalAssetsCents - before.totalAssetsCents).toBe(124050);
    expect(after.liabilities.totalCents - before.liabilities.totalCents).toBe(4050);
    expect(after.result.periodCents).toBe(20000);
    const equity = after.equity.groups.find((g: any) => g.code === '28');
    expect(equity.accounts.find((a: any) => a.accountNumber === '2800')).toBeTruthy();
    expect(after.equity.groups[after.equity.groups.length - 1].code).toBe('result');
    // asOfDate alias
    expect((await ok(admin.get('/accounting/reports/balance-sheet?asOfDate=2034-12-31'))).totalAssetsCents)
      .toBe(after.totalAssetsCents);
  });

  it('validates the period and is admin-only', async () => {
    expect((await admin.get('/accounting/reports/income-statement?dateFrom=2034-01-01')).status).toBe(400);
    expect((await admin.get('/accounting/reports/income-statement?dateFrom=2034-12-31&dateTo=2034-01-01')).status).toBe(400);
    expect((await admin.get('/accounting/reports/balance-sheet?dateTo=2034-02-30')).status).toBe(400);
    expect((await pm.get('/accounting/reports/balance-sheet')).status).toBe(403);
    expect((await pm.get('/accounting/reports/income-statement?dateFrom=2034-01-01&dateTo=2034-12-31')).status).toBe(403);
  });
});

/* ═══════════════════════════════════════════════
   Journal advisory lock
   ═══════════════════════════════════════════════ */

describe('journal entry numbering', () => {
  it('stays gapless under concurrent entries', async () => {
    const created = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        ok(admin.post('/accounting/entries', {
          entryDate: '2034-06-01',
          description: `Concurrent ${i}`,
          lines: [{ accountId: acc['1000'], debitCents: 100, creditCents: 0 }, { accountId: acc['1020'], debitCents: 0, creditCents: 100 }],
        })),
      ),
    );
    const numbers = created.map((e: any) => e.entryNumber).sort((a: number, b: number) => a - b);
    expect(new Set(numbers).size).toBe(6);
    expect(numbers[5] - numbers[0]).toBe(5);
  });
});

/* ═══════════════════════════════════════════════
   Bank statement parsing (pure)
   ═══════════════════════════════════════════════ */

function camt(id: string, entries: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>${id}</MsgId></GrpHdr>
    <Stmt>
      <Id>${id}</Id>
      <Acct><Id><IBAN>CH44 3199 9123 0008 8901 2</IBAN></Id><Ccy>CHF</Ccy></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-01-01</Dt></Dt></Bal>
      ${entries}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
}

function credit(opts: { amount: string; date: string; ref?: string; text?: string; acctRef?: string; name?: string }) {
  return `<Ntry>
    <Amt Ccy="CHF">${opts.amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>${opts.date}</Dt></BookgDt><ValDt><Dt>${opts.date}</Dt></ValDt>
    ${opts.acctRef ? `<AcctSvcrRef>${opts.acctRef}</AcctSvcrRef>` : ''}
    <NtryDtls><TxDtls>
      <RltdPties><Dbtr><Nm>${opts.name ?? 'Client &amp; Fils SA'}</Nm></Dbtr></RltdPties>
      <RmtInf>
        ${opts.text ? `<Ustrd>${opts.text}</Ustrd>` : ''}
        ${opts.ref ? `<Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp><Ref>${opts.ref}</Ref></CdtrRefInf></Strd>` : ''}
      </RmtInf>
    </TxDtls></NtryDtls>
  </Ntry>`;
}

function debit(amount: string, date: string, acctRef: string) {
  return `<Ntry><Amt Ccy="CHF">${amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><Dt>${date}</Dt></BookgDt><AcctSvcrRef>${acctRef}</AcctSvcrRef><AddtlNtryInf>Frais bancaires</AddtlNtryInf></Ntry>`;
}

describe('bank statement parser', () => {
  it('reads camt.053 entries, references, batches and skips pending entries', () => {
    const xml = camt('P-1', `
      ${credit({ amount: '1250.05', date: '2026-03-10', ref: '00 00000 00000 00000 00202 60073', acctRef: 'R1' })}
      ${debit('20.00', '2026-03-31', 'R2')}
      <Ntry><Amt Ccy="CHF">5.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-03-31</Dt></BookgDt></Ntry>
      <Ntry><Amt Ccy="CHF">300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-15</Dt></BookgDt><AcctSvcrRef>B</AcctSvcrRef>
        <NtryDtls><TxDtls><Amt Ccy="CHF">100.00</Amt></TxDtls><TxDtls><AmtDtls><TxAmt><Amt Ccy="CHF">200.00</Amt></TxAmt></AmtDtls></TxDtls></NtryDtls></Ntry>`);
    const s = parseBankStatement(xml);
    expect(s.format).toBe('camt053');
    expect(s.iban).toBe('CH4431999123000889012');
    expect(s.openingBalanceCents).toBe(100000);
    expect(s.skippedEntries).toBe(1);
    expect(s.lines.map((l) => l.amountCents)).toEqual([125005, -2000, 10000, 20000]);
    expect(s.lines[0]).toMatchObject({ reference: '000000000000000000020260073', counterpartyName: 'Client & Fils SA', bankReference: 'R1' });
    expect(s.lines.slice(2).map((l) => l.bankReference)).toEqual(['B/1', 'B/2']);
  });

  it('rejects DOCTYPE / entity declarations (XXE) and malformed XML', () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document>&x;</Document>';
    expect(() => parseXml(xxe)).toThrow(/DOCTYPE/);
    expect(() => parseXml('<Document>&x;</Document>')).toThrow(/entity/);
    expect(() => parseXml('<Document><a></Document>')).toThrow(/Malformed/);
    expect(() => parseBankStatement('<Other/>', 'camt053')).toThrow(/camt\.053/);
  });

  it('reads CSV exports with French / German headers and Swiss number formats', () => {
    const csv = '﻿Konto;CH44\r\n\r\nBuchungsdatum;Valuta;Buchungstext;Referenz;Gutschrift;Belastung;Währung\r\n'
      + '05.03.2026;05.03.2026;"Zahlung; Facture 2026-008";;"1\'250.05";;CHF\r\n'
      + '06.03.2026;;Gebühr;;;12.50;CHF\r\n;;Total;;1250.05;;\r\n';
    const s = parseBankStatement(csv);
    expect(s.format).toBe('csv');
    expect(s.lines.map((l) => [l.bookingDate, l.amountCents])).toEqual([['2026-03-05', 125005], ['2026-03-06', -1250]]);
    expect(s.lines[0].remittanceInfo).toBe('Zahlung; Facture 2026-008');
    expect(parseAmountToCents('1 234,50')).toBe(123450);
    expect(() => parseAmountToCents('1.234')).toThrow();
    expect(() => parseBankStatement('foo;bar\n1;2\n')).toThrow(/header/);
  });
});

describe('matching rules (pure)', () => {
  const line = (id: string, amountCents: number, extra: Partial<{ reference: string; remittanceInfo: string }> = {}) => ({
    id, bookingDate: '2026-03-15', valueDate: null, amountCents, currency: 'CHF',
    reference: extra.reference ?? null, remittanceInfo: extra.remittanceInfo ?? null,
  });
  const inv = (id: string, invoiceNumber: string, outstandingCents: number, dueDate: string | null = null) => ({
    id, invoiceNumber, clientName: null, issueDate: '2026-02-01', dueDate, totalTtcCents: outstandingCents, outstandingCents,
  });

  it('ranks QR reference, then invoice number, then exact amount; prefers recorded payments', () => {
    const qr = invoiceQrReference('2026-007')!;
    const res = suggestMatches(
      [line('qr', 50000, { reference: qr }), line('num', 1000, { remittanceInfo: 'Fact. 2026-008 merci' }),
        line('amt', 7000), line('pay', 3000), line('over', 99999, { reference: qr }), line('out', -500)],
      [{ id: 'P', invoiceId: 'I9', invoiceNumber: '2026-009', amountCents: 3000, paymentDate: '2026-03-14', reference: null }],
      [inv('I7', '2026-007', 50000), inv('I8', '2026-008', 2000), inv('I9', '2026-009', 3000), inv('I10', '2026-010', 7000, '2026-03-20')],
    );
    const by = Object.fromEntries(res.map((r) => [r.lineId, r]));
    expect(by.qr.best).toMatchObject({ kind: 'invoice', invoiceId: 'I7', confidence: 'high', reasons: ['qr_reference', 'amount'] });
    expect(by.num.candidates[0]).toMatchObject({ invoiceId: 'I8', confidence: 'medium', reasons: ['invoice_number'] });
    expect(by.amt.candidates[0]).toMatchObject({ invoiceId: 'I10', confidence: 'low', reasons: ['amount', 'date'] });
    expect(by.pay.candidates.map((c) => `${c.kind}:${c.invoiceId}`)).toEqual(['payment:I9']);
    expect(by.over.candidates).toEqual([]);
    expect(by.out.candidates).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════
   Bank reconciliation (API)
   ═══════════════════════════════════════════════ */

describe('bank reconciliation', () => {
  const inv: Record<'qr' | 'manual' | 'csv', any> = {} as any;
  let manualPaymentId: string;
  let statement: any;
  let today: string;

  beforeAll(async () => {
    const projectId = await createProject(admin, 'Rapprochement bancaire');
    const project = await ok(admin.get(`/projects/${projectId}`));
    const create = async (quantity: number) => {
      const i = await ok(admin.post('/invoices', {
        projectId, clientId: project.clientId, type: 'invoice',
        lines: [{ description: 'Installation électrique', unit: 'h', quantity, unitPriceCents: 9500 }],
      }));
      await ok(admin.patch(`/invoices/${i.id}/status`, { status: 'sent' }));
      return ok(admin.get(`/invoices/${i.id}`));
    };
    inv.qr = await create(13);
    inv.manual = await create(7);
    inv.csv = await create(3);
    today = String(inv.qr.issueDate).slice(0, 10);
    const payment = await ok(admin.post(`/invoices/${inv.manual.id}/payments`, {
      amountCents: 4321, paymentDate: today, paymentMethod: 'bank_transfer', reference: 'VIR-RAPPRO',
    }));
    manualPaymentId = payment.id;
  });

  const statementXml = () => camt('RECON-1', `
    ${credit({ amount: (inv.qr.totalTtcCents / 100).toFixed(2), date: today, ref: invoiceQrReference(inv.qr.invoiceNumber)!, acctRef: 'RECON-A' })}
    ${credit({ amount: '43.21', date: today, text: 'Acompte chantier', acctRef: 'RECON-B' })}
    ${debit('12.50', today, 'RECON-C')}`);

  it('imports a camt.053 statement and refuses the same file twice', async () => {
    const res = await ok(admin.post('/accounting/reconciliation/statements', { content: statementXml(), filename: 'camt053.xml' }));
    expect(res.statement.format).toBe('camt053');
    expect(res.importedLines).toBe(3);
    expect(res.duplicateLines).toBe(0);
    statement = await ok(admin.get(`/accounting/reconciliation/statements/${res.statement.id}`));
    expect(statement.lines.map((l: any) => [l.amountCents, l.status])).toEqual([
      [inv.qr.totalTtcCents, 'unmatched'], [4321, 'unmatched'], [-1250, 'unmatched'],
    ]);

    const again = await admin.post('/accounting/reconciliation/statements', { content: statementXml() });
    expect(again.status).toBe(422);

    // Overlapping statement (other message id, same bookings): lines are not duplicated.
    const overlap = await ok(admin.post('/accounting/reconciliation/statements', {
      content: statementXml().replace(/RECON-1/g, 'RECON-1b'),
    }));
    expect(overlap.importedLines).toBe(0);
    expect(overlap.duplicateLines).toBe(3);

    // The audit trail keeps the file's metadata, not its transactions.
    const { rows } = await db.query(
      `SELECT new_values FROM audit_log
        WHERE company_id = $1 AND new_values->>'filename' = 'camt053.xml' AND new_values ? 'sha256'`,
      [COMPANY_A],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].new_values).toMatchObject({ format: 'camt053', importedLines: 3 });
    expect(JSON.stringify(rows[0].new_values)).not.toContain('BkToCstmrStmt');
  });

  it('rejects XXE payloads and malformed statements with 400', async () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE Document [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document>&x;</Document>';
    expect((await admin.post('/accounting/reconciliation/statements', { content: xxe })).status).toBe(400);
    expect((await admin.post('/accounting/reconciliation/statements', { content: 'a;b\n1;2\n', format: 'csv' })).status).toBe(400);
    expect((await admin.post('/accounting/reconciliation/statements', { content: 'x', format: 'mt940' })).status).toBe(400);
  });

  it('suggests the QR-referenced invoice and the recorded payment', async () => {
    const res = await ok(admin.get(`/accounting/reconciliation/suggestions?statementId=${statement.id}`));
    const [qrLine, manualLine] = statement.lines;
    const qr = res.lines.find((l: any) => l.lineId === qrLine.id);
    expect(qr.best).toMatchObject({ kind: 'invoice', invoiceId: inv.qr.id, confidence: 'high' });
    expect(qr.best.reasons).toContain('qr_reference');
    const manual = res.lines.find((l: any) => l.lineId === manualLine.id);
    expect(manual.candidates[0]).toMatchObject({ kind: 'payment', paymentId: manualPaymentId, invoiceId: inv.manual.id });
    // Outgoing lines are never suggested.
    expect(res.lines.find((l: any) => l.lineId === statement.lines[2].id)).toBeUndefined();
  });

  it('confirms an invoice match by recording the payment through invoicing', async () => {
    const qrLine = statement.lines[0];
    const res = await ok(admin.post(`/accounting/reconciliation/lines/${qrLine.id}/match`, { invoiceId: inv.qr.id }));
    expect(res.paymentCreated).toBe(true);
    expect(res.line).toMatchObject({ status: 'matched', matchedInvoiceId: inv.qr.id });
    expect(res.line.matchedPaymentId).toBeTruthy();

    const invoice = await ok(admin.get(`/invoices/${inv.qr.id}`));
    expect(invoice.status).toBe('paid');
    expect(invoice.amountPaidCents).toBe(inv.qr.totalTtcCents);
    const { rows } = await db.query(
      'SELECT amount_cents, payment_method, reference, journal_entry_id FROM payment WHERE id = $1',
      [res.line.matchedPaymentId],
    );
    expect({ ...rows[0], amount_cents: Number(rows[0].amount_cents) }).toMatchObject({ amount_cents: inv.qr.totalTtcCents, payment_method: 'bank_transfer' });
    expect(rows[0].reference).toBe(invoiceQrReference(inv.qr.invoiceNumber));
    expect(rows[0].journal_entry_id).toBeTruthy();

    // Confirming the same line again is refused.
    expect((await admin.post(`/accounting/reconciliation/lines/${qrLine.id}/match`, { invoiceId: inv.qr.id })).status).toBe(422);
  });

  it('confirms a recorded payment, once', async () => {
    const manualLine = statement.lines[1];
    expect((await admin.post(`/accounting/reconciliation/lines/${manualLine.id}/match`, {})).status).toBe(400);
    expect((await admin.post(`/accounting/reconciliation/lines/${manualLine.id}/match`,
      { paymentId: manualPaymentId, invoiceId: inv.manual.id })).status).toBe(400);
    const res = await ok(admin.post(`/accounting/reconciliation/lines/${manualLine.id}/match`, { paymentId: manualPaymentId }));
    expect(res.paymentCreated).toBe(false);
    expect(res.line).toMatchObject({ status: 'matched', matchedPaymentId: manualPaymentId, matchedInvoiceId: inv.manual.id });
    const invoice = await ok(admin.get(`/invoices/${inv.manual.id}`));
    expect(invoice.amountPaidCents).toBe(4321); // no second payment
  });

  it('lists what is left, and ignores / resets a line', async () => {
    const feeLine = statement.lines[2];
    let left = await ok(admin.get(`/accounting/reconciliation/unmatched?statementId=${statement.id}`));
    expect(left.bankLines.map((l: any) => l.id)).toEqual([feeLine.id]);
    expect(left.payments.map((p: any) => p.id)).not.toContain(manualPaymentId);
    expect(left.openInvoices.map((i: any) => i.id)).toContain(inv.csv.id);
    expect(left.openInvoices.map((i: any) => i.id)).not.toContain(inv.qr.id);

    // An outgoing line cannot pay a customer invoice.
    expect((await admin.post(`/accounting/reconciliation/lines/${feeLine.id}/match`, { invoiceId: inv.csv.id })).status).toBe(422);
    expect((await ok(admin.post(`/accounting/reconciliation/lines/${feeLine.id}/ignore`))).line.status).toBe('ignored');
    left = await ok(admin.get(`/accounting/reconciliation/unmatched?statementId=${statement.id}`));
    expect(left.bankLines).toEqual([]);
    expect((await ok(admin.post(`/accounting/reconciliation/lines/${feeLine.id}/unmatch`))).line.status).toBe('unmatched');

    const list = await ok(admin.get('/accounting/reconciliation/statements'));
    expect(list.find((s: any) => s.id === statement.id)).toMatchObject({ matchedCount: 2, unmatchedCount: 1 });
  });

  it('matches a CSV line by invoice number in the booking text', async () => {
    const amount = (inv.csv.totalTtcCents / 100).toFixed(2);
    const csv = `Date;Description;Montant;Devise\n${today};Paiement facture ${inv.csv.invoiceNumber};${amount};CHF\n`;
    const res = await ok(admin.post('/accounting/reconciliation/statements', { content: csv, filename: 'releve.csv' }));
    expect(res.statement.format).toBe('csv');
    const sugg = await ok(admin.get(`/accounting/reconciliation/suggestions?statementId=${res.statement.id}`));
    expect(sugg.lines[0].best).toMatchObject({ kind: 'invoice', invoiceId: inv.csv.id });
    expect(sugg.lines[0].best.reasons).toEqual(['invoice_number', 'amount']);
  });

  it('is admin-only and tenant-scoped', async () => {
    expect((await pm.get('/accounting/reconciliation/statements')).status).toBe(403);
    expect((await pm.post('/accounting/reconciliation/statements', { content: statementXml() })).status).toBe(403);
    expect((await adminB.get(`/accounting/reconciliation/statements/${statement.id}`)).status).toBe(404);
    expect((await adminB.post(`/accounting/reconciliation/lines/${statement.lines[2].id}/ignore`)).status).toBe(404);
    const other = await ok(adminB.get('/accounting/reconciliation/unmatched'));
    expect(other.bankLines.map((l: any) => l.id)).not.toContain(statement.lines[2].id);
  });
});

/* ═══════════════════════════════════════════════
   Fiduciary frais_debours with expense VAT
   ═══════════════════════════════════════════════ */

describe('frais_debours VAT', () => {
  it('derives VAT from the rate when only the rate is known', () => {
    expect(expenseVat(10810, 810, null)).toEqual({ vatRate: 810, vat: 810 });
    expect(expenseVat(10810, 810, 800)).toEqual({ vatRate: 810, vat: 800 });
    expect(expenseVat(10810, null, null)).toEqual({ vatRate: 0, vat: 0 });
  });

  it('exports HT = TTC − VAT, tva_taux and tva_montant when the expense records its VAT', async () => {
    const insert = (description: string, amount: number, rate: number | null, vat: number | null) =>
      db.query(
        `INSERT INTO expense (company_id, user_id, project_id, date, category, description, amount_cents,
                              vat_rate_bps, vat_amount_cents, status)
         VALUES ($1, $2, NULL, '2032-05-10', 'material', $3, $4, $5, $6, 'approved')`,
        [COMPANY_A, WORKER_1_A.id, description, amount, rate, vat],
      );
    await insert('TVA connue', 10810, 810, 810);
    await insert('Taux seul', 2160, 810, null);
    await insert('Sans TVA', 5000, null, null);

    const res = await ok(admin.get('/accounting/export/fiduciary?dateFrom=2032-05-01&dateTo=2032-05-31'));
    const [header, ...rows] = res.files.frais_debours.content.replace(/^﻿/, '').trim().split('\r\n').map((l: string) => l.split(';'));
    const col = (r: string[], name: string) => r[header.indexOf(name)];
    const byDesc = Object.fromEntries(rows.map((r: string[]) => [col(r, 'description'), r]));
    const pick = (d: string) => ['montant_ht', 'tva_taux', 'tva_montant', 'montant_ttc'].map((c) => col(byDesc[d], c));
    expect(pick('TVA connue')).toEqual(['100.00', '8.10', '8.10', '108.10']);
    expect(pick('Taux seul')).toEqual(['19.98', '8.10', '1.62', '21.60']);
    expect(pick('Sans TVA')).toEqual(['50.00', '0.00', '0.00', '50.00']);
  });
});
