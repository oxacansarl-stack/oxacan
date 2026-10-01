import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Check, Play, Send, Square, Timer, X } from 'lucide-react';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { enumLabel, formatDate, formatMinutes, formatMoney, statusLabel } from '../lib/format';
import { useCurrentUser } from '../lib/current-user';
import { OFFICE, SITE_LEAD } from '@/app/nav';
import { MetaDivider, PageBody, PageHeader } from '@/components/page-header';
import { Card, CardContent, CardCount, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { DataState, EmptyState, Skeleton } from '@/components/states';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Project {
  id: string;
  name: string;
  reference?: string;
}

/** Row shape of GET /timekeeping (date is YYYY-MM-DD, times are HH:MM:SS). */
interface TimeEntry {
  id: string;
  userId: string;
  user?: { id: string; firstName: string; lastName: string };
  projectId: string;
  project?: { name: string; reference?: string };
  taskId?: string | null;
  category: string;
  date: string;
  startTime: string;
  endTime: string | null;
  breakMinutes: number;
  normalMinutes: number | null;
  overtimeMinutes: number;
  travelMinutes: number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  rejectionReason?: string | null;
  costCents: number | null;
  notes?: string | null;
  createdAt: string;
}

/** GET /timekeeping/summary/weekly */
interface WeeklySummary {
  totalNormal: number;
  totalOvertime: number;
  totalTravel: number;
  totalCost: number;
  entriesByDay: Record<string, TimeEntry[]>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_TABS = ['all', 'draft', 'submitted', 'approved', 'rejected'] as const;

/** One flight at a time: every control is disabled while a request runs, and says what it is doing. */
type PendingAction = 'clockIn' | 'clockOut' | 'submit' | 'approve' | 'reject';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** 'HH:MM:SS' → 'HH:MM' */
function formatTime(time: string | null): string {
  if (!time) return '—';
  return time.slice(0, 5);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Timekeeping() {
  const { t } = useTranslation('timekeeping');
  const confirm = useConfirm();
  const me = useCurrentUser();

  // The API stays the source of truth; this only avoids showing what would answer 403.
  const canApprove = SITE_LEAD.includes(me.role);
  // Labour cost reveals pay rates; the API only returns it to office roles.
  const showCost = OFFICE.includes(me.role);

  // Clock in/out
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsError, setProjectsError] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [category, setCategory] = useState<'normal' | 'travel'>('normal');
  const [clockNotes, setClockNotes] = useState('');
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Entries
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // A failed action is not a failed load: it never replaces the table with an error state.
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const busy = pending !== null;

  // Weekly summary (the caller's own week)
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');

  // The caller's own drafts: the active clock-in plus everything that can be submitted.
  const [myDrafts, setMyDrafts] = useState<TimeEntry[]>([]);
  // This fetch is the only source of `activeEntry` and `submittable`, so a failure must be shown
  // as a failure: a default clock-in form would hide the clock-out of someone already clocked in.
  const [myDraftsLoading, setMyDraftsLoading] = useState(true);
  const [myDraftsError, setMyDraftsError] = useState('');

  // Rejection needs a reason, so it asks for one in a dialog rather than a browser prompt.
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  // ---- Load projects ----
  useEffect(() => {
    apiGet<Project[]>('/projects')
      .then((list) => {
        setProjects(list ?? []);
        setProjectsError('');
      })
      .catch(() => setProjectsError(t('clock.projectsFailed')));
  }, [t]);

  // ---- Load the caller's own drafts (active clock-in + submittable entries) ----
  const loadMyDrafts = useCallback(
    // A background refresh keeps the card as it is; only the first load and an explicit retry
    // replace it with a skeleton.
    (showLoading = false) => {
      if (showLoading) setMyDraftsLoading(true);
      // Rejected entries go back to their owner to correct and resubmit.
      Promise.all(
        ['draft', 'rejected'].map((status) =>
          apiGet<TimeEntry[]>(`/timekeeping?userId=${me.id}&status=${status}&limit=100`),
        ),
      )
        .then(([drafts, rejected]) => {
          setMyDrafts([...(drafts ?? []), ...(rejected ?? [])]);
          setActiveEntry((drafts ?? []).find((e) => !e.endTime) || null);
          setMyDraftsError('');
        })
        .catch((err) => setMyDraftsError(errorMessage(err, t('messages.draftsLoadFailed'))))
        .finally(() => setMyDraftsLoading(false));
    },
    [me.id, t],
  );

  // ---- Load entries ----
  const loadEntries = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    apiGet<TimeEntry[]>(`/timekeeping?${params.toString()}`)
      .then((list) => {
        setEntries(list ?? []);
        setLoadError('');
      })
      .catch((err) => setLoadError(errorMessage(err, t('messages.loadFailed'))))
      .finally(() => setLoading(false));
    loadMyDrafts();
  }, [statusFilter, dateFrom, dateTo, loadMyDrafts, t]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // ---- Load weekly summary ----
  const loadSummary = useCallback(() => {
    setSummaryLoading(true);
    apiGet<WeeklySummary>('/timekeeping/summary/weekly')
      .then((data) => {
        setSummary(data);
        setSummaryError('');
      })
      .catch((err) => setSummaryError(errorMessage(err, t('summary.loadFailed'))))
      .finally(() => setSummaryLoading(false));
  }, [t]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const totalBreakMinutes = summary
    ? Object.values(summary.entriesByDay ?? {})
        .flat()
        .reduce((sum, e) => sum + (e.breakMinutes || 0), 0)
    : 0;

  // ---- Timer ----
  useEffect(() => {
    if (activeEntry && !activeEntry.endTime) {
      const start = new Date(`${activeEntry.date.slice(0, 10)}T${activeEntry.startTime}`).getTime();
      const tick = () => {
        setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
      };
      tick();
      timerRef.current = setInterval(tick, 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } else {
      setElapsedSeconds(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [activeEntry]);

  /**
   * The engine approves and rejects only `submitted` entries: any other status throws
   * INVALID_STATUS and aborts the whole batch, so nothing else may enter the selection.
   */
  const selectableIds = useMemo(
    () => entries.filter((e) => e.status === 'submitted').map((e) => e.id),
    [entries],
  );

  // A reload can move a row out of `submitted`; the selection must not keep it.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const allowed = new Set(selectableIds);
      const next = new Set([...prev].filter((id) => allowed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [selectableIds]);

  // ---- Actions ----
  const handleClockIn = async () => {
    if (!selectedProjectId) return;
    setPending('clockIn');
    setActionError('');
    try {
      await apiPost('/timekeeping/clock-in', {
        projectId: selectedProjectId,
        category,
        notes: clockNotes || undefined,
      });
      setClockNotes('');
      loadEntries();
    } catch (err) {
      setActionError(errorMessage(err, t('messages.clockInFailed')));
    } finally {
      setPending(null);
    }
  };

  const handleClockOut = async () => {
    if (!activeEntry) return;
    setPending('clockOut');
    setActionError('');
    try {
      await apiPost(`/timekeeping/clock-out/${activeEntry.id}`);
      setActiveEntry(null);
      loadEntries();
    } catch (err) {
      setActionError(errorMessage(err, t('messages.clockOutFailed')));
    } finally {
      setPending(null);
    }
  };

  // Only the caller's own, clocked-out drafts can be submitted.
  const submittable = useMemo(() => myDrafts.filter((e) => e.endTime), [myDrafts]);

  // A load that failed says so; it never claims there is nothing to submit.
  const submitBlockedReason = myDraftsError
    ? t('messages.draftsUnknown')
    : myDraftsLoading
      ? t('messages.draftsChecking')
      : submittable.length === 0
        ? t('messages.noDraftsToSubmit')
        : undefined;

  const handleSubmitDrafts = async () => {
    const entryIds = submittable.map((e) => e.id);
    if (entryIds.length === 0) {
      setActionError(t('messages.noDraftsToSubmit'));
      return;
    }
    setPending('submit');
    setActionError('');
    try {
      await apiPost('/timekeeping/submit', { entryIds });
      loadEntries();
    } catch (err) {
      setActionError(errorMessage(err, t('messages.submitFailed')));
    } finally {
      setPending(null);
    }
  };

  const handleApprove = async () => {
    if (selected.size === 0) return;
    const ok = await confirm({
      title: t('approve.title', { count: selected.size }),
      description: t('approve.description'),
      confirmLabel: t('approve.confirm'),
      tone: 'default',
    });
    if (!ok) return;
    setPending('approve');
    setActionError('');
    try {
      await apiPost('/timekeeping/approve', { entryIds: Array.from(selected) });
      setSelected(new Set());
      loadEntries();
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.status === 403
          ? t('messages.approveForbidden')
          : errorMessage(err, t('messages.approveFailed')),
      );
    } finally {
      setPending(null);
    }
  };

  const openReject = () => {
    if (selected.size === 0) return;
    setRejectReason('');
    setRejectError('');
    setRejectOpen(true);
  };

  const handleReject = async () => {
    const reason = rejectReason.trim();
    if (selected.size === 0 || !reason) return;
    setPending('reject');
    setRejectError('');
    setActionError('');
    try {
      await apiPost('/timekeeping/reject', { entryIds: Array.from(selected), reason });
      setRejectOpen(false);
      setRejectReason('');
      setSelected(new Set());
      loadEntries();
    } catch (err) {
      setRejectError(
        err instanceof ApiError && err.status === 403
          ? t('messages.rejectForbidden')
          : errorMessage(err, t('messages.rejectFailed')),
      );
    } finally {
      setPending(null);
    }
  };

  const toggleSelect = (id: string) => {
    if (!selectableIds.includes(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelectableSelected = selectableIds.length > 0 && selected.size === selectableIds.length;

  const toggleSelectAll = () => {
    setSelected(allSelectableSelected ? new Set() : new Set(selectableIds));
  };

  const elapsedH = Math.floor(elapsedSeconds / 3600);
  const elapsedM = Math.floor((elapsedSeconds % 3600) / 60);
  const elapsedS = elapsedSeconds % 60;
  const elapsed = [elapsedH, elapsedM, elapsedS].map((n) => String(n).padStart(2, '0')).join(':');

  const filtersActive = statusFilter !== 'all' || Boolean(dateFrom) || Boolean(dateTo);

  const tiles = summary
    ? [
        { key: 'normal', label: t('summary.normal'), value: formatMinutes(summary.totalNormal), tone: 'text-ink' },
        { key: 'overtime', label: t('summary.overtime'), value: formatMinutes(summary.totalOvertime), tone: 'text-warn' },
        { key: 'travel', label: t('summary.travel'), value: formatMinutes(summary.totalTravel), tone: 'text-copper' },
        { key: 'break', label: t('summary.break'), value: formatMinutes(totalBreakMinutes), tone: 'text-muted' },
        { key: 'totalCost', label: t('summary.totalCost'), value: formatMoney(summary.totalCost), tone: 'text-ok' },
      ].filter((item) => showCost || item.key !== 'totalCost')
    : [];

  const dateRange = (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('filters.period')}>
      <span className="text-[13px] text-muted">{t('filters.from')}</span>
      <Input
        type="date"
        className="w-[150px]"
        aria-label={t('filters.fromLabel')}
        value={dateFrom}
        onChange={(e) => setDateFrom(e.target.value)}
      />
      <span className="text-[13px] text-muted">{t('filters.to')}</span>
      <Input
        type="date"
        className="w-[150px]"
        aria-label={t('filters.toLabel')}
        value={dateTo}
        onChange={(e) => setDateTo(e.target.value)}
      />
    </div>
  );

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        kicker={t('common:navGroup.people')}
        meta={
          <>
            <span>{t('subtitle')}</span>
            {submittable.length > 0 ? (
              <>
                <MetaDivider />
                <span>{t('meta.pendingDrafts', { count: submittable.length })}</span>
              </>
            ) : null}
          </>
        }
        actions={
          <Button
            variant="ghost"
            onClick={handleSubmitDrafts}
            disabled={busy}
            blockedReason={submitBlockedReason}
          >
            <Send />
            {pending === 'submit' ? t('actions.submitting') : t('actions.submitDrafts')}
          </Button>
        }
      />

      {actionError ? (
        <p role="alert" className="rounded-card bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad">
          {actionError}
        </p>
      ) : null}

      {/* Clock in / out — the page's primary action */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Timer aria-hidden className="size-4 text-muted" />
            {t('clock.title')}
          </CardTitle>
          {activeEntry ? <Badge tone="live">{t('clock.currentlyClockedIn')}</Badge> : null}
        </CardHeader>
        {/* Without this load the page cannot tell "not clocked in" from "we do not know yet". */}
        <DataState
          isLoading={myDraftsLoading}
          error={myDraftsError || null}
          onRetry={() => loadMyDrafts(true)}
          loading={
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_160px_minmax(0,1fr)_auto]">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[58px]" />
              ))}
            </CardContent>
          }
        >
          <CardContent>
            {activeEntry ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[15px] font-semibold">
                      {activeEntry.project?.name || t('clock.projectFallback')}
                    </span>
                    <span className="text-[13px] text-muted">
                      {enumLabel('timeCategory', activeEntry.category)}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {t('clock.startedAt', { time: formatTime(activeEntry.startTime) })}
                  </p>
                </div>
                <div className="grid justify-items-center gap-0.5">
                  <span className="tnum font-display text-[32px] font-semibold leading-none tracking-[-0.02em]">
                    {elapsed}
                  </span>
                  <span className="text-xs text-muted">{t('clock.elapsed')}</span>
                </div>
                <Button variant="danger" className="h-10 px-5 text-sm" onClick={handleClockOut} disabled={busy}>
                  <Square />
                  {pending === 'clockOut' ? t('clock.clockingOut') : t('clock.clockOut')}
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_160px_minmax(0,1fr)_auto] lg:items-end">
                <Field label={t('clock.project')} htmlFor="tk-project" error={projectsError || undefined}>
                  <Select
                    id="tk-project"
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                  >
                    <option value="">{t('clock.selectProject')}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.reference ? `${p.reference} - ` : ''}
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('clock.category')} htmlFor="tk-category">
                  <Select
                    id="tk-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as 'normal' | 'travel')}
                  >
                    <option value="normal">{enumLabel('timeCategory', 'normal')}</option>
                    <option value="travel">{enumLabel('timeCategory', 'travel')}</option>
                  </Select>
                </Field>
                <Field label={t('clock.notes')} htmlFor="tk-notes">
                  <Input
                    id="tk-notes"
                    placeholder={t('clock.notesPlaceholder')}
                    value={clockNotes}
                    onChange={(e) => setClockNotes(e.target.value)}
                  />
                </Field>
                <Button
                  variant="primary"
                  className="h-10 px-5 text-sm sm:col-span-2 lg:col-span-1"
                  onClick={handleClockIn}
                  disabled={busy}
                  blockedReason={selectedProjectId ? undefined : t('clock.selectProjectFirst')}
                >
                  <Play />
                  {pending === 'clockIn' ? t('clock.clockingIn') : t('clock.clockIn')}
                </Button>
              </div>
            )}
          </CardContent>
        </DataState>
      </Card>

      {/* Weekly summary */}
      <Card>
        <CardHeader>
          <CardTitle>
            <CalendarDays aria-hidden className="size-4 text-muted" />
            {t('summary.title')}
          </CardTitle>
        </CardHeader>
        <DataState
          isLoading={summaryLoading}
          error={summaryError || null}
          onRetry={loadSummary}
          isEmpty={!summary}
          empty={
            <EmptyState
              icon={<CalendarDays className="size-5" />}
              title={t('summary.unavailable')}
              description={t('summary.unavailableHelp')}
            />
          }
          loading={
            <CardContent className="flex flex-wrap gap-3">
              {Array.from({ length: showCost ? 5 : 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[66px] min-w-[138px] flex-1" />
              ))}
            </CardContent>
          }
        >
          <CardContent className="flex flex-wrap gap-3">
            {tiles.map((item) => (
              <div
                key={item.key}
                className="min-w-[138px] flex-1 rounded-md border border-line bg-paper-2 px-3.5 py-3"
              >
                <div className="text-xs text-muted">{item.label}</div>
                <div className={cn('tnum mt-1 font-display text-xl font-semibold', item.tone)}>
                  {item.value}
                </div>
              </div>
            ))}
          </CardContent>
        </DataState>
      </Card>

      {/* Status tabs */}
      <Tabs
        value={statusFilter}
        onValueChange={(value) => {
          setStatusFilter(value);
          setSelected(new Set());
        }}
      >
        <TabsList aria-label={t('filters.status')}>
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {tab === 'all' ? t('common:actions.all') : statusLabel('timeEntry', tab)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Entries */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t('entries.title')}
            {loading || loadError ? null : <CardCount>({entries.length})</CardCount>}
          </CardTitle>
          {dateRange}
        </CardHeader>

        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft bg-paper-2 px-3.5 py-2.5">
            <span className="text-[13px] text-ink-2">{t('selection.count', { count: selected.size })}</span>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="quiet" size="sm" onClick={() => setSelected(new Set())}>
                {t('selection.clear')}
              </Button>
              {canApprove ? (
                <>
                  <Button variant="ghost" size="sm" onClick={handleApprove} disabled={busy}>
                    <Check />
                    {t('actions.approve', { count: selected.size })}
                  </Button>
                  <Button variant="danger" size="sm" onClick={openReject} disabled={busy}>
                    <X />
                    {t('actions.reject', { count: selected.size })}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        <DataState
          isLoading={loading}
          error={loadError || null}
          onRetry={loadEntries}
          isEmpty={entries.length === 0}
          empty={
            filtersActive ? (
              <EmptyState title={t('noMatch')} description={t('noMatchHelp')} />
            ) : (
              <EmptyState
                icon={<Timer className="size-5" />}
                title={t('empty')}
                description={t('emptyHelp')}
              />
            )
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH className="w-10 px-3">
                    {/* Select-all covers the submitted rows only: the engine refuses the rest. */}
                    <input
                      type="checkbox"
                      className="size-4 accent-graphite align-middle disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={t('table.selectAll')}
                      title={selectableIds.length === 0 ? t('table.noneSelectable') : undefined}
                      checked={allSelectableSelected}
                      disabled={selectableIds.length === 0}
                      onChange={toggleSelectAll}
                    />
                  </TH>
                  <TH>{t('table.date')}</TH>
                  <TH>{t('table.project')}</TH>
                  <TH>{t('table.start')}</TH>
                  <TH>{t('table.end')}</TH>
                  <TH numeric>{t('table.break')}</TH>
                  <TH numeric>{t('table.normal')}</TH>
                  <TH numeric>{t('table.overtime')}</TH>
                  <TH numeric>{t('table.travel')}</TH>
                  <TH>{t('table.status')}</TH>
                  {showCost ? <TH numeric>{t('table.cost')}</TH> : null}
                </tr>
              </THead>
              <TBody>
                {entries.map((entry) => {
                  // Only a submitted entry can be approved or rejected, so only it can be picked.
                  const selectable = entry.status === 'submitted';
                  const isSelected = selectable && selected.has(entry.id);
                  return (
                    <TR
                      key={entry.id}
                      onActivate={selectable ? () => toggleSelect(entry.id) : undefined}
                      aria-pressed={selectable ? isSelected : undefined}
                      className={cn(isSelected && '[&>td]:bg-chalk')}
                    >
                      {/* The checkbox keeps its own activation: the row must not undo it. */}
                      <TD
                        className="w-10 px-3"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {selectable ? (
                          <input
                            type="checkbox"
                            className="size-4 accent-graphite align-middle"
                            aria-label={t('table.select', { date: formatDate(entry.date) })}
                            checked={isSelected}
                            onChange={() => toggleSelect(entry.id)}
                          />
                        ) : (
                          <span className="sr-only">{t('table.notSelectable')}</span>
                        )}
                      </TD>
                      <TD className="tnum whitespace-nowrap">{formatDate(entry.date)}</TD>
                      <TD className="font-medium">{entry.project?.name || '—'}</TD>
                      <TD className="tnum">{formatTime(entry.startTime)}</TD>
                      <TD className="tnum">
                        {entry.endTime ? (
                          formatTime(entry.endTime)
                        ) : (
                          <Badge tone="live">{t('table.active')}</Badge>
                        )}
                      </TD>
                      <TD numeric className={entry.breakMinutes ? undefined : 'text-muted'}>
                        {formatMinutes(entry.breakMinutes)}
                      </TD>
                      <TD numeric>{formatMinutes(entry.normalMinutes ?? 0)}</TD>
                      <TD numeric className={entry.overtimeMinutes ? 'font-medium text-warn' : 'text-muted'}>
                        {formatMinutes(entry.overtimeMinutes)}
                      </TD>
                      <TD numeric className={entry.travelMinutes ? undefined : 'text-muted'}>
                        {formatMinutes(entry.travelMinutes)}
                      </TD>
                      <TD>
                        <div className="grid gap-1">
                          <StatusBadge domain="timeEntry" value={entry.status} />
                          {entry.status === 'rejected' && entry.rejectionReason ? (
                            <span className="max-w-[260px] text-xs text-bad">
                              {t('table.reason', { reason: entry.rejectionReason })}
                            </span>
                          ) : null}
                        </div>
                      </TD>
                      {showCost ? <TD numeric>{formatMoney(entry.costCents ?? 0)}</TD> : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('footer.count', { count: entries.length })}</span>
            <span>{t('footer.limit')}</span>
          </CardFooter>
        </DataState>
      </Card>

      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open);
          if (!open) setRejectError('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('reject.title', { count: selected.size })}</DialogTitle>
            <DialogDescription>{t('reject.description')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('reject.reason')} htmlFor="tk-reject-reason" required>
              <Textarea
                id="tk-reject-reason"
                value={rejectReason}
                placeholder={t('reject.reasonPlaceholder')}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </Field>
            {rejectError ? (
              <p role="alert" className="text-[13px] text-bad">
                {rejectError}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={handleReject}
              disabled={busy}
              blockedReason={rejectReason.trim() ? undefined : t('reject.reasonRequired')}
            >
              {pending === 'reject' ? t('reject.rejecting') : t('reject.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}
