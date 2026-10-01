import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Flag, Layers, Link2Off, ListChecks, Newspaper } from 'lucide-react';
import { ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardContent, CardCount, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { DataState, EmptyState, ErrorState, LoadingState, Skeleton, TableSkeleton } from '@/components/states';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Lot {
  id: string;
  name: string;
  taskCount: number;
}

interface Milestone {
  id: string;
  name: string;
  status: string;
  dueDate?: string;
}

interface DailyReport {
  id: string;
  date: string;
  summary: string;
}

interface TaskOverview {
  todo: number;
  in_progress: number;
  done: number;
}

interface PortalData {
  project: {
    name: string;
    status: string;
    progress: number;
  };
  lots: Lot[];
  milestones: Milestone[];
  recentReports: DailyReport[];
  taskOverview: TaskOverview;
}

/** Raw shape of GET /portal/view/:token (inside the response envelope). */
interface PortalApiResponse {
  project: { name: string; status: string; progressPercent: number | null };
  lots: { id: string; name: string }[];
  milestones: { id: string; name: string; status: string; targetDate: string | null }[];
  tasks: { id: string; lotId: string | null; status: string }[];
  dailyReports: { id: string; date: string; workDescription: string | null }[];
}

function toPortalData(raw: PortalApiResponse): PortalData {
  const tasks = raw.tasks ?? [];
  const countStatus = (st: string) => tasks.filter(t => t.status === st).length;
  return {
    project: {
      name: raw.project.name,
      status: raw.project.status,
      progress: raw.project.progressPercent ?? 0,
    },
    lots: (raw.lots ?? []).map(l => ({
      id: l.id,
      name: l.name,
      taskCount: tasks.filter(t => t.lotId === l.id).length,
    })),
    milestones: (raw.milestones ?? []).map(m => ({
      id: m.id,
      name: m.name,
      status: m.status,
      dueDate: m.targetDate ?? undefined,
    })),
    recentReports: (raw.dailyReports ?? []).map(r => ({
      id: r.id,
      date: r.date,
      summary: r.workDescription ?? '',
    })),
    taskOverview: {
      todo: countStatus('todo'),
      in_progress: countStatus('in_progress'),
      // 'validated' is a signed-off 'done'
      done: countStatus('done') + countStatus('validated'),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

/**
 * The portal is public and token-scoped, so it renders outside the app shell: no sidebar, no
 * top bar, no navigation. It carries its own calm frame instead — a band with the wordmark and
 * a single centred column — and every state of the page lives inside it.
 */
function PortalFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation('portalView');
  return (
    <div className="flex min-h-dvh flex-col bg-chalk">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5 sm:px-6">
          <span className="font-display text-base font-bold tracking-[0.14em] text-ink">OXACAN</span>
          <span className="text-[13px] text-muted">{t('brand')}</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-center gap-1.5 px-4 py-3.5 text-xs text-muted sm:px-6">
          <span>{t('footer.poweredBy')}</span>
          <span className="font-display font-semibold tracking-[0.12em] text-ink">OXACAN</span>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PortalView() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation('portalView');

  /**
   * Deliberately a bare fetch rather than the `api` helper: the portal carries no session, and a
   * 401 here must not fire the app's "session expired" event on a client who was never signed in.
   */
  const portal = useQuery<PortalData, Error>({
    queryKey: ['portal-view', token],
    queryFn: async () => {
      const res = await fetch(`/api/portal/view/${token}`);
      if (!res.ok) {
        const body = await res.text();
        let msg: string;
        let code: string | undefined;
        let details: Record<string, unknown> | undefined;
        try {
          const parsed = JSON.parse(body);
          msg = parsed?.error?.message || parsed?.message || res.statusText;
          code = parsed?.error?.code;
          details = parsed?.error?.details;
        }
        catch { msg = body || res.statusText; }
        throw new ApiError(res.status, msg, code, details);
      }
      const payload = await res.json();
      return toPortalData((payload?.data ?? payload) as PortalApiResponse);
    },
    enabled: Boolean(token),
    retry: false,
    // The client reads the portal, they do not work in it: one load per visit, no focus refetch
    // that could replace the page with an error after the link was revoked in another tab.
    refetchOnWindowFocus: false,
  });

  const loadError = portal.isError ? errorMessage(portal.error, t('unavailable.loadFailed')) : null;

  if (portal.isPending) {
    return (
      <PortalFrame>
        <Card>
          <LoadingState label={t('loading')} />
        </Card>
      </PortalFrame>
    );
  }

  const data = portal.data;

  // The states where the page has no project to name: an unusable link, or a load that failed.
  if (!data) {
    const status = portal.error instanceof ApiError ? portal.error.status : undefined;
    // An unknown, revoked or expired token is the common case for the building owner.
    const invalidLink = status !== undefined && [401, 403, 404].includes(status);
    return (
      <PortalFrame>
        <Card>
          {invalidLink ? (
            <EmptyState
              icon={<Link2Off className="size-5" />}
              title={t('unavailable.title')}
              description={t('unavailable.invalidLink')}
            />
          ) : (
            <ErrorState
              message={loadError ?? t('unavailable.loadFailed')}
              onRetry={() => portal.refetch()}
            />
          )}
        </Card>
      </PortalFrame>
    );
  }

  const { project, lots, milestones, recentReports, taskOverview } = data;
  const progress = project.progress ?? 0;
  const progressWidth = Math.min(100, Math.max(0, progress));
  const totalTasks =
    (taskOverview?.todo ?? 0) + (taskOverview?.in_progress ?? 0) + (taskOverview?.done ?? 0);

  const taskTiles = [
    { key: 'todo', label: t('tasks.todo'), value: taskOverview?.todo ?? 0, tone: 'text-ink' },
    { key: 'inProgress', label: t('tasks.inProgress'), value: taskOverview?.in_progress ?? 0, tone: 'text-copper' },
    { key: 'done', label: t('tasks.done'), value: taskOverview?.done ?? 0, tone: 'text-ok' },
  ];

  return (
    <PortalFrame>
      <PageBody>
        <PageHeader
          title={project.name}
          kicker={t('kicker')}
          meta={<StatusBadge domain="project" value={project.status || 'active'} />}
        />

        <Card>
          <CardHeader>
            <CardTitle>{t('progress')}</CardTitle>
            <span className="tnum text-[13px] text-muted">{t('progressValue', { percent: progress })}</span>
          </CardHeader>
          <CardContent>
            <div
              role="progressbar"
              aria-label={t('progress')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="h-2.5 overflow-hidden rounded-full bg-line-soft"
            >
              {/* The one permitted inline style: a width only known at runtime. */}
              <div
                className={cn(
                  'h-full rounded-full',
                  progressWidth >= 100 ? 'bg-ok' : progressWidth >= 50 ? 'bg-copper' : 'bg-warn',
                )}
                style={{ width: `${progressWidth}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {t('tasks.title')}
              <CardCount>{totalTasks}</CardCount>
            </CardTitle>
          </CardHeader>
          <DataState
            isLoading={portal.isPending}
            error={loadError}
            onRetry={() => portal.refetch()}
            isEmpty={totalTasks === 0}
            loading={
              <CardContent className="flex flex-wrap gap-3">
                {taskTiles.map((tile) => (
                  <Skeleton key={tile.key} className="h-[66px] min-w-[138px] flex-1" />
                ))}
              </CardContent>
            }
            empty={
              <EmptyState
                icon={<ListChecks className="size-5" />}
                title={t('tasks.empty')}
                description={t('tasks.emptyHelp')}
              />
            }
          >
            <CardContent className="flex flex-wrap gap-3">
              {taskTiles.map((tile) => (
                <div
                  key={tile.key}
                  className="min-w-[138px] flex-1 rounded-md border border-line bg-paper-2 px-3.5 py-3"
                >
                  <div className="text-xs text-muted">{tile.label}</div>
                  <div className={cn('tnum mt-1 font-display text-xl font-semibold', tile.tone)}>
                    {tile.value}
                  </div>
                </div>
              ))}
            </CardContent>
          </DataState>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {t('lots.title')}
              <CardCount>{lots.length}</CardCount>
            </CardTitle>
          </CardHeader>
          <DataState
            isLoading={portal.isPending}
            error={loadError}
            onRetry={() => portal.refetch()}
            isEmpty={lots.length === 0}
            loading={<TableSkeleton rows={3} cols={2} />}
            empty={
              <EmptyState
                icon={<Layers className="size-5" />}
                title={t('lots.empty')}
                description={t('lots.emptyHelp')}
              />
            }
          >
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>{t('lots.table.name')}</TH>
                    <TH numeric>{t('lots.table.tasks')}</TH>
                  </tr>
                </THead>
                <TBody>
                  {lots.map((lot) => (
                    <TR key={lot.id}>
                      <TD className="font-medium">{lot.name}</TD>
                      <TD numeric className="text-muted">{lot.taskCount}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </DataState>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {t('milestones.title')}
              <CardCount>{milestones.length}</CardCount>
            </CardTitle>
          </CardHeader>
          <DataState
            isLoading={portal.isPending}
            error={loadError}
            onRetry={() => portal.refetch()}
            isEmpty={milestones.length === 0}
            loading={<TableSkeleton rows={3} cols={3} />}
            empty={
              <EmptyState
                icon={<Flag className="size-5" />}
                title={t('milestones.empty')}
                description={t('milestones.emptyHelp')}
              />
            }
          >
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>{t('milestones.table.name')}</TH>
                    <TH>{t('milestones.table.targetDate')}</TH>
                    <TH>{t('milestones.table.status')}</TH>
                  </tr>
                </THead>
                <TBody>
                  {milestones.map((milestone) => (
                    <TR key={milestone.id}>
                      <TD className="font-medium">{milestone.name}</TD>
                      <TD className="tnum text-muted">{formatDate(milestone.dueDate)}</TD>
                      <TD>
                        <StatusBadge domain="milestone" value={milestone.status} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </DataState>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {t('reports.title')}
              <CardCount>{recentReports.length}</CardCount>
            </CardTitle>
          </CardHeader>
          <DataState
            isLoading={portal.isPending}
            error={loadError}
            onRetry={() => portal.refetch()}
            isEmpty={recentReports.length === 0}
            loading={<TableSkeleton rows={3} cols={2} />}
            empty={
              <EmptyState
                icon={<Newspaper className="size-5" />}
                title={t('reports.empty')}
                description={t('reports.emptyHelp')}
              />
            }
          >
            <ul className="grid">
              {recentReports.map((report) => (
                <li key={report.id} className="grid gap-1 border-b border-line-soft p-4 last:border-b-0">
                  <span className="tnum text-[13px] text-muted">{formatDate(report.date)}</span>
                  <p className={cn('text-[13.5px]', report.summary ? 'text-ink' : 'text-muted')}>
                    {report.summary || t('reports.noDetail')}
                  </p>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>
      </PageBody>
    </PortalFrame>
  );
}
