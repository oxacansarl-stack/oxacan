import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, FileText, Plus, Receipt, Timer } from 'lucide-react';
import { apiGet, apiList, ApiError, PageMeta } from '../lib/api';
import { formatMoney, formatDate, formatMinutes } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useCurrentUser } from '../lib/current-user';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardContent, CardCount, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { DataState, EmptyState, Skeleton, TableSkeleton } from '@/components/states';
import { Ref, TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Offer {
  id: string;
  projectName: string;
  status: string;
  totalTtcCents: number;
  createdAt: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  totalTtcCents: number;
  paidCents: number;
  createdAt: string;
  issueDate?: string;
}

interface TimeEntry {
  id: string;
  date: string;
  durationMinutes: number;
  status: string;
  project?: { name: string };
}

/* ------------------------------------------------------------------ */
/*  Helpers: API responses are already unwrapped (lists are arrays)    */
/* ------------------------------------------------------------------ */

interface OfferStats {
  byStatus: Record<string, { count: number; totalTtcCents: number }>;
  open: { count: number; totalTtcCents: number };
}

interface InvoiceStats {
  year: number;
  invoicedTtcCents: number;
  paidTtcCents: number;
  outstandingTtcCents: number;
  pendingCount: number;
  pendingTtcCents: number;
  overdueCount: number;
  paidThisMonthCents: number;
}

type ListResult = { items: unknown[]; meta: PageMeta };

function unwrapArray<T>(res: T[] | undefined): T[] {
  return Array.isArray(res) ? res : [];
}

/** Field roles get 403 on offers/invoices: those widgets are hidden rather than shown as errors. */
function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

/* ------------------------------------------------------------------ */
/*  Stat strip cell                                                    */
/* ------------------------------------------------------------------ */

function StatCell({
  label,
  value,
  loading,
  error,
  className,
}: {
  label: string;
  value: string | number;
  loading: boolean;
  error?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 border-line-soft px-4 py-3.5', className)}>
      <div className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-20" />
      ) : (
        <div className="tnum mt-1 font-display text-[22px] font-semibold leading-tight">
          {error ? '—' : value}
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation('dashboard');
  const { role } = useCurrentUser();
  // Offers and invoices are office data; don't request them for field roles.
  const isOffice = role === 'ADMIN' || role === 'PROJECT_MANAGER';

  /* --- Stat queries --- */
  const activeProjects = useQuery<ListResult, ApiError>({
    queryKey: ['dash-projects'],
    queryFn: () => apiList('/projects?status=active&limit=1'),
    retry: false,
  });

  // Company-wide aggregates. These replace counting a one-row list and summing a capped page
  // of invoices: the figures below cover the whole company for the current financial year.
  const offerStats = useQuery<OfferStats, ApiError>({
    queryKey: ['dash-offer-stats'],
    queryFn: () => apiGet<OfferStats>('/offers/stats'),
    enabled: isOffice,
    retry: false,
  });

  const invoiceStats = useQuery<InvoiceStats, ApiError>({
    queryKey: ['dash-invoice-stats'],
    queryFn: () => apiGet<InvoiceStats>('/invoices/stats'),
    enabled: isOffice,
    retry: false,
  });

  /* --- Recent lists --- */
  const recentOffers = useQuery<Offer[], ApiError>({
    queryKey: ['dash-recent-offers'],
    queryFn: () => apiGet<Offer[]>('/offers?limit=5'),
    enabled: isOffice,
    retry: false,
  });

  const recentInvoices = useQuery<Invoice[], ApiError>({
    queryKey: ['dash-recent-invoices'],
    queryFn: () => apiGet<Invoice[]>('/invoices?limit=5'),
    enabled: isOffice,
    retry: false,
  });

  const recentTime = useQuery<TimeEntry[], ApiError>({
    queryKey: ['dash-recent-time'],
    queryFn: () => apiGet<TimeEntry[]>('/timekeeping?limit=5'),
    retry: false,
  });

  /* --- Computed values --- */
  function getCount(query: { data?: ListResult }): number {
    return query.data?.meta?.total ?? query.data?.items.length ?? 0;
  }

  /** '—' for widgets the caller's role may not see (not requested, or 403). */
  function statValue(
    query: { error: ApiError | null; status: string; fetchStatus: string },
    value: string | number,
  ): string | number {
    const notRequested = query.status === 'pending' && query.fetchStatus === 'idle';
    return notRequested || isForbidden(query.error) ? '—' : value;
  }

  function getError(query: { error: ApiError | null }): string | undefined {
    if (!query.error || isForbidden(query.error)) return undefined;
    if (query.error.status === 401) return t('stats.loginRequired');
    return errorMessage(query.error, t('stats.unavailable'));
  }

  /** A failed list is never shown as an empty one: DataState gets a message it can retry. */
  function listError(
    query: { isError: boolean; error: ApiError | null },
    fallback: string,
  ): string | null {
    if (!query.isError) return null;
    if (query.error?.status === 401) return t('stats.loginRequired');
    return errorMessage(query.error, fallback);
  }

  const canSeeOffers = isOffice && !isForbidden(recentOffers.error);
  const canSeeInvoices = isOffice && !isForbidden(recentInvoices.error);

  const money = invoiceStats.data;
  const thisMonthRevenue = money?.paidThisMonthCents ?? 0;
  const totalInvoiced = money?.invoicedTtcCents ?? 0;
  const totalPaid = money?.paidTtcCents ?? 0;
  const outstanding = money?.outstandingTtcCents ?? 0;
  const paidPercent = Math.round((totalPaid / Math.max(totalInvoiced, 1)) * 100);

  /* --- Recent rows --- */
  const offerRows = unwrapArray<Offer>(recentOffers.data).slice(0, 5);
  const invoiceRows = unwrapArray<Invoice>(recentInvoices.data).slice(0, 5);
  const timeRows = unwrapArray<TimeEntry>(recentTime.data).slice(0, 5);

  type Stat = {
    key: string;
    label: string;
    value: string | number;
    loading: boolean;
    error?: string;
  };

  const projectsStat: Stat = {
    key: 'activeProjects',
    label: t('stats.activeProjects'),
    value: statValue(activeProjects, getCount(activeProjects)),
    loading: activeProjects.isLoading,
    error: getError(activeProjects),
  };

  const offersStat: Stat = {
    key: 'openOffers',
    label: t('stats.openOffers'),
    value: statValue(offerStats, offerStats.data?.open.count ?? 0),
    loading: offerStats.isLoading,
    error: getError(offerStats),
  };

  const invoicesStat: Stat = {
    key: 'pendingInvoices',
    label: t('stats.pendingInvoices'),
    value: statValue(invoiceStats, money?.pendingCount ?? 0),
    loading: invoiceStats.isLoading,
    error: getError(invoiceStats),
  };

  const revenueStat: Stat = {
    key: 'monthRevenue',
    label: t('stats.monthRevenue'),
    value: statValue(invoiceStats, formatMoney(thisMonthRevenue)),
    loading: invoiceStats.isLoading,
    error: getError(invoiceStats),
  };

  // Offers, invoices and revenue are office figures and are never requested for a field role:
  // showing them would be three permanently blank cells labelled with information that role
  // cannot have. They are left out of the strip entirely instead.
  const stats: Stat[] = [projectsStat, ...(isOffice ? [offersStat, invoicesStat, revenueStat] : [])];

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        actions={
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={t('quickActions.title')}
          >
            {isOffice ? (
              <>
                <Button variant="primary" onClick={() => navigate('/offers')}>
                  <Plus />
                  {t('quickActions.newOffer')}
                </Button>
                <Button variant="ghost" onClick={() => navigate('/invoices')}>
                  <Plus />
                  {t('quickActions.newInvoice')}
                </Button>
                <Button variant="ghost" onClick={() => navigate('/timekeeping')}>
                  <Timer />
                  {t('quickActions.clockIn')}
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => navigate('/timekeeping')}>
                <Timer />
                {t('quickActions.clockIn')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate('/daily-reports')}>
              <ClipboardList />
              {t('quickActions.newReport')}
            </Button>
          </div>
        }
      />

      {/* ============================================================ */}
      {/*  Stat strip — one card, the figures divided by a hairline      */}
      {/* ============================================================ */}
      <Card role="group" aria-label={t('stats.label')}>
        {/* Sized to the cells actually rendered: a field role gets the one figure, full width. */}
        <div className={cn('grid', stats.length > 1 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-1')}>
          {stats.map((stat, i) => (
            <StatCell
              key={stat.key}
              label={stat.label}
              value={stat.value}
              loading={stat.loading}
              error={stat.error}
              className={cn(
                // Two columns on mobile, four from md: the divider follows the column it opens.
                i % 2 === 1 ? 'border-l' : i > 0 && 'md:border-l',
                i >= 2 && 'border-t md:border-t-0',
              )}
            />
          ))}
        </div>
      </Card>

      {/* ============================================================ */}
      {/*  Financial Overview                                           */}
      {/* ============================================================ */}
      {canSeeInvoices && (
        <Card>
          <CardHeader>
            <CardTitle>{t('financial.title')}</CardTitle>
          </CardHeader>
          <DataState
            isLoading={invoiceStats.isLoading}
            error={getError(invoiceStats) ? t('financial.loadFailed') : null}
            onRetry={() => invoiceStats.refetch()}
            loading={<TableSkeleton rows={3} cols={2} />}
          >
            <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
              {/* Invoiced — the reference bar, always full width */}
              <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 text-[13px]">
                  <span className="text-muted">{t('financial.totalInvoiced')}</span>
                  <span className="tnum font-semibold">{formatMoney(totalInvoiced)}</span>
                </div>
                <div aria-hidden className="h-2.5 overflow-hidden rounded-full bg-line-soft">
                  <div className="h-full w-full rounded-full bg-graphite" />
                </div>
              </div>

              {/* Paid — share of the invoiced total */}
              <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 text-[13px]">
                  <span className="text-muted">{t('financial.totalPaid')}</span>
                  <span className="tnum font-semibold text-ok">{formatMoney(totalPaid)}</span>
                </div>
                <div aria-hidden className="h-2.5 overflow-hidden rounded-full bg-line-soft">
                  {/* A bar's width is a runtime value — the one inline style the conventions allow. */}
                  <div
                    className="h-full rounded-full bg-ok transition-[width] duration-300"
                    style={{ width: `${paidPercent}%` }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-3 border-t border-line-soft pt-3 text-[13.5px]">
                <span className="text-muted">{t('financial.outstanding')}</span>
                <span className={cn('tnum font-semibold', outstanding > 0 ? 'text-bad' : 'text-ok')}>
                  {formatMoney(outstanding)}
                </span>
              </div>
            </CardContent>
            <CardFooter>
              <span>{t('financial.basis', { year: money?.year ?? '' })}</span>
            </CardFooter>
          </DataState>
        </Card>
      )}

      {/* ============================================================ */}
      {/*  Recent Activity                                              */}
      {/* ============================================================ */}
      <section aria-labelledby="dash-recent" className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <h2
          id="dash-recent"
          className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink"
        >
          {t('recent.title')}
        </h2>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
          {/* Recent Offers */}
          {canSeeOffers && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('recent.offers')}
                  {offerRows.length > 0 ? <CardCount>({offerRows.length})</CardCount> : null}
                </CardTitle>
              </CardHeader>
              <DataState
                isLoading={recentOffers.isLoading}
                error={listError(recentOffers, t('recent.offersFailed'))}
                onRetry={() => recentOffers.refetch()}
                isEmpty={offerRows.length === 0}
                loading={<TableSkeleton rows={4} cols={4} />}
                empty={
                  <EmptyState
                    icon={<FileText className="size-5" />}
                    title={t('recent.noOffers')}
                    description={t('recent.noOffersHelp')}
                  />
                }
              >
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>{t('recent.table.project')}</TH>
                        <TH>{t('recent.table.status')}</TH>
                        <TH numeric>{t('recent.table.amount')}</TH>
                        <TH>{t('recent.table.date')}</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {offerRows.map((offer) => (
                        <TR key={offer.id} onActivate={() => navigate(`/offers/${offer.id}`)}>
                          <TD className="font-medium">{offer.projectName}</TD>
                          <TD>
                            <StatusBadge domain="offer" value={offer.status} />
                          </TD>
                          <TD numeric>{formatMoney(offer.totalTtcCents ?? 0)}</TD>
                          <TD className="tnum text-muted">{formatDate(offer.createdAt)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </DataState>
            </Card>
          )}

          {/* Recent Invoices */}
          {canSeeInvoices && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('recent.invoices')}
                  {invoiceRows.length > 0 ? <CardCount>({invoiceRows.length})</CardCount> : null}
                </CardTitle>
              </CardHeader>
              <DataState
                isLoading={recentInvoices.isLoading}
                error={listError(recentInvoices, t('recent.invoicesFailed'))}
                onRetry={() => recentInvoices.refetch()}
                isEmpty={invoiceRows.length === 0}
                loading={<TableSkeleton rows={4} cols={3} />}
                empty={
                  <EmptyState
                    icon={<Receipt className="size-5" />}
                    title={t('recent.noInvoices')}
                    description={t('recent.noInvoicesHelp')}
                  />
                }
              >
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>{t('recent.table.number')}</TH>
                        <TH>{t('recent.table.status')}</TH>
                        <TH numeric>{t('recent.table.amount')}</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {invoiceRows.map((inv) => (
                        <TR key={inv.id} onActivate={() => navigate('/invoices')}>
                          <TD>
                            {inv.invoiceNumber ? (
                              <Ref>{inv.invoiceNumber}</Ref>
                            ) : (
                              <span className="text-muted">{t('recent.draftInvoice')}</span>
                            )}
                          </TD>
                          <TD>
                            <StatusBadge domain="invoice" value={inv.status} />
                          </TD>
                          <TD numeric>{formatMoney(inv.totalTtcCents ?? 0)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </DataState>
            </Card>
          )}

          {/* Recent Time Entries — the one list every role sees */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>
                {t('recent.timeEntries')}
                {timeRows.length > 0 ? <CardCount>({timeRows.length})</CardCount> : null}
              </CardTitle>
            </CardHeader>
            <DataState
              isLoading={recentTime.isLoading}
              error={listError(recentTime, t('recent.timeEntriesFailed'))}
              onRetry={() => recentTime.refetch()}
              isEmpty={timeRows.length === 0}
              loading={<TableSkeleton rows={4} cols={4} />}
              empty={
                <EmptyState
                  icon={<Timer className="size-5" />}
                  title={t('recent.noTimeEntries')}
                  description={t('recent.noTimeEntriesHelp')}
                />
              }
            >
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <TH>{t('recent.table.project')}</TH>
                      <TH>{t('recent.table.status')}</TH>
                      <TH>{t('recent.table.date')}</TH>
                      <TH numeric>{t('recent.table.duration')}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {timeRows.map((entry) => (
                      // A time entry has no detail route, so the row stays a plain row.
                      <TR key={entry.id}>
                        <TD className="font-medium">{entry.project?.name || t('recent.project')}</TD>
                        <TD>
                          {entry.status ? (
                            <StatusBadge domain="timeEntry" value={entry.status} />
                          ) : (
                            // No status yet means the clock is still running.
                            <Badge tone="live">{t('recent.openEntry')}</Badge>
                          )}
                        </TD>
                        <TD className="tnum text-muted">{formatDate(entry.date)}</TD>
                        <TD numeric>
                          {entry.durationMinutes ? formatMinutes(entry.durationMinutes) : '—'}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </DataState>
          </Card>
        </div>
      </section>
    </PageBody>
  );
}
