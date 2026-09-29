import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPost, apiPatch, ApiError } from '../lib/api';
import { formatMoney, formatDate, statusLabel, enumLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Client {
  id: string;
  name: string;
}

interface Lot {
  id: string;
  name: string;
  description?: string | null;
  /** Absent for field roles (financials are stripped server-side). */
  budgetCents?: number | null;
}

interface UserRef {
  id: string;
  firstName: string;
  lastName: string;
}

interface Milestone {
  id: string;
  name: string;
  targetDate: string;
  completedDate?: string;
  status: string;
}

interface TaskDependency {
  predecessorId: string;
  predecessorTitle?: string;
}

interface Task {
  id: string;
  title: string;
  description?: string | null;
  lotId: string | null;
  status: string;
  priority: string;
  assignedTo?: string | null;
  assignee?: UserRef | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  estimatedHours?: number | null;
  progressPercent: number;
  dependencies?: TaskDependency[];
}

/** Raw shape of GET /projects/:id/gantt. */
interface GanttApiResponse {
  tasks: (Task & { lot?: { id: string; name: string } | null })[];
  dependencies: { predecessorId: string; successorId: string; type: string; lagDays: number }[];
}

interface GanttTask {
  id: string;
  title: string;
  lotId: string;
  lotName: string;
  status: string;
  plannedStart: string;
  plannedEnd: string;
  dependencies: string[];
}

interface GanttMilestone {
  id: string;
  name: string;
  date: string;
}

interface GanttData {
  tasks: GanttTask[];
  milestones: GanttMilestone[];
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
  actualCostCents?: number;
  manager?: UserRef | null;
  startDate?: string;
  endDate?: string;
  lots?: Lot[];
  milestones?: Milestone[];
  tasks?: Task[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'] as const;

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  planning: { bg: '#e0e7ff', fg: '#3730a3' },
  active: { bg: '#dcfce7', fg: '#166534' },
  on_hold: { bg: '#fef3c7', fg: '#92400e' },
  completed: { bg: '#f1f5f9', fg: '#475569' },
  cancelled: { bg: '#fee2e2', fg: '#991b1b' },
};

const TASK_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  todo: { bg: '#f3f4f6', fg: '#374151' },
  in_progress: { bg: '#dbeafe', fg: '#1e40af' },
  done: { bg: '#dcfce7', fg: '#166534' },
  validated: { bg: '#d1fae5', fg: '#065f46' },
  cancelled: { bg: '#fee2e2', fg: '#991b1b' },
};

const PRIORITY_COLORS: Record<string, { bg: string; fg: string }> = {
  low: { bg: '#f3f4f6', fg: '#6b7280' },
  normal: { bg: '#fef3c7', fg: '#92400e' },
  high: { bg: '#fed7aa', fg: '#9a3412' },
  urgent: { bg: '#fee2e2', fg: '#991b1b' },
};

const MILESTONE_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#f3f4f6', fg: '#374151' },
  in_progress: { bg: '#dbeafe', fg: '#1e40af' },
  completed: { bg: '#dcfce7', fg: '#166534' },
  overdue: { bg: '#fee2e2', fg: '#991b1b' },
};

// Must match the DB CHECK constraints on task.status / task.priority.
const TASK_STATUSES = ['todo', 'in_progress', 'done', 'validated', 'cancelled'] as const;
const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

const GANTT_BAR_COLORS: Record<string, string> = {
  todo: '#9ca3af',
  in_progress: '#3b82f6',
  done: '#22c55e',
  validated: '#059669',
  cancelled: '#ef4444',
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

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const buttonSecondaryStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#f3f4f6',
  color: '#374151',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function userName(u?: UserRef | null): string {
  return u ? `${u.firstName} ${u.lastName}`.trim() : '';
}

/** CHF amount as integer centimes, or undefined when not a positive number. */
function chfToCents(chf: string): number | undefined {
  const n = Number(chf);
  return chf.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Drops keys whose value is '' / null / undefined so optional DTO fields are simply omitted. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined),
  ) as Partial<T>;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
/* ------------------------------------------------------------------ */

type TabKey = 'lots' | 'milestones' | 'tasks' | 'gantt';

const TABS: { key: TabKey }[] = [
  { key: 'lots' },
  { key: 'milestones' },
  { key: 'tasks' },
  { key: 'gantt' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('projectDetail');
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>('lots');

  /* --- Form states --- */
  const [showLotForm, setShowLotForm] = useState(false);
  const [lotForm, setLotForm] = useState({ name: '', description: '', budgetChf: '' });

  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [milestoneForm, setMilestoneForm] = useState({ name: '', targetDate: '' });

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    lotId: '',
    priority: 'normal',
    plannedStart: '',
    plannedEnd: '',
    estimatedHours: '' as string | number,
    assignedTo: '',
  });

  const [taskLotFilter, setTaskLotFilter] = useState('');

  /* --- Queries --- */

  const {
    data: project,
    isLoading,
    error,
  } = useQuery<Project, ApiError>({
    queryKey: ['project', id],
    queryFn: () => apiGet<Project>(`/projects/${id}`),
    enabled: !!id,
    retry: false,
  });

  const { data: ganttData } = useQuery<GanttData, ApiError>({
    queryKey: ['project-gantt', id],
    queryFn: async () => {
      const raw = await apiGet<GanttApiResponse>(`/projects/${id}/gantt`);
      return {
        tasks: raw.tasks
          .filter((t) => t.plannedStart && t.plannedEnd)
          .map((t) => ({
            id: t.id,
            title: t.title,
            lotId: t.lotId ?? '',
            lotName: t.lot?.name ?? '',
            status: t.status,
            plannedStart: t.plannedStart as string,
            plannedEnd: t.plannedEnd as string,
            dependencies: raw.dependencies
              .filter((d) => d.successorId === t.id)
              .map((d) => d.predecessorId),
          })),
        milestones: (project?.milestones ?? [])
          .filter((m) => m.targetDate)
          .map((m) => ({ id: m.id, name: m.name, date: m.targetDate })),
      };
    },
    enabled: !!id && activeTab === 'gantt',
    retry: false,
  });

  /* --- Mutations --- */

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['project', id] });

  const addLotMutation = useMutation({
    mutationFn: (data: typeof lotForm) =>
      apiPost(
        `/projects/${id}/lots`,
        compact({
          name: data.name.trim(),
          description: data.description.trim(),
          budgetCents: chfToCents(data.budgetChf),
        }),
      ),
    onSuccess: () => {
      invalidate();
      setShowLotForm(false);
      setLotForm({ name: '', description: '', budgetChf: '' });
    },
  });

  const addMilestoneMutation = useMutation({
    mutationFn: (data: typeof milestoneForm) =>
      apiPost(`/projects/${id}/milestones`, { name: data.name.trim(), targetDate: data.targetDate }),
    onSuccess: () => {
      invalidate();
      setShowMilestoneForm(false);
      setMilestoneForm({ name: '', targetDate: '' });
    },
  });

  const completeMilestoneMutation = useMutation({
    mutationFn: (milestoneId: string) =>
      apiPatch(`/projects/${id}/milestones/${milestoneId}`, {
        status: 'completed',
        completedDate: todayIso(),
      }),
    onSuccess: invalidate,
  });

  const addTaskMutation = useMutation({
    mutationFn: (data: {
      title: string;
      description: string;
      lotId: string;
      priority: string;
      plannedStart: string;
      plannedEnd: string;
      estimatedHours: number | null;
      assignedTo: string;
    }) => apiPost(`/projects/${id}/tasks`, compact(data)),
    onSuccess: () => {
      invalidate();
      setShowTaskForm(false);
      setTaskForm({
        title: '',
        description: '',
        lotId: '',
        priority: 'normal',
        plannedStart: '',
        plannedEnd: '',
        estimatedHours: '',
        assignedTo: '',
      });
    },
  });

  const updateTaskStatusMutation = useMutation({
    mutationFn: (data: { taskId: string; status: string }) =>
      apiPatch(`/projects/${id}/tasks/${data.taskId}`, { status: data.status }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['project-gantt', id] });
    },
  });

  /* --- Derived --- */

  const lots = project?.lots ?? [];
  const milestones = project?.milestones ?? [];
  const tasks = project?.tasks ?? [];

  const filteredTasks = taskLotFilter
    ? tasks.filter((t) => t.lotId === taskLotFilter)
    : tasks;

  /* Group tasks by lot */
  const tasksByLot = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of filteredTasks) {
      const key = t.lotId || '__unassigned__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [filteredTasks]);

  const lotTaskCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) if (t.lotId) m.set(t.lotId, (m.get(t.lotId) ?? 0) + 1);
    return m;
  }, [tasks]);

  const lotNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lots) m.set(l.id, l.name);
    return m;
  }, [lots]);

  /* --- Render --- */

  if (error instanceof ApiError && error.status === 401) {
    return <div style={{ color: '#ef4444', padding: 20 }}>{t('loginRequired')}</div>;
  }

  if (isLoading) {
    return <div style={{ color: '#6b7280', padding: 20 }}>{t('common:state.loading')}</div>;
  }

  if (error && error.status !== 404) {
    return <div style={{ color: '#ef4444', padding: 20 }}>{errorMessage(error)}</div>;
  }

  if (!project) {
    return <div style={{ color: '#ef4444', padding: 20 }}>{t('notFound')}</div>;
  }

  const colors = STATUS_COLORS[project.status] ?? STATUS_COLORS.planning;
  const progressPct = Math.min(100, Math.max(0, project.progressPercent ?? 0));
  const progressColor =
    progressPct >= 100 ? '#22c55e' : progressPct >= 50 ? '#2563eb' : '#f59e0b';

  return (
    <div>
      {/* Back nav */}
      <button
        onClick={() => navigate('/projects')}
        style={{
          background: 'none',
          border: 'none',
          color: '#2563eb',
          fontSize: 14,
          cursor: 'pointer',
          padding: 0,
          marginBottom: 16,
        }}
      >
        {t('back')}
      </button>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 6px 0' }}>
            {project.name}
          </h1>
          <div style={{ fontSize: 14, color: '#6b7280', display: 'flex', gap: 12, alignItems: 'center' }}>
            <span>{project.client?.name ?? '-'}</span>
            <span style={{ color: '#d1d5db' }}>|</span>
            <span>{t('reference', { reference: project.reference || '-' })}</span>
            <span style={{ color: '#d1d5db' }}>|</span>
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
              {statusLabel('project', project.status)}
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar (large) */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{t('progress')}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: progressColor }}>{progressPct}%</span>
        </div>
        <div
          style={{
            width: '100%',
            height: 12,
            background: '#e5e7eb',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progressPct}%`,
              height: '100%',
              background: progressColor,
              borderRadius: 6,
              transition: 'width 0.3s',
            }}
          />
        </div>
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 16,
          marginBottom: 32,
        }}
      >
        <SummaryCard
          label={t('summary.budget')}
          value={project.budgetHtCents != null ? formatMoney(project.budgetHtCents) : '—'}
          highlight
        />
        <SummaryCard
          label={t('summary.actualCost')}
          value={project.actualCostCents != null ? formatMoney(project.actualCostCents) : '—'}
        />
        <SummaryCard label={t('summary.manager')} value={userName(project.manager) || '-'} />
        <SummaryCard
          label={t('summary.start')}
          value={project.startDate ? formatDate(project.startDate) : '-'}
        />
        <SummaryCard
          label={t('summary.end')}
          value={project.endDate ? formatDate(project.endDate) : '-'}
        />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '2px solid #e5e7eb',
          marginBottom: 24,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: 'none',
              fontSize: 14,
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: -2,
              cursor: 'pointer',
              transition: 'color 0.15s',
            }}
          >
            {t(`tabs.${tab.key}`)}
          </button>
        ))}
      </div>

      {/* Tab: Lots */}
      {activeTab === 'lots' && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: 0 }}>
              {t('lots.title', { count: lots.length })}
            </h2>
            <button
              style={buttonStyle}
              onClick={() => setShowLotForm(!showLotForm)}
            >
              {showLotForm ? t('common:actions.cancel') : t('lots.add')}
            </button>
          </div>

          {showLotForm && (
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 2fr 1fr',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <input
                  style={inputStyle}
                  placeholder={t('lots.namePlaceholder')}
                  value={lotForm.name}
                  onChange={(e) => setLotForm({ ...lotForm, name: e.target.value })}
                />
                <input
                  style={inputStyle}
                  placeholder={t('lots.descriptionPlaceholder')}
                  value={lotForm.description}
                  onChange={(e) => setLotForm({ ...lotForm, description: e.target.value })}
                />
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  step="0.05"
                  placeholder={t('lots.budgetPlaceholder')}
                  value={lotForm.budgetChf}
                  onChange={(e) => setLotForm({ ...lotForm, budgetChf: e.target.value })}
                />
              </div>
              <button
                style={buttonStyle}
                onClick={() => lotForm.name && addLotMutation.mutate(lotForm)}
                disabled={addLotMutation.isPending}
              >
                {addLotMutation.isPending ? t('adding') : t('lots.submit')}
              </button>
              {addLotMutation.error && (
                <span style={{ color: '#ef4444', marginLeft: 12, fontSize: 13 }}>
                  {errorMessage(addLotMutation.error)}
                </span>
              )}
            </div>
          )}

          {lots.length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 14 }}>{t('lots.empty')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {(['name', 'description', 'budget', 'tasks'] as const).map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '2px solid #e5e7eb',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#6b7280',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                    >
                      {t(`lots.table.${h}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.id}>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 14, fontWeight: 500 }}>
                      {lot.name}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 14, color: '#6b7280' }}>
                      {lot.description || '-'}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                      {lot.budgetCents != null ? formatMoney(lot.budgetCents) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                      {lotTaskCounts.get(lot.id) ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab: Milestones */}
      {activeTab === 'milestones' && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: 0 }}>
              {t('milestones.title', { count: milestones.length })}
            </h2>
            <button
              style={buttonStyle}
              onClick={() => setShowMilestoneForm(!showMilestoneForm)}
            >
              {showMilestoneForm ? t('common:actions.cancel') : t('milestones.add')}
            </button>
          </div>

          {showMilestoneForm && (
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <input
                  style={inputStyle}
                  placeholder={t('milestones.namePlaceholder')}
                  value={milestoneForm.name}
                  onChange={(e) => setMilestoneForm({ ...milestoneForm, name: e.target.value })}
                />
                <input
                  style={inputStyle}
                  type="date"
                  value={milestoneForm.targetDate}
                  onChange={(e) => setMilestoneForm({ ...milestoneForm, targetDate: e.target.value })}
                />
              </div>
              <button
                style={buttonStyle}
                onClick={() =>
                  milestoneForm.name && milestoneForm.targetDate && addMilestoneMutation.mutate(milestoneForm)
                }
                disabled={addMilestoneMutation.isPending}
              >
                {addMilestoneMutation.isPending ? t('adding') : t('milestones.submit')}
              </button>
              {addMilestoneMutation.error && (
                <span style={{ color: '#ef4444', marginLeft: 12, fontSize: 13 }}>
                  {errorMessage(addMilestoneMutation.error)}
                </span>
              )}
            </div>
          )}

          {completeMilestoneMutation.error && (
            <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>
              {errorMessage(completeMilestoneMutation.error)}
            </div>
          )}

          {milestones.length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 14 }}>{t('milestones.empty')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {(['name', 'targetDate', 'completedDate', 'status', 'actions'] as const).map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '2px solid #e5e7eb',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#6b7280',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                    >
                      {t(`milestones.table.${h}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {milestones.map((m) => {
                  const mColors = MILESTONE_STATUS_COLORS[m.status] ?? MILESTONE_STATUS_COLORS.pending;
                  return (
                    <tr key={m.id}>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 14, fontWeight: 500 }}>
                        {m.name}
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                        {m.targetDate ? formatDate(m.targetDate) : '-'}
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 14, color: '#6b7280' }}>
                        {m.completedDate ? formatDate(m.completedDate) : '-'}
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            background: mColors.bg,
                            color: mColors.fg,
                          }}
                        >
                          {statusLabel('milestone', m.status)}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>
                        {m.status !== 'completed' && (
                          <button
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#2563eb',
                              cursor: 'pointer',
                              fontSize: 13,
                              padding: '2px 6px',
                            }}
                            onClick={() => completeMilestoneMutation.mutate(m.id)}
                            disabled={completeMilestoneMutation.isPending}
                          >
                            {t('milestones.markCompleted')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab: Tasks */}
      {activeTab === 'tasks' && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: 0 }}>
              {t('tasks.title', { count: tasks.length })}
            </h2>
            <button
              style={buttonStyle}
              onClick={() => setShowTaskForm(!showTaskForm)}
            >
              {showTaskForm ? t('common:actions.cancel') : t('tasks.add')}
            </button>
          </div>

          {/* Lot filter */}
          <div style={{ marginBottom: 16 }}>
            <select
              style={{ ...inputStyle, maxWidth: 250 }}
              value={taskLotFilter}
              onChange={(e) => setTaskLotFilter(e.target.value)}
            >
              <option value="">{t('tasks.allLots')}</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* Add task form */}
          {showTaskForm && (
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 12 }}>
                {t('tasks.newTask')}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr',
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <input
                  style={inputStyle}
                  placeholder={t('tasks.titlePlaceholder')}
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                />
                <select
                  style={inputStyle}
                  value={taskForm.lotId}
                  onChange={(e) => setTaskForm({ ...taskForm, lotId: e.target.value })}
                >
                  <option value="">{t('tasks.selectLot')}</option>
                  {lots.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <select
                  style={inputStyle}
                  value={taskForm.priority}
                  onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {enumLabel('taskPriority', p)}
                    </option>
                  ))}
                </select>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <input
                  style={inputStyle}
                  placeholder={t('tasks.descriptionPlaceholder')}
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                />
                <input
                  style={inputStyle}
                  type="date"
                  placeholder={t('tasks.plannedStart')}
                  value={taskForm.plannedStart}
                  onChange={(e) => setTaskForm({ ...taskForm, plannedStart: e.target.value })}
                  title={t('tasks.plannedStart')}
                />
                <input
                  style={inputStyle}
                  type="date"
                  placeholder={t('tasks.plannedEnd')}
                  value={taskForm.plannedEnd}
                  onChange={(e) => setTaskForm({ ...taskForm, plannedEnd: e.target.value })}
                  title={t('tasks.plannedEnd')}
                />
                <input
                  style={inputStyle}
                  type="number"
                  placeholder={t('tasks.estimatedHours')}
                  value={taskForm.estimatedHours}
                  onChange={(e) =>
                    setTaskForm({
                      ...taskForm,
                      estimatedHours: e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                />
                <input
                  style={inputStyle}
                  placeholder={t('tasks.assigneePlaceholder')}
                  value={taskForm.assignedTo}
                  onChange={(e) => setTaskForm({ ...taskForm, assignedTo: e.target.value })}
                />
              </div>
              <button
                style={buttonStyle}
                onClick={() => {
                  if (!taskForm.title) return;
                  addTaskMutation.mutate({
                    title: taskForm.title,
                    description: taskForm.description,
                    lotId: taskForm.lotId,
                    priority: taskForm.priority,
                    plannedStart: taskForm.plannedStart,
                    plannedEnd: taskForm.plannedEnd,
                    estimatedHours: taskForm.estimatedHours === '' ? null : Number(taskForm.estimatedHours),
                    assignedTo: taskForm.assignedTo,
                  });
                }}
                disabled={addTaskMutation.isPending}
              >
                {addTaskMutation.isPending ? t('adding') : t('tasks.submit')}
              </button>
              {addTaskMutation.error && (
                <span style={{ color: '#ef4444', marginLeft: 12, fontSize: 13 }}>
                  {errorMessage(addTaskMutation.error)}
                </span>
              )}
            </div>
          )}

          {updateTaskStatusMutation.error && (
            <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>
              {errorMessage(updateTaskStatusMutation.error)}
            </div>
          )}

          {/* Tasks grouped by lot */}
          {filteredTasks.length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 14 }}>{t('tasks.empty')}</div>
          ) : (
            Array.from(tasksByLot.entries()).map(([lotId, lotTasks]) => (
              <div key={lotId} style={{ marginBottom: 24 }}>
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#374151',
                    marginBottom: 8,
                    marginTop: 0,
                    padding: '6px 10px',
                    background: '#f9fafb',
                    borderRadius: 4,
                  }}
                >
                  {lotNameMap.get(lotId) ?? t('tasks.unassigned')}
                </h3>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {(['title', 'status', 'priority', 'assignedTo', 'start', 'end', 'progress', 'dependencies'] as const).map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: 'left',
                            padding: '6px 10px',
                            borderBottom: '2px solid #e5e7eb',
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#6b7280',
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                          }}
                        >
                          {t(`tasks.table.${h}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lotTasks.map((task) => {
                      const tColors = TASK_STATUS_COLORS[task.status] ?? TASK_STATUS_COLORS.todo;
                      const pColors = PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.normal;
                      const taskProg = Math.min(100, Math.max(0, task.progressPercent ?? 0));
                      return (
                        <tr key={task.id}>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 13, fontWeight: 500 }}>
                            {task.title}
                          </td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f3f4f6' }}>
                            <select
                              style={{
                                padding: '2px 6px',
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 600,
                                background: tColors.bg,
                                color: tColors.fg,
                                border: 'none',
                                cursor: 'pointer',
                              }}
                              value={task.status}
                              onChange={(e) =>
                                updateTaskStatusMutation.mutate({
                                  taskId: task.id,
                                  status: e.target.value,
                                })
                              }
                            >
                              {TASK_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {statusLabel('task', s)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f3f4f6' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 600,
                                background: pColors.bg,
                                color: pColors.fg,
                              }}
                            >
                              {enumLabel('taskPriority', task.priority)}
                            </span>
                          </td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                            {userName(task.assignee) || '-'}
                          </td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#6b7280' }}>
                            {task.plannedStart ? formatDate(task.plannedStart) : '-'}
                          </td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#6b7280' }}>
                            {task.plannedEnd ? formatDate(task.plannedEnd) : '-'}
                          </td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f3f4f6' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <div
                                style={{
                                  width: 50,
                                  height: 6,
                                  background: '#e5e7eb',
                                  borderRadius: 3,
                                  overflow: 'hidden',
                                }}
                              >
                                <div
                                  style={{
                                    width: `${taskProg}%`,
                                    height: '100%',
                                    background: taskProg >= 100 ? '#22c55e' : '#3b82f6',
                                    borderRadius: 3,
                                  }}
                                />
                              </div>
                              <span style={{ fontSize: 11, color: '#6b7280' }}>{taskProg}%</span>
                            </div>
                          </td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#6b7280' }}>
                            {task.dependencies && task.dependencies.length > 0
                              ? task.dependencies.map((d) => d.predecessorTitle ?? d.predecessorId).join(', ')
                              : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Gantt Chart */}
      {activeTab === 'gantt' && (
        <GanttChart data={ganttData ?? null} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Gantt Chart Component                                              */
/* ------------------------------------------------------------------ */

function GanttChart({ data }: { data: GanttData | null }) {
  const { t, i18n } = useTranslation('projectDetail');
  const PX_PER_DAY = 3;
  const ROW_HEIGHT = 32;
  const LABEL_WIDTH = 220;
  const HEADER_HEIGHT = 40;
  const LOT_HEADER_HEIGHT = 28;

  if (!data || data.tasks.length === 0) {
    return (
      <div style={{ color: '#9ca3af', fontSize: 14, padding: 20 }}>
        {t('gantt.noTasks')}
      </div>
    );
  }

  /* Compute date range */
  const allDates: Date[] = [];
  for (const t of data.tasks) {
    if (t.plannedStart) allDates.push(new Date(t.plannedStart));
    if (t.plannedEnd) allDates.push(new Date(t.plannedEnd));
  }
  for (const m of data.milestones) {
    if (m.date) allDates.push(new Date(m.date));
  }

  if (allDates.length === 0) {
    return (
      <div style={{ color: '#9ca3af', fontSize: 14, padding: 20 }}>
        {t('gantt.noDates')}
      </div>
    );
  }

  const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));

  /* Add buffer */
  const startDate = new Date(minDate);
  startDate.setDate(startDate.getDate() - 7);
  const endDate = new Date(maxDate);
  endDate.setDate(endDate.getDate() + 14);

  const totalDays = daysBetween(startDate, endDate);
  const chartWidth = totalDays * PX_PER_DAY;

  /* Group tasks by lot */
  const lotGroups = new Map<string, GanttTask[]>();
  for (const task of data.tasks) {
    const key = task.lotName || t('gantt.unassigned');
    if (!lotGroups.has(key)) lotGroups.set(key, []);
    lotGroups.get(key)!.push(task);
  }

  /* Build rows for rendering */
  interface GanttRow {
    type: 'lot_header' | 'task';
    label: string;
    task?: GanttTask;
  }

  const rows: GanttRow[] = [];
  for (const [lotName, lotTasks] of lotGroups) {
    rows.push({ type: 'lot_header', label: lotName });
    for (const t of lotTasks) {
      rows.push({ type: 'task', label: t.title, task: t });
    }
  }

  /* Compute chart height */
  let chartContentHeight = 0;
  for (const r of rows) {
    chartContentHeight += r.type === 'lot_header' ? LOT_HEADER_HEIGHT : ROW_HEIGHT;
  }
  const chartHeight = chartContentHeight + HEADER_HEIGHT;

  /* Date helper */
  function dayOffset(dateStr: string): number {
    return daysBetween(startDate, new Date(dateStr));
  }

  /* Generate month markers */
  const months: { label: string; x: number }[] = [];
  const cursor = new Date(startDate);
  cursor.setDate(1);
  if (cursor < startDate) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor <= endDate) {
    const offset = daysBetween(startDate, cursor);
    months.push({
      label: cursor.toLocaleDateString(`${i18n.language}-CH`, { month: 'short', year: '2-digit' }),
      x: offset * PX_PER_DAY,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  /* Today marker */
  const today = new Date();
  const todayOffset = daysBetween(startDate, today);
  const todayX = todayOffset * PX_PER_DAY;
  const showToday = todayOffset >= 0 && todayOffset <= totalDays;

  /* Task positions map for dependency arrows */
  const taskPositions = new Map<string, { x: number; y: number; width: number }>();
  let yAcc = HEADER_HEIGHT;
  for (const r of rows) {
    if (r.type === 'lot_header') {
      yAcc += LOT_HEADER_HEIGHT;
    } else if (r.task) {
      const t = r.task;
      const start = dayOffset(t.plannedStart) * PX_PER_DAY;
      const end = dayOffset(t.plannedEnd) * PX_PER_DAY;
      const barWidth = Math.max(end - start, PX_PER_DAY);
      taskPositions.set(t.id, { x: start, y: yAcc + ROW_HEIGHT / 2, width: barWidth });
      yAcc += ROW_HEIGHT;
    }
  }

  /* Dependency arrows */
  const arrows: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const t of data.tasks) {
    if (!t.dependencies) continue;
    const target = taskPositions.get(t.id);
    if (!target) continue;
    for (const depId of t.dependencies) {
      const source = taskPositions.get(depId);
      if (!source) continue;
      arrows.push({
        x1: source.x + source.width,
        y1: source.y,
        x2: target.x,
        y2: target.y,
      });
    }
  }

  /* Render */
  let yPos = HEADER_HEIGHT;

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: '0 0 16px 0' }}>
        {t('gantt.title')}
      </h2>
      <div
        style={{
          display: 'flex',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {/* Labels column */}
        <div
          style={{
            width: LABEL_WIDTH,
            minWidth: LABEL_WIDTH,
            borderRight: '1px solid #e5e7eb',
            background: '#f9fafb',
          }}
        >
          {/* Header spacer */}
          <div
            style={{
              height: HEADER_HEIGHT,
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              alignItems: 'center',
              padding: '0 12px',
              fontSize: 12,
              fontWeight: 600,
              color: '#6b7280',
              textTransform: 'uppercase',
            }}
          >
            {t('gantt.task')}
          </div>
          {rows.map((r, i) => {
            if (r.type === 'lot_header') {
              return (
                <div
                  key={`lbl-${i}`}
                  style={{
                    height: LOT_HEADER_HEIGHT,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 12px',
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#1e40af',
                    background: '#eff6ff',
                    borderBottom: '1px solid #e5e7eb',
                  }}
                >
                  {r.label}
                </div>
              );
            }
            return (
              <div
                key={`lbl-${i}`}
                style={{
                  height: ROW_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 12px',
                  fontSize: 12,
                  color: '#374151',
                  borderBottom: '1px solid #f3f4f6',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={r.label}
              >
                {r.label}
              </div>
            );
          })}
        </div>

        {/* Chart area */}
        <div style={{ flex: 1, overflowX: 'auto' }}>
          <div style={{ position: 'relative', width: chartWidth, height: chartHeight }}>
            {/* Month headers */}
            {months.map((m, i) => (
              <div
                key={`month-${i}`}
                style={{
                  position: 'absolute',
                  left: m.x,
                  top: 0,
                  height: HEADER_HEIGHT,
                  borderLeft: '1px solid #e5e7eb',
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 6px',
                  fontSize: 11,
                  color: '#6b7280',
                  fontWeight: 500,
                }}
              >
                {m.label}
              </div>
            ))}

            {/* Month grid lines */}
            {months.map((m, i) => (
              <div
                key={`grid-${i}`}
                style={{
                  position: 'absolute',
                  left: m.x,
                  top: HEADER_HEIGHT,
                  width: 1,
                  height: chartContentHeight,
                  background: '#f3f4f6',
                }}
              />
            ))}

            {/* Row backgrounds + task bars */}
            {(() => {
              yPos = HEADER_HEIGHT;
              return rows.map((r, i) => {
                const currentY = yPos;
                if (r.type === 'lot_header') {
                  yPos += LOT_HEADER_HEIGHT;
                  return (
                    <div
                      key={`row-${i}`}
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: currentY,
                        width: chartWidth,
                        height: LOT_HEADER_HEIGHT,
                        background: '#eff6ff',
                        borderBottom: '1px solid #e5e7eb',
                      }}
                    />
                  );
                }

                yPos += ROW_HEIGHT;
                const task = r.task!;
                const barStart = dayOffset(task.plannedStart) * PX_PER_DAY;
                const barEnd = dayOffset(task.plannedEnd) * PX_PER_DAY;
                const barWidth = Math.max(barEnd - barStart, PX_PER_DAY);
                const barColor = GANTT_BAR_COLORS[task.status] ?? GANTT_BAR_COLORS.todo;

                return (
                  <div key={`row-${i}`}>
                    {/* Row stripe */}
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: currentY,
                        width: chartWidth,
                        height: ROW_HEIGHT,
                        background: i % 2 === 0 ? '#fff' : '#fafafa',
                        borderBottom: '1px solid #f3f4f6',
                      }}
                    />
                    {/* Task bar */}
                    <div
                      style={{
                        position: 'absolute',
                        left: barStart,
                        top: currentY + 8,
                        width: barWidth,
                        height: ROW_HEIGHT - 16,
                        background: barColor,
                        borderRadius: 3,
                        cursor: 'default',
                        minWidth: 4,
                      }}
                      title={t('gantt.barTitle', {
                        title: task.title,
                        start: formatDate(task.plannedStart),
                        end: formatDate(task.plannedEnd),
                        status: statusLabel('task', task.status),
                      })}
                    />
                  </div>
                );
              });
            })()}

            {/* Milestone diamonds */}
            {data.milestones.map((m) => {
              if (!m.date) return null;
              const mx = dayOffset(m.date) * PX_PER_DAY;
              return (
                <div
                  key={`ms-${m.id}`}
                  style={{
                    position: 'absolute',
                    left: mx - 6,
                    top: HEADER_HEIGHT + chartContentHeight - 20,
                    width: 12,
                    height: 12,
                    background: '#f59e0b',
                    transform: 'rotate(45deg)',
                    borderRadius: 2,
                  }}
                  title={t('gantt.milestoneTitle', { name: m.name, date: formatDate(m.date) })}
                />
              );
            })}

            {/* Today line */}
            {showToday && (
              <div
                style={{
                  position: 'absolute',
                  left: todayX,
                  top: HEADER_HEIGHT,
                  width: 0,
                  height: chartContentHeight,
                  borderLeft: '2px dashed #ef4444',
                  zIndex: 2,
                }}
                title={t('gantt.today')}
              />
            )}

            {/* Dependency arrows (SVG overlay) */}
            {arrows.length > 0 && (
              <svg
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: chartWidth,
                  height: chartHeight,
                  pointerEvents: 'none',
                  overflow: 'visible',
                }}
              >
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="8"
                    markerHeight="6"
                    refX="8"
                    refY="3"
                    orient="auto"
                  >
                    <polygon points="0 0, 8 3, 0 6" fill="#9ca3af" />
                  </marker>
                </defs>
                {arrows.map((a, i) => {
                  /* Simple right-angle connector */
                  const midX = a.x1 + (a.x2 - a.x1) / 2;
                  return (
                    <path
                      key={`dep-${i}`}
                      d={`M ${a.x1} ${a.y1} L ${midX} ${a.y1} L ${midX} ${a.y2} L ${a.x2} ${a.y2}`}
                      fill="none"
                      stroke="#9ca3af"
                      strokeWidth={1.5}
                      markerEnd="url(#arrowhead)"
                    />
                  );
                })}
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SummaryCard                                                        */
/* ------------------------------------------------------------------ */

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        background: highlight ? '#eff6ff' : '#fff',
        border: `1px solid ${highlight ? '#bfdbfe' : '#e5e7eb'}`,
        borderRadius: 8,
        padding: '16px 14px',
      }}
    >
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{label}</div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: highlight ? '#1d4ed8' : '#111827',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  );
}
