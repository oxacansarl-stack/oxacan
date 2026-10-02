import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Every page opens the same way: an optional kicker, the title, a metadata line, then the
 * actions. The breadcrumb lives in the top bar, so a page never repeats its own location.
 */
export function PageHeader({
  title,
  kicker,
  meta,
  actions,
  className,
}: {
  title: React.ReactNode;
  kicker?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-5 gap-y-3', className)}>
      <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 gap-1.5">
        {kicker ? <div className="text-[13px] text-muted">{kicker}</div> : null}
        <h1 className="flex flex-wrap items-center gap-2.5 font-display text-2xl font-semibold tracking-[-0.015em]">
          {title}
        </h1>
        {meta ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13.5px] text-muted">{meta}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Vertical hairline between two metadata items. */
export function MetaDivider() {
  return <span aria-hidden className="h-3.5 w-px bg-line" />;
}

/**
 * The page body: one column, consistent gaps, room under the last card.
 * The column is pinned to minmax(0,1fr) because an `auto` grid track grows to its widest
 * child — a wide table would otherwise stretch the page sideways instead of scrolling itself.
 */
export function PageBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid grid-cols-[minmax(0,1fr)] content-start gap-5', className)} {...props} />;
}
