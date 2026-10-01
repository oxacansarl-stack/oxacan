import { Badge, type BadgeTone } from '@/components/ui/badge';
import { statusLabel } from '@/lib/format';

/**
 * Colour for a stored status value, per domain. The label itself comes from the i18n
 * `status.<domain>` tables, so a badge always reads exactly as the rest of the app does.
 */
const TONES: Record<string, Record<string, BadgeTone>> = {
  offer: {
    draft: 'neutral',
    in_progress: 'copper',
    submitted: 'info',
    accepted: 'ok',
    rejected: 'bad',
    archived: 'neutral',
  },
  contract: {
    draft: 'neutral',
    sent: 'info',
    signed: 'ok',
    active: 'copper',
    completed: 'ok',
    terminated: 'bad',
  },
  amendment: { draft: 'neutral', sent: 'info', signed: 'ok' },
  esignature: { none: 'neutral', pending: 'warn', signed: 'ok', declined: 'bad', expired: 'bad' },
  project: {
    planning: 'neutral',
    active: 'copper',
    on_hold: 'warn',
    completed: 'ok',
    cancelled: 'bad',
  },
  milestone: { pending: 'neutral', completed: 'ok', overdue: 'bad' },
  task: { todo: 'neutral', in_progress: 'copper', done: 'ok', validated: 'ok', cancelled: 'bad' },
  timeEntry: { draft: 'neutral', submitted: 'info', approved: 'ok', rejected: 'bad' },
  expense: { draft: 'neutral', submitted: 'info', approved: 'ok', rejected: 'bad' },
  invoice: {
    draft: 'neutral',
    sent: 'info',
    partially_paid: 'warn',
    paid: 'ok',
    overdue: 'bad',
    cancelled: 'neutral',
  },
  plusValue: { detected: 'info', submitted: 'info', approved: 'ok', rejected: 'bad', invoiced: 'ok' },
  purchaseOrder: {
    draft: 'neutral',
    sent: 'info',
    confirmed: 'ok',
    partially_delivered: 'warn',
    delivered: 'ok',
    cancelled: 'bad',
  },
  meeting: { scheduled: 'info', in_progress: 'copper', completed: 'ok' },
  meetingAction: { open: 'warn', in_progress: 'copper', done: 'ok', cancelled: 'neutral' },
  assumption: { open: 'warn', confirmed: 'ok', rejected: 'bad' },
  subscription: {
    trialing: 'info',
    active: 'ok',
    past_due: 'bad',
    cancelled: 'neutral',
    paused: 'warn',
  },
};

export function StatusBadge({
  domain,
  value,
  className,
}: {
  domain: keyof typeof TONES | string;
  value: string | null | undefined;
  className?: string;
}) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <Badge tone={TONES[domain]?.[value] ?? 'neutral'} className={className}>
      {statusLabel(domain, value)}
    </Badge>
  );
}
