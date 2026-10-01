import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Bell, CheckCheck } from 'lucide-react';
import { apiList, apiPatch, apiPost, ApiError, type PageMeta } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataState, EmptyState, TableSkeleton } from '@/components/states';
import { cn } from '@/lib/cn';

interface Notification {
  id: string;
  title: string;
  body: string | null;
  isRead: boolean;
  createdAt: string;
}

type Filter = 'all' | 'unread';

type NotificationPage = { items: Notification[]; meta: PageMeta };

/** Relative age of a notification; the exact timestamp stays available as a tooltip. */
function timeAgo(dateStr: string, t: TFunction): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 30) return t('timeAgo.months', { count: Math.floor(days / 30) });
  if (days > 0) return t('timeAgo.days', { count: days });
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return t('timeAgo.hours', { count: hours });
  const mins = Math.floor(diff / 60000);
  return mins > 0 ? t('timeAgo.minutes', { count: mins }) : t('timeAgo.justNow');
}

/**
 * Every notification the user received, all or unread only. A row is the clickable unit: opening
 * an unread one marks it read and it stays in place, so the list never jumps under the pointer.
 */
export default function Notifications() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>('all');

  const listKey = ['notifications', 'list', page, filter];

  const list = useQuery<NotificationPage, ApiError>({
    queryKey: listKey,
    queryFn: () =>
      apiList<Notification>(`/notifications?page=${page}${filter === 'unread' ? '&isRead=false' : ''}`),
    retry: false,
  });

  /**
   * Marking read flips the flag on every cached page of this list, not only the one on screen —
   * no reshuffle, no refetch, and a cached sibling page cannot come back still showing the
   * notification as unread with a live mark-read button. Everything else under the shared
   * ['notifications'] key — the top bar's unread count, which lives in a sibling query — is
   * invalidated so the bell drops its badge at once; the list pages are the one exception,
   * because refetching them would pull the row the user just read out of the "Non lues" filter.
   */
  const patchRows = (update: (n: Notification) => Notification) => {
    queryClient.setQueriesData<NotificationPage>({ queryKey: ['notifications', 'list'] }, (current) =>
      current ? { ...current, items: current.items.map(update) } : current,
    );
    queryClient.invalidateQueries({
      queryKey: ['notifications'],
      predicate: (query) => query.queryKey[1] !== 'list',
    });
  };

  const markRead = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => apiPatch(`/notifications/${id}/read`),
    onSuccess: (_result, id) => patchRows((n) => (n.id === id ? { ...n, isRead: true } : n)),
  });

  const markAllRead = useMutation<unknown, ApiError, void>({
    mutationFn: () => apiPost('/notifications/read-all'),
    onSuccess: () => patchRows((n) => ({ ...n, isRead: true })),
  });

  const rows = list.data?.items ?? [];
  const meta = list.data?.meta;
  const total = meta?.total ?? rows.length;
  const totalPages = Math.max(1, meta?.totalPages ?? 1);
  const unreadCount = rows.filter((n) => !n.isRead).length;
  const settled = !list.isPending && !list.isError;

  const mutationError = markRead.isError
    ? errorMessage(markRead.error, t('messages.markReadFailed'))
    : markAllRead.isError
      ? errorMessage(markAllRead.error, t('messages.markAllReadFailed'))
      : null;

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        meta={
          settled ? (
            <span>{unreadCount > 0 ? t('unreadCount', { count: unreadCount }) : t('allCaughtUp')}</span>
          ) : undefined
        }
        actions={
          settled && unreadCount > 0 ? (
            <Button variant="primary" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
              <CheckCheck />
              {markAllRead.isPending ? t('actions.markingAllRead') : t('actions.markAllRead')}
            </Button>
          ) : undefined
        }
      />

      <Tabs
        value={filter}
        onValueChange={(value) => {
          setFilter(value as Filter);
          setPage(1);
        }}
      >
        <TabsList aria-label={t('tabs.label')}>
          <TabsTrigger value="all">{t('tabs.all')}</TabsTrigger>
          <TabsTrigger value="unread">{t('tabs.unread')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        {mutationError ? (
          <p role="alert" className="border-b border-line-soft px-4 py-2.5 text-[13px] text-bad">
            {mutationError}
          </p>
        ) : null}

        <DataState
          isLoading={list.isPending}
          error={list.isError ? errorMessage(list.error, t('messages.loadFailed')) : null}
          onRetry={() => list.refetch()}
          isEmpty={rows.length === 0}
          loading={<TableSkeleton rows={5} cols={3} />}
          empty={
            filter === 'unread' ? (
              <EmptyState
                icon={<CheckCheck className="size-5" />}
                title={t('empty.unread')}
                description={t('empty.unreadHelp')}
              />
            ) : (
              <EmptyState
                icon={<Bell className="size-5" />}
                title={t('empty.all')}
                description={t('empty.allHelp')}
              />
            )
          }
        >
          <ul className="grid">
            {rows.map((n) => {
              // A row is always a <button>, so its content stays phrasing-only: spans, no <div>/<p>.
              const content = (
                <span className="grid grid-cols-[6px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 sm:grid-cols-[6px_minmax(0,1fr)_auto]">
                  <span
                    aria-hidden
                    className={cn(
                      'mt-[7px] size-1.5 shrink-0 rounded-full',
                      n.isRead ? 'bg-transparent' : 'bg-copper',
                    )}
                  />
                  <span className="grid min-w-0 gap-1">
                    {/* The API already writes these in French (PRD wording) — shown verbatim. */}
                    <span className={cn('block', n.isRead ? 'text-ink-2' : 'font-semibold text-ink')}>
                      {n.title}
                    </span>
                    {n.body ? <span className="block text-[13.5px] text-muted">{n.body}</span> : null}
                  </span>
                  <span
                    title={formatDateTime(n.createdAt)}
                    className="col-start-2 text-xs text-muted sm:col-start-3 sm:pl-4 sm:text-right"
                  >
                    {timeAgo(n.createdAt, t)}
                  </span>
                </span>
              );

              return (
                <li
                  key={n.id}
                  className={cn('border-b border-line-soft last:border-b-0', !n.isRead && 'bg-paper-2')}
                >
                  {/*
                    Read and unread rows are the same element type on purpose. Activating an unread
                    row is exactly what makes it read, so swapping <button> for <div> here would
                    unmount the node the keyboard is on and send the next Tab back to the top of the
                    document. A read row stays a mounted button, out of the tab order (tabIndex -1,
                    as before) and inert (aria-disabled, no handler), so focus survives the flip and
                    Tab continues from the notification the user just read.
                  */}
                  <button
                    type="button"
                    tabIndex={n.isRead ? -1 : 0}
                    aria-disabled={n.isRead || undefined}
                    onClick={n.isRead ? undefined : () => markRead.mutate(n.id)}
                    aria-label={n.isRead ? undefined : t('actions.markReadNamed', { title: n.title })}
                    className={cn(
                      'block w-full border-l-2 px-4 py-3.5 text-left',
                      n.isRead ? 'border-transparent' : 'border-copper transition-colors hover:bg-chalk',
                    )}
                  >
                    {content}
                  </button>
                </li>
              );
            })}
          </ul>

          <CardFooter>
            <span>{t('summary.count', { count: rows.length, total })}</span>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('common:actions.previous')}
                </Button>
                <span className="tnum">{t('common:state.page', { page, total: totalPages })}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t('common:actions.next')}
                </Button>
              </div>
            ) : (
              <span>{t('summary.sortedBy')}</span>
            )}
          </CardFooter>
        </DataState>
      </Card>
    </PageBody>
  );
}
