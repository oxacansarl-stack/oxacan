import { Fragment, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ChartGantt,
  CircleCheck,
  Flag,
  HardHat,
  Layers,
  ListChecks,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { apiGet, apiPost, apiPatch, ApiError } from '../lib/api';
import { formatDate, formatMoney, statusLabel, enumLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useCurrentUser, type CurrentUser, type Role } from '../lib/current-user';
import { MetaDivider, PageBody, PageHeader } from '@/components/page-header';
import { Card, CardCount, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/badge';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { DataState, EmptyState, ErrorState, Skeleton, TableSkeleton } from '@/components/states';
import { useConfirm } from '@/components/confirm-dialog';
import { useDetailCrumb } from '@/components/shell/breadcrumbs';
import { TabCount, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Ref, TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';

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

// Must match the DB CHECK constraints on task.status / task.priority.
const TASK_STATUSES = ['todo', 'in_progress', 'done', 'validated', 'cancelled'] as const;
const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

/** A worker may only report these three (API: WORKER_TASK_STATUSES in dto/task.dto.ts). */
const WORKER_TASK_STATUSES = new Set<string>(['todo', 'in_progress', 'done']);

/** Mirrors the API's @Roles policy: lots and milestones are office-only, tasks site-lead. */
const OFFICE_ROLES: Role[] = ['ADMIN', 'PROJECT_MANAGER'];
const SITE_LEAD_ROLES: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER'];

/** Priority chip tone — the Tag tones, never a raw colour. */
const PRIORITY_TONE: Record<string, 'default' | 'warn' | 'bad' | 'dashed'> = {
  low: 'dashed',
  normal: 'default',
  high: 'warn',
  urgent: 'bad',
};

/** Gantt bar fill per task status, in design tokens; it follows the StatusBadge tones. */
const GANTT_BAR_CLASS: Record<string, string> = {
  todo: 'bg-neu',
  in_progress: 'bg-copper',
  done: 'bg-ok/70',
  validated: 'bg-ok',
  cancelled: 'bg-bad',
};

type TabKey = 'lots' | 'milestones' | 'tasks' | 'gantt';

const TAB_KEYS: readonly TabKey[] = ['lots', 'milestones', 'tasks', 'gantt'];

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

/** 0–100, so a malformed percentage can never overflow a bar. */
function clampPercent(value: number | null | undefined): number {
  return Math.min(100, Math.max(0, Math.round(value ?? 0)));
}

/**
 * The statuses this user may actually set on this task. The API lets a WORKER change only
 * `status` / `progressPercent`, only on a task assigned to them, and only to todo /
 * in_progress / done (TasksService.assertWorkerMayUpdate) — anything else answers 403, so it
 * is not offered at all.
 */
function statusChoicesFor(task: Task, me: CurrentUser): readonly string[] {
  if (me.role !== 'WORKER') return TASK_STATUSES;
  if (task.assignedTo !== me.id) return [];
  return TASK_STATUSES.filter((status) => WORKER_TASK_STATUSES.has(status));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('projectDetail');
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const me = useCurrentUser();
  const [params, setParams] = useSearchParams();

  /**
   * The API strips every `*Cents` field for field roles, so a budget column would read as a
   * blank — or worse, as CHF 0.00. Only the office roles get the money at all (as in Projets).
   */
  const canSeeFinancials = me.role === 'ADMIN' || me.role === 'PROJECT_MANAGER';
  const canPlan = OFFICE_ROLES.includes(me.role);
  const canAddTask = SITE_LEAD_ROLES.includes(me.role);

  /* --- Open tab, kept in ?tab= so a tab can be linked to and bookmarked --- */

  const requestedTab = params.get('tab') ?? '';
  const activeTab: TabKey = (TAB_KEYS as readonly string[]).includes(requestedTab)
    ? (requestedTab as TabKey)
    : 'lots';

  const openTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: true });
  };

  /* --- Form states --- */

  const [lotFormOpen, setLotFormOpen] = useState(false);
  const [lotForm, setLotForm] = useState({ name: '', description: '', budgetChf: '' });

  const [milestoneFormOpen, setMilestoneFormOpen] = useState(false);
  const [milestoneForm, setMilestoneForm] = useState({ name: '', targetDate: '' });

  const [taskFormOpen, setTaskFormOpen] = useState(false);
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

  const project = useQuery<Project, ApiError>({
    queryKey: ['project', id],
    queryFn: () => apiGet<Project>(`/projects/${id}`),
    enabled: !!id,
    retry: false,
  });

  const gantt = useQuery<GanttData, ApiError>({
    queryKey: ['project-gantt', id],
    queryFn: async () => {
      const raw = await apiGet<GanttApiResponse>(`/projects/${id}/gantt`);
      return {
        tasks: raw.tasks
          .filter((task) => task.plannedStart && task.plannedEnd)
          .map((task) => ({
            id: task.id,
            title: task.title,
            lotId: task.lotId ?? '',
            lotName: task.lot?.name ?? '',
            status: task.status,
            plannedStart: task.plannedStart as string,
            plannedEnd: task.plannedEnd as string,
            dependencies: raw.dependencies
              .filter((d) => d.successorId === task.id)
              .map((d) => d.predecessorId),
          })),
        milestones: (project.data?.milestones ?? [])
          .filter((m) => m.targetDate)
          .map((m) => ({ id: m.id, name: m.name, date: m.targetDate })),
      };
    },
    enabled: !!id && activeTab === 'gantt',
    retry: false,
  });

  // Names the project in the top bar's breadcrumb instead of repeating it in the page body.
  useDetailCrumb(project.data?.name);

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
      setLotFormOpen(false);
      setLotForm({ name: '', description: '', budgetChf: '' });
    },
  });

  const addMilestoneMutation = useMutation({
    mutationFn: (data: typeof milestoneForm) =>
      apiPost(`/projects/${id}/milestones`, { name: data.name.trim(), targetDate: data.targetDate }),
    onSuccess: () => {
      invalidate();
      setMilestoneFormOpen(false);
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
      setTaskFormOpen(false);
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

  const lots = project.data?.lots ?? [];
  const milestones = project.data?.milestones ?? [];
  const tasks = project.data?.tasks ?? [];

  const filteredTasks = taskLotFilter ? tasks.filter((task) => task.lotId === taskLotFilter) : tasks;

  /* Group tasks by lot */
  const tasksByLot = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of filteredTasks) {
      const key = task.lotId || '__unassigned__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(task);
    }
    return map;
  }, [filteredTasks]);

  const lotTaskCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const task of tasks) if (task.lotId) m.set(task.lotId, (m.get(task.lotId) ?? 0) + 1);
    return m;
  }, [tasks]);

  const lotNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const lot of lots) m.set(lot.id, lot.name);
    return m;
  }, [lots]);

  /* --- Actions --- */

  const openLotForm = () => {
    addLotMutation.reset();
    setLotFormOpen(true);
  };

  const openMilestoneForm = () => {
    addMilestoneMutation.reset();
    setMilestoneFormOpen(true);
  };

  const openTaskForm = () => {
    addTaskMutation.reset();
    setTaskFormOpen(true);
  };

  /** A lot row opens its tasks: the same list, pre-filtered on that lot. */
  const showLotTasks = (lotId: string) => {
    setTaskLotFilter(lotId);
    openTab('tasks');
  };

  const completeMilestone = async (milestone: Milestone) => {
    const ok = await confirm({
      title: t('milestones.confirm.title', { name: milestone.name }),
      description: t('milestones.confirm.description', { date: formatDate(todayIso()) }),
      confirmLabel: t('milestones.markCompleted'),
      tone: 'default',
    });
    if (!ok) return;
    completeMilestoneMutation.mutate(milestone.id);
  };

  const backToProjects = (
    <Button variant="ghost" asChild>
      <Link to="/projects">
        <ArrowLeft />
        {t('back')}
      </Link>
    </Button>
  );

  /* --- Render: the states where the header itself has no project to name --- */

  if (project.isPending) {
    return (
      <PageBody>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Card>
          <TableSkeleton rows={6} cols={5} />
        </Card>
      </PageBody>
    );
  }

  if (!project.data) {
    const status = project.error?.status;
    return (
      <PageBody>
        <PageHeader title={t('title')} kicker={t('common:navGroup.sites')} actions={backToProjects} />
        <Card>
          {status === 404 ? (
            <EmptyState
              icon={<HardHat className="size-5" />}
              title={t('notFound')}
              description={t('notFoundHelp')}
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/projects">{t('back')}</Link>
                </Button>
              }
            />
          ) : (
            <ErrorState
              message={
                status === 401 ? t('loginRequired') : errorMessage(project.error, t('loadFailed'))
              }
              onRetry={() => project.refetch()}
            />
          )}
        </Card>
      </PageBody>
    );
  }

  const data = project.data;
  const progressPct = clampPercent(data.progressPercent);

  /* A failed reload must never read as "no rows", so every tab guards its table the same way. */
  const failure: ApiError | null = project.isError ? project.error : null;
  const loadError = failure
    ? failure.status === 401
      ? t('loginRequired')
      : errorMessage(failure, t('loadFailed'))
    : null;
  const retry = () => project.refetch();

  const lotColumns = canSeeFinancials ? 4 : 3;

  return (
    <PageBody>
      <PageHeader
        kicker={t('common:navGroup.sites')}
        title={data.name}
        meta={
          <>
            <span>{data.client?.name ?? '—'}</span>
            <MetaDivider />
            <Ref>{data.reference || '—'}</Ref>
            <MetaDivider />
            <StatusBadge domain="project" value={data.status} />
          </>
        }
        actions={backToProjects}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Tabs
          value={activeTab}
          onValueChange={openTab}
          className="grid grid-cols-[minmax(0,1fr)] min-w-0 content-start gap-5"
        >
          <TabsList>
            <TabsTrigger value="lots">
              <Layers aria-hidden />
              {t('tabs.lots')}
              <TabCount>{lots.length}</TabCount>
            </TabsTrigger>
            <TabsTrigger value="milestones">
              <Flag aria-hidden />
              {t('tabs.milestones')}
              <TabCount>{milestones.length}</TabCount>
            </TabsTrigger>
            <TabsTrigger value="tasks">
              <ListChecks aria-hidden />
              {t('tabs.tasks')}
              <TabCount>{tasks.length}</TabCount>
            </TabsTrigger>
            <TabsTrigger value="gantt">
              <ChartGantt aria-hidden />
              {t('tabs.gantt')}
            </TabsTrigger>
          </TabsList>

          {/* ---------------- Lots ---------------- */}
          <TabsContent value="lots">
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('tabs.lots')}
                  <CardCount>{lots.length}</CardCount>
                </CardTitle>
                {canPlan ? (
                  <Button variant="primary" size="sm" onClick={openLotForm}>
                    <Plus />
                    {t('lots.add')}
                  </Button>
                ) : null}
              </CardHeader>

              <DataState
                isLoading={project.isPending}
                error={loadError}
                onRetry={retry}
                isEmpty={lots.length === 0}
                loading={<TableSkeleton cols={lotColumns} />}
                empty={
                  <EmptyState
                    icon={<Layers className="size-5" />}
                    title={t('lots.empty')}
                    description={t('lots.emptyHelp')}
                    action={
                      canPlan ? (
                        <Button variant="ghost" size="sm" onClick={openLotForm}>
                          <Plus />
                          {t('lots.add')}
                        </Button>
                      ) : undefined
                    }
                  />
                }
              >
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>{t('lots.table.name')}</TH>
                        <TH>{t('lots.table.description')}</TH>
                        {canSeeFinancials ? <TH numeric>{t('lots.table.budget')}</TH> : null}
                        <TH numeric>{t('lots.table.tasks')}</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {lots.map((lot) => (
                        <TR
                          key={lot.id}
                          onActivate={() => showLotTasks(lot.id)}
                          title={t('lots.openTasks')}
                        >
                          <TD className="font-medium">{lot.name}</TD>
                          <TD className="text-muted">{lot.description || '—'}</TD>
                          {canSeeFinancials ? (
                            <TD numeric>
                              {lot.budgetCents != null ? (
                                formatMoney(lot.budgetCents)
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </TD>
                          ) : null}
                          <TD numeric className="text-muted">
                            {lotTaskCounts.get(lot.id) ?? 0}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
                <CardFooter>
                  <span>{t('lots.count', { count: lots.length })}</span>
                  <span>{t('lots.rowHint')}</span>
                </CardFooter>
              </DataState>
            </Card>
          </TabsContent>

          {/* ---------------- Milestones ---------------- */}
          <TabsContent value="milestones">
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('tabs.milestones')}
                  <CardCount>{milestones.length}</CardCount>
                </CardTitle>
                {canPlan ? (
                  <Button variant="primary" size="sm" onClick={openMilestoneForm}>
                    <Plus />
                    {t('milestones.add')}
                  </Button>
                ) : null}
              </CardHeader>

              {completeMilestoneMutation.isError ? (
                <p
                  role="alert"
                  className="border-b border-line-soft bg-bad-bg px-4 py-2.5 text-[13px] text-bad"
                >
                  {errorMessage(completeMilestoneMutation.error, t('milestones.updateFailed'))}
                </p>
              ) : null}

              <DataState
                isLoading={project.isPending}
                error={loadError}
                onRetry={retry}
                isEmpty={milestones.length === 0}
                loading={<TableSkeleton cols={4} />}
                empty={
                  <EmptyState
                    icon={<Flag className="size-5" />}
                    title={t('milestones.empty')}
                    description={t('milestones.emptyHelp')}
                    action={
                      canPlan ? (
                        <Button variant="ghost" size="sm" onClick={openMilestoneForm}>
                          <Plus />
                          {t('milestones.add')}
                        </Button>
                      ) : undefined
                    }
                  />
                }
              >
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>{t('milestones.table.name')}</TH>
                        <TH>{t('milestones.table.targetDate')}</TH>
                        <TH>{t('milestones.table.completedDate')}</TH>
                        <TH>{t('milestones.table.status')}</TH>
                        <TH className="w-px">
                          <span className="sr-only">{t('milestones.table.actions')}</span>
                        </TH>
                      </tr>
                    </THead>
                    <TBody>
                      {milestones.map((milestone) => (
                        <TR key={milestone.id}>
                          <TD className="font-medium">{milestone.name}</TD>
                          <TD className="tnum">{formatDate(milestone.targetDate)}</TD>
                          <TD className="tnum text-muted">{formatDate(milestone.completedDate)}</TD>
                          <TD>
                            <StatusBadge domain="milestone" value={milestone.status} />
                          </TD>
                          <TD>
                            {canPlan && milestone.status !== 'completed' ? (
                              <Button
                                variant="quiet"
                                size="sm"
                                disabled={completeMilestoneMutation.isPending}
                                onClick={() => completeMilestone(milestone)}
                              >
                                <CircleCheck />
                                {t('milestones.markCompleted')}
                              </Button>
                            ) : null}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
                <CardFooter>
                  <span>{t('milestones.count', { count: milestones.length })}</span>
                </CardFooter>
              </DataState>
            </Card>
          </TabsContent>

          {/* ---------------- Tasks ---------------- */}
          <TabsContent value="tasks">
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('tabs.tasks')}
                  <CardCount>{tasks.length}</CardCount>
                </CardTitle>
                {canAddTask ? (
                  <Button variant="primary" size="sm" onClick={openTaskForm}>
                    <Plus />
                    {t('tasks.add')}
                  </Button>
                ) : null}
              </CardHeader>

              <div className="flex flex-wrap items-center gap-2.5 border-b border-line-soft p-3">
                <label htmlFor="task-lot-filter" className="text-[13px] text-muted">
                  {t('tasks.filterLot')}
                </label>
                <Select
                  id="task-lot-filter"
                  className="max-w-[240px]"
                  value={taskLotFilter}
                  onChange={(e) => setTaskLotFilter(e.target.value)}
                >
                  <option value="">{t('tasks.allLots')}</option>
                  {lots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.name}
                    </option>
                  ))}
                </Select>
              </div>

              {updateTaskStatusMutation.isError ? (
                <p
                  role="alert"
                  className="border-b border-line-soft bg-bad-bg px-4 py-2.5 text-[13px] text-bad"
                >
                  {errorMessage(updateTaskStatusMutation.error, t('tasks.updateFailed'))}
                </p>
              ) : null}

              <DataState
                isLoading={project.isPending}
                error={loadError}
                onRetry={retry}
                isEmpty={filteredTasks.length === 0}
                loading={<TableSkeleton rows={6} cols={6} />}
                empty={
                  tasks.length === 0 ? (
                    <EmptyState
                      icon={<ListChecks className="size-5" />}
                      title={t('tasks.empty')}
                      description={t('tasks.emptyHelp')}
                      action={
                        canAddTask ? (
                          <Button variant="ghost" size="sm" onClick={openTaskForm}>
                            <Plus />
                            {t('tasks.add')}
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <EmptyState
                      title={t('tasks.noMatch')}
                      description={t('tasks.noMatchHelp')}
                      action={
                        <Button variant="ghost" size="sm" onClick={() => setTaskLotFilter('')}>
                          {t('tasks.allLots')}
                        </Button>
                      }
                    />
                  )
                }
              >
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>{t('tasks.table.title')}</TH>
                        <TH>{t('tasks.table.status')}</TH>
                        <TH>{t('tasks.table.priority')}</TH>
                        <TH>{t('tasks.table.assignedTo')}</TH>
                        <TH>{t('tasks.table.start')}</TH>
                        <TH>{t('tasks.table.end')}</TH>
                        <TH>{t('tasks.table.progress')}</TH>
                        <TH>{t('tasks.table.dependencies')}</TH>
                        <TH className="w-px">
                          <span className="sr-only">{t('tasks.table.actions')}</span>
                        </TH>
                      </tr>
                    </THead>
                    <TBody>
                      {Array.from(tasksByLot.entries()).map(([lotId, lotTasks]) => (
                        <Fragment key={lotId}>
                          <tr>
                            {/* Group label, not a column header: no scope to claim. */}
                            <th
                              colSpan={9}
                              className="border-b border-line bg-chalk px-3.5 py-2 text-left text-xs font-semibold text-ink-2"
                            >
                              {lotNameMap.get(lotId) ?? t('tasks.unassigned')}
                              <span className="tnum ml-2 font-normal text-muted">
                                {lotTasks.length}
                              </span>
                            </th>
                          </tr>
                          {lotTasks.map((task) => {
                            const taskProgress = clampPercent(task.progressPercent);
                            const choices = statusChoicesFor(task, me);
                            return (
                              <TR key={task.id}>
                                <TD className="font-medium">
                                  <span className="block max-w-[260px] truncate" title={task.title}>
                                    {task.title}
                                  </span>
                                </TD>
                                <TD>
                                  <StatusBadge domain="task" value={task.status} />
                                </TD>
                                <TD>
                                  <Tag tone={PRIORITY_TONE[task.priority] ?? 'default'}>
                                    {enumLabel('taskPriority', task.priority)}
                                  </Tag>
                                </TD>
                                <TD>
                                  {userName(task.assignee) || <span className="text-muted">—</span>}
                                </TD>
                                <TD className="tnum text-muted">{formatDate(task.plannedStart)}</TD>
                                <TD className="tnum text-muted">{formatDate(task.plannedEnd)}</TD>
                                <TD>
                                  <div className="flex items-center gap-2">
                                    <div
                                      role="progressbar"
                                      aria-label={t('tasks.table.progress')}
                                      aria-valuemin={0}
                                      aria-valuemax={100}
                                      aria-valuenow={taskProgress}
                                      className="h-2 w-14 shrink-0 overflow-hidden rounded-full bg-line-soft"
                                    >
                                      {/* The one permitted inline style: a width only known at runtime. */}
                                      <div
                                        className={cn(
                                          'h-full rounded-full',
                                          taskProgress >= 100 ? 'bg-ok' : 'bg-copper',
                                        )}
                                        style={{ width: `${taskProgress}%` }}
                                      />
                                    </div>
                                    <span className="tnum text-xs text-muted">
                                      {t('progressValue', { percent: taskProgress })}
                                    </span>
                                  </div>
                                </TD>
                                <TD className="text-muted">
                                  {task.dependencies && task.dependencies.length > 0
                                    ? task.dependencies
                                        .map((d) => d.predecessorTitle ?? d.predecessorId)
                                        .join(', ')
                                    : '—'}
                                </TD>
                                <TD>
                                  {choices.length > 0 ? (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button
                                          variant="quiet"
                                          size="iconSm"
                                          aria-label={t('tasks.rowActions', { title: task.title })}
                                        >
                                          <MoreHorizontal />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent>
                                        <DropdownMenuLabel>{t('tasks.changeStatus')}</DropdownMenuLabel>
                                        {choices.map((status) => (
                                          <DropdownMenuItem
                                            key={status}
                                            disabled={
                                              status === task.status ||
                                              updateTaskStatusMutation.isPending
                                            }
                                            onSelect={() =>
                                              updateTaskStatusMutation.mutate({
                                                taskId: task.id,
                                                status,
                                              })
                                            }
                                          >
                                            {status === task.status ? (
                                              <CircleCheck />
                                            ) : (
                                              <span aria-hidden className="size-4" />
                                            )}
                                            {statusLabel('task', status)}
                                          </DropdownMenuItem>
                                        ))}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  ) : null}
                                </TD>
                              </TR>
                            );
                          })}
                        </Fragment>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
                <CardFooter>
                  <span>{t('tasks.count', { count: filteredTasks.length, total: tasks.length })}</span>
                  <span>{t('tasks.groupedByLot')}</span>
                </CardFooter>
              </DataState>
            </Card>
          </TabsContent>

          {/* ---------------- Gantt ---------------- */}
          <TabsContent value="gantt">
            <Card>
              <CardHeader>
                <CardTitle>{t('gantt.title')}</CardTitle>
              </CardHeader>
              <DataState
                isLoading={gantt.isPending}
                error={gantt.isError ? errorMessage(gantt.error, t('gantt.loadFailed')) : null}
                onRetry={() => gantt.refetch()}
                isEmpty={(gantt.data?.tasks.length ?? 0) === 0}
                loading={<TableSkeleton rows={6} cols={3} />}
                empty={
                  <EmptyState
                    icon={<ChartGantt className="size-5" />}
                    title={t('gantt.noTasks')}
                    description={t('gantt.noTasksHelp')}
                  />
                }
              >
                {gantt.data ? <GanttChart data={gantt.data} /> : null}
              </DataState>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ---------------- Sticky summary ---------------- */}
        <aside className="grid grid-cols-[minmax(0,1fr)] content-start gap-5 lg:sticky lg:top-[calc(var(--spacing-topbar)_+_1.5rem)] lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>{t('summary.title')}</CardTitle>
            </CardHeader>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4">
              <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium text-ink-2">{t('progress')}</span>
                  <span className="tnum text-[13px] font-medium">
                    {t('progressValue', { percent: progressPct })}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={t('progress')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPct}
                  className="h-2.5 overflow-hidden rounded-full bg-line-soft"
                >
                  {/* The one permitted inline style: a width only known at runtime. */}
                  <div
                    className={cn(
                      'h-full rounded-full',
                      progressPct >= 100 ? 'bg-ok' : progressPct >= 50 ? 'bg-copper' : 'bg-warn',
                    )}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <dl className="grid grid-cols-[minmax(0,1fr)] gap-2.5 border-t border-line-soft pt-3.5 text-[13.5px]">
                {canSeeFinancials ? (
                  <>
                    <SummaryRow
                      label={t('summary.budget')}
                      value={data.budgetHtCents != null ? formatMoney(data.budgetHtCents) : '—'}
                      numeric
                    />
                    <SummaryRow
                      label={t('summary.actualCost')}
                      value={data.actualCostCents != null ? formatMoney(data.actualCostCents) : '—'}
                      numeric
                    />
                  </>
                ) : null}
                <SummaryRow label={t('summary.manager')} value={userName(data.manager) || '—'} />
                <SummaryRow label={t('summary.start')} value={formatDate(data.startDate)} numeric />
                <SummaryRow label={t('summary.end')} value={formatDate(data.endDate)} numeric />
              </dl>
            </div>
          </Card>
        </aside>
      </div>

      {/* ---------------- Dialogs ---------------- */}

      <Dialog open={lotFormOpen} onOpenChange={setLotFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('lots.form.heading')}</DialogTitle>
            <DialogDescription>{t('lots.form.help')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('lots.form.name')} htmlFor="lot-name" required>
              <Input
                id="lot-name"
                value={lotForm.name}
                onChange={(e) => setLotForm({ ...lotForm, name: e.target.value })}
              />
            </Field>
            <Field label={t('lots.form.description')} htmlFor="lot-description">
              <Textarea
                id="lot-description"
                value={lotForm.description}
                onChange={(e) => setLotForm({ ...lotForm, description: e.target.value })}
              />
            </Field>
            <Field
              label={t('lots.form.budget')}
              htmlFor="lot-budget"
              hint={t('lots.form.budgetHint')}
            >
              <Input
                id="lot-budget"
                type="number"
                min={0}
                step="0.05"
                inputMode="decimal"
                value={lotForm.budgetChf}
                onChange={(e) => setLotForm({ ...lotForm, budgetChf: e.target.value })}
              />
            </Field>
            {addLotMutation.isError ? (
              <p role="alert" className="text-[13px] text-bad">
                {errorMessage(addLotMutation.error, t('lots.createFailed'))}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLotFormOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={lotForm.name.trim().length === 0 || addLotMutation.isPending}
              onClick={() => addLotMutation.mutate(lotForm)}
            >
              {addLotMutation.isPending ? t('adding') : t('lots.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={milestoneFormOpen} onOpenChange={setMilestoneFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('milestones.form.heading')}</DialogTitle>
            <DialogDescription>{t('milestones.form.help')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('milestones.form.name')} htmlFor="milestone-name" required>
              <Input
                id="milestone-name"
                value={milestoneForm.name}
                onChange={(e) => setMilestoneForm({ ...milestoneForm, name: e.target.value })}
              />
            </Field>
            <Field label={t('milestones.form.targetDate')} htmlFor="milestone-date" required>
              <Input
                id="milestone-date"
                type="date"
                value={milestoneForm.targetDate}
                onChange={(e) => setMilestoneForm({ ...milestoneForm, targetDate: e.target.value })}
              />
            </Field>
            {addMilestoneMutation.isError ? (
              <p role="alert" className="text-[13px] text-bad">
                {errorMessage(addMilestoneMutation.error, t('milestones.createFailed'))}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMilestoneFormOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={
                milestoneForm.name.trim().length === 0 ||
                milestoneForm.targetDate.length === 0 ||
                addMilestoneMutation.isPending
              }
              onClick={() => addMilestoneMutation.mutate(milestoneForm)}
            >
              {addMilestoneMutation.isPending ? t('adding') : t('milestones.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={taskFormOpen} onOpenChange={setTaskFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tasks.form.heading')}</DialogTitle>
            <DialogDescription>{t('tasks.form.help')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('tasks.form.title')} htmlFor="task-title" required>
              <Input
                id="task-title"
                value={taskForm.title}
                onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
              <Field label={t('tasks.form.lot')} htmlFor="task-lot">
                <Select
                  id="task-lot"
                  value={taskForm.lotId}
                  onChange={(e) => setTaskForm({ ...taskForm, lotId: e.target.value })}
                >
                  <option value="">{t('tasks.selectLot')}</option>
                  {lots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('tasks.form.priority')} htmlFor="task-priority">
                <Select
                  id="task-priority"
                  value={taskForm.priority}
                  onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
                >
                  {TASK_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {enumLabel('taskPriority', priority)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t('tasks.form.description')} htmlFor="task-description">
              <Textarea
                id="task-description"
                value={taskForm.description}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
              <Field label={t('tasks.form.plannedStart')} htmlFor="task-start">
                <Input
                  id="task-start"
                  type="date"
                  value={taskForm.plannedStart}
                  onChange={(e) => setTaskForm({ ...taskForm, plannedStart: e.target.value })}
                />
              </Field>
              <Field label={t('tasks.form.plannedEnd')} htmlFor="task-end">
                <Input
                  id="task-end"
                  type="date"
                  value={taskForm.plannedEnd}
                  onChange={(e) => setTaskForm({ ...taskForm, plannedEnd: e.target.value })}
                />
              </Field>
              <Field label={t('tasks.form.estimatedHours')} htmlFor="task-hours">
                <Input
                  id="task-hours"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={taskForm.estimatedHours}
                  onChange={(e) =>
                    setTaskForm({
                      ...taskForm,
                      estimatedHours: e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                />
              </Field>
            </div>
            <Field
              label={t('tasks.form.assignedTo')}
              htmlFor="task-assignee"
              hint={t('tasks.form.assignedToHint')}
            >
              <Input
                id="task-assignee"
                value={taskForm.assignedTo}
                onChange={(e) => setTaskForm({ ...taskForm, assignedTo: e.target.value })}
              />
            </Field>
            {addTaskMutation.isError ? (
              <p role="alert" className="text-[13px] text-bad">
                {errorMessage(addTaskMutation.error, t('tasks.createFailed'))}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTaskFormOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={taskForm.title.trim().length === 0 || addTaskMutation.isPending}
              onClick={() =>
                addTaskMutation.mutate({
                  title: taskForm.title,
                  description: taskForm.description,
                  lotId: taskForm.lotId,
                  priority: taskForm.priority,
                  plannedStart: taskForm.plannedStart,
                  plannedEnd: taskForm.plannedEnd,
                  estimatedHours:
                    taskForm.estimatedHours === '' ? null : Number(taskForm.estimatedHours),
                  assignedTo: taskForm.assignedTo,
                })
              }
            >
              {addTaskMutation.isPending ? t('adding') : t('tasks.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

/* ------------------------------------------------------------------ */
/*  Summary row                                                        */
/* ------------------------------------------------------------------ */

function SummaryRow({
  label,
  value,
  numeric,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right font-medium', numeric && 'tnum')}>{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Gantt chart                                                        */
/* ------------------------------------------------------------------ */

/*
 * The chart is hand-drawn: absolutely positioned bars over a day grid, plus an SVG overlay for
 * the dependency arrows. Its geometry is computed at runtime, which is the one case the UI
 * conventions allow `style` for — every colour, border and font below is a design token class.
 * The constants and the Tailwind sizes must stay in step:
 *   HEADER_HEIGHT 40 → h-10 · ROW_HEIGHT 32 → h-8 · LOT_HEADER_HEIGHT 28 → h-7
 *   bar height ROW_HEIGHT - 16 → h-4 · label column 220px → w-[220px]
 */
function GanttChart({ data }: { data: GanttData }) {
  const { t, i18n } = useTranslation('projectDetail');
  const PX_PER_DAY = 3;
  const ROW_HEIGHT = 32;
  const HEADER_HEIGHT = 40;
  const LOT_HEADER_HEIGHT = 28;

  /* Compute date range */
  const allDates: Date[] = [];
  for (const task of data.tasks) {
    if (task.plannedStart) allDates.push(new Date(task.plannedStart));
    if (task.plannedEnd) allDates.push(new Date(task.plannedEnd));
  }
  for (const milestone of data.milestones) {
    if (milestone.date) allDates.push(new Date(milestone.date));
  }

  if (allDates.length === 0) {
    return <EmptyState icon={<ChartGantt className="size-5" />} title={t('gantt.noDates')} />;
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
    for (const task of lotTasks) {
      rows.push({ type: 'task', label: task.title, task });
    }
  }

  /* Compute chart height */
  let chartContentHeight = 0;
  for (const row of rows) {
    chartContentHeight += row.type === 'lot_header' ? LOT_HEADER_HEIGHT : ROW_HEIGHT;
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
  for (const row of rows) {
    if (row.type === 'lot_header') {
      yAcc += LOT_HEADER_HEIGHT;
    } else if (row.task) {
      const task = row.task;
      const start = dayOffset(task.plannedStart) * PX_PER_DAY;
      const end = dayOffset(task.plannedEnd) * PX_PER_DAY;
      const barWidth = Math.max(end - start, PX_PER_DAY);
      taskPositions.set(task.id, { x: start, y: yAcc + ROW_HEIGHT / 2, width: barWidth });
      yAcc += ROW_HEIGHT;
    }
  }

  /* Dependency arrows */
  const arrows: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const task of data.tasks) {
    if (!task.dependencies) continue;
    const target = taskPositions.get(task.id);
    if (!target) continue;
    for (const depId of task.dependencies) {
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

  return (
    <div className="flex overflow-hidden rounded-b-card">
      {/* Labels column */}
      <div className="w-[220px] min-w-[220px] border-r border-line bg-paper-2">
        <div className="flex h-10 items-center border-b border-line px-3 text-xs font-medium text-muted">
          {t('gantt.task')}
        </div>
        {rows.map((row, i) =>
          row.type === 'lot_header' ? (
            <div
              key={`lbl-${i}`}
              className="flex h-7 items-center border-b border-line bg-chalk px-3 text-xs font-semibold text-ink-2"
            >
              <span className="truncate">{row.label}</span>
            </div>
          ) : (
            <div
              key={`lbl-${i}`}
              className="flex h-8 items-center border-b border-line-soft px-3 text-xs text-ink-2"
              title={row.label}
            >
              <span className="truncate">{row.label}</span>
            </div>
          ),
        )}
      </div>

      {/* Chart area — keyboard-scrollable, so the planning is reachable without a mouse. */}
      <div
        tabIndex={0}
        role="group"
        aria-label={t('gantt.chartLabel')}
        className="min-w-0 flex-1 overflow-x-auto"
      >
        {/* Geometry only: the chart is as wide as its date range. */}
        <div className="relative" style={{ width: chartWidth, height: chartHeight }}>
          {/* Month headers */}
          {months.map((month, i) => (
            <div
              key={`month-${i}`}
              className="absolute top-0 flex h-10 items-center border-b border-l border-line px-1.5 text-[11px] font-medium text-muted"
              style={{ left: month.x }}
            >
              {month.label}
            </div>
          ))}

          {/* Month grid lines */}
          {months.map((month, i) => (
            <div
              key={`grid-${i}`}
              aria-hidden
              className="absolute top-10 w-px bg-line-soft"
              style={{ left: month.x, height: chartContentHeight }}
            />
          ))}

          {/* Row backgrounds + task bars */}
          {(() => {
            let yPos = HEADER_HEIGHT;
            return rows.map((row, i) => {
              const currentY = yPos;
              if (row.type === 'lot_header') {
                yPos += LOT_HEADER_HEIGHT;
                return (
                  <div
                    key={`row-${i}`}
                    aria-hidden
                    className="absolute left-0 h-7 border-b border-line bg-chalk"
                    style={{ top: currentY, width: chartWidth }}
                  />
                );
              }

              yPos += ROW_HEIGHT;
              const task = row.task!;
              const barStart = dayOffset(task.plannedStart) * PX_PER_DAY;
              const barEnd = dayOffset(task.plannedEnd) * PX_PER_DAY;
              const barWidth = Math.max(barEnd - barStart, PX_PER_DAY);
              const barClass = GANTT_BAR_CLASS[task.status] ?? GANTT_BAR_CLASS.todo;
              const barLabel = t('gantt.barLabel', {
                title: task.title,
                start: formatDate(task.plannedStart),
                end: formatDate(task.plannedEnd),
                status: statusLabel('task', task.status),
              });

              return (
                <div key={`row-${i}`}>
                  {/* Row stripe */}
                  <div
                    aria-hidden
                    className={cn(
                      'absolute left-0 h-8 border-b border-line-soft',
                      i % 2 === 0 ? 'bg-paper' : 'bg-paper-2',
                    )}
                    style={{ top: currentY, width: chartWidth }}
                  />
                  {/* Task bar */}
                  <div
                    role="img"
                    aria-label={barLabel}
                    className={cn('absolute h-4 min-w-[4px] rounded-[3px]', barClass)}
                    style={{ left: barStart, top: currentY + 8, width: barWidth }}
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
          {data.milestones.map((milestone) => {
            if (!milestone.date) return null;
            const mx = dayOffset(milestone.date) * PX_PER_DAY;
            const label = t('gantt.milestoneTitle', {
              name: milestone.name,
              date: formatDate(milestone.date),
            });
            return (
              <div
                key={`ms-${milestone.id}`}
                role="img"
                aria-label={label}
                className="absolute size-3 rotate-45 rounded-[2px] bg-warn"
                style={{ left: mx - 6, top: HEADER_HEIGHT + chartContentHeight - 20 }}
                title={label}
              />
            );
          })}

          {/* Today line */}
          {showToday ? (
            <div
              role="img"
              aria-label={t('gantt.today')}
              className="absolute top-10 z-[2] w-0 border-l-2 border-dashed border-bad"
              style={{ left: todayX, height: chartContentHeight }}
              title={t('gantt.today')}
            />
          ) : null}

          {/* Dependency arrows (SVG overlay) */}
          {arrows.length > 0 ? (
            <svg
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
              style={{ width: chartWidth, height: chartHeight }}
            >
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" className="fill-muted" />
                </marker>
              </defs>
              {arrows.map((arrow, i) => {
                /* Simple right-angle connector */
                const midX = arrow.x1 + (arrow.x2 - arrow.x1) / 2;
                return (
                  <path
                    key={`dep-${i}`}
                    d={`M ${arrow.x1} ${arrow.y1} L ${midX} ${arrow.y1} L ${midX} ${arrow.y2} L ${arrow.x2} ${arrow.y2}`}
                    fill="none"
                    className="stroke-muted"
                    strokeWidth={1.5}
                    markerEnd="url(#arrowhead)"
                  />
                );
              })}
            </svg>
          ) : null}
        </div>
      </div>
    </div>
  );
}
