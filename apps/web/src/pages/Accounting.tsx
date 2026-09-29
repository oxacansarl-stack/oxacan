import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiList, apiPost, ApiError } from '../lib/api';
import { useCurrentUser } from '../lib/current-user';

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

/** GET /accounting/export/fiduciary → semicolon-separated CSV strings (UTF-8 BOM). */
interface FiduciaryExport {
  journalCsv: string;
  balanceCsv: string;
  clientCsv: string;
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

const TAB_LABELS: Record<Tab, string> = {
  accounts: 'Chart of Accounts',
  entries: 'Journal Entries',
  ledger: 'Ledger',
  export: 'Export',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

// Exact to the centime — ledger amounts must never be display-rounded.
const displayCHF = (cents: number): string => `CHF ${(cents / 100).toFixed(2)}`;

const displayAmount = (cents: number): string => (cents / 100).toFixed(2);

const errorMessage = (e: unknown, fallback: string): string =>
  e instanceof ApiError || e instanceof Error ? e.message || fallback : fallback;

const entryTotalDebit = (e: JournalEntry): number =>
  (e.lines ?? []).reduce((sum, l) => sum + (l.debitCents || 0), 0);

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
  // Project managers may only run the fiduciary export (PRD §3.2); the ledger is admin-only.
  const isAdmin = useCurrentUser().role === 'ADMIN';
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
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
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
      setError(errorMessage(e, 'Failed to load accounts'));
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
      setError(errorMessage(e, 'Failed to load entries'));
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
      setError(errorMessage(e, 'Failed to load ledger'));
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

  /* ============================================================ */
  /*  Account actions                                             */
  /* ============================================================ */

  const createAccount = async () => {
    if (!accountForm.accountNumber || !accountForm.name) {
      setError('Account number and name are required');
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
      setError(errorMessage(e, 'Failed to create account'));
    }
  };

  const seedDefaults = async () => {
    if (!confirm('Seed Swiss default chart of accounts? This will create standard accounts if they do not exist.')) return;
    try {
      await apiPost('/accounting/accounts/seed');
      fetchAccounts();
    } catch (e) {
      setError(errorMessage(e, 'Failed to seed defaults'));
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
      setEntryError('Date and description are required');
      return;
    }
    if (!isBalanced) {
      setEntryError('Debits and credits must be equal and greater than zero');
      return;
    }
    const hasEmpty = entryLines.some(l => !l.accountId);
    if (hasEmpty) {
      setEntryError('All lines must have an account selected');
      return;
    }
    const validAmount = (c: number) => Number.isInteger(c) && c >= 0;
    if (entryLines.some(l => !validAmount(l.debitCents) || !validAmount(l.creditCents))) {
      setEntryError('Amounts must be positive');
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
      setEntryError(errorMessage(e, 'Failed to create entry'));
    }
  };

  const postEntry = async (id: string) => {
    if (!confirm('Post this entry? This action is irreversible.')) return;
    try {
      await apiPost(`/accounting/entries/${id}/post`);
      fetchEntries();
    } catch (e) {
      setError(errorMessage(e, 'Failed to post entry'));
    }
  };

  /* ============================================================ */
  /*  Export actions                                               */
  /* ============================================================ */

  const generateExport = async () => {
    if (!exportDateFrom || !exportDateTo) {
      setError('Both dates are required for export');
      return;
    }
    setExportLoading(true);
    try {
      if (exportDateFrom > exportDateTo) {
        setError('"From" must not be after "To"');
        return;
      }
      const res = await apiGet<FiduciaryExport>(
        `/accounting/export/fiduciary?dateFrom=${encodeURIComponent(exportDateFrom)}&dateTo=${encodeURIComponent(exportDateTo)}`,
      );
      setExportData(res);
    } catch (e) {
      setError(errorMessage(e, 'Failed to generate export'));
    } finally {
      setExportLoading(false);
    }
  };

  /** Downloads the CSV exactly as generated by the API (semicolons, BOM, Swiss dates). */
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
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111827' }}>Accounting</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Chart of accounts, journal entries, ledger, and fiduciary export</p>
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
            {TAB_LABELS[tab]}
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
                {showAccountForm ? 'Cancel' : '+ New Account'}
              </button>
              <button style={btnWarning} onClick={seedDefaults}>
                Seed Swiss Defaults
              </button>
            </div>
          </div>

          {showAccountForm && (
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: 20, marginBottom: 20, border: '1px solid #e5e7eb' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>Create Account</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Account Number *</label>
                  <input
                    style={inputStyle}
                    value={accountForm.accountNumber}
                    onChange={e => setAccountForm(f => ({ ...f, accountNumber: e.target.value }))}
                    placeholder="1000"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Name *</label>
                  <input
                    style={inputStyle}
                    value={accountForm.name}
                    onChange={e => setAccountForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Account name"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Type</label>
                  <select
                    style={inputStyle}
                    value={accountForm.type}
                    onChange={e => setAccountForm(f => ({ ...f, type: e.target.value as Account['type'] }))}
                  >
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                    <option value="equity">Equity</option>
                    <option value="revenue">Revenue</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Parent Account</label>
                  <select
                    style={inputStyle}
                    value={accountForm.parentId}
                    onChange={e => setAccountForm(f => ({ ...f, parentId: e.target.value }))}
                  >
                    <option value="">None (top-level)</option>
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
                <button style={btnPrimary} onClick={createAccount}>Create Account</button>
                <button style={btnOutline} onClick={() => setShowAccountForm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {accountsLoading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>Loading accounts...</p>
          ) : flatAccounts.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>No accounts found. Seed Swiss defaults to get started.</p>
          ) : (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={thStyle}>Number</th>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>System</th>
                    <th style={thStyle}>Active</th>
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
                        <Badge color={ACCOUNT_TYPE_COLORS[a.type]}>{a.type}</Badge>
                      </td>
                      <td style={tdStyle}>
                        {a.isSystem && (
                          <span style={{ fontSize: 16 }} title="System account">
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
              {showEntryForm ? 'Cancel' : '+ New Entry'}
            </button>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>From</label>
              <input type="date" style={{ ...inputStyle, width: 160 }} value={entryDateFrom} onChange={e => { setEntryDateFrom(e.target.value); setEntriesPage(1); }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>To</label>
              <input type="date" style={{ ...inputStyle, width: 160 }} value={entryDateTo} onChange={e => { setEntryDateTo(e.target.value); setEntriesPage(1); }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Status</label>
              <select style={{ ...inputStyle, width: 140 }} value={entryPostedFilter} onChange={e => { setEntryPostedFilter(e.target.value as any); setEntriesPage(1); }}>
                <option value="">All</option>
                <option value="true">Posted</option>
                <option value="false">Unposted</option>
              </select>
            </div>
            <div style={{ alignSelf: 'flex-end' }}>
              <button style={btnOutline} onClick={fetchEntries}>Apply</button>
            </div>
          </div>

          {/* Create entry form */}
          {showEntryForm && (
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: 20, marginBottom: 20, border: '1px solid #e5e7eb' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>Create Journal Entry</h3>
              {entryError && (
                <div style={{ background: '#fee2e2', color: '#dc2626', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
                  {entryError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Date *</label>
                  <input
                    type="date"
                    style={inputStyle}
                    value={entryForm.entryDate}
                    onChange={e => setEntryForm(f => ({ ...f, entryDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Description *</label>
                  <input
                    style={inputStyle}
                    value={entryForm.description}
                    onChange={e => setEntryForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Entry description"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Reference Type</label>
                  <input
                    style={inputStyle}
                    value={entryForm.referenceType}
                    onChange={e => setEntryForm(f => ({ ...f, referenceType: e.target.value }))}
                    placeholder="e.g. invoice, receipt"
                  />
                </div>
              </div>

              {/* Lines */}
              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>Lines</h4>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ background: '#f3f4f6' }}>
                    <tr>
                      <th style={thStyle}>Account</th>
                      <th style={{ ...thStyle, width: 160, textAlign: 'right' }}>Debit (CHF)</th>
                      <th style={{ ...thStyle, width: 160, textAlign: 'right' }}>Credit (CHF)</th>
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
                            <option value="">Select account</option>
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
                      <td style={{ ...tdStyle, fontWeight: 600 }}>Total</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
                        {displayAmount(totalDebits)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
                        {displayAmount(totalCredits)}
                      </td>
                      <td style={tdStyle} />
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Balance indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <button style={btnOutline} onClick={addEntryLine}>+ Add Line</button>
                <span style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: totalDebits === 0 && totalCredits === 0 ? '#6b7280' : isBalanced ? '#16a34a' : '#dc2626',
                }}>
                  {totalDebits === 0 && totalCredits === 0
                    ? 'Enter amounts'
                    : isBalanced
                      ? 'Balanced'
                      : `Unbalanced: difference ${displayCHF(Math.abs(totalDebits - totalCredits))}`
                  }
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnPrimary} onClick={createEntry} disabled={!isBalanced}>Create Entry</button>
                <button style={btnOutline} onClick={() => setShowEntryForm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {/* Entries table */}
          {entriesLoading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>Loading entries...</p>
          ) : entries.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>No journal entries found</p>
          ) : (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={thStyle}>Entry #</th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Description</th>
                    <th style={thStyle}>Reference</th>
                    <th style={thStyle}>Posted</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.id}>
                      <td style={{ ...tdStyle, fontWeight: 600, fontFamily: 'monospace' }}>{e.entryNumber || e.id.slice(0, 8)}</td>
                      <td style={tdStyle}>{new Date(e.entryDate).toLocaleDateString()}</td>
                      <td style={tdStyle}>{e.description}</td>
                      <td style={tdStyle}>{e.referenceType || '-'}</td>
                      <td style={tdStyle}>
                        <span style={{ color: e.isPosted ? '#16a34a' : '#6b7280', fontWeight: 600, fontSize: 16 }}>
                          {e.isPosted ? '✓' : '—'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                        {displayCHF(entryTotalDebit(e))}
                      </td>
                      <td style={tdStyle}>
                        {!e.isPosted && (
                          <button
                            style={{ ...btnSuccess, padding: '4px 10px', fontSize: 12 }}
                            onClick={() => postEntry(e.id)}
                          >
                            Post
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
                Previous
              </button>
              <span style={{ padding: '8px 12px', fontSize: 14, color: '#6b7280' }}>
                Page {entriesPage} of {entriesTotalPages}
              </span>
              <button style={btnOutline} disabled={entriesPage >= entriesTotalPages} onClick={() => setEntriesPage(p => p + 1)}>
                Next
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
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Account *</label>
              <select
                style={inputStyle}
                value={ledgerAccountId}
                onChange={e => setLedgerAccountId(e.target.value)}
              >
                <option value="">Select account</option>
                {flatAccounts.map(({ account: a, depth }) => (
                  <option key={a.id} value={a.id}>
                    {' '.repeat(depth * 2)}{a.accountNumber} - {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>From</label>
              <input type="date" style={{ ...inputStyle, width: 160 }} value={ledgerDateFrom} onChange={e => setLedgerDateFrom(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>To</label>
              <input type="date" style={{ ...inputStyle, width: 160 }} value={ledgerDateTo} onChange={e => setLedgerDateTo(e.target.value)} />
            </div>
            <button style={btnPrimary} onClick={fetchLedger} disabled={!ledgerAccountId}>
              Load Ledger
            </button>
          </div>

          {ledgerLoading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>Loading ledger...</p>
          ) : !ledgerAccountId ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Select an account to view its ledger</p>
          ) : ledgerEntries.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>No ledger entries for this account</p>
          ) : (
            <>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ background: '#f9fafb' }}>
                    <tr>
                      <th style={thStyle}>Date</th>
                      <th style={thStyle}>Entry #</th>
                      <th style={thStyle}>Description</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Debit</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Credit</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerEntries.map((entry, idx) => (
                      <tr key={`${entry.entryNumber}-${idx}`}>
                        <td style={tdStyle}>{new Date(entry.entryDate).toLocaleDateString()}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{entry.entryNumber}</td>
                        <td style={tdStyle}>{entry.description}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                          {entry.debitCents > 0 ? displayAmount(entry.debitCents) : ''}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                          {entry.creditCents > 0 ? displayAmount(entry.creditCents) : ''}
                        </td>
                        <td style={{
                          ...tdStyle,
                          textAlign: 'right',
                          fontWeight: 600,
                          fontFamily: 'monospace',
                          color: entry.balanceCents < 0 ? '#dc2626' : '#111827',
                        }}>
                          {displayCHF(entry.balanceCents)}
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
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#0369a1' }}>Closing Balance</span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: '#111827' }}>
                    {displayCHF(ledgerEntries[ledgerEntries.length - 1].balanceCents)}
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
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Fiduciary Export</h3>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Generate CSV files for your fiduciary. Select a date range and click Generate.
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>From *</label>
                <input type="date" style={{ ...inputStyle, width: 180 }} value={exportDateFrom} onChange={e => setExportDateFrom(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>To *</label>
                <input type="date" style={{ ...inputStyle, width: 180 }} value={exportDateTo} onChange={e => setExportDateTo(e.target.value)} />
              </div>
              <button style={btnPrimary} onClick={generateExport} disabled={exportLoading}>
                {exportLoading ? 'Generating...' : 'Generate Export'}
              </button>
            </div>
          </div>

          {exportData && (
            <div>
              {/* Render each CSV dataset */}
              {(() => {
                const datasets: { key: string; label: string; csv: string; data: Record<string, string>[] }[] = [];
                const sources: [string, string, string][] = [
                  ['journal', 'Journal', exportData.journalCsv],
                  ['balance', 'Balance', exportData.balanceCsv],
                  ['clients', 'Clients', exportData.clientCsv],
                ];
                sources.forEach(([key, label, csv]) => {
                  const data = csv ? parseCsv(csv) : [];
                  if (data.length > 0) datasets.push({ key, label, csv, data });
                });

                if (datasets.length === 0) {
                  return <p style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>No data to export</p>;
                }

                return datasets.map(ds => (
                  <div key={ds.key} style={{ marginBottom: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#111827' }}>{ds.label}</h4>
                      <button
                        style={{ ...btnOutline, fontSize: 12, padding: '4px 12px' }}
                        onClick={() => downloadCSV(ds.csv, `${ds.key}_${exportDateFrom}_${exportDateTo}.csv`)}
                      >
                        Download CSV
                      </button>
                    </div>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto', maxHeight: 320 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
                          <tr>
                            {Object.keys(ds.data[0]).map(h => (
                              <th key={h} style={thStyle}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ds.data.slice(0, 100).map((row, ri) => (
                            <tr key={ri}>
                              {Object.values(row).map((val, ci) => (
                                <td key={ci} style={{ ...tdStyle, fontSize: 13, whiteSpace: 'nowrap' }}>
                                  {val == null ? '' : String(val)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {ds.data.length > 100 && (
                      <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                        Showing first 100 of {ds.data.length} rows. Download CSV for full data.
                      </p>
                    )}
                  </div>
                ));
              })()}
            </div>
          )}
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
      textTransform: 'capitalize',
    }}>
      {children}
    </span>
  );
}
