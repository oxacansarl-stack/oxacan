import * as React from 'react';
import { cn } from '@/lib/cn';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('min-w-0 rounded-card border border-line bg-paper', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

/** Title on the left, actions on the right; wraps instead of clipping on narrow screens. */
export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex min-h-[50px] flex-wrap items-center justify-between gap-2.5 border-b border-line-soft px-4 py-2.5',
        className,
      )}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => (
    <h2 ref={ref} className={cn('flex items-center gap-2 text-sm font-semibold', className)} {...props}>
      {children}
    </h2>
  ),
);
CardTitle.displayName = 'CardTitle';

/** The count beside a card title, e.g. "Lignes (5)". */
export function CardCount({ children }: { children: React.ReactNode }) {
  return <span className="tnum font-normal text-muted">{children}</span>;
}

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-4', className)} {...props} />,
);
CardContent.displayName = 'CardContent';

/** Footer under a table: a left-aligned action and a right-aligned note. */
export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-wrap items-center justify-between gap-2.5 border-t border-line-soft px-3.5 py-2.5 text-xs text-muted',
        className,
      )}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';
