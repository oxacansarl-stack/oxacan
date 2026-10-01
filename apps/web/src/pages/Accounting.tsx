import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiList, apiPost } from '../lib/api';
import { useCurrentUser } from '../lib/current-user';
import { errorMessage } from '../lib/errors';
import { enumLabel, formatAmount, formatDate, formatMoney } from '../lib/format';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Account {
  id: string;
  accountNumber: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentId?: string;
  isSystem: boolean;
  isActive: boolean;
  children?: Account[];
}

interface JournalEntryLine {
  id?: string;
  accountId: string;
  account?: Account;
  debitCents: number;
  creditCents: number;
}

interface JournalEntry {
  id: string;
  entryNumber?: number;
  entryDate: string;
  description: string;
  referenceType?: string | null;
  isPosted: boolean;
  lines?: JournalEntryLine[];
  createdAt: string;
}

/** Row of GET /accounting/ledger/:accountId → { accountId, entries } */
interface LedgerEntry {
  entryNumber: number;
  entryDate: string;
  description: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
}

/** GET /accounting/export/fiduciary → the three PRD §17 files (UTF-8 BOM, ';', CRLF, ISO dates). */
const FIDUCIARY_FILES = ['heures_employes', 'frais_debours', 'resume_projets'] as const;
type FiduciaryFileKey = typeof FIDUCIARY_FILES[number];

interface FiduciaryCsvFile {
  filename: string;
  content: string;
  rowCount: number;
}

interface FiduciaryExport {
  dateFrom: string;
  dateTo: string;
  periode: string;
  scope: 'all' | 'own_projects';
  files: Record<FiduciaryFileKey, FiduciaryCsvFile>;
}

interface ExportProject {
  id: string;
  reference: string;
  name: string;
  managerId?: string | null;
}

interface ExportEmployee {
  id: string;
  firstName: string;
  lastName: string;
}

interface TrialBalanceRow {
  accountId: string;
  accountNumber: string;
  accountName: string;
  type: string;
  debitCents: number;
  creditCents: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ACCOUNT_TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  asset: { bg: '#dbeafe', fg: '#1d4ed8' },
  liability: { bg: '#fee2e2', fg: '#dc2626' },
  equity: { bg: '#ede9fe', fg: '#7c3aed' },
  revenue: { bg: '#dcfce7', fg: '#166534' },
  expense: { bg: '#fef3c7', fg: '#92400e' },
};

const TABS = ['accounts', 'entries', 'ledger', 'export'] as const;
type Tab = typeof TABS[number];

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

/** §17.4 expense categories, as written in the CSV. */
const FIDUCIARY_CATEGORIES = ['materiel', 'deplacement', 'equipement', 'sous-traitance', 'divers'] as const;

/** §17.7 period selection. */
const PERIOD_TYPES = ['month', 'quarter', 'year', 'custom'] as const;
type PeriodType = typeof PERIOD_TYPES[number];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Last day of a month as YYYY-MM-DD (month is 1-based). */
const monthEnd = (year: number, month: number) =>
  `${year}-${pad2(month)}-${pad2(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;

/** [dateFrom, dateTo] (ISO) for the selected period, or null when incomplete. */
function periodRange(
  type: PeriodType, month: string, quarter: number, year: number, from: string, to: string,
): [string, string] | null {
  if (type === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) return null;
    return [`${month}-01`, monthEnd(Number(m[1]), Number(m[2]))];
  }
  if (type === 'quarter') {
    const first = (quarter - 1) * 3 + 1;
    return [`${year}-${pad2(first)}-01`, monthEnd(year, first + 2)];
  }
  if (type === 'year') return [`${year}-01-01`, `${year}-12-31`];
  return from && to ? [from, to] : null;
}

const entryTotalDebit = (e: JournalEntry): number =>
  (e.lines ?? []).reduce((sum, l) => sum + (l.debitCents || 0), 0);

/** Column names of a CSV (first line), so the preview shows headers even for an empty file. */
function parseCsvHeader(csv: string): string[] {
  const first = csv.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  return first ? first.split(';') : [];
}

/** Parses the API's semicolon-separated CSV (optional BOM, "quoted" fields) for preview. */
function parseCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const text = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  const [headers, ...body] = rows;
  if (!headers) return [];
  return body.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

/* ------------------------------------------------------------------ */
/*  Shared styles                                                      */
/* ------------------------------------------------------------------ */

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  ...btnPrimary,
  background: '#dc2626',
};

const btnSuccess: React.CSSProperties = {
  ...btnPrimary,
  background: '#16a34a',
};

const btnOutline: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const btnWarning: React.CSSProperties = {
  ...btnPrimary,
  background: '#f59e0b',
};

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  display: 'block',
  marginBottom: 4,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 14,
  color: '#111827',
  borderTop: '1px solid #f3f4f6',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Accounting() {
  const { t } = useTranslation('accounting');
  // Project managers may only run the fiduciary export (PRD §3.2); the ledger is admin-only.
  const currentUser = useCurrentUser();
  const isAdmin = currentUser.role === 'ADMIN';
  const visibleTabs: readonly Tab[] = isAdmin ? TABS : ['export'];
  const [activeTab, setActiveTab] = useState<Tab>(isAdmin ? 'accounts' : 'export');
  const [error, setError] = useState('');

  /* ============================================================ */
  /*  Chart of Accounts state                                     */
  /* ============================================================ */
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountForm, setAccountForm] = useState({
    accountNumber: '',
    name: '',
    type: 'asset' as Account['type'],
    parentId: '',
  });

  /* ============================================================ */
  /*  Journal Entries state                                       */
  /* ============================================================ */
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesPage, setEntriesPage] = useState(1);
  const [entriesTotalPages, setEntriesTotalPages] = useState(1);
  const [entryDateFrom, setEntryDateFrom] = useState('');
  const [entryDateTo, setEntryDateTo] = useState('');
  const [entryPostedFilter, setEntryPostedFilter] = useState<'' | 'true' | 'false'>('');
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryForm, setEntryForm] = useState({
    entryDate: new Date().toISOString().slice(0, 10),
    description: '',
    referenceType: '',
  });
  const [entryLines, setEntryLines] = useState<JournalEntryLine[]>([
    { accountId: '', debitCents: 0, creditCents: 0 },
    { accountId: '', debitCents: 0, creditCents: 0 },
  ]);
  const [entryError, setEntryError] = useState('');

  /* ============================================================ */
  /*  Ledger state                                                */
  /* ============================================================ */
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [ledgerDateFrom, setLedgerDateFrom] = useState('');
  const [ledgerDateTo, setLedgerDateTo] = useState('');
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  /* ============================================================ */
  /*  Export state                                                */
  /* ============================================================ */
  const today = new Date();
  const [exportPeriodType, setExportPeriodType] = useState<PeriodType>('month');
  const [exportMonth, setExportMonth] = useState(`${today.getFullYear()}-${pad2(today.getMonth() + 1)}`);
  const [exportQuarter, setExportQuarter] = useState(Math.floor(today.getMonth() / 3) + 1);
  const [exportYear, setExportYear] = useState(today.getFullYear());
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [exportProjectId, setExportProjectId] = useState('');
  const [exportEmployeeId, setExportEmployeeId] = useState('');
  const [exportCategory, setExportCategory] = useState('');
  const [exportFile, setExportFile] = useState<FiduciaryFileKey>('heures_employes');
  const [exportProjects, setExportProjects] = useState<ExportProject[]>([]);
  const [exportEmployees, setExportEmployees] = useState<ExportEmployee[]>([]);
  const [exportData, setExportData] = useState<FiduciaryExport | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  /* ============================================================ */
  /*  Trial Balance state                                         */
  /* ============================================================ */
  const [trialBalance, setTrialBalance] = useState<TrialBalanceRow[]>([]);
  const [trialBalanceLoading, setTrialBalanceLoading] = useState(false);

  /* ============================================================ */
  /*  Data loading                                                */
  /* ============================================================ */

  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const items = await apiGet<Account[]>('/accounting/accounts?limit=500');
      setAccounts(Array.isArray(items) ? items : []);
    } catch (e) {
      setError(errorMessage(e, t('errors.loadAccounts')));
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const fetchEntries = useCallback(async () => {
    setEntriesLoading(true);
    try {
      let path = `/accounting/entries?page=${entriesPage}`;
      if (entryDateFrom) path += `&dateFrom=${entryDateFrom}`;
      if (entryDateTo) path += `&dateTo=${entryDateTo}`;
      if (entryPostedFilter) path += `&isPosted=${entryPostedFilter}`;
      const { items, meta } = await apiList<JournalEntry>(path);
      setEntries(items);
      setEntriesTotalPages(Math.max(1, meta?.totalPages ?? 1));
    } catch (e) {
      setError(errorMessage(e, t('errors.loadEntries')));
    } finally {
      setEntriesLoading(false);
    }
  }, [entriesPage, entryDateFrom, entryDateTo, entryPostedFilter]);

  const fetchLedger = useCallback(async () => {
    if (!ledgerAccountId) return;
    setLedgerLoading(true);
    try {
      let path = `/accounting/ledger/${ledgerAccountId}`;
      const params: string[] = [];
      if (ledgerDateFrom) params.push(`dateFrom=${ledgerDateFrom}`);
      if (ledgerDateTo) params.push(`dateTo=${ledgerDateTo}`);
      if (params.length) path += '?' + params.join('&');
      const res = await apiGet<{ accountId: string; entries: LedgerEntry[] }>(path);
      setLedgerEntries(res?.entries ?? []);
    } catch (e) {
      setError(errorMessage(e, t('errors.loadLedger')));
    } finally {
      setLedgerLoading(false);
    }
  }, [ledgerAccountId, ledgerDateFrom, ledgerDateTo]);

  // Fetch data when tab changes
  useEffect(() => {
    if (activeTab === 'accounts') fetchAccounts();
    if (activeTab === 'entries') { fetchAccounts(); fetchEntries(); }
    if (activeTab === 'ledger') fetchAccounts();
  }, [activeTab, fetchAccounts, fetchEntries]);

  // Filter options for the fiduciary export: a project manager only picks among their own projects (§17.6).
  useEffect(() => {
    if (activeTab !== 'export') return;
    const projectPath = isAdmin ? '/projects?limit=100' : `/projects?limit=100&managerId=${encodeURIComponent(currentUser.id)}`;
    apiGet<ExportProject[]>(projectPath)
      .then(items => setExportProjects(Array.isArray(items) ? items : []))
      .catch(() => setExportProjects([]));
    apiGet<ExportEmployee[]>('/hr/employees?limit=200')
      .then(items => setExportEmployees(Array.isArray(items) ? items : []))
      .catch(() => setExportEmployees([]));
  }, [activeTab, isAdmin, currentUser.id]);

  /* ============================================================ */
  /*  Account actions                                             */
  /* ============================================================ */

  const createAccount = async () => {
    if (!accountForm.accountNumber || !accountForm.name) {
      setError(t('validation.accountRequired'));
      return;
    }
    try {
      await apiPost('/accounting/accounts', {
        accountNumber: accountForm.accountNumber.trim(),
        name: accountForm.name.trim(),
        type: accountForm.type,
        ...(accountForm.parentId ? { parentId: accountForm.parentId } : {}),
      });
      setShowAccountForm(false);
      setAccountForm({ accountNumber: '', name: '', type: 'asset', parentId: '' });
      fetchAccounts();
    } catch (e) {
      setError(errorMessage(e, t('errors.createAccount')));
    }
  };

  const seedDefaults = async () => {
    if (!confirm(t('confirm.seedDefaults'))) return;
    try {
      await apiPost('/accounting/accounts/seed');
      fetchAccounts();
    } catch (e) {
      setError(errorMessage(e, t('errors.seedDefaults')));
    }
  };

  /* ============================================================ */
  /*  Journal entry actions                                       */
  /* ============================================================ */

  const addEntryLine = () => {
    setEntryLines(prev => [...prev, { accountId: '', debitCents: 0, creditCents: 0 }]);
  };

  const removeEntryLine = (idx: number) => {
    setEntryLines(prev => prev.filter((_, i) => i !== idx));
  };

  const updateEntryLine = (idx: number, field: keyof JournalEntryLine, value: any) => {
    setEntryLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const totalDebits = entryLines.reduce((sum, l) => sum + l.debitCents, 0);
  const totalCredits = entryLines.reduce((sum, l) => sum + l.creditCents, 0);
  const isBalanced = totalDebits === totalCredits && totalDebits > 0;

  const createEntry = async () => {
    setEntryError('');
    if (!entryForm.entryDate || !entryForm.description) {
      setEntryError(t('validation.entryRequired'));
      return;
    }
    if (!isBalanced) {
      setEntryError(t('validation.unbalanced'));
      return;
    }
    const hasEmpty = entryLines.some(l => !l.accountId);
    if (hasEmpty) {
      setEntryError(t('validation.lineAccount'));
      return;
    }
    const validAmount = (c: number) => Number.isInteger(c) && c >= 0;
    if (entryLines.some(l => !validAmount(l.debitCents) || !validAmount(l.creditCents))) {
      setEntryError(t('validation.positiveAmounts'));
      return;
    }
    try {
      await apiPost('/accounting/entries', {
        entryDate: entryForm.entryDate,
        description: entryForm.description.trim(),
        ...(entryForm.referenceType.trim() ? { referenceType: entryForm.referenceType.trim() } : {}),
        lines: entryLines.map(l => ({
          accountId: l.accountId,
          debitCents: l.debitCents,
          creditCents: l.creditCents,
        })),
      });
      setShowEntryForm(false);
      setEntryForm({ entryDate: new Date().toISOString().slice(0, 10), description: '', referenceType: '' });
      setEntryLines([
        { accountId: '', debitCents: 0, creditCents: 0 },
        { accountId: '', debitCents: 0, creditCents: 0 },
      ]);
      fetchEntries();
    } catch (e) {
      setEntryError(errorMessage(e, t('errors.createEntry')));
    }
  };

  const postEntry = async (id: string) => {
    if (!confirm(t('confirm.postEntry'))) return;
    try {
      await apiPost(`/accounting/entries/${id}/post`);
      fetchEntries();
    } catch (e) {
      setError(errorMessage(e, t('errors.postEntry')));
    }
  };

  /* ============================================================ */
  /*  Export actions                                               */
  /* ============================================================ */

  const generateExport = async () => {
    const range = periodRange(exportPeriodType, exportMonth, exportQuarter, exportYear, exportDateFrom, exportDateTo);
    if (!range) {
      setError(t('validation.exportDates'));
      return;
    }
    const [from, to] = range;
    if (from > to) {
      setError(t('validation.exportRange'));
      return;
    }
    setExportLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom: from, dateTo: to });
      if (exportProjectId) params.set('projectId', exportProjectId);
      if (exportEmployeeId) params.set('employeeId', exportEmployeeId);
      if (exportCategory) params.set('category', exportCategory);
      const res = await apiGet<FiduciaryExport>(`/accounting/export/fiduciary?${params.toString()}`);
      setExportData(res);
    } catch (e) {
      setError(errorMessage(e, t('errors.generateExport')));
    } finally {
      setExportLoading(false);
    }
  };

  /** Downloads the CSV exactly as generated by the API (UTF-8 BOM, semicolons, CRLF, ISO dates). */
  const downloadCSV = (csv: string, filename: string) => {
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  /* ============================================================ */
  /*  Build flattened accounts for display                        */
  /* ============================================================ */

  const flattenAccounts = (items: Account[], depth = 0): { account: Account; depth: number }[] => {
    const result: { account: Account; depth: number }[] = [];
    // Build parent-child map
    const childMap = new Map<string | undefined, Account[]>();
    items.forEach(a => {
      const key = a.parentId || '__root__';
      if (!childMap.has(key)) childMap.set(key, []);
      childMap.get(key)!.push(a);
    });

    const walk = (parentId: string | undefined, d: number) => {
      const children = childMap.get(parentId || '__root__') ?? [];
      children
        .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
        .forEach(a => {
          result.push({ account: a, depth: d });
          walk(a.id, d + 1);
        });
    };
    walk(undefined, 0);

    // If hierarchical walk found nothing (flat list), just sort by number
    if (result.length === 0 && items.length > 0) {
      return items
        .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
        .map(a => ({ account: a, depth: 0 }));
    }
    return result;
  };

  const flatAccounts = flattenAccounts(accounts);

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111827' }}>{t('title')}</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>{t('subtitle')}</p>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 600 }}>x</button>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid #e5e7eb' }}>
        {visibleTabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #2563eb' : '2px solid transparent',
              background: 'none',
              color: activeTab === tab ? '#2563eb' : '#6b7280',
              fontWeight: activeTab === tab ? 600 : 400,
              fontSize: 14,
              cursor: 'pointer',
              marginBottom: -2,
            }}
          >
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* ============================================================ */}
      {/*  CHART OF ACCOUNTS                                          */}
      {/* ============================================================ */}

      {activeTab === 'accounts' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btnPrimary} onClick={() => setShowAccountForm(!showAccountForm)}>
                {showAccountForm ? t('common:actions.cancel') : t('accounts.newAccount')}
              </button>
              <button style={btnWarning} onClick={seedDefaults}>
                {t('accounts.seedDefaults')}
              </button>
            </div>
          </div>

          {showAccountForm && (
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: 20, marginBottom: 20, border: '1px solid #e5e7eb' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>{t('accounts.createTitle')}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('accounts.accountNumber')}</label>
                  <input
                    style={inputStyle}
                    value={accountForm.accountNumber}
                    onChange={e => setAccountForm(f => ({ ...f, accountNumber: e.target.value }))}
                    placeholder="1000"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('accounts.name')}</label>
                  <input
                    style={inputStyle}
                    value={accountForm.name}
                    onChange={e => setAccountForm(f => ({ ...f, name: e.target.value }))}
                    placeholder={t('accounts.namePlaceholder')}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('accounts.type')}</label>
                  <select
                    style={inputStyle}
                    value={accountForm.type}
                    onChange={e => setAccountForm(f => ({ ...f, type: e.target.value as Account['type'] }))}
                  >
                    {ACCOUNT_TYPES.map(type => (
                      <option key={type} value={type}>{enumLabel('accountType', type)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('accounts.parentAccount')}</label>
                  <select
                    style={inputStyle}
                    value={accountForm.parentId}
                    onChange={e => setAccountForm(f => ({ ...f, parentId: e.target.value }))}
                  >
                    <option value="">{t('accounts.noParent')}</option>
                    {accounts
                      .filter(a => a.type === accountForm.type)
                      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
                      .map(a => (
                        <option key={a.id} value={a.id}>{a.accountNumber} - {a.name}</option>
                      ))}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnPrimary} onClick={createAccount}>{t('accounts.create')}</button>
                <button style={btnOutline} onClick={() => setShowAccountForm(false)}>{t('common:actions.cancel')}</button>
              </div>
            </div>
          )}

          {accountsLoading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>{t('accounts.loading')}</p>
          ) : flatAccounts.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>{t('accounts.empty')}</p>
          ) : (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={thStyle}>{t('accounts.table.number')}</th>
                    <th style={thStyle}>{t('accounts.table.name')}</th>
                    <th style={thStyle}>{t('accounts.table.type')}</th>
                    <th style={thStyle}>{t('accounts.table.system')}</th>
                    <th style={thStyle}>{t('accounts.table.active')}</th>
                  </tr>
                </thead>
                <tbody>
                  {flatAccounts.map(({ account: a, depth }) => (
                    <tr key={a.id}>
                      <td style={{ ...tdStyle, fontWeight: 600, paddingLeft: 12 + depth * 20, fontFamily: 'monospace' }}>
                        {a.accountNumber}
                      </td>
                      <td style={{ ...tdStyle, paddingLeft: 12 + depth * 20 }}>
                        {a.name}
                      </td>
                      <td style={tdStyle}>
                        <Badge color={ACCOUNT_TYPE_COLORS[a.type]}>{enumLabel('accountType', a.type)}</Badge>
                      </td>
                      <td style={tdStyle}>
                        {a.isSystem && (
                          <span style={{ fontSize: 16 }} title={t('accounts.systemAccount')}>
                            &#x1F512;
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: a.isActive ? '#16a34a' : '#dc2626', fontWeight: 600, fontSize: 16 }}>
                          {a.isActive ? '✓' : '✗'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ============================================================ */}
      {/*  JOURNAL ENTRIES                                             */}
      {/* ============================================================ */}

      {activeTab === 'entries' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <button style={btnPrimary} onClick={() => setShowEntryForm(!showEntryForm)}>
              {showEntryForm ? t('common:actions.cancel') : t('entries.newEntry')}
            </button>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('entries.from')}</label>
              <input type="date" style={{ ...inputStyle, width: 160 }} value={entryDateFrom} onChange={e => { setEntryDateFrom(e.target.value); setEntriesPage(1); }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('entries.to')}</label>
              <input type="date" style={{ ...inputStyle, width: 160 }} value={entryDateTo} onChange={e => { setEntryDateTo(e.target.value); setEntriesPage(1); }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('entries.status')}</label>
              <select style={{ ...inputStyle, width: 140 }} value={entryPostedFilter} onChange={e => { setEntryPostedFilter(e.target.value as any); setEntriesPage(1); }}>
                <option value="">{t('entries.all')}</option>
                <option value="true">{t('entries.posted')}</option>
                <option value="false">{t('entries.unposted')}</option>
              </select>
            </div>
            <div style={{ alignSelf: 'flex-end' }}>
              <button style={btnOutline} onClick={fetchEntries}>{t('entries.apply')}</button>
            </div>
          </div>

          {/* Create entry form */}
          {showEntryForm && (
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: 20, marginBottom: 20, border: '1px solid #e5e7eb' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>{t('entries.createTitle')}</h3>
              {entryError && (
                <div style={{ background: '#fee2e2', color: '#dc2626', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
                  {entryError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('entries.date')}</label>
                  <input
                    type="date"
                    style={inputStyle}
                    value={entryForm.entryDate}
                    onChange={e => setEntryForm(f => ({ ...f, entryDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('entries.description')}</label>
                  <input
                    style={inputStyle}
                    value={entryForm.description}
                    onChange={e => setEntryForm(f => ({ ...f, description: e.target.value }))}
                    placeholder={t('entries.descriptionPlaceholder')}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('entries.referenceType')}</label>
                  <input
                    style={inputStyle}
                    value={entryForm.referenceType}
                    onChange={e => setEntryForm(f => ({ ...f, referenceType: e.target.value }))}
                    placeholder={t('entries.referenceTypePlaceholder')}
                  />
                </div>
              </div>

              {/* Lines */}
              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>{t('entries.lines')}</h4>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ background: '#f3f4f6' }}>
                    <tr>
                      <th style={thStyle}>{t('entries.account')}</th>
                      <th style={{ ...thStyle, width: 160, textAlign: 'right' }}>{t('entries.debitChf')}</th>
                      <th style={{ ...thStyle, width: 160, textAlign: 'right' }}>{t('entries.creditChf')}</th>
                      <th style={{ ...thStyle, width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entryLines.map((line, idx) => (
                      <tr key={idx}>
                        <td style={tdStyle}>
                          <select
                            style={{ ...inputStyle, border: 'none', padding: '4px 8px' }}
                            value={line.accountId}
                            onChange={e => updateEntryLine(idx, 'accountId', e.target.value)}
                          >
                            <option value="">{t('entries.selectAccount')}</option>
                            {flatAccounts.map(({ account: a, depth }) => (
                              <option key={a.id} value={a.id}>
                                {' '.repeat(depth * 2)}{a.accountNumber} - {a.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="number"
                            step="0.05"
                            style={{ ...inputStyle, border: 'none', padding: '4px 8px', textAlign: 'right' }}
                            value={line.debitCents / 100 || ''}
                            onChange={e => updateEntryLine(idx, 'debitCents', Math.round(parseFloat(e.target.value || '0') * 100))}
                          />
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="number"
                            step="0.05"
                            style={{ ...inputStyle, border: 'none', padding: '4px 8px', textAlign: 'right' }}
                            value={line.creditCents / 100 || ''}
                            onChange={e => updateEntryLine(idx, 'creditCents', Math.round(parseFloat(e.target.value || '0') * 100))}
                          />
                        </td>
                        <td style={tdStyle}>
                          {entryLines.length > 2 && (
                            <button
                              onClick={() => removeEntryLine(idx)}
                              style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16 }}
                            >
                              &times;
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr style={{ background: '#f9fafb' }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{t('entries.total')}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
                        {formatAmount(totalDebits)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
                        {formatAmount(totalCredits)}
                      </td>
                      <td style={tdStyle} />
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Balance indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <button style={btnOutline} onClick={addEntryLine}>{t('entries.addLine')}</button>
                <span style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: totalDebits === 0 && totalCredits === 0 ? '#6b7280' : isBalanced ? '#16a34a' : '#dc2626',
                }}>
                  {totalDebits === 0 && totalCredits === 0
                    ? t('entries.enterAmounts')
                    : isBalanced
                      ? t('entries.balanced')
                      : t('entries.unbalanced', { amount: formatMoney(Math.abs(totalDebits - totalCredits)) })
                  }
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnPrimary} onClick={createEntry} disabled={!isBalanced}>{t('entries.create')}</button>
                <button style={btnOutline} onClick={() => setShowEntryForm(false)}>{t('common:actions.cancel')}</button>
              </div>
            </div>
          )}

          {/* Entries table */}
          {entriesLoading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>{t('entries.loading')}</p>
          ) : entries.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>{t('entries.empty')}</p>
          ) : (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={thStyle}>{t('entries.table.entryNumber')}</th>
                    <th style={thStyle}>{t('entries.table.date')}</th>
                    <th style={thStyle}>{t('entries.table.description')}</th>
                    <th style={thStyle}>{t('entries.table.reference')}</th>
                    <th style={thStyle}>{t('entries.table.posted')}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{t('entries.table.total')}</th>
                    <th style={thStyle}>{t('entries.table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.id}>
                      <td style={{ ...tdStyle, fontWeight: 600, fontFamily: 'monospace' }}>{e.entryNumber || e.id.slice(0, 8)}</td>
                      <td style={tdStyle}>{formatDate(e.entryDate)}</td>
                      <td style={tdStyle}>{e.description}</td>
                      <td style={tdStyle}>{e.referenceType || '-'}</td>
                      <td style={tdStyle}>
                        <span style={{ color: e.isPosted ? '#16a34a' : '#6b7280', fontWeight: 600, fontSize: 16 }}>
                          {e.isPosted ? '✓' : '—'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                        {formatMoney(entryTotalDebit(e))}
                      </td>
                      <td style={tdStyle}>
                        {!e.isPosted && (
                          <button
                            style={{ ...btnSuccess, padding: '4px 10px', fontSize: 12 }}
                            onClick={() => postEntry(e.id)}
                          >
                            {t('entries.post')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {entriesTotalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button style={btnOutline} disabled={entriesPage <= 1} onClick={() => setEntriesPage(p => Math.max(1, p - 1))}>
                {t('common:actions.previous')}
              </button>
              <span style={{ padding: '8px 12px', fontSize: 14, color: '#6b7280' }}>
                {t('common:state.page', { page: entriesPage, total: entriesTotalPages })}
              </span>
              <button style={btnOutline} disabled={entriesPage >= entriesTotalPages} onClick={() => setEntriesPage(p => p + 1)}>
                {t('common:actions.next')}
              </button>
            </div>
          )}
        </>
      )}

      {/* ============================================================ */}
      {/*  LEDGER                                                      */}
      {/* ============================================================ */}

      {activeTab === 'ledger' && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('ledger.account')}</label>
              <select
                style={inputStyle}
                value={ledgerAccountId}
                onChange={e => setLedgerAccountId(e.target.value)}
              >
                <option value="">{t('ledger.selectAccount')}</option>
                {flatAccounts.map(({ account: a, depth }) => (
                  <option key={a.id} value={a.id}>
                    {' '.repeat(depth * 2)}{a.accountNumber} - {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('ledger.from')}</label>
              <input type="date" style={{ ...inputStyle, width: 160 }} value={ledgerDateFrom} onChange={e => setLedgerDateFrom(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('ledger.to')}</label>
              <input type="date" style={{ ...inputStyle, width: 160 }} value={ledgerDateTo} onChange={e => setLedgerDateTo(e.target.value)} />
            </div>
            <button style={btnPrimary} onClick={fetchLedger} disabled={!ledgerAccountId}>
              {t('ledger.load')}
            </button>
          </div>

          {ledgerLoading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>{t('ledger.loading')}</p>
          ) : !ledgerAccountId ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>{t('ledger.selectPrompt')}</p>
          ) : ledgerEntries.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>{t('ledger.empty')}</p>
          ) : (
            <>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ background: '#f9fafb' }}>
                    <tr>
                      <th style={thStyle}>{t('ledger.table.date')}</th>
                      <th style={thStyle}>{t('ledger.table.entryNumber')}</th>
                      <th style={thStyle}>{t('ledger.table.description')}</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>{t('ledger.table.debit')}</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>{t('ledger.table.credit')}</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>{t('ledger.table.balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerEntries.map((entry, idx) => (
                      <tr key={`${entry.entryNumber}-${idx}`}>
                        <td style={tdStyle}>{formatDate(entry.entryDate)}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{entry.entryNumber}</td>
                        <td style={tdStyle}>{entry.description}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                          {entry.debitCents > 0 ? formatAmount(entry.debitCents) : ''}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                          {entry.creditCents > 0 ? formatAmount(entry.creditCents) : ''}
                        </td>
                        <td style={{
                          ...tdStyle,
                          textAlign: 'right',
                          fontWeight: 600,
                          fontFamily: 'monospace',
                          color: entry.balanceCents < 0 ? '#dc2626' : '#111827',
                        }}>
                          {formatMoney(entry.balanceCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bottom balance */}
              {ledgerEntries.length > 0 && (
                <div style={{
                  marginTop: 16,
                  padding: 16,
                  background: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  borderRadius: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#0369a1' }}>{t('ledger.closingBalance')}</span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: '#111827' }}>
                    {formatMoney(ledgerEntries[ledgerEntries.length - 1].balanceCents)}
                  </span>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ============================================================ */}
      {/*  EXPORT (Fiduciary)                                          */}
      {/* ============================================================ */}

      {activeTab === 'export' && (
        <>
          <div style={{ background: '#f9fafb', borderRadius: 8, padding: 20, marginBottom: 20, border: '1px solid #e5e7eb' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>{t('export.title')}</h3>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              {isAdmin ? t('export.help') : t('export.helpOwnProjects')}
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>{t('export.periodType')}</label>
                <select style={{ ...inputStyle, width: 170 }} value={exportPeriodType} onChange={e => setExportPeriodType(e.target.value as PeriodType)}>
                  {PERIOD_TYPES.map(p => <option key={p} value={p}>{t(`export.periodTypes.${p}`)}</option>)}
                </select>
              </div>
              {exportPeriodType === 'month' && (
                <div>
                  <label style={labelStyle}>{t('export.month')}</label>
                  <input type="month" style={{ ...inputStyle, width: 180 }} value={exportMonth} onChange={e => setExportMonth(e.target.value)} />
                </div>
              )}
              {exportPeriodType === 'quarter' && (
                <div>
                  <label style={labelStyle}>{t('export.quarter')}</label>
                  <select style={{ ...inputStyle, width: 120 }} value={exportQuarter} onChange={e => setExportQuarter(Number(e.target.value))}>
                    {[1, 2, 3, 4].map(q => <option key={q} value={q}>{t('export.quarterLabel', { quarter: q })}</option>)}
                  </select>
                </div>
              )}
              {(exportPeriodType === 'quarter' || exportPeriodType === 'year') && (
                <div>
                  <label style={labelStyle}>{t('export.year')}</label>
                  <input type="number" min={2000} max={2100} style={{ ...inputStyle, width: 110 }} value={exportYear} onChange={e => setExportYear(Number(e.target.value))} />
                </div>
              )}
              {exportPeriodType === 'custom' && (
                <>
                  <div>
                    <label style={labelStyle}>{t('export.from')}</label>
                    <input type="date" style={{ ...inputStyle, width: 180 }} value={exportDateFrom} onChange={e => setExportDateFrom(e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle}>{t('export.to')}</label>
                    <input type="date" style={{ ...inputStyle, width: 180 }} value={exportDateTo} onChange={e => setExportDateTo(e.target.value)} />
                  </div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label style={labelStyle}>{t('export.project')}</label>
                <select style={{ ...inputStyle, width: 240 }} value={exportProjectId} onChange={e => setExportProjectId(e.target.value)}>
                  <option value="">{isAdmin ? t('export.allProjects') : t('export.allOwnProjects')}</option>
                  {exportProjects.map(p => <option key={p.id} value={p.id}>{p.reference} — {p.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('export.employee')}</label>
                <select style={{ ...inputStyle, width: 220 }} value={exportEmployeeId} onChange={e => setExportEmployeeId(e.target.value)}>
                  <option value="">{t('export.allEmployees')}</option>
                  {exportEmployees.map(u => <option key={u.id} value={u.id}>{`${u.firstName} ${u.lastName}`.trim()}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('export.category')}</label>
                <select style={{ ...inputStyle, width: 200 }} value={exportCategory} onChange={e => setExportCategory(e.target.value)}>
                  <option value="">{t('export.allCategories')}</option>
                  {FIDUCIARY_CATEGORIES.map(c => <option key={c} value={c}>{t(`export.categories.${c}`)}</option>)}
                </select>
              </div>
              <button style={btnPrimary} onClick={generateExport} disabled={exportLoading}>
                {exportLoading ? t('export.generating') : t('export.generate')}
              </button>
            </div>
          </div>

          {exportData && (() => {
            const file = exportData.files[exportFile];
            const data = file ? parseCsv(file.content) : [];
            const headers = file ? parseCsvHeader(file.content) : [];
            return (
              <div>
                {/* §17.7: one tab per file — Heures | Frais & Débours | Résumé projets */}
                <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 12 }}>
                  {FIDUCIARY_FILES.map(key => (
                    <button
                      key={key}
                      onClick={() => setExportFile(key)}
                      style={{
                        padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14,
                        fontWeight: exportFile === key ? 600 : 400,
                        color: exportFile === key ? '#2563eb' : '#6b7280',
                        borderBottom: exportFile === key ? '2px solid #2563eb' : '2px solid transparent',
                      }}
                    >
                      {t(`export.files.${key}`)} ({exportData.files[key]?.rowCount ?? 0})
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: '#6b7280' }}>{file?.filename}</span>
                  <button
                    style={{ ...btnOutline, fontSize: 12, padding: '4px 12px' }}
                    disabled={!file}
                    onClick={() => file && downloadCSV(file.content, file.filename)}
                  >
                    {t('export.downloadCsv')}
                  </button>
                </div>
                {data.length === 0 ? (
                  <p style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>{t('export.noData')}</p>
                ) : (
                  <>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto', maxHeight: 360 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
                          <tr>
                            {headers.map(h => (
                              <th key={h} style={thStyle} title={h}>{t(`export.columns.${h}`, { defaultValue: h })}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.slice(0, 100).map((row, ri) => (
                            <tr key={ri}>
                              {headers.map(col => (
                                <td key={col} style={{ ...tdStyle, fontSize: 13, whiteSpace: 'nowrap' }}>
                                  {col === 'categorie' && row[col]
                                    ? t(`export.categories.${row[col]}`, { defaultValue: row[col] })
                                    : row[col]}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {data.length > 100 && (
                      <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                        {t('export.truncated', { count: data.length })}
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable sub-components                                            */
/* ------------------------------------------------------------------ */

function Badge({ color, children }: { color: { bg: string; fg: string }; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 9999,
      fontSize: 12,
      fontWeight: 500,
      background: color.bg,
      color: color.fg,
    }}>
      {children}
    </span>
  );
}
