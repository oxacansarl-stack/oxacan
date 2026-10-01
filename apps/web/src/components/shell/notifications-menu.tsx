import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Inbox } from 'lucide-react';
import { apiList, apiPatch, apiPost } from '@/lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface Notification {
  id: string;
  title: string;
  body: string | null;
  isRead: boolean;
  createdAt: string;
  referenceType?: string | null;
  referenceId?: string | null;
}

/** Where a notification's reference opens. Anything unmapped stays a plain row. */
const TARGETS: Record<string, (id: string) => string> = {
  offer: (id) => `/offers/${id}`,
  project: (id) => `/projects/${id}`,
  invoice: () => '/invoices',
  contract: () => '/contracts',
  plus_value: () => '/invoices',
  time_entry: () => '/timekeeping',
  expense: () => '/expenses',
  meeting: () => '/meetings',
};

export function NotificationsMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiList<Notification>('/notifications?isRead=false&limit=8'),
    retry: false,
    refetchInterval: 120_000,
  });

  const items = unread.data?.items ?? [];
  const count = unread.data?.meta?.total ?? items.length;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const markOne = useMutation({
    mutationFn: (id: string) => apiPatch(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: () => apiPost('/notifications/read-all'),
    onSuccess: invalidate,
  });

  function open(item: Notification) {
    markOne.mutate(item.id);
    const target = item.referenceType && item.referenceId
      ? TARGETS[item.referenceType]?.(item.referenceId)
      : undefined;
    navigate(target ?? '/notifications');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="quiet"
          size="icon"
          className="relative"
          aria-label={count > 0 ? t('shell.notifications', { count }) : t('shell.notificationsTitle')}
        >
          <Bell />
          {count > 0 ? (
            <span className="tnum absolute right-[3px] top-1 min-w-4 rounded-full border-2 border-paper bg-copper px-1 text-[10px] font-semibold leading-4 text-white">
              {count > 99 ? '99+' : count}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[min(380px,calc(100vw-32px))]">
        <DropdownMenuLabel>
          <span>{t('shell.notificationsTitle')}</span>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                markAll.mutate();
              }}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-ink-2 hover:bg-chalk"
            >
              {t('shell.markAllRead')}
            </button>
          ) : null}
        </DropdownMenuLabel>

        {items.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-[13.5px] text-muted">{t('shell.noNotifications')}</p>
        ) : (
          items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => open(item)}
              className="grid grid-cols-[20px_1fr] items-start gap-x-2.5 gap-y-0.5 py-2"
            >
              <span
                aria-hidden
                className={cn('mt-1.5 size-1.5 rounded-full', item.isRead ? 'bg-transparent' : 'bg-copper')}
              />
              {/* The API already writes these in French (PRD wording) — shown verbatim. */}
              <span className="font-medium">{item.title}</span>
              {item.body ? <span className="col-start-2 text-xs text-muted">{item.body}</span> : null}
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/notifications')}>
          <Inbox />
          {t('shell.allNotifications')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
