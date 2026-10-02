import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ListChecks } from 'lucide-react';
import { api, apiPatch, type PageMeta } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { Tabs, TabsList, TabsTrigger, TabCount } from '@/components/ui/tabs';
import { DataState, EmptyState } from '@/components/states';

type View = 'today' | 'open' | 'done';

interface MyTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  plannedEnd: string | null;
  progressPercent: number;
  overdue: boolean;
  project: { id: string; name: string; reference: string | null };
  lot: { id: string; name: string } | null;
}

interface MyTasksMeta extends PageMeta {
  counts?: { today: number; open: number; overdue: number };
}

/**
 * The worker's and team leader's own tasks across every project (PRD §3.2). The project page
 * still owns planning; this view only answers "what am I on today" and lets the assignee
 * move a task forward.
 */
export default function MyTasks() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('today');

  const tasks = useQuery({
    queryKey: ['my-tasks', view],
    queryFn: () => api<{ data: MyTask[]; meta: MyTasksMeta }>(`/tasks/mine?view=${view}`),
    retry: false,
  });

  const update = useMutation({
    mutationFn: ({ task, status }: { task: MyTask; status: string }) =>
      apiPatch(`/projects/${task.project.id}/tasks/${task.id}`, {
        status,
        ...(status === 'done' ? { progressPercent: 100 } : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-tasks'] }),
  });

  const items = tasks.data?.data ?? [];
  const counts = tasks.data?.meta?.counts;

  const emptyTitle = {
    today: t('myTasks.emptyToday'),
    open: t('myTasks.emptyOpen'),
    done: t('myTasks.emptyDone'),
  }[view];

  return (
    <PageBody>
      <PageHeader
        title={t('myTasks.title')}
        kicker={t('navGroup.sites')}
        meta={
          counts && counts.overdue > 0 ? (
            <Badge tone="bad">
              {counts.overdue} {t('myTasks.overdue').toLowerCase()}
            </Badge>
          ) : undefined
        }
      />

      <Tabs value={view} onValueChange={(value) => setView(value as View)}>
        <TabsList>
          <TabsTrigger value="today">
            {t('myTasks.today')}
            {counts ? <TabCount>{counts.today}</TabCount> : null}
          </TabsTrigger>
          <TabsTrigger value="open">
            {t('myTasks.open')}
            {counts ? <TabCount>{counts.open}</TabCount> : null}
          </TabsTrigger>
          <TabsTrigger value="done">{t('myTasks.done')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <DataState
          isLoading={tasks.isPending}
          error={tasks.isError ? errorMessage(tasks.error, t('myTasks.loadFailed')) : null}
          onRetry={() => tasks.refetch()}
          isEmpty={items.length === 0}
          empty={
            <EmptyState
              icon={<ListChecks className="size-5" />}
              title={emptyTitle}
              description={view === 'today' ? t('myTasks.emptyTodayHelp') : undefined}
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/projects">{t('myTasks.openProjects')}</Link>
                </Button>
              }
            />
          }
        >
          <ul className="grid grid-cols-[minmax(0,1fr)]">
            {items.map((task) => (
              <li
                key={task.id}
                className="grid grid-cols-[minmax(0,1fr)] gap-3 border-b border-line-soft p-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{task.title}</span>
                    <StatusBadge domain="task" value={task.status} />
                    {task.overdue ? <Badge tone="bad">{t('myTasks.overdue')}</Badge> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                    <Link to={`/projects/${task.project.id}`} className="hover:text-ink hover:underline">
                      {task.project.name}
                    </Link>
                    {task.lot ? <span>· {task.lot.name}</span> : null}
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock aria-hidden className="size-3.5" />
                      {task.plannedEnd ? t('myTasks.dueOn', { date: formatDate(task.plannedEnd) }) : t('myTasks.noDate')}
                    </span>
                    {task.progressPercent > 0 && task.status !== 'done' ? (
                      <span className="tnum">
                        {t('myTasks.progress')} {task.progressPercent} %
                      </span>
                    ) : null}
                  </div>
                </div>

                {view === 'done' ? null : (
                  <div className="flex flex-wrap gap-2">
                    {task.status === 'todo' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ task, status: 'in_progress' })}
                      >
                        {t('myTasks.markStarted')}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ task, status: 'done' })}
                    >
                      {t('myTasks.markDone')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </DataState>
      </Card>

      {update.isError ? (
        <p role="alert" className="text-[13.5px] text-bad">
          {errorMessage(update.error, t('myTasks.updateFailed'))}
        </p>
      ) : null}
    </PageBody>
  );
}
