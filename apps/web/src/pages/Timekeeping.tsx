import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiGet, apiPost, ApiError, formatCHF } from '../lib/api';

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

interface Profile {
  id: string;
  role: string;
}

const APPROVER_ROLES = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER'];

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_TABS = ['all', 'draft', 'submitted', 'approved', 'rejected'] as const;

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f3f4f6', fg: '#4b5563' },
  submitted: { bg: '#fef3c7', fg: '#92400e' },
  approved: { bg: '#dcfce7', fg: '#166534' },
  rejected: { bg: '#fee2e2', fg: '#991b1b' },
};

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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatMinutes(mins: number): string {
  if (mins == null || isNaN(mins)) return '0:00';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/** 'HH:MM:SS' → 'HH:MM' */
function formatTime(time: string | null): string {
  if (!time) return '-';
  return time.slice(0, 5);
}

/** 'YYYY-MM-DD' → local date without timezone shift */
function formatDate(date: string): string {
  if (!date) return '-';
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-CH');
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return `Not allowed: ${err.message}`;
    return err.message || fallback;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Timekeeping() {
  // Clock in/out state
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [category, setCategory] = useState<'normal' | 'travel'>('normal');
  const [clockNotes, setClockNotes] = useState('');
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Entries state
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  // Weekly summary
  const [summary, setSummary] = useState<WeeklySummary | null>(null);

  // Caller (for own drafts / active entry and approve rights); null until loaded or if unavailable
  const [me, setMe] = useState<Profile | null>(null);
  const [myDrafts, setMyDrafts] = useState<TimeEntry[]>([]);
  const canApprove = me ? APPROVER_ROLES.includes(me.role) : true;
  // Labour cost reveals pay rates; the API only returns it to office roles.
  const showCost = me ? ['ADMIN', 'PROJECT_MANAGER'].includes(me.role) : false;

  // ---- Load profile & projects ----
  useEffect(() => {
    apiGet<Profile>('/auth/profile')
      .then(setMe)
      .catch(() => {});
    apiGet<Project[]>('/projects')
      .then((list) => setProjects(list ?? []))
      .catch(() => {});
  }, []);

  // ---- Load the caller's own drafts (active clock-in + submittable entries) ----
  const loadMyDrafts = useCallback(() => {
    if (!me) return;
    // Rejected entries go back to their owner to correct and resubmit.
    Promise.all(
      ['draft', 'rejected'].map((status) =>
        apiGet<TimeEntry[]>(`/timekeeping?userId=${me.id}&status=${status}&limit=100`),
      ),
    )
      .then(([drafts, rejected]) => {
        setMyDrafts([...(drafts ?? []), ...(rejected ?? [])]);
        setActiveEntry((drafts ?? []).find((e) => !e.endTime) || null);
      })
      .catch(() => {});
  }, [me]);


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
        // Without a profile, fall back to the first open draft in the list.
        if (!me) setActiveEntry((list ?? []).find((e) => !e.endTime && e.status === 'draft') || null);
        setError('');
      })
      .catch((err) => setError(errorMessage(err, 'Failed to load entries')))
      .finally(() => setLoading(false));
    loadMyDrafts();
  }, [statusFilter, dateFrom, dateTo, me, loadMyDrafts]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // ---- Load weekly summary (the caller's own week) ----
  useEffect(() => {
    apiGet<WeeklySummary>('/timekeeping/summary/weekly')
      .then(setSummary)
      .catch(() => {});
  }, []);

  const totalBreakMinutes = summary
    ? Object.values(summary.entriesByDay ?? {}).flat().reduce((sum, e) => sum + (e.breakMinutes || 0), 0)
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

  // ---- Actions ----
  const handleClockIn = async () => {
    if (!selectedProjectId) return;
    setActionLoading(true);
    try {
      await apiPost('/timekeeping/clock-in', {
        projectId: selectedProjectId,
        category,
        notes: clockNotes || undefined,
      });
      setClockNotes('');
      loadEntries();
    } catch (err) {
      setError(errorMessage(err, 'Clock in failed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleClockOut = async () => {
    if (!activeEntry) return;
    setActionLoading(true);
    try {
      await apiPost(`/timekeeping/clock-out/${activeEntry.id}`);
      setActiveEntry(null);
      loadEntries();
    } catch (err) {
      setError(errorMessage(err, 'Clock out failed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitDrafts = async () => {
    // Only the caller's own, clocked-out drafts can be submitted.
    const entryIds = myDrafts.filter((e) => e.endTime).map((e) => e.id);
    if (me && entryIds.length === 0) {
      setError('No completed draft entries to submit.');
      return;
    }
    setActionLoading(true);
    try {
      // Without a profile the ids are unknown: omit them and the API submits all own drafts.
      await apiPost('/timekeeping/submit', me ? { entryIds } : {});
      loadEntries();
    } catch (err) {
      setError(errorMessage(err, 'Submit failed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    if (selected.size === 0) return;
    setActionLoading(true);
    try {
      await apiPost('/timekeeping/approve', { entryIds: Array.from(selected) });
      setSelected(new Set());
      loadEntries();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'You can only approve time entries of your own team members (not your own).'
          : errorMessage(err, 'Approve failed'),
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (selected.size === 0) return;
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    setActionLoading(true);
    try {
      await apiPost('/timekeeping/reject', { entryIds: Array.from(selected), reason });
      setSelected(new Set());
      loadEntries();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'You can only reject time entries of your own team members (not your own).'
          : errorMessage(err, 'Reject failed'),
      );
    } finally {
      setActionLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === entries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.id)));
    }
  };

  const elapsedH = Math.floor(elapsedSeconds / 3600);
  const elapsedM = Math.floor((elapsedSeconds % 3600) / 60);
  const elapsedS = elapsedSeconds % 60;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Timekeeping</h1>
        <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>Clock in/out and manage time entries</p>
      </div>

      {error && (
        <div style={{ padding: '10px 16px', background: '#fee2e2', color: '#991b1b', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Clock In / Out Section */}
      <div
        style={{
          background: '#f8f9fa',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 20,
          marginBottom: 24,
        }}
      >
        {activeEntry ? (
          /* Currently clocked in */
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>Currently clocked in</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>
                {activeEntry.project?.name || 'Project'}
                <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 8, fontSize: 13 }}>
                  ({statusLabel(activeEntry.category)})
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                Started at {formatTime(activeEntry.startTime)}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>
                {String(elapsedH).padStart(2, '0')}:{String(elapsedM).padStart(2, '0')}:{String(elapsedS).padStart(2, '0')}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Elapsed time</div>
            </div>
            <button
              style={{ ...btnDanger, padding: '12px 32px', fontSize: 16, fontWeight: 700 }}
              onClick={handleClockOut}
              disabled={actionLoading}
            >
              Clock Out
            </button>
          </div>
        ) : (
          /* Clock in form */
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Project</label>
              <select
                style={{ ...inputStyle }}
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                <option value="">Select a project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.reference ? `${p.reference} - ` : ''}{p.name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '0 0 150px' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Category</label>
              <select
                style={{ ...inputStyle }}
                value={category}
                onChange={(e) => setCategory(e.target.value as 'normal' | 'travel')}
              >
                <option value="normal">Normal</option>
                <option value="travel">Travel</option>
              </select>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Notes (optional)</label>
              <input
                style={{ ...inputStyle }}
                placeholder="What are you working on?"
                value={clockNotes}
                onChange={(e) => setClockNotes(e.target.value)}
              />
            </div>
            <button
              style={{ ...btnSuccess, padding: '12px 32px', fontSize: 16, fontWeight: 700, flex: '0 0 auto' }}
              onClick={handleClockIn}
              disabled={!selectedProjectId || actionLoading}
            >
              Clock In
            </button>
          </div>
        )}
      </div>

      {/* Weekly Summary */}
      {summary && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            { label: 'Normal Hours', value: formatMinutes(summary.totalNormal), color: '#2563eb' },
            { label: 'Overtime', value: formatMinutes(summary.totalOvertime), color: '#f59e0b' },
            { label: 'Travel', value: formatMinutes(summary.totalTravel), color: '#8b5cf6' },
            { label: 'Break', value: formatMinutes(totalBreakMinutes), color: '#6b7280' },
            { label: 'Total Cost', value: `CHF ${formatCHF(summary.totalCost)}`, color: '#16a34a' },
          ].filter((item) => showCost || item.label !== 'Total Cost').map((item) => (
            <div
              key={item.label}
              style={{
                flex: '1 1 140px',
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '14px 16px',
              }}
            >
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: item.color, fontVariantNumeric: 'tabular-nums' }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters and Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => { setStatusFilter(tab); setSelected(new Set()); }}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid #e5e7eb',
                background: statusFilter === tab ? '#2563eb' : '#fff',
                color: statusFilter === tab ? '#fff' : '#4b5563',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {statusLabel(tab)}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="date"
            style={{ ...inputStyle, width: 150 }}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From"
          />
          <span style={{ color: '#9ca3af', fontSize: 13 }}>to</span>
          <input
            type="date"
            style={{ ...inputStyle, width: 150 }}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To"
          />
        </div>
      </div>

      {/* Bulk Actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button style={{ ...btnPrimary }} onClick={handleSubmitDrafts} disabled={actionLoading}>
          Submit All Drafts
        </button>
        {canApprove && selected.size > 0 && (
          <>
            <button style={{ ...btnSuccess }} onClick={handleApprove} disabled={actionLoading}>
              Approve ({selected.size})
            </button>
            <button style={{ ...btnDanger }} onClick={handleReject} disabled={actionLoading}>
              Reject ({selected.size})
            </button>
          </>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: '#6b7280', padding: 20 }}>Loading...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ padding: '10px 8px', borderBottom: '2px solid #e5e7eb', textAlign: 'left', width: 32 }}>
                <input
                  type="checkbox"
                  checked={entries.length > 0 && selected.size === entries.length}
                  onChange={toggleSelectAll}
                />
              </th>
              {['Date', 'Project', 'Start', 'End', 'Break', 'Normal', 'Overtime', 'Travel', 'Status', ...(showCost ? ['Cost'] : [])].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: h === 'Cost' ? 'right' : 'left',
                    padding: '10px 12px',
                    borderBottom: '2px solid #e5e7eb',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#6b7280',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={11} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>
                  No time entries found
                </td>
              </tr>
            )}
            {entries.map((entry) => {
              const colors = STATUS_COLORS[entry.status] ?? STATUS_COLORS.draft;
              return (
                <tr
                  key={entry.id}
                  style={{ borderBottom: '1px solid #f3f4f6' }}
                  onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = '#f9fafb'; }}
                  onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td style={{ padding: '10px 8px' }}>
                    <input
                      type="checkbox"
                      checked={selected.has(entry.id)}
                      onChange={() => toggleSelect(entry.id)}
                    />
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {formatDate(entry.date)}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14 }}>
                    {entry.project?.name || '-'}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(entry.startTime)}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {entry.endTime ? formatTime(entry.endTime) : (
                      <span style={{ color: '#16a34a', fontWeight: 500, fontSize: 12 }}>Active</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {formatMinutes(entry.breakMinutes)}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {formatMinutes(entry.normalMinutes ?? 0)}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {formatMinutes(entry.overtimeMinutes)}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {formatMinutes(entry.travelMinutes)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 9999,
                        fontSize: 12,
                        fontWeight: 600,
                        background: colors.bg,
                        color: colors.fg,
                      }}
                    >
                      {statusLabel(entry.status)}
                    </span>
                    {entry.status === 'rejected' && entry.rejectionReason && (
                      <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 4, maxWidth: 260 }}>
                        Reason: {entry.rejectionReason}
                      </div>
                    )}
                  </td>
                  {showCost && (
                    <td style={{ padding: '10px 12px', fontSize: 14, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      CHF {formatCHF(entry.costCents ?? 0)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
