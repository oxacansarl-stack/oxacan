import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPut, apiPost, api, formatCHF } from '../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CompanySettings {
  companyName?: string;
  legalName?: string;
  address?: string;
  vatNumber?: string;
  defaultVatRate?: number;
  defaultRetentionRate?: number;
  defaultMarginFactor?: number;
  geolocationEnabled?: boolean;
}

interface Subscription {
  id?: string;
  tier?: string;
  status?: string;
  saasSeatCount?: number;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  trialEnd?: string;
}

interface SeatInfo {
  used: number;
  total: number;
}

interface BillingEvent {
  id: string;
  type: string;
  amountCents: number;
  stripeEventId?: string;
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  ...btnPrimary,
  background: '#dc2626',
};

const btnOutline: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 14,
  color: '#111827',
  borderTop: '1px solid #f3f4f6',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  display: 'block',
  marginBottom: 4,
  fontWeight: 600,
};

const sectionStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 24,
  marginBottom: 24,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const displayCHF = (cents: number): string => {
  const rounded = Math.round(cents / 5) * 5;
  return `CHF ${(rounded / 100).toFixed(2)}`;
};

const TIER_COLORS: Record<string, { bg: string; fg: string }> = {
  solo: { bg: '#dbeafe', fg: '#1d4ed8' },
  equipe: { bg: '#ede9fe', fg: '#7c3aed' },
  entreprise: { bg: '#fef3c7', fg: '#92400e' },
};

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#dcfce7', fg: '#166534' },
  trialing: { bg: '#fef3c7', fg: '#92400e' },
  cancelled: { bg: '#fee2e2', fg: '#dc2626' },
  past_due: { bg: '#fee2e2', fg: '#dc2626' },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Settings() {
  const [settings, setSettings] = useState<CompanySettings>({});
  const [subscription, setSubscription] = useState<Subscription>({});
  const [seats, setSeats] = useState<SeatInfo>({ used: 0, total: 0 });
  const [billingEvents, setBillingEvents] = useState<BillingEvent[]>([]);
  const [billingPage, setBillingPage] = useState(1);
  const [billingTotalPages, setBillingTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  // Form state for editable defaults
  const [vatRate, setVatRate] = useState('');
  const [retentionRate, setRetentionRate] = useState('');
  const [marginFactor, setMarginFactor] = useState('');
  const [geoEnabled, setGeoEnabled] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await apiGet<any>('/settings');
      const data = res?.data ?? res;
      setSettings(data);
      setVatRate(data.defaultVatRate != null ? (data.defaultVatRate / 100).toFixed(2) : '8.10');
      setRetentionRate(data.defaultRetentionRate != null ? (data.defaultRetentionRate / 100).toFixed(2) : '5.00');
      setMarginFactor(data.defaultMarginFactor != null ? (data.defaultMarginFactor / 100).toFixed(2) : '1.20');
      setGeoEnabled(data.geolocationEnabled ?? false);
    } catch (e: any) {
      setError(e.message || 'Failed to load settings');
    }
  }, []);

  const fetchSubscription = useCallback(async () => {
    try {
      const [subRes, seatsRes] = await Promise.all([
        apiGet<any>('/subscription'),
        apiGet<any>('/subscription/seats'),
      ]);
      setSubscription(subRes?.data ?? subRes ?? {});
      const s = seatsRes?.data ?? seatsRes ?? {};
      setSeats({ used: s.used ?? 0, total: s.total ?? 0 });
    } catch { /* subscription may not exist */ }
  }, []);

  const fetchBilling = useCallback(async () => {
    try {
      const res = await apiGet<PaginatedResponse<BillingEvent>>(`/subscription/billing?page=${billingPage}`);
      if (res && typeof res === 'object' && 'data' in res) {
        setBillingEvents(res.data);
        setBillingTotalPages(Math.ceil((res.meta?.total ?? res.data.length) / (res.meta?.pageSize ?? 25)));
      } else if (Array.isArray(res)) {
        setBillingEvents(res);
      }
    } catch { /* ignore */ }
  }, [billingPage]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSettings(), fetchSubscription()]).finally(() => setLoading(false));
  }, [fetchSettings, fetchSubscription]);

  useEffect(() => { fetchBilling(); }, [fetchBilling]);

  const handleSaveDefaults = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await apiPut('/settings', {
        defaultVatRate: Math.round(parseFloat(vatRate) * 100),
        defaultRetentionRate: Math.round(parseFloat(retentionRate) * 100),
        defaultMarginFactor: Math.round(parseFloat(marginFactor) * 100),
        geolocationEnabled: geoEnabled,
      });
      setSuccess('Settings saved successfully');
      fetchSettings();
    } catch (e: any) {
      setError(e.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm('Are you sure you want to cancel your subscription? This action cannot be undone.')) return;
    try {
      await apiPost('/subscription/cancel');
      setSuccess('Subscription cancelled');
      fetchSubscription();
    } catch (e: any) {
      setError(e.message || 'Failed to cancel subscription');
    }
  };

  if (loading) {
    return <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>Loading settings...</p>;
  }

  const seatPct = seats.total > 0 ? Math.min(100, Math.round((seats.used / seats.total) * 100)) : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Settings</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Company settings, defaults, and subscription</p>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 600 }}>x</button>
        </div>
      )}

      {success && (
        <div style={{ background: '#dcfce7', color: '#166534', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {success}
          <button onClick={() => setSuccess('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#166534', fontWeight: 600 }}>x</button>
        </div>
      )}

      {/* Company Info */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 16px' }}>Company Information</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>Company Name</label>
            <div style={{ fontSize: 14, color: '#111827', padding: '8px 0' }}>{settings.companyName || '-'}</div>
          </div>
          <div>
            <label style={labelStyle}>Legal Name</label>
            <div style={{ fontSize: 14, color: '#111827', padding: '8px 0' }}>{settings.legalName || '-'}</div>
          </div>
          <div>
            <label style={labelStyle}>Address</label>
            <div style={{ fontSize: 14, color: '#111827', padding: '8px 0' }}>{settings.address || '-'}</div>
          </div>
          <div>
            <label style={labelStyle}>VAT Number</label>
            <div style={{ fontSize: 14, color: '#111827', padding: '8px 0' }}>{settings.vatNumber || '-'}</div>
          </div>
        </div>
      </div>

      {/* Defaults */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 16px' }}>Defaults</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Default VAT Rate (%)</label>
            <input
              type="number"
              step="0.01"
              style={inputStyle}
              value={vatRate}
              onChange={e => setVatRate(e.target.value)}
              placeholder="8.10"
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Stored as basis points (810 = 8.10%)</div>
          </div>
          <div>
            <label style={labelStyle}>Default Retention Rate (%)</label>
            <input
              type="number"
              step="0.01"
              style={inputStyle}
              value={retentionRate}
              onChange={e => setRetentionRate(e.target.value)}
              placeholder="5.00"
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Stored as basis points (500 = 5.00%)</div>
          </div>
          <div>
            <label style={labelStyle}>Default Margin Factor</label>
            <input
              type="number"
              step="0.01"
              style={inputStyle}
              value={marginFactor}
              onChange={e => setMarginFactor(e.target.value)}
              placeholder="1.20"
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Stored as integer (120 = 1.20x)</div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: '#111827' }}>
            <input
              type="checkbox"
              checked={geoEnabled}
              onChange={e => setGeoEnabled(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            Enable Geolocation
          </label>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, marginLeft: 24 }}>Track GPS coordinates for timekeeping and daily reports</div>
        </div>

        <button style={btnPrimary} onClick={handleSaveDefaults} disabled={saving}>
          {saving ? 'Saving...' : 'Save Defaults'}
        </button>
      </div>

      {/* Subscription */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 16px' }}>Subscription</h2>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
          {subscription.tier && (
            <span style={{
              display: 'inline-block',
              padding: '4px 14px',
              borderRadius: 9999,
              fontSize: 13,
              fontWeight: 600,
              background: (TIER_COLORS[subscription.tier] || TIER_COLORS.solo).bg,
              color: (TIER_COLORS[subscription.tier] || TIER_COLORS.solo).fg,
              textTransform: 'capitalize',
            }}>
              {subscription.tier}
            </span>
          )}
          {subscription.status && (
            <span style={{
              display: 'inline-block',
              padding: '4px 14px',
              borderRadius: 9999,
              fontSize: 13,
              fontWeight: 500,
              background: (STATUS_COLORS[subscription.status] || STATUS_COLORS.active).bg,
              color: (STATUS_COLORS[subscription.status] || STATUS_COLORS.active).fg,
              textTransform: 'capitalize',
            }}>
              {subscription.status.replace('_', ' ')}
            </span>
          )}
        </div>

        {/* Seat usage */}
        {seats.total > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
              <span>Seat Usage: {seats.used} of {seats.total} seats used</span>
              <span>{seatPct}%</span>
            </div>
            <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${seatPct}%`,
                height: '100%',
                background: seatPct >= 90 ? '#dc2626' : seatPct >= 70 ? '#f59e0b' : '#2563eb',
                borderRadius: 4,
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        )}

        {/* Period and trial info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div>
            <label style={labelStyle}>Current Period Start</label>
            <div style={{ fontSize: 14, color: '#111827' }}>
              {subscription.currentPeriodStart ? new Date(subscription.currentPeriodStart).toLocaleDateString() : '-'}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Current Period End</label>
            <div style={{ fontSize: 14, color: '#111827' }}>
              {subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : '-'}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Trial End</label>
            <div style={{ fontSize: 14, color: '#111827' }}>
              {subscription.trialEnd ? new Date(subscription.trialEnd).toLocaleDateString() : '-'}
            </div>
          </div>
        </div>

        {/* Billing history */}
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 8 }}>Billing History</h3>
        {billingEvents.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 14, padding: '12px 0' }}>No billing events</p>
        ) : (
          <>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Type</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                    <th style={thStyle}>Stripe Event ID</th>
                  </tr>
                </thead>
                <tbody>
                  {billingEvents.map(evt => (
                    <tr key={evt.id}>
                      <td style={tdStyle}>{new Date(evt.createdAt).toLocaleDateString()}</td>
                      <td style={tdStyle}>
                        <span style={{ textTransform: 'capitalize' }}>{evt.type.replace(/_/g, ' ')}</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                        {displayCHF(evt.amountCents)}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>
                        {evt.stripeEventId || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {billingTotalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                <button
                  style={btnOutline}
                  disabled={billingPage <= 1}
                  onClick={() => setBillingPage(p => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span style={{ padding: '8px 12px', fontSize: 14, color: '#6b7280' }}>
                  Page {billingPage} of {billingTotalPages}
                </span>
                <button
                  style={btnOutline}
                  disabled={billingPage >= billingTotalPages}
                  onClick={() => setBillingPage(p => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}

        {/* Cancel subscription */}
        {subscription.status && subscription.status !== 'cancelled' && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
            <button style={btnDanger} onClick={handleCancelSubscription}>
              Cancel Subscription
            </button>
            <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 12 }}>This cannot be undone</span>
          </div>
        )}
      </div>
    </div>
  );
}
