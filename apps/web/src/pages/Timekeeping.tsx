import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiGet, apiPost, apiPut, formatCHF } from '../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Project {
  id: string;
  name: string;
  reference?: string;
}

interface TimeEntry {
  id: string;
  userId: string;
  projectId: string;
  project?: { name: string; reference?: string };
  taskId?: string;
  category: 'normal' | 'travel';
  clockIn: string;
  clockOut?: string;
  breakMinutes: number;
  normalMinutes: number;
  overtimeMinutes: number;
  travelMinutes: number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  costCents: number;
  notes?: string;
  createdAt: string;
}

interface WeeklySummary {
  totalNormalMinutes: number;
  totalOvertimeMinutes: number;
  totalTravelMinutes: number;
  totalBreakMinutes: number;
  totalCostCents: number;
  entriesCount: number;
}

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

function formatTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('fr-CH');
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

  // ---- Load projects ----
  useEffect(() => {
    apiGet<{ data: Project[] } | Project[]>('/projects')
      .then((res) => {
        const list = Array.isArray(res) ? res : res.data;
        setProjects(list);
      })
      .catch(() => {});
  }, []);

  // ---- Load entries ----
  const loadEntries = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const qs = params.toString() ? `?${params.toString()}` : '';

    apiGet<{ data: TimeEntry[] }>(`/timekeeping${qs}`)
      .then((res) => {
        const list = Array.isArray(res) ? res : res.data ?? [];
        setEntries(list);
        // Check for active (clocked-in) entry
        const active = list.find((e: TimeEntry) => !e.clockOut && e.status === 'draft');
        setActiveEntry(active || null);
        setError('');
      })
      .catch((err) => setError(err.message || 'Failed to load entries'))
      .finally(() => setLoading(false));
  }, [statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // ---- Load weekly summary ----
  useEffect(() => {
    apiGet<{ data: WeeklySummary }>('/timekeeping/summary/weekly')
      .then((res) => {
        setSummary(Array.isArray(res) ? null : res.data ?? (res as unknown as WeeklySummary));
      })
      .catch(() => {});
  }, []);

  // ---- Timer ----
  useEffect(() => {
    if (activeEntry && !activeEntry.clockOut) {
      const start = new Date(activeEntry.clockIn).getTime();
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
    } catch (err: any) {
      setError(err.message || 'Clock in failed');
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
    } catch (err: any) {
      setError(err.message || 'Clock out failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitDrafts = async () => {
    setActionLoading(true);
    try {
      await apiPost('/timekeeping/submit');
      loadEntries();
    } catch (err: any) {
      setError(err.message || 'Submit failed');
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
    } catch (err: any) {
      setError(err.message || 'Approve failed');
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
    } catch (err: any) {
      setError(err.message || 'Reject failed');
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
                Started at {formatTime(activeEntry.clockIn)}
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
            { label: 'Normal Hours', value: formatMinutes(summary.totalNormalMinutes), color: '#2563eb' },
            { label: 'Overtime', value: formatMinutes(summary.totalOvertimeMinutes), color: '#f59e0b' },
            { label: 'Travel', value: formatMinutes(summary.totalTravelMinutes), color: '#8b5cf6' },
            { label: 'Break', value: formatMinutes(summary.totalBreakMinutes), color: '#6b7280' },
            { label: 'Total Cost', value: `CHF ${formatCHF(summary.totalCostCents)}`, color: '#16a34a' },
          ].map((item) => (
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
        {selected.size > 0 && (
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
              {['Date', 'Project', 'Start', 'End', 'Break', 'Normal', 'Overtime', 'Travel', 'Status', 'Cost'].map((h) => (
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
                    {formatDate(entry.clockIn)}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14 }}>
                    {entry.project?.name || '-'}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(entry.clockIn)}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {entry.clockOut ? formatTime(entry.clockOut) : (
                      <span style={{ color: '#16a34a', fontWeight: 500, fontSize: 12 }}>Active</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {formatMinutes(entry.breakMinutes)}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {formatMinutes(entry.normalMinutes)}
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
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    CHF {formatCHF(entry.costCents ?? 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
