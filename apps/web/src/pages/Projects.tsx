import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiGet, ApiError, formatCHF } from '../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Client {
  id: string;
  name: string;
}

interface Project {
  id: string;
  reference: string;
  name: string;
  clientId: string;
  client?: Client;
  status: string;
  progressPercent: number;
  /** Absent for field roles (financials are stripped server-side). */
  budgetHtCents?: number | null;
  manager?: { id: string; firstName: string; lastName: string } | null;
  startDate?: string;
  endDate?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'] as const;

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  planning: { bg: '#e0e7ff', fg: '#3730a3' },
  active: { bg: '#dcfce7', fg: '#166534' },
  on_hold: { bg: '#fef3c7', fg: '#92400e' },
  completed: { bg: '#f1f5f9', fg: '#475569' },
  cancelled: { bg: '#fee2e2', fg: '#991b1b' },
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function managerName(m: Project['manager']): string {
  return m ? `${m.firstName} ${m.lastName}`.trim() : '';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Projects() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const {
    data: projects = [],
    isLoading,
    error,
  } = useQuery<Project[], ApiError>({
    queryKey: ['projects', statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter) params.set('status', statusFilter);
      return apiGet<Project[]>(`/projects?${params.toString()}`);
    },
    retry: false,
  });

  const filtered = projects.filter((p) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      (p.reference ?? '').toLowerCase().includes(term) ||
      managerName(p.manager).toLowerCase().includes(term)
    );
  });

  if (error instanceof ApiError && error.status === 401) {
    return <div style={{ color: '#ef4444', padding: 20 }}>Login required</div>;
  }
  if (error) {
    return <div style={{ color: '#ef4444', padding: 20 }}>{error.message}</div>;
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>
          Projects
        </h1>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input
          style={{ ...inputStyle, maxWidth: 300 }}
          placeholder="Search by name, reference, manager..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={{ ...inputStyle, maxWidth: 200 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ color: '#6b7280', padding: 20 }}>Loading...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Reference', 'Name', 'Client', 'Status', 'Progress', 'Budget HT (CHF)', 'Manager', 'Start Date'].map(
                (h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderBottom: '2px solid #e5e7eb',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}
                >
                  No projects found
                </td>
              </tr>
            )}
            {filtered.map((project) => {
              const colors = STATUS_COLORS[project.status] ?? STATUS_COLORS.planning;
              const progressPct = Math.min(100, Math.max(0, project.progressPercent ?? 0));
              const progressColor =
                progressPct >= 100 ? '#22c55e' : progressPct >= 50 ? '#2563eb' : '#f59e0b';

              return (
                <tr
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  style={{ cursor: 'pointer' }}
                  onMouseOver={(e) => {
                    (e.currentTarget as HTMLElement).style.background = '#f9fafb';
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLElement).style.background = '';
                  }}
                >
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontWeight: 500, fontSize: 14 }}>
                    {project.reference || '-'}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                    {project.name}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                    {project.client?.name ?? '-'}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                        background: colors.bg,
                        color: colors.fg,
                      }}
                    >
                      {statusLabel(project.status)}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 80,
                          height: 8,
                          background: '#e5e7eb',
                          borderRadius: 4,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${progressPct}%`,
                            height: '100%',
                            background: progressColor,
                            borderRadius: 4,
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 12, color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>
                        {progressPct}%
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>
                    {project.budgetHtCents != null ? `CHF ${formatCHF(project.budgetHtCents)}` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                    {managerName(project.manager) || '-'}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 13, color: '#6b7280' }}>
                    {project.startDate ? new Date(project.startDate).toLocaleDateString('fr-CH') : '-'}
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
