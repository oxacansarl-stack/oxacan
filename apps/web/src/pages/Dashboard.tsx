import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiList, ApiError, formatCHF, PageMeta } from '../lib/api';
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
    if (query.error.status === 401) return 'Login required';
    return query.error.message || 'Unavailable';
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
        Dashboard
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
          label="Active Projects"
          value={statValue(activeProjects, getCount(activeProjects))}
          loading={activeProjects.isLoading}
          error={getError(activeProjects)}
          accentColor="#2563eb"
        />
        <StatCard
          label="Open Offers"
          value={statValue(openOffers, getCount(openOffers))}
          loading={openOffers.isLoading}
          error={getError(openOffers)}
          accentColor="#f59e0b"
        />
        <StatCard
          label="Pending Invoices"
          value={statValue(pendingInvoices, getCount(pendingInvoices))}
          loading={pendingInvoices.isLoading}
          error={getError(pendingInvoices)}
          accentColor="#ef4444"
        />
        <StatCard
          label="This Month Revenue"
          value={statValue(paidInvoices, `CHF ${formatCHF(thisMonthRevenue)}`)}
          loading={paidInvoices.isLoading}
          error={getError(paidInvoices)}
          accentColor="#16a34a"
        />
      </div>

      {/* ============================================================ */}
      {/*  Quick Actions                                                */}
      {/* ============================================================ */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={sectionTitleStyle}>Quick Actions</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {isOffice && (
            <>
              <button style={quickActionStyle} onClick={() => navigate('/offers')}>
                + New Offer
              </button>
              <button
                style={{ ...quickActionStyle, background: '#16a34a' }}
                onClick={() => navigate('/invoices')}
              >
                + New Invoice
              </button>
            </>
          )}
          <button
            style={{ ...quickActionStyle, background: '#7c3aed' }}
            onClick={() => navigate('/timekeeping')}
          >
            Clock In
          </button>
          <button
            style={{ ...quickActionStyle, background: '#0ea5e9' }}
            onClick={() => navigate('/daily-reports')}
          >
            + New Report
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  Financial Overview                                           */}
      {/* ============================================================ */}
      {canSeeInvoices && (
      <div style={{ ...cardStyle, marginBottom: 32 }}>
        <h2 style={{ ...sectionTitleStyle, marginBottom: 16 }}>Financial Overview</h2>
        {recentInvoices.isLoading ? (
          <div style={{ color: '#6b7280', fontSize: 14 }}>Loading...</div>
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
                <span>Total Invoiced</span>
                <span style={{ fontWeight: 600, color: '#111827' }}>
                  CHF {formatCHF(totalInvoiced)}
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
                <span>Total Paid</span>
                <span style={{ fontWeight: 600, color: '#16a34a' }}>
                  CHF {formatCHF(totalPaid)}
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
              <span style={{ color: '#6b7280' }}>Outstanding</span>
              <span
                style={{
                  fontWeight: 700,
                  color: outstanding > 0 ? '#dc2626' : '#16a34a',
                }}
              >
                CHF {formatCHF(outstanding)}
              </span>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ============================================================ */}
      {/*  Recent Activity — 3-column grid                              */}
      {/* ============================================================ */}
      <h2 style={sectionTitleStyle}>Recent Activity</h2>
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
            Recent Offers
          </h3>
          {recentOffers.isLoading ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>Loading...</div>
          ) : recentOffers.error ? (
            <div style={{ color: '#ef4444', fontSize: 13 }}>{recentOffers.error.message}</div>
          ) : unwrapArray<Offer>(recentOffers.data).length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>No offers yet</div>
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
                          {offer.createdAt
                            ? new Date(offer.createdAt).toLocaleDateString('fr-CH')
                            : ''}
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
                          textTransform: 'capitalize',
                        }}
                      >
                        {offer.status?.replace(/_/g, ' ')}
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
            Recent Invoices
          </h3>
          {recentInvoices.isLoading ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>Loading...</div>
          ) : recentInvoices.error ? (
            <div style={{ color: '#ef4444', fontSize: 13 }}>{recentInvoices.error.message}</div>
          ) : unwrapArray<Invoice>(recentInvoices.data).length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>No invoices yet</div>
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
                          {inv.invoiceNumber || 'Draft'}
                        </div>
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>
                          CHF {formatCHF(inv.totalTtcCents || 0)}
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
                          textTransform: 'capitalize',
                        }}
                      >
                        {inv.status?.replace(/_/g, ' ')}
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
            Recent Time Entries
          </h3>
          {recentTime.isLoading ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>Loading...</div>
          ) : recentTime.error ? (
            <div style={{ color: '#ef4444', fontSize: 13 }}>{recentTime.error.message}</div>
          ) : unwrapArray<TimeEntry>(recentTime.data).length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>No time entries yet</div>
          ) : (
            <div>
              {unwrapArray<TimeEntry>(recentTime.data)
                .slice(0, 5)
                .map((entry) => {
                  const hours = Math.floor((entry.durationMinutes || 0) / 60);
                  const mins = (entry.durationMinutes || 0) % 60;
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
                          {entry.project?.name || 'Project'}
                        </div>
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>
                          {entry.date
                            ? new Date(entry.date).toLocaleDateString('fr-CH')
                            : ''}{' '}
                          {hours > 0 || mins > 0 ? `${hours}h${mins > 0 ? ` ${mins}m` : ''}` : ''}
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
                          textTransform: 'capitalize',
                        }}
                      >
                        {entry.status?.replace(/_/g, ' ') || 'active'}
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
