import * as React from 'react';
import { cn } from '@/lib/cn';

/** Wrap every table: only the table scrolls sideways, never the page. */
export function TableWrap({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('overflow-x-auto', className)} {...props} />;
}

export const Table = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table ref={ref} className={cn('w-full border-collapse text-[13.5px]', className)} {...props} />
  ),
);
Table.displayName = 'Table';

export const THead = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={className} {...props} />,
);
THead.displayName = 'THead';

export const TBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('[&_tr:last-child_td]:border-b-0', className)} {...props} />
  ),
);
TBody.displayName = 'TBody';

export const TH = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <th
    ref={ref}
    scope="col"
    className={cn(
      'whitespace-nowrap border-b border-line bg-paper-2 px-3.5 py-2.5 text-left text-xs font-medium text-muted',
      numeric && 'text-right',
      className,
    )}
    {...props}
  />
));
TH.displayName = 'TH';

export const TD = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'h-[46px] border-b border-line-soft px-3.5 align-middle',
      numeric && 'tnum text-right',
      className,
    )}
    {...props}
  />
));
TD.displayName = 'TD';

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Makes the row open its record by mouse, Enter or Space, with a visible focus ring. */
  onActivate?: () => void;
  /** Dims and strikes a row the engine excludes from totals. */
  muted?: boolean;
}

export const TR = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, onActivate, muted, children, ...props }, ref) => (
    <tr
      ref={ref}
      {...(onActivate
        ? {
            tabIndex: 0,
            role: 'button',
            onClick: onActivate,
            onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivate();
              }
            },
          }
        : {})}
      className={cn(
        onActivate && 'cursor-pointer hover:[&>td]:bg-paper-2 focus-visible:outline-offset-[-2px]',
        muted && 'text-muted',
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  ),
);
TR.displayName = 'TR';

/** Reference code: OFF-2026-0001, 2026-004, CTR-2026-0001. */
export function Ref({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('whitespace-nowrap font-mono text-xs text-ink-2', className)}>{children}</span>;
}
