import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * The three states every data view needs. Phase 9 asks for no unhandled state, so pages use
 * these instead of inventing their own: a skeleton that keeps the layout, an empty state that
 * says what would appear here, and an error that can be retried.
 */

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded bg-neu-bg', className)}
      {...props}
    />
  );
}

/** Placeholder rows shaped like the table that is loading. */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  const { t } = useTranslation();
  return (
    <div className="p-3.5" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t('state.loading')}</span>
      <div className="grid gap-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={c}
                className="h-3"
                style={{ width: c === 0 ? '22%' : c === cols - 1 ? '12%' : `${14 + ((r + c) % 3) * 6}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid justify-items-center gap-3 p-10 text-muted" role="status" aria-live="polite">
      <Skeleton className="h-3 w-40" />
      <span className="text-[13.5px]">{label ?? t('state.loading')}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-2.5 px-5 py-12 text-center">
      <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-neu-bg text-muted">
        {icon ?? <Inbox className="size-5" />}
      </span>
      <p className="font-medium text-ink">{title}</p>
      {description ? <p className="max-w-[46ch] text-[13.5px] text-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/**
 * A failed load must never look like an empty list: it names the failure and offers a retry.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid justify-items-center gap-2.5 px-5 py-12 text-center" role="alert">
      <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-bad-bg text-bad">
        <CircleAlert className="size-5" />
      </span>
      <p className="max-w-[52ch] text-[13.5px] text-bad">{message}</p>
      {onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry} className="mt-1">
          {t('actions.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * One guard for a whole data view. Order matters: an error wins over an empty result, so a
 * failed request is never shown as "no data".
 */
export function DataState({
  isLoading,
  error,
  isEmpty,
  onRetry,
  loading,
  empty,
  children,
}: {
  isLoading: boolean;
  error?: string | null;
  isEmpty?: boolean;
  onRetry?: () => void;
  loading?: React.ReactNode;
  empty?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (isLoading) return <>{loading ?? <TableSkeleton />}</>;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (isEmpty) return <>{empty ?? <EmptyState title="—" />}</>;
  return <>{children}</>;
}
