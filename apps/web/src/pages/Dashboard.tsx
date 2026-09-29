import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiGet, apiList, ApiError, PageMeta } from '../lib/api';
import { formatMoney, formatDate, formatMinutes, statusLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useCurrentUser } from '../lib/current-user';

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
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '20px 20px',
};

const statValueStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  color: '#111827',
  marginTop: 4,
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  fontWeight: 500,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: '#111827',
  marginBottom: 12,
  marginTop: 0,
};

const quickActionStyle: React.CSSProperties = {
  padding: '10px 18px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
};

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f3f4f6', fg: '#374151' },
  in_progress: { bg: '#dbeafe', fg: '#1e40af' },
  submitted: { bg: '#fef3c7', fg: '#92400e' },
  accepted: { bg: '#dcfce7', fg: '#166534' },
  rejected: { bg: '#fee2e2', fg: '#991b1b' },
  sent: { bg: '#dbeafe', fg: '#1d4ed8' },
  paid: { bg: '#dcfce7', fg: '#166534' },
  partially_paid: { bg: '#fef3c7', fg: '#92400e' },
  overdue: { bg: '#fee2e2', fg: '#dc2626' },
  approved: { bg: '#dcfce7', fg: '#166534' },
  pending: { bg: '#f3f4f6', fg: '#4b5563' },
};

/* ------------------------------------------------------------------ */
/*  Helpers: API responses are already unwrapped (lists are arrays)    */
/* ------------------------------------------------------------------ */

type ListResult = { items: unknown[]; meta: PageMeta };

function unwrapArray<T>(res: T[] | undefined): T[] {
  return Array.isArray(res) ? res : [];
}

/** Field roles get 403 on offers/invoices: those widgets are hidden rather than shown as errors. */
function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

/* ------------------------------------------------------------------ */
/*  Stat Card                                                          */
/* ------------------------------------------------------------------ */

interface StatCardProps {
  label: string;
  value: string | number;
  loading: boolean;
  error?: string;
  accentColor?: string;
}

function StatCard({ label, value, loading, error, accentColor }: StatCardProps) {
  return (
    <div style={{ ...cardStyle, borderTop: `3px solid ${accentColor || '#2563eb'}` }}>
      <div style={statLabelStyle}>{label}</div>
      <div style={statValueStyle}>
        {loading ? '...' : error ? '--' : value}
      </div>
      {error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{error}</div>
      )}
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

  const openOffers = useQuery<ListResult, ApiError>({
    queryKey: ['dash-offers'],
    queryFn: () => apiList('/offers?status=draft&limit=1'),
    enabled: isOffice,
    retry: false,
  });

  const pendingInvoices = useQuery<ListResult, ApiError>({
    queryKey: ['dash-invoices-pending'],
    queryFn: () => apiList('/invoices?status=sent&limit=1'),
    enabled: isOffice,
    retry: false,
  });

  const paidInvoices = useQuery<Invoice[], ApiError>({
    queryKey: ['dash-invoices-paid'],
    queryFn: () => apiGet<Invoice[]>('/invoices?status=paid&limit=100'),
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

  const canSeeOffers = isOffice && !isForbidden(recentOffers.error);
  const canSeeInvoices = isOffice && !isForbidden(recentInvoices.error);

  // Revenue calculation — sum of paid invoices this month
  const paidList = unwrapArray<Invoice>(paidInvoices.data);
  const now = new Date();
  const thisMonthRevenue = paidList
    .filter((inv) => {
      if (!inv.createdAt) return false;
      const d = new Date(inv.createdAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .reduce((sum, inv) => sum + (inv.paidCents || 0), 0);

  // Financial overview — all invoices for bar comparison
  const allInvoices = unwrapArray<Invoice>(recentInvoices.data);
  const totalInvoiced = allInvoices.reduce((s, i) => s + (i.totalTtcCents || 0), 0);
  const totalPaid = allInvoices.reduce((s, i) => s + (i.paidCents || 0), 0);
  const outstanding = totalInvoiced - totalPaid;
  const maxBar = Math.max(totalInvoiced, 1); // avoid division by zero

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 24 }}>
        {t('title')}
      </h1>

      {/* ============================================================ */}
      {/*  Summary Cards                                                */}
      {/* ============================================================ */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}
      >
        <StatCard
          label={t('stats.activeProjects')}
          value={statValue(activeProjects, getCount(activeProjects))}
          loading={activeProjects.isLoading}
          error={getError(activeProjects)}
          accentColor="#2563eb"
        />
        <StatCard
          label={t('stats.openOffers')}
          value={statValue(openOffers, getCount(openOffers))}
          loading={openOffers.isLoading}
          error={getError(openOffers)}
          accentColor="#f59e0b"
        />
        <StatCard
          label={t('stats.pendingInvoices')}
          value={statValue(pendingInvoices, getCount(pendingInvoices))}
          loading={pendingInvoices.isLoading}
          error={getError(pendingInvoices)}
          accentColor="#ef4444"
        />
        <StatCard
          label={t('stats.monthRevenue')}
          value={statValue(paidInvoices, formatMoney(thisMonthRevenue))}
          loading={paidInvoices.isLoading}
          error={getError(paidInvoices)}
          accentColor="#16a34a"
        />
      </div>

      {/* ============================================================ */}
      {/*  Quick Actions                                                */}
      {/* ============================================================ */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={sectionTitleStyle}>{t('quickActions.title')}</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {isOffice && (
            <>
              <button style={quickActionStyle} onClick={() => navigate('/offers')}>
                {t('quickActions.newOffer')}
              </button>
              <button
                style={{ ...quickActionStyle, background: '#16a34a' }}
                onClick={() => navigate('/invoices')}
              >
                {t('quickActions.newInvoice')}
              </button>
            </>
          )}
          <button
            style={{ ...quickActionStyle, background: '#7c3aed' }}
            onClick={() => navigate('/timekeeping')}
          >
            {t('quickActions.clockIn')}
          </button>
          <button
            style={{ ...quickActionStyle, background: '#0ea5e9' }}
            onClick={() => navigate('/daily-reports')}
          >
            {t('quickActions.newReport')}
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  Financial Overview                                           */}
      {/* ============================================================ */}
      {canSeeInvoices && (
      <div style={{ ...cardStyle, marginBottom: 32 }}>
        <h2 style={{ ...sectionTitleStyle, marginBottom: 16 }}>{t('financial.title')}</h2>
        {recentInvoices.isLoading ? (
          <div style={{ color: '#6b7280', fontSize: 14 }}>{t('common:state.loading')}</div>
        ) : (
          <div>
            {/* Invoiced bar */}
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  color: '#6b7280',
                  marginBottom: 4,
                }}
              >
                <span>{t('financial.totalInvoiced')}</span>
                <span style={{ fontWeight: 600, color: '#111827' }}>
                  {formatMoney(totalInvoiced)}
                </span>
              </div>
              <div
                style={{
                  height: 12,
                  background: '#e5e7eb',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    background: '#2563eb',
                    borderRadius: 6,
                  }}
                />
              </div>
            </div>

            {/* Paid bar */}
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  color: '#6b7280',
                  marginBottom: 4,
                }}
              >
                <span>{t('financial.totalPaid')}</span>
                <span style={{ fontWeight: 600, color: '#16a34a' }}>
                  {formatMoney(totalPaid)}
                </span>
              </div>
              <div
                style={{
                  height: 12,
                  background: '#e5e7eb',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.round((totalPaid / maxBar) * 100)}%`,
                    height: '100%',
                    background: '#16a34a',
                    borderRadius: 6,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>

            {/* Outstanding */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '1px solid #f3f4f6',
                paddingTop: 12,
                fontSize: 14,
              }}
            >
              <span style={{ color: '#6b7280' }}>{t('financial.outstanding')}</span>
              <span
                style={{
                  fontWeight: 700,
                  color: outstanding > 0 ? '#dc2626' : '#16a34a',
                }}
              >
                {formatMoney(outstanding)}
              </span>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ============================================================ */}
      {/*  Recent Activity — 3-column grid                              */}
      {/* ============================================================ */}
      <h2 style={sectionTitleStyle}>{t('recent.title')}</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}
      >
        {/* Recent Offers */}
        {canSeeOffers && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginTop: 0, marginBottom: 12 }}>
            {t('recent.offers')}
          </h3>
          {recentOffers.isLoading ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>{t('common:state.loading')}</div>
          ) : recentOffers.error ? (
            <div style={{ color: '#ef4444', fontSize: 13 }}>{errorMessage(recentOffers.error)}</div>
          ) : unwrapArray<Offer>(recentOffers.data).length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>{t('recent.noOffers')}</div>
          ) : (
            <div>
              {unwrapArray<Offer>(recentOffers.data)
                .slice(0, 5)
                .map((offer) => {
                  const colors = STATUS_COLORS[offer.status] ?? STATUS_COLORS.draft;
                  return (
                    <div
                      key={offer.id}
                      onClick={() => navigate(`/offers/${offer.id}`)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 0',
                        borderBottom: '1px solid #f3f4f6',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500, color: '#111827' }}>
                          {offer.projectName}
                        </div>
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>
                          {offer.createdAt ? formatDate(offer.createdAt) : ''}
                        </div>
                      </div>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 600,
                          background: colors.bg,
                          color: colors.fg,
                        }}
                      >
                        {statusLabel('offer', offer.status)}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
        )}

        {/* Recent Invoices */}
        {canSeeInvoices && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginTop: 0, marginBottom: 12 }}>
            {t('recent.invoices')}
          </h3>
          {recentInvoices.isLoading ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>{t('common:state.loading')}</div>
          ) : recentInvoices.error ? (
            <div style={{ color: '#ef4444', fontSize: 13 }}>{errorMessage(recentInvoices.error)}</div>
          ) : unwrapArray<Invoice>(recentInvoices.data).length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>{t('recent.noInvoices')}</div>
          ) : (
            <div>
              {unwrapArray<Invoice>(recentInvoices.data)
                .slice(0, 5)
                .map((inv) => {
                  const colors = STATUS_COLORS[inv.status] ?? STATUS_COLORS.draft;
                  return (
                    <div
                      key={inv.id}
                      onClick={() => navigate('/invoices')}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 0',
                        borderBottom: '1px solid #f3f4f6',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500, color: '#2563eb' }}>
                          {inv.invoiceNumber || t('recent.draftInvoice')}
                        </div>
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>
                          {formatMoney(inv.totalTtcCents || 0)}
                        </div>
                      </div>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 600,
                          background: colors.bg,
                          color: colors.fg,
                        }}
                      >
                        {statusLabel('invoice', inv.status)}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
        )}

        {/* Recent Time Entries */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginTop: 0, marginBottom: 12 }}>
            {t('recent.timeEntries')}
          </h3>
          {recentTime.isLoading ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>{t('common:state.loading')}</div>
          ) : recentTime.error ? (
            <div style={{ color: '#ef4444', fontSize: 13 }}>{errorMessage(recentTime.error)}</div>
          ) : unwrapArray<TimeEntry>(recentTime.data).length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>{t('recent.noTimeEntries')}</div>
          ) : (
            <div>
              {unwrapArray<TimeEntry>(recentTime.data)
                .slice(0, 5)
                .map((entry) => {
                  const colors = STATUS_COLORS[entry.status] ?? STATUS_COLORS.pending;
                  return (
                    <div
                      key={entry.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 0',
                        borderBottom: '1px solid #f3f4f6',
                        fontSize: 13,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500, color: '#111827' }}>
                          {entry.project?.name || t('recent.project')}
                        </div>
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>
                          {entry.date ? formatDate(entry.date) : ''}{' '}
                          {entry.durationMinutes ? formatMinutes(entry.durationMinutes) : ''}
                        </div>
                      </div>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 600,
                          background: colors.bg,
                          color: colors.fg,
                        }}
                      >
                        {entry.status ? statusLabel('timeEntry', entry.status) : t('recent.openEntry')}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
