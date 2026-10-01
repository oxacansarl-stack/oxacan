import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { apiGet, apiList, apiPost } from '../lib/api';
import { useCurrentUser } from '../lib/current-user';
import { errorMessage } from '../lib/errors';
import { enumLabel, formatAmount, formatDate, formatMoney } from '../lib/format';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardCount, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge, Tag } from '@/components/ui/badge';
import { DataState, EmptyState } from '@/components/states';
import { useConfirm } from '@/components/confirm-dialog';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TabCount, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Ref, TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

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

/** Row of GET /accounting/trial-balance → { asOfDate, accounts, totals, isBalanced }. */
interface TrialBalanceRow {
  accountId: string;
  accountNumber: string;
  accountName: string;
  accountType: string;
  totalDebitCents: number;
  totalCreditCents: number;
  balanceCents: number;
}

interface TrialBalance {
  asOfDate: string;
  accounts: TrialBalanceRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  isBalanced: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TABS = ['accounts', 'entries', 'ledger', 'balance', 'export'] as const;
type Tab = typeof TABS[number];

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

/** §17.4 expense categories, as written in the CSV. */
const FIDUCIARY_CATEGORIES = ['materiel', 'deplacement', 'equipement', 'sous-traitance', 'divers'] as const;

/** §17.7 period selection. */
const PERIOD_TYPES = ['month', 'quarter', 'year', 'custom'] as const;
type PeriodType = typeof PERIOD_TYPES[number];

/**
 * Chart-of-accounts indentation as literal utility classes — the depth is data, but the
 * spacing must stay in the design system rather than become an inline style.
 */
const INDENT = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16'] as const;
const indentClass = (depth: number) => INDENT[Math.min(depth, INDENT.length - 1)];

/** A native <option> collapses plain spaces, so the picker indents with non-breaking ones. */
const NBSP = '\u00A0';

const BLANK_ACCOUNT_FORM = {
  accountNumber: '',
  name: '',
  type: 'asset' as Account['type'],
  parentId: '',
};

const blankEntryLines = (): JournalEntryLine[] => [
  { accountId: '', debitCents: 0, creditCents: 0 },
  { accountId: '', debitCents: 0, creditCents: 0 },
];

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
  const first = csv.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  return first ? first.split(';') : [];
}

/** Parses the API's semicolon-separated CSV (optional BOM, "quoted" fields) for preview. */
function parseCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const text = csv.replace(/^﻿/, '');
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

/** Parent-first order with the nesting depth of each account, for the indented list. */
function flattenAccounts(items: Account[]): { account: Account; depth: number }[] {
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
    return [...items]
      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
      .map(a => ({ account: a, depth: 0 }));
  }
  return result;
}

/** Downloads the CSV exactly as generated by the API (UTF-8 BOM, semicolons, CRLF, ISO dates). */
function downloadCSV(csv: string, filename: string) {
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
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Accounting() {
  const { t } = useTranslation('accounting');
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  // Project managers may only run the fiduciary export (PRD §3.2); the rest is admin-only.
  const currentUser = useCurrentUser();
  const isAdmin = currentUser.role === 'ADMIN';
  const visibleTabs: readonly Tab[] = isAdmin ? TABS : ['export'];

  /** Failures of a row action (post, seed): shown in the card, never as window.alert. */
  const [actionAlert, setActionAlert] = useState<string | null>(null);

  // The open tab lives in ?tab=, so a section can be linked to and survives a reload.
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') ?? '';
  const activeTab: Tab = (visibleTabs as readonly string[]).includes(requested)
    ? (requested as Tab)
    : visibleTabs[0];
  const selectTab = (value: string) => {
    setActionAlert(null);
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: true });
  };

  /* ============================================================ */
  /*  Chart of accounts                                           */
  /* ============================================================ */
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [accountForm, setAccountForm] = useState(BLANK_ACCOUNT_FORM);
  const [accountFormError, setAccountFormError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['accounting', 'accounts'],
    queryFn: async () => {
      const items = await apiGet<Account[]>('/accounting/accounts?limit=500');
      return Array.isArray(items) ? items : [];
    },
    // The chart also feeds the entry lines and the ledger picker.
    enabled: isAdmin && (activeTab === 'accounts' || activeTab === 'entries' || activeTab === 'ledger'),
    retry: false,
  });

  const flatAccounts = useMemo(() => flattenAccounts(accountsQuery.data ?? []), [accountsQuery.data]);

  /* ============================================================ */
  /*  Journal entries                                             */
  /* ============================================================ */
  const [entriesPage, setEntriesPage] = useState(1);
  const [entryDateFrom, setEntryDateFrom] = useState('');
  const [entryDateTo, setEntryDateTo] = useState('');
  const [entryPostedFilter, setEntryPostedFilter] = useState<'' | 'true' | 'false'>('');
  const [entryFormOpen, setEntryFormOpen] = useState(false);
  const [entryForm, setEntryForm] = useState({
    entryDate: new Date().toISOString().slice(0, 10),
    description: '',
    referenceType: '',
  });
  const [entryLines, setEntryLines] = useState<JournalEntryLine[]>(blankEntryLines);
  const [entryError, setEntryError] = useState<string | null>(null);

  const entriesQuery = useQuery({
    queryKey: ['accounting', 'entries', entriesPage, entryDateFrom, entryDateTo, entryPostedFilter],
    queryFn: () => {
      let path = `/accounting/entries?page=${entriesPage}`;
      if (entryDateFrom) path += `&dateFrom=${entryDateFrom}`;
      if (entryDateTo) path += `&dateTo=${entryDateTo}`;
      if (entryPostedFilter) path += `&isPosted=${entryPostedFilter}`;
      return apiList<JournalEntry>(path);
    },
    enabled: isAdmin && activeTab === 'entries',
    retry: false,
  });

  const entries = entriesQuery.data?.items ?? [];
  const entriesTotalPages = Math.max(1, entriesQuery.data?.meta?.totalPages ?? 1);

  /* ============================================================ */
  /*  Ledger — loaded on demand, never on account change alone     */
  /* ============================================================ */
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [ledgerDateFrom, setLedgerDateFrom] = useState('');
  const [ledgerDateTo, setLedgerDateTo] = useState('');
  const [ledgerRequest, setLedgerRequest] = useState<
    { accountId: string; dateFrom: string; dateTo: string; run: number } | null
  >(null);
  const ledgerRun = useRef(0);

  const ledgerQuery = useQuery({
    queryKey: ['accounting', 'ledger', ledgerRequest],
    queryFn: async () => {
      const req = ledgerRequest!;
      let path = `/accounting/ledger/${req.accountId}`;
      const search: string[] = [];
      if (req.dateFrom) search.push(`dateFrom=${req.dateFrom}`);
      if (req.dateTo) search.push(`dateTo=${req.dateTo}`);
      if (search.length) path += '?' + search.join('&');
      const res = await apiGet<{ accountId: string; entries: LedgerEntry[] }>(path);
      return res?.entries ?? [];
    },
    enabled: isAdmin && activeTab === 'ledger' && ledgerRequest !== null,
    retry: false,
  });

  const ledgerEntries = ledgerQuery.data ?? [];
  /**
   * The closing-balance strip reads the last row. `DataState` takes its children as a built
   * node, so they are evaluated before it can short-circuit on loading/error/empty — the row
   * has to be looked up here and the strip guarded on it existing.
   */
  const lastLedgerEntry = ledgerEntries.at(-1);

  /* ============================================================ */
  /*  Trial balance                                               */
  /* ============================================================ */
  const [balanceAsOf, setBalanceAsOf] = useState('');

  const balanceQuery = useQuery({
    queryKey: ['accounting', 'trial-balance', balanceAsOf],
    queryFn: () =>
      apiGet<TrialBalance>(
        `/accounting/trial-balance${balanceAsOf ? `?asOfDate=${balanceAsOf}` : ''}`,
      ),
    enabled: isAdmin && activeTab === 'balance',
    retry: false,
  });

  const balanceRows = balanceQuery.data?.accounts ?? [];

  /* ============================================================ */
  /*  Fiduciary export                                            */
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
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportRequest, setExportRequest] = useState<
    { dateFrom: string; dateTo: string; projectId: string; employeeId: string; category: string; run: number } | null
  >(null);
  const exportRun = useRef(0);

  // Filter options: a project manager only picks among their own projects (§17.6).
  const exportProjectsQuery = useQuery({
    queryKey: ['accounting', 'export-projects', isAdmin, currentUser.id],
    queryFn: async () => {
      const path = isAdmin
        ? '/projects?limit=100'
        : `/projects?limit=100&managerId=${encodeURIComponent(currentUser.id)}`;
      const items = await apiGet<ExportProject[]>(path);
      return Array.isArray(items) ? items : [];
    },
    enabled: activeTab === 'export',
    retry: false,
  });

  const exportEmployeesQuery = useQuery({
    queryKey: ['accounting', 'export-employees'],
    queryFn: async () => {
      const items = await apiGet<ExportEmployee[]>('/hr/employees?limit=200');
      return Array.isArray(items) ? items : [];
    },
    enabled: activeTab === 'export',
    retry: false,
  });

  const exportQuery = useQuery({
    queryKey: ['accounting', 'fiduciary-export', exportRequest],
    queryFn: () => {
      const req = exportRequest!;
      const search = new URLSearchParams({ dateFrom: req.dateFrom, dateTo: req.dateTo });
      if (req.projectId) search.set('projectId', req.projectId);
      if (req.employeeId) search.set('employeeId', req.employeeId);
      if (req.category) search.set('category', req.category);
      return apiGet<FiduciaryExport>(`/accounting/export/fiduciary?${search.toString()}`);
    },
    enabled: activeTab === 'export' && exportRequest !== null,
    retry: false,
  });

  const exportData = exportQuery.data ?? null;

  /** Each file parsed once per export, so switching file tabs never re-parses the CSV. */
  const previews = useMemo(() => {
    const out = {} as Record<
      FiduciaryFileKey,
      { file?: FiduciaryCsvFile; headers: string[]; rows: Record<string, string>[] }
    >;
    for (const key of FIDUCIARY_FILES) {
      const file = exportData?.files?.[key];
      out[key] = {
        file,
        headers: file ? parseCsvHeader(file.content) : [],
        rows: file ? parseCsv(file.content) : [],
      };
    }
    return out;
  }, [exportData]);

  /* ============================================================ */
  /*  Mutations                                                   */
  /* ============================================================ */

  const createAccount = useMutation({
    mutationFn: (form: typeof accountForm) =>
      apiPost('/accounting/accounts', {
        accountNumber: form.accountNumber.trim(),
        name: form.name.trim(),
        type: form.type,
        ...(form.parentId ? { parentId: form.parentId } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting', 'accounts'] });
      setAccountFormOpen(false);
      setAccountForm(BLANK_ACCOUNT_FORM);
      setAccountFormError(null);
    },
  });

  const seedAccounts = useMutation({
    mutationFn: () => apiPost('/accounting/accounts/seed'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounting', 'accounts'] }),
    onError: (e) => setActionAlert(errorMessage(e, t('errors.seedDefaults'))),
  });

  const createEntry = useMutation({
    mutationFn: (payload: { form: typeof entryForm; lines: JournalEntryLine[] }) =>
      apiPost('/accounting/entries', {
        entryDate: payload.form.entryDate,
        description: payload.form.description.trim(),
        ...(payload.form.referenceType.trim() ? { referenceType: payload.form.referenceType.trim() } : {}),
        lines: payload.lines.map(l => ({
          accountId: l.accountId,
          debitCents: l.debitCents,
          creditCents: l.creditCents,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting', 'entries'] });
      queryClient.invalidateQueries({ queryKey: ['accounting', 'trial-balance'] });
      setEntryFormOpen(false);
      setEntryForm({ entryDate: new Date().toISOString().slice(0, 10), description: '', referenceType: '' });
      setEntryLines(blankEntryLines());
      setEntryError(null);
    },
    onError: (e) => setEntryError(errorMessage(e, t('errors.createEntry'))),
  });

  const postEntry = useMutation({
    mutationFn: (id: string) => apiPost(`/accounting/entries/${id}/post`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting', 'entries'] });
      queryClient.invalidateQueries({ queryKey: ['accounting', 'trial-balance'] });
    },
    onError: (e) => setActionAlert(errorMessage(e, t('errors.postEntry'))),
  });

  /* ============================================================ */
  /*  Account actions                                             */
  /* ============================================================ */

  const openAccountForm = () => {
    setAccountForm(BLANK_ACCOUNT_FORM);
    setAccountFormError(null);
    createAccount.reset();
    setAccountFormOpen(true);
  };

  const submitAccount = () => {
    setAccountFormError(null);
    if (!accountForm.accountNumber || !accountForm.name) {
      setAccountFormError(t('validation.accountRequired'));
      return;
    }
    createAccount.mutate(accountForm);
  };

  const handleSeedDefaults = async () => {
    setActionAlert(null);
    const ok = await confirm({
      title: t('confirm.seedDefaults.title'),
      description: t('confirm.seedDefaults.description'),
      confirmLabel: t('confirm.seedDefaults.confirm'),
      tone: 'default',
    });
    if (!ok) return;
    seedAccounts.mutate();
  };

  /* ============================================================ */
  /*  Journal entry actions                                       */
  /* ============================================================ */

  const openEntryForm = () => {
    setEntryError(null);
    createEntry.reset();
    setEntryFormOpen(true);
  };

  const addEntryLine = () => {
    setEntryLines(prev => [...prev, { accountId: '', debitCents: 0, creditCents: 0 }]);
  };

  const removeEntryLine = (idx: number) => {
    setEntryLines(prev => prev.filter((_, i) => i !== idx));
  };

  const setLineAccount = (idx: number, accountId: string) => {
    setEntryLines(prev => prev.map((l, i) => (i === idx ? { ...l, accountId } : l)));
  };

  const setLineAmount = (idx: number, field: 'debitCents' | 'creditCents', cents: number) => {
    setEntryLines(prev => prev.map((l, i) => (i === idx ? { ...l, [field]: cents } : l)));
  };

  const totalDebits = entryLines.reduce((sum, l) => sum + l.debitCents, 0);
  const totalCredits = entryLines.reduce((sum, l) => sum + l.creditCents, 0);
  const isBalanced = totalDebits === totalCredits && totalDebits > 0;

  const submitEntry = () => {
    setEntryError(null);
    if (!entryForm.entryDate || !entryForm.description) {
      setEntryError(t('validation.entryRequired'));
      return;
    }
    if (!isBalanced) {
      setEntryError(t('validation.unbalanced'));
      return;
    }
    if (entryLines.some(l => !l.accountId)) {
      setEntryError(t('validation.lineAccount'));
      return;
    }
    const validAmount = (c: number) => Number.isInteger(c) && c >= 0;
    if (entryLines.some(l => !validAmount(l.debitCents) || !validAmount(l.creditCents))) {
      setEntryError(t('validation.positiveAmounts'));
      return;
    }
    createEntry.mutate({ form: entryForm, lines: entryLines });
  };

  /** The one entry whose posting is in flight, so only its own button says "Comptabilisation…". */
  const postingEntryId = postEntry.isPending ? postEntry.variables : undefined;

  const handlePostEntry = async (id: string) => {
    setActionAlert(null);
    const ok = await confirm({
      title: t('confirm.postEntry.title'),
      description: t('confirm.postEntry.description'),
      confirmLabel: t('confirm.postEntry.confirm'),
      tone: 'default',
    });
    if (!ok) return;
    postEntry.mutate(id);
  };

  /* ============================================================ */
  /*  Ledger & export actions                                     */
  /* ============================================================ */

  const loadLedger = () => {
    if (!ledgerAccountId) return;
    ledgerRun.current += 1;
    setLedgerRequest({
      accountId: ledgerAccountId,
      dateFrom: ledgerDateFrom,
      dateTo: ledgerDateTo,
      run: ledgerRun.current,
    });
  };

  const generateExport = () => {
    setExportError(null);
    const range = periodRange(
      exportPeriodType, exportMonth, exportQuarter, exportYear, exportDateFrom, exportDateTo,
    );
    if (!range) {
      setExportError(t('validation.exportDates'));
      return;
    }
    const [from, to] = range;
    if (from > to) {
      setExportError(t('validation.exportRange'));
      return;
    }
    exportRun.current += 1;
    setExportRequest({
      dateFrom: from,
      dateTo: to,
      projectId: exportProjectId,
      employeeId: exportEmployeeId,
      category: exportCategory,
      run: exportRun.current,
    });
  };

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  const accountOptions = flatAccounts.map(({ account: a, depth }) => (
    <option key={a.id} value={a.id}>
      {NBSP.repeat(depth * 2)}{a.accountNumber} — {a.name}
    </option>
  ));

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        kicker={t('common:navGroup.finance')}
        meta={<span>{isAdmin ? t('subtitle') : t('subtitleExportOnly')}</span>}
      />

      <Tabs value={activeTab} onValueChange={selectTab} className="grid gap-5">
        {visibleTabs.length > 1 ? (
          <TabsList aria-label={t('tabsLabel')}>
            {visibleTabs.map(tab => (
              <TabsTrigger key={tab} value={tab}>
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        ) : null}

        {/* ============================================================ */}
        {/*  PLAN COMPTABLE — admin only                                 */}
        {/* ============================================================ */}
        {isAdmin ? (
          <TabsContent value="accounts">
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('tabs.accounts')}
                  <CardCount>{flatAccounts.length}</CardCount>
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={openAccountForm}>
                    <Plus />
                    {t('accounts.newAccount')}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t('accounts.moreActions')}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        disabled={seedAccounts.isPending}
                        onSelect={() => {
                          void handleSeedDefaults();
                        }}
                      >
                        <Sparkles />
                        {t('accounts.seedDefaults')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>

              {actionAlert ? (
                <p role="alert" className="border-b border-line-soft px-3.5 py-2.5 text-[13px] text-bad">
                  {actionAlert}
                </p>
              ) : null}

              <DataState
                isLoading={accountsQuery.isPending}
                error={accountsQuery.isError ? errorMessage(accountsQuery.error, t('errors.loadAccounts')) : null}
                onRetry={() => accountsQuery.refetch()}
                isEmpty={flatAccounts.length === 0}
                empty={
                  <EmptyState
                    title={t('accounts.empty')}
                    description={t('accounts.emptyHelp')}
                    action={
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={seedAccounts.isPending}
                        onClick={() => {
                          void handleSeedDefaults();
                        }}
                      >
                        <Sparkles />
                        {t('accounts.seedDefaults')}
                      </Button>
                    }
                  />
                }
              >
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>{t('accounts.table.number')}</TH>
                        <TH>{t('accounts.table.name')}</TH>
                        <TH>{t('accounts.table.type')}</TH>
                        <TH>{t('accounts.table.system')}</TH>
                        <TH>{t('accounts.table.active')}</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {flatAccounts.map(({ account: a, depth }) => (
                        <TR key={a.id}>
                          <TD>
                            <Ref className={cn('font-medium', indentClass(depth))}>{a.accountNumber}</Ref>
                          </TD>
                          <TD>
                            <span className={cn('font-medium', indentClass(depth))}>{a.name}</span>
                          </TD>
                          <TD>
                            <Tag>{enumLabel('accountType', a.type)}</Tag>
                          </TD>
                          <TD>
                            {a.isSystem ? (
                              <span className="inline-flex items-center text-muted" title={t('accounts.systemAccount')}>
                                <Lock aria-hidden className="size-3.5" />
                                <span className="sr-only">{t('accounts.systemAccount')}</span>
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </TD>
                          <TD>
                            {a.isActive ? (
                              <Badge tone="ok">{t('accounts.statusActive')}</Badge>
                            ) : (
                              <Badge tone="neutral">{t('accounts.statusInactive')}</Badge>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
                <CardFooter>
                  <span>{t('accounts.count', { count: flatAccounts.length })}</span>
                  <span>{t('accounts.hierarchy')}</span>
                </CardFooter>
              </DataState>
            </Card>
          </TabsContent>
        ) : null}

        {/* ============================================================ */}
        {/*  ÉCRITURES — admin only                                      */}
        {/* ============================================================ */}
        {isAdmin ? (
          <TabsContent value="entries">
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('tabs.entries')}
                  <CardCount>{entries.length}</CardCount>
                </CardTitle>
                <Button variant="primary" onClick={openEntryForm}>
                  <Plus />
                  {t('entries.newEntry')}
                </Button>
              </CardHeader>

              <div className="flex flex-wrap items-end gap-2.5 border-b border-line-soft p-3">
                <Field className="w-[150px]" label={t('entries.from')} htmlFor="accounting-entries-from">
                  <Input
                    id="accounting-entries-from"
                    type="date"
                    value={entryDateFrom}
                    onChange={e => { setEntryDateFrom(e.target.value); setEntriesPage(1); }}
                  />
                </Field>
                <Field className="w-[150px]" label={t('entries.to')} htmlFor="accounting-entries-to">
                  <Input
                    id="accounting-entries-to"
                    type="date"
                    value={entryDateTo}
                    onChange={e => { setEntryDateTo(e.target.value); setEntriesPage(1); }}
                  />
                </Field>
                <Field className="w-[200px]" label={t('entries.status')} htmlFor="accounting-entries-status">
                  <Select
                    id="accounting-entries-status"
                    value={entryPostedFilter}
                    onChange={e => {
                      setEntryPostedFilter(e.target.value as '' | 'true' | 'false');
                      setEntriesPage(1);
                    }}
                  >
                    <option value="">{t('entries.all')}</option>
                    <option value="true">{t('entries.posted')}</option>
                    <option value="false">{t('entries.unposted')}</option>
                  </Select>
                </Field>
                <Button onClick={() => entriesQuery.refetch()}>{t('entries.apply')}</Button>
              </div>

              {actionAlert ? (
                <p role="alert" className="border-b border-line-soft px-3.5 py-2.5 text-[13px] text-bad">
                  {actionAlert}
                </p>
              ) : null}

              <DataState
                isLoading={entriesQuery.isPending}
                error={entriesQuery.isError ? errorMessage(entriesQuery.error, t('errors.loadEntries')) : null}
                onRetry={() => entriesQuery.refetch()}
                isEmpty={entries.length === 0}
                empty={<EmptyState title={t('entries.empty')} description={t('entries.emptyHelp')} />}
              >
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>{t('entries.table.entryNumber')}</TH>
                        <TH>{t('entries.table.date')}</TH>
                        <TH>{t('entries.table.description')}</TH>
                        <TH>{t('entries.table.reference')}</TH>
                        <TH>{t('entries.table.posted')}</TH>
                        <TH numeric>{t('entries.table.total')}</TH>
                        <TH>{t('entries.table.actions')}</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {entries.map(e => (
                        <TR key={e.id}>
                          <TD>
                            <Ref>{e.entryNumber || e.id.slice(0, 8)}</Ref>
                          </TD>
                          <TD className="tnum">{formatDate(e.entryDate)}</TD>
                          <TD className="font-medium">{e.description}</TD>
                          <TD className="text-muted">{e.referenceType || '—'}</TD>
                          <TD>
                            {e.isPosted ? (
                              <Badge tone="ok">{t('entries.isPosted')}</Badge>
                            ) : (
                              <Badge tone="neutral">{t('entries.notPosted')}</Badge>
                            )}
                          </TD>
                          <TD numeric className="font-medium">{formatMoney(entryTotalDebit(e))}</TD>
                          <TD>
                            {e.isPosted ? (
                              <span className="text-muted">—</span>
                            ) : (
                              <Button
                                size="sm"
                                disabled={postEntry.isPending}
                                onClick={() => {
                                  void handlePostEntry(e.id);
                                }}
                              >
                                {postingEntryId === e.id ? t('entries.posting') : t('entries.post')}
                              </Button>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
                <CardFooter>
                  <span>{t('entries.count', { count: entries.length })}</span>
                  {entriesTotalPages > 1 ? (
                    <span className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={t('common:actions.previous')}
                        disabled={entriesPage <= 1}
                        onClick={() => setEntriesPage(p => Math.max(1, p - 1))}
                      >
                        <ChevronLeft />
                      </Button>
                      <span className="tnum">
                        {t('common:state.page', { page: entriesPage, total: entriesTotalPages })}
                      </span>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={t('common:actions.next')}
                        disabled={entriesPage >= entriesTotalPages}
                        onClick={() => setEntriesPage(p => p + 1)}
                      >
                        <ChevronRight />
                      </Button>
                    </span>
                  ) : (
                    <span>{t('entries.sortedBy')}</span>
                  )}
                </CardFooter>
              </DataState>
            </Card>
          </TabsContent>
        ) : null}

        {/* ============================================================ */}
        {/*  GRAND LIVRE — admin only                                    */}
        {/* ============================================================ */}
        {isAdmin ? (
          <TabsContent value="ledger">
            <Card>
              <CardHeader>
                <CardTitle>{t('tabs.ledger')}</CardTitle>
              </CardHeader>

              <div className="flex flex-wrap items-end gap-2.5 border-b border-line-soft p-3">
                <Field
                  className="min-w-[220px] flex-1"
                  label={t('ledger.account')}
                  htmlFor="accounting-ledger-account"
                  required
                >
                  <Select
                    id="accounting-ledger-account"
                    value={ledgerAccountId}
                    onChange={e => setLedgerAccountId(e.target.value)}
                  >
                    <option value="">{t('ledger.selectAccount')}</option>
                    {accountOptions}
                  </Select>
                </Field>
                <Field className="w-[150px]" label={t('ledger.from')} htmlFor="accounting-ledger-from">
                  <Input
                    id="accounting-ledger-from"
                    type="date"
                    value={ledgerDateFrom}
                    onChange={e => setLedgerDateFrom(e.target.value)}
                  />
                </Field>
                <Field className="w-[150px]" label={t('ledger.to')} htmlFor="accounting-ledger-to">
                  <Input
                    id="accounting-ledger-to"
                    type="date"
                    value={ledgerDateTo}
                    onChange={e => setLedgerDateTo(e.target.value)}
                  />
                </Field>
                <Button
                  variant="primary"
                  blockedReason={ledgerAccountId ? undefined : t('ledger.loadBlocked')}
                  onClick={loadLedger}
                >
                  {t('ledger.load')}
                </Button>
              </div>

              {ledgerRequest === null ? (
                <EmptyState title={t('ledger.selectPrompt')} description={t('ledger.selectPromptHelp')} />
              ) : (
                <DataState
                  isLoading={ledgerQuery.isPending}
                  error={ledgerQuery.isError ? errorMessage(ledgerQuery.error, t('errors.loadLedger')) : null}
                  onRetry={() => ledgerQuery.refetch()}
                  isEmpty={ledgerEntries.length === 0}
                  empty={<EmptyState title={t('ledger.empty')} description={t('ledger.emptyHelp')} />}
                >
                  <TableWrap>
                    <Table>
                      <THead>
                        <tr>
                          <TH>{t('ledger.table.date')}</TH>
                          <TH>{t('ledger.table.entryNumber')}</TH>
                          <TH>{t('ledger.table.description')}</TH>
                          <TH numeric>{t('ledger.table.debit')}</TH>
                          <TH numeric>{t('ledger.table.credit')}</TH>
                          <TH numeric>{t('ledger.table.balance')}</TH>
                        </tr>
                      </THead>
                      <TBody>
                        {ledgerEntries.map((entry, idx) => (
                          <TR key={`${entry.entryNumber}-${idx}`}>
                            <TD className="tnum">{formatDate(entry.entryDate)}</TD>
                            <TD>
                              <Ref>{entry.entryNumber}</Ref>
                            </TD>
                            <TD>{entry.description}</TD>
                            <TD numeric>{entry.debitCents > 0 ? formatAmount(entry.debitCents) : ''}</TD>
                            <TD numeric>{entry.creditCents > 0 ? formatAmount(entry.creditCents) : ''}</TD>
                            <TD numeric className={cn('font-medium', entry.balanceCents < 0 && 'text-bad')}>
                              {formatMoney(entry.balanceCents)}
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </TableWrap>

                  {lastLedgerEntry ? (
                    <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line-soft bg-paper-2 px-3.5 py-3">
                      <span className="text-[13px] font-medium text-muted">{t('ledger.closingBalance')}</span>
                      <span
                        className={cn(
                          'tnum font-display text-xl font-semibold',
                          lastLedgerEntry.balanceCents < 0 && 'text-bad',
                        )}
                      >
                        {formatMoney(lastLedgerEntry.balanceCents)}
                      </span>
                    </div>
                  ) : null}
                  <CardFooter>
                    <span>{t('ledger.count', { count: ledgerEntries.length })}</span>
                  </CardFooter>
                </DataState>
              )}
            </Card>
          </TabsContent>
        ) : null}

        {/* ============================================================ */}
        {/*  BALANCE — admin only                                        */}
        {/* ============================================================ */}
        {isAdmin ? (
          <TabsContent value="balance">
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('balance.title')}
                  <CardCount>{balanceRows.length}</CardCount>
                </CardTitle>
              </CardHeader>

              <div className="flex flex-wrap items-end justify-between gap-2.5 border-b border-line-soft p-3">
                <Field
                  className="w-[190px]"
                  label={t('balance.asOfDate')}
                  htmlFor="accounting-balance-asof"
                  hint={t('balance.asOfHint')}
                >
                  <Input
                    id="accounting-balance-asof"
                    type="date"
                    value={balanceAsOf}
                    onChange={e => setBalanceAsOf(e.target.value)}
                  />
                </Field>
                <p className="max-w-[46ch] text-[13px] text-muted">{t('balance.help')}</p>
              </div>

              <DataState
                isLoading={balanceQuery.isPending}
                error={balanceQuery.isError ? errorMessage(balanceQuery.error, t('errors.loadTrialBalance')) : null}
                onRetry={() => balanceQuery.refetch()}
                isEmpty={balanceRows.length === 0}
                empty={<EmptyState title={t('balance.empty')} description={t('balance.emptyHelp')} />}
              >
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>{t('balance.table.number')}</TH>
                        <TH>{t('balance.table.name')}</TH>
                        <TH>{t('balance.table.type')}</TH>
                        <TH numeric>{t('balance.table.debit')}</TH>
                        <TH numeric>{t('balance.table.credit')}</TH>
                        <TH numeric>{t('balance.table.balance')}</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {balanceRows.map(row => (
                        <TR key={row.accountId}>
                          <TD>
                            <Ref className="font-medium">{row.accountNumber}</Ref>
                          </TD>
                          <TD className="font-medium">{row.accountName}</TD>
                          <TD>
                            <Tag>{enumLabel('accountType', row.accountType)}</Tag>
                          </TD>
                          <TD numeric>{formatAmount(row.totalDebitCents)}</TD>
                          <TD numeric>{formatAmount(row.totalCreditCents)}</TD>
                          <TD numeric className={cn('font-medium', row.balanceCents < 0 && 'text-bad')}>
                            {formatMoney(row.balanceCents)}
                          </TD>
                        </TR>
                      ))}
                      <TR className="bg-paper-2 font-medium">
                        <TD colSpan={3}>{t('balance.totals')}</TD>
                        <TD numeric>{formatAmount(balanceQuery.data?.totalDebitCents ?? 0)}</TD>
                        <TD numeric>{formatAmount(balanceQuery.data?.totalCreditCents ?? 0)}</TD>
                        <TD numeric>
                          {formatMoney(
                            (balanceQuery.data?.totalDebitCents ?? 0) - (balanceQuery.data?.totalCreditCents ?? 0),
                          )}
                        </TD>
                      </TR>
                    </TBody>
                  </Table>
                </TableWrap>
                <CardFooter>
                  <span>{t('balance.count', { count: balanceRows.length })}</span>
                  {balanceQuery.data?.isBalanced ? (
                    <Badge tone="ok">{t('balance.balanced')}</Badge>
                  ) : (
                    <Badge tone="bad">{t('balance.unbalanced')}</Badge>
                  )}
                </CardFooter>
              </DataState>
            </Card>
          </TabsContent>
        ) : null}

        {/* ============================================================ */}
        {/*  EXPORT FIDUCIAIRE — the one section a project manager sees   */}
        {/* ============================================================ */}
        <TabsContent value="export" className="grid gap-5">
          <Card>
            <CardHeader>
              <CardTitle>{t('export.title')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="max-w-[80ch] text-[13.5px] text-muted">
                {isAdmin ? t('export.help') : t('export.helpOwnProjects')}
              </p>

              <div className="flex flex-wrap items-end gap-2.5">
                <Field className="w-[170px]" label={t('export.periodType')} htmlFor="accounting-export-periodtype">
                  <Select
                    id="accounting-export-periodtype"
                    value={exportPeriodType}
                    onChange={e => setExportPeriodType(e.target.value as PeriodType)}
                  >
                    {PERIOD_TYPES.map(p => (
                      <option key={p} value={p}>{t(`export.periodTypes.${p}`)}</option>
                    ))}
                  </Select>
                </Field>
                {exportPeriodType === 'month' ? (
                  <Field className="w-[180px]" label={t('export.month')} htmlFor="accounting-export-month" required>
                    <Input
                      id="accounting-export-month"
                      type="month"
                      value={exportMonth}
                      onChange={e => setExportMonth(e.target.value)}
                    />
                  </Field>
                ) : null}
                {exportPeriodType === 'quarter' ? (
                  <Field className="w-[130px]" label={t('export.quarter')} htmlFor="accounting-export-quarter" required>
                    <Select
                      id="accounting-export-quarter"
                      value={exportQuarter}
                      onChange={e => setExportQuarter(Number(e.target.value))}
                    >
                      {[1, 2, 3, 4].map(q => (
                        <option key={q} value={q}>{t('export.quarterLabel', { quarter: q })}</option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                {exportPeriodType === 'quarter' || exportPeriodType === 'year' ? (
                  <Field className="w-[120px]" label={t('export.year')} htmlFor="accounting-export-year" required>
                    <Input
                      id="accounting-export-year"
                      type="number"
                      inputMode="numeric"
                      min={2000}
                      max={2100}
                      value={exportYear}
                      onChange={e => setExportYear(Number(e.target.value))}
                    />
                  </Field>
                ) : null}
                {exportPeriodType === 'custom' ? (
                  <>
                    <Field className="w-[170px]" label={t('export.from')} htmlFor="accounting-export-from" required>
                      <Input
                        id="accounting-export-from"
                        type="date"
                        value={exportDateFrom}
                        onChange={e => setExportDateFrom(e.target.value)}
                      />
                    </Field>
                    <Field className="w-[170px]" label={t('export.to')} htmlFor="accounting-export-to" required>
                      <Input
                        id="accounting-export-to"
                        type="date"
                        value={exportDateTo}
                        onChange={e => setExportDateTo(e.target.value)}
                      />
                    </Field>
                  </>
                ) : null}
              </div>

              <div className="flex flex-wrap items-end gap-2.5">
                <Field className="w-[240px]" label={t('export.project')} htmlFor="accounting-export-project">
                  <Select
                    id="accounting-export-project"
                    value={exportProjectId}
                    onChange={e => setExportProjectId(e.target.value)}
                  >
                    <option value="">{isAdmin ? t('export.allProjects') : t('export.allOwnProjects')}</option>
                    {(exportProjectsQuery.data ?? []).map(p => (
                      <option key={p.id} value={p.id}>{p.reference} — {p.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field className="w-[220px]" label={t('export.employee')} htmlFor="accounting-export-employee">
                  <Select
                    id="accounting-export-employee"
                    value={exportEmployeeId}
                    onChange={e => setExportEmployeeId(e.target.value)}
                  >
                    <option value="">{t('export.allEmployees')}</option>
                    {(exportEmployeesQuery.data ?? []).map(u => (
                      <option key={u.id} value={u.id}>{`${u.firstName} ${u.lastName}`.trim()}</option>
                    ))}
                  </Select>
                </Field>
                <Field className="w-[200px]" label={t('export.category')} htmlFor="accounting-export-category">
                  <Select
                    id="accounting-export-category"
                    value={exportCategory}
                    onChange={e => setExportCategory(e.target.value)}
                  >
                    <option value="">{t('export.allCategories')}</option>
                    {FIDUCIARY_CATEGORIES.map(c => (
                      <option key={c} value={c}>{t(`export.categories.${c}`)}</option>
                    ))}
                  </Select>
                </Field>
                <Button variant="primary" disabled={exportQuery.isFetching} onClick={generateExport}>
                  {exportQuery.isFetching ? t('export.generating') : t('export.generate')}
                </Button>
              </div>

              {exportError ? (
                <p role="alert" className="text-[13px] text-bad">{exportError}</p>
              ) : null}
            </CardContent>
          </Card>

          {exportRequest !== null ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('export.previewTitle')}
                  {exportData ? (
                    <CardCount>
                      {t('export.range', {
                        from: formatDate(exportData.dateFrom),
                        to: formatDate(exportData.dateTo),
                      })}
                    </CardCount>
                  ) : null}
                </CardTitle>
              </CardHeader>

              {/* §17.7: one tab per file — Heures | Frais & Débours | Résumé projets */}
              <Tabs
                value={exportFile}
                onValueChange={value => setExportFile(value as FiduciaryFileKey)}
              >
                <TabsList aria-label={t('export.filesLabel')} className="px-3">
                  {FIDUCIARY_FILES.map(key => (
                    <TabsTrigger key={key} value={key}>
                      {t(`export.files.${key}`)}
                      <TabCount>{exportData?.files?.[key]?.rowCount ?? 0}</TabCount>
                    </TabsTrigger>
                  ))}
                </TabsList>

                {FIDUCIARY_FILES.map(key => {
                  const preview = previews[key];
                  return (
                    <TabsContent key={key} value={key}>
                      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft px-3.5 py-2.5">
                        <span className="font-mono text-xs text-muted">{preview.file?.filename ?? '—'}</span>
                        <Button
                          size="sm"
                          blockedReason={preview.file ? undefined : t('export.noData')}
                          onClick={() =>
                            preview.file && downloadCSV(preview.file.content, preview.file.filename)
                          }
                        >
                          <Download />
                          {t('export.downloadCsv')}
                        </Button>
                      </div>

                      <DataState
                        isLoading={exportQuery.isPending}
                        error={
                          exportQuery.isError
                            ? errorMessage(exportQuery.error, t('errors.generateExport'))
                            : null
                        }
                        onRetry={() => exportQuery.refetch()}
                        isEmpty={preview.rows.length === 0}
                        empty={<EmptyState title={t('export.noData')} description={t('export.noDataHelp')} />}
                      >
                        <TableWrap className="max-h-[360px] overflow-y-auto">
                          <Table className="text-[13px]">
                            <THead>
                              <tr>
                                {preview.headers.map(h => (
                                  <TH key={h} className="sticky top-0 z-10" title={h}>
                                    {t(`export.columns.${h}`, { defaultValue: h })}
                                  </TH>
                                ))}
                              </tr>
                            </THead>
                            <TBody>
                              {preview.rows.slice(0, 100).map((row, ri) => (
                                <TR key={ri}>
                                  {preview.headers.map(col => (
                                    <TD key={col} className="h-10 whitespace-nowrap">
                                      {col === 'categorie' && row[col]
                                        ? t(`export.categories.${row[col]}`, { defaultValue: row[col] })
                                        : row[col]}
                                    </TD>
                                  ))}
                                </TR>
                              ))}
                            </TBody>
                          </Table>
                        </TableWrap>
                        <CardFooter>
                          <span>{t('export.rowCount', { count: preview.rows.length })}</span>
                          {preview.rows.length > 100 ? (
                            <span>{t('export.truncated', { count: preview.rows.length })}</span>
                          ) : null}
                        </CardFooter>
                      </DataState>
                    </TabsContent>
                  );
                })}
              </Tabs>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>

      {/* ============================================================ */}
      {/*  Dialogs — admin only, so they never render for a manager     */}
      {/* ============================================================ */}
      {isAdmin ? (
        <>
          <Dialog open={accountFormOpen} onOpenChange={setAccountFormOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('accounts.createTitle')}</DialogTitle>
                <DialogDescription>{t('accounts.createHelp')}</DialogDescription>
              </DialogHeader>
              <DialogBody>
                <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
                  <Field label={t('accounts.accountNumber')} htmlFor="accounting-account-number" required>
                    <Input
                      id="accounting-account-number"
                      className="tnum"
                      placeholder={t('accounts.numberPlaceholder')}
                      value={accountForm.accountNumber}
                      onChange={e => setAccountForm(f => ({ ...f, accountNumber: e.target.value }))}
                    />
                  </Field>
                  <Field label={t('accounts.name')} htmlFor="accounting-account-name" required>
                    <Input
                      id="accounting-account-name"
                      placeholder={t('accounts.namePlaceholder')}
                      value={accountForm.name}
                      onChange={e => setAccountForm(f => ({ ...f, name: e.target.value }))}
                    />
                  </Field>
                </div>
                <Field label={t('accounts.type')} htmlFor="accounting-account-type">
                  <Select
                    id="accounting-account-type"
                    value={accountForm.type}
                    onChange={e =>
                      setAccountForm(f => ({ ...f, type: e.target.value as Account['type'] }))
                    }
                  >
                    {ACCOUNT_TYPES.map(type => (
                      <option key={type} value={type}>{enumLabel('accountType', type)}</option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('accounts.parentAccount')}
                  htmlFor="accounting-account-parent"
                  hint={t('accounts.parentHint')}
                >
                  <Select
                    id="accounting-account-parent"
                    value={accountForm.parentId}
                    onChange={e => setAccountForm(f => ({ ...f, parentId: e.target.value }))}
                  >
                    <option value="">{t('accounts.noParent')}</option>
                    {(accountsQuery.data ?? [])
                      .filter(a => a.type === accountForm.type)
                      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
                      .map(a => (
                        <option key={a.id} value={a.id}>{a.accountNumber} — {a.name}</option>
                      ))}
                  </Select>
                </Field>
                {accountFormError ? (
                  <p role="alert" className="text-[13px] text-bad">{accountFormError}</p>
                ) : null}
                {createAccount.isError ? (
                  <p role="alert" className="text-[13px] text-bad">
                    {errorMessage(createAccount.error, t('errors.createAccount'))}
                  </p>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAccountFormOpen(false)}>
                  {t('common:actions.cancel')}
                </Button>
                <Button variant="primary" disabled={createAccount.isPending} onClick={submitAccount}>
                  {createAccount.isPending ? t('accounts.creating') : t('accounts.create')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={entryFormOpen} onOpenChange={setEntryFormOpen}>
            <DialogContent className="w-[min(780px,calc(100vw-32px))]">
              <DialogHeader>
                <DialogTitle>{t('entries.createTitle')}</DialogTitle>
                <DialogDescription>{t('entries.createHelp')}</DialogDescription>
              </DialogHeader>
              <DialogBody>
                <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_180px]">
                  <Field label={t('entries.date')} htmlFor="accounting-entry-date" required>
                    <Input
                      id="accounting-entry-date"
                      type="date"
                      value={entryForm.entryDate}
                      onChange={e => setEntryForm(f => ({ ...f, entryDate: e.target.value }))}
                    />
                  </Field>
                  <Field label={t('entries.description')} htmlFor="accounting-entry-description" required>
                    <Input
                      id="accounting-entry-description"
                      placeholder={t('entries.descriptionPlaceholder')}
                      value={entryForm.description}
                      onChange={e => setEntryForm(f => ({ ...f, description: e.target.value }))}
                    />
                  </Field>
                  <Field label={t('entries.referenceType')} htmlFor="accounting-entry-reference">
                    <Input
                      id="accounting-entry-reference"
                      placeholder={t('entries.referenceTypePlaceholder')}
                      value={entryForm.referenceType}
                      onChange={e => setEntryForm(f => ({ ...f, referenceType: e.target.value }))}
                    />
                  </Field>
                </div>

                <div className="grid gap-2">
                  <h3 className="text-[13px] font-semibold text-ink-2">{t('entries.lines')}</h3>
                  <div className="overflow-hidden rounded-card border border-line">
                    <TableWrap>
                      <Table>
                        <THead>
                          <tr>
                            <TH>{t('entries.account')}</TH>
                            <TH numeric className="w-[150px]">{t('entries.debitChf')}</TH>
                            <TH numeric className="w-[150px]">{t('entries.creditChf')}</TH>
                            <TH className="w-11">
                              <span className="sr-only">{t('entries.table.actions')}</span>
                            </TH>
                          </tr>
                        </THead>
                        <TBody>
                          {entryLines.map((line, idx) => (
                            <TR key={idx}>
                              <TD>
                                <Select
                                  className="h-8"
                                  aria-label={t('entries.accountLine', { line: idx + 1 })}
                                  value={line.accountId}
                                  onChange={e => setLineAccount(idx, e.target.value)}
                                >
                                  <option value="">{t('entries.selectAccount')}</option>
                                  {accountOptions}
                                </Select>
                              </TD>
                              <TD>
                                <Input
                                  className="tnum h-8 text-right"
                                  type="number"
                                  step="0.05"
                                  inputMode="decimal"
                                  aria-label={t('entries.debitLine', { line: idx + 1 })}
                                  value={line.debitCents / 100 || ''}
                                  onChange={e =>
                                    setLineAmount(
                                      idx,
                                      'debitCents',
                                      Math.round(parseFloat(e.target.value || '0') * 100),
                                    )
                                  }
                                />
                              </TD>
                              <TD>
                                <Input
                                  className="tnum h-8 text-right"
                                  type="number"
                                  step="0.05"
                                  inputMode="decimal"
                                  aria-label={t('entries.creditLine', { line: idx + 1 })}
                                  value={line.creditCents / 100 || ''}
                                  onChange={e =>
                                    setLineAmount(
                                      idx,
                                      'creditCents',
                                      Math.round(parseFloat(e.target.value || '0') * 100),
                                    )
                                  }
                                />
                              </TD>
                              <TD>
                                {entryLines.length > 2 ? (
                                  <Button
                                    variant="quiet"
                                    size="iconSm"
                                    className="text-bad"
                                    aria-label={t('entries.removeLine', { line: idx + 1 })}
                                    onClick={() => removeEntryLine(idx)}
                                  >
                                    <Trash2 />
                                  </Button>
                                ) : null}
                              </TD>
                            </TR>
                          ))}
                          <TR className="bg-paper-2 font-medium">
                            <TD>{t('entries.total')}</TD>
                            <TD numeric className="font-semibold">{formatAmount(totalDebits)}</TD>
                            <TD numeric className="font-semibold">{formatAmount(totalCredits)}</TD>
                            <TD />
                          </TR>
                        </TBody>
                      </Table>
                    </TableWrap>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" onClick={addEntryLine}>
                      <Plus />
                      {t('entries.addLine')}
                    </Button>
                    <span
                      aria-live="polite"
                      className={cn(
                        'text-[13px] font-medium',
                        totalDebits === 0 && totalCredits === 0
                          ? 'text-muted'
                          : isBalanced
                            ? 'text-ok'
                            : 'text-bad',
                      )}
                    >
                      {totalDebits === 0 && totalCredits === 0
                        ? t('entries.enterAmounts')
                        : isBalanced
                          ? t('entries.balanced')
                          : t('entries.unbalanced', {
                              amount: formatMoney(Math.abs(totalDebits - totalCredits)),
                            })}
                    </span>
                  </div>
                </div>

                {entryError ? (
                  <p role="alert" className="text-[13px] text-bad">{entryError}</p>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setEntryFormOpen(false)}>
                  {t('common:actions.cancel')}
                </Button>
                <Button
                  variant="primary"
                  blockedReason={isBalanced ? undefined : t('validation.unbalanced')}
                  disabled={createEntry.isPending}
                  onClick={submitEntry}
                >
                  {createEntry.isPending ? t('entries.creating') : t('entries.create')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </PageBody>
  );
}
