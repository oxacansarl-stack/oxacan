import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-[7px] pr-2 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-neu-bg text-neu',
        info: 'bg-info-bg text-info',
        ok: 'bg-ok-bg text-ok',
        bad: 'bg-bad-bg text-bad',
        warn: 'bg-warn-bg text-warn',
        copper: 'bg-copper-bg text-copper',
        /** Something happening right now, e.g. an open clock-in. */
        live: 'bg-graphite text-volt',
      },
      dot: { true: '', false: 'pl-2' },
    },
    defaultVariants: { tone: 'neutral', dot: true },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/** Status pill. The dot carries the state in shape as well as colour. */
export function Badge({ className, tone, dot = true, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, dot }), className)} {...props}>
      {dot ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-85" /> : null}
      {children}
    </span>
  );
}

/** Square-ish tag for a type or category (line type, invoice type) — never a status. */
export function Tag({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'default' | 'warn' | 'bad' | 'dashed' }) {
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded border px-[7px] py-0.5 text-[11.5px] font-medium',
        tone === 'warn' && 'border-[#e6d2a4] bg-warn-bg text-warn',
        tone === 'bad' && 'border-[#e9c3b9] bg-bad-bg text-bad',
        tone === 'dashed' && 'border-dashed border-line bg-transparent text-muted',
        (!tone || tone === 'default') && 'border-line bg-paper-2 text-ink-2',
        className,
      )}
      {...props}
    />
  );
}
