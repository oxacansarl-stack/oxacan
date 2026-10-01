import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPut, apiPost, apiList } from '../lib/api';
import { useCurrentUser } from '../lib/current-user';
import { enumLabel, formatDate, formatMoney, statusLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';
import type { PageProps } from '../lib/page-props';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CompanySettings {
  companyName?: string;
  legalName?: string | null;
  address?: string | null;
  vatNumber?: string | null;
  logo?: string | null;
  defaultVatRate?: number;
  defaultRetentionRate?: number;
  defaultMarginFactor?: number;
  geolocationEnabled?: boolean;
  iban?: string | null;
  defaultPaymentTermsDays?: number;
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

const displayCHF = (cents: number): string => formatMoney(Math.round(cents / 5) * 5);

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

/** "CH4431999123000889012" → "CH44 3199 9123 0008 8901 2" (as printed by banks). */
function formatIban(value: string): string {
  return value.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

export default function Settings({ embedded = false }: PageProps) {
  const { t } = useTranslation('settings');
  // Project managers may view the defaults; changing them and the subscription is admin-only.
  const isAdmin = useCurrentUser().role === 'ADMIN';
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
  const [iban, setIban] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState('30');

  const fetchSettings = useCallback(async () => {
    try {
      const data = await apiGet<CompanySettings>('/settings');
      setSettings(data);
      setVatRate(data.defaultVatRate != null ? (data.defaultVatRate / 100).toFixed(2) : '8.10');
      setRetentionRate(data.defaultRetentionRate != null ? (data.defaultRetentionRate / 100).toFixed(2) : '5.00');
      setMarginFactor(data.defaultMarginFactor != null ? (data.defaultMarginFactor / 100).toFixed(2) : '1.20');
      setGeoEnabled(data.geolocationEnabled ?? false);
      setIban(formatIban(data.iban ?? ''));
      setPaymentTermsDays(String(data.defaultPaymentTermsDays ?? 30));
    } catch (e: any) {
      setError(errorMessage(e, t('messages.loadFailed')));
    }
  }, [t]);

  const fetchSubscription = useCallback(async () => {
    try {
      const [sub, s] = await Promise.all([
        apiGet<Subscription>('/subscription'),
        apiGet<Partial<SeatInfo>>('/subscription/seats'),
      ]);
      setSubscription(sub ?? {});
      setSeats({ used: s?.used ?? 0, total: s?.total ?? 0 });
    } catch { /* subscription may not exist */ }
  }, []);

  const fetchBilling = useCallback(async () => {
    try {
      const { items, meta } = await apiList<BillingEvent>(`/subscription/billing?page=${billingPage}`);
      setBillingEvents(items);
      setBillingTotalPages(Math.max(1, meta?.totalPages ?? 1));
    } catch { /* ignore */ }
  }, [billingPage]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSettings(), isAdmin ? fetchSubscription() : undefined]).finally(() => setLoading(false));
  }, [fetchSettings, fetchSubscription, isAdmin]);

  useEffect(() => { if (isAdmin) fetchBilling(); }, [fetchBilling, isAdmin]);

  const handleSaveDefaults = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    // Percentages → basis points, factor → hundredths (integers, as the API expects).
    const toHundredths = (v: string) => Math.round(parseFloat(v) * 100);
    const payload = {
      defaultVatRate: toHundredths(vatRate),
      defaultRetentionRate: toHundredths(retentionRate),
      defaultMarginFactor: toHundredths(marginFactor),
      geolocationEnabled: geoEnabled,
      iban: iban.trim(),
      defaultPaymentTermsDays: parseInt(paymentTermsDays, 10),
    };
    if (![payload.defaultVatRate, payload.defaultRetentionRate, payload.defaultMarginFactor, payload.defaultPaymentTermsDays].every(Number.isFinite)) {
      setError(t('messages.invalidRates'));
      setSaving(false);
      return;
    }
    try {
      await apiPut('/settings', payload);
      setSuccess(t('messages.saved'));
      fetchSettings();
    } catch (e: any) {
      setError(errorMessage(e, t('messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm(t('subscription.confirmCancel'))) return;
    try {
      await apiPost('/subscription/cancel');
      setSuccess(t('messages.subscriptionCancelled'));
      fetchSubscription();
    } catch (e: any) {
      setError(errorMessage(e, t('messages.cancelFailed')));
    }
  };

  if (loading) {
    return <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>{t('state.loading')}</p>;
  }

  const seatPct = seats.total > 0 ? Math.min(100, Math.round((seats.used / seats.total) * 100)) : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>{t('title')}</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>{t('subtitle')}</p>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 600 }} aria-label={t('common:actions.close')} title={t('common:actions.close')}>x</button>
        </div>
      )}

      {success && (
        <div style={{ background: '#dcfce7', color: '#166534', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {success}
          <button onClick={() => setSuccess('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#166534', fontWeight: 600 }} aria-label={t('common:actions.close')} title={t('common:actions.close')}>x</button>
        </div>
      )}

      {/* Company Info */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 16px' }}>{t('company.title')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>{t('company.name')}</label>
            <div style={{ fontSize: 14, color: '#111827', padding: '8px 0' }}>{settings.companyName || '-'}</div>
          </div>
          <div>
            <label style={labelStyle}>{t('company.legalName')}</label>
            <div style={{ fontSize: 14, color: '#111827', padding: '8px 0' }}>{settings.legalName || '-'}</div>
          </div>
          <div>
            <label style={labelStyle}>{t('company.address')}</label>
            <div style={{ fontSize: 14, color: '#111827', padding: '8px 0' }}>{settings.address || '-'}</div>
          </div>
          <div>
            <label style={labelStyle}>{t('company.vatNumber')}</label>
            <div style={{ fontSize: 14, color: '#111827', padding: '8px 0' }}>{settings.vatNumber || '-'}</div>
          </div>
        </div>
      </div>

      {/* Defaults */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 16px' }}>{t('defaults.title')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>{t('defaults.vatRate')}</label>
            <input
              type="number"
              step="0.01"
              style={inputStyle}
              value={vatRate}
              onChange={e => setVatRate(e.target.value)}
              placeholder="8.10"
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{t('defaults.vatRateHint')}</div>
          </div>
          <div>
            <label style={labelStyle}>{t('defaults.retentionRate')}</label>
            <input
              type="number"
              step="0.01"
              style={inputStyle}
              value={retentionRate}
              onChange={e => setRetentionRate(e.target.value)}
              placeholder="5.00"
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{t('defaults.retentionRateHint')}</div>
          </div>
          <div>
            <label style={labelStyle}>{t('defaults.marginFactor')}</label>
            <input
              type="number"
              step="0.01"
              style={inputStyle}
              value={marginFactor}
              onChange={e => setMarginFactor(e.target.value)}
              placeholder="1.20"
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{t('defaults.marginFactorHint')}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>{t('billing.iban')}</label>
            <input
              style={inputStyle}
              value={iban}
              onChange={e => setIban(e.target.value)}
              placeholder="CH44 3199 9123 0008 8901 2"
              disabled={!isAdmin}
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{t('billing.ibanHint')}</div>
          </div>
          <div>
            <label style={labelStyle}>{t('billing.paymentTerms')}</label>
            <input
              type="number"
              min={0}
              max={365}
              style={inputStyle}
              value={paymentTermsDays}
              onChange={e => setPaymentTermsDays(e.target.value)}
              disabled={!isAdmin}
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{t('billing.paymentTermsHint')}</div>
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
            {t('defaults.geolocation')}
          </label>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, marginLeft: 24 }}>{t('defaults.geolocationHint')}</div>
        </div>

        {isAdmin && (
          <button style={btnPrimary} onClick={handleSaveDefaults} disabled={saving}>
            {saving ? t('common:actions.saving') : t('defaults.save')}
          </button>
        )}
      </div>

      {/* Subscription */}
      {isAdmin && (
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 16px' }}>{t('subscription.title')}</h2>

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
            }}>
              {enumLabel('subscriptionTier', subscription.tier)}
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
            }}>
              {statusLabel('subscription', subscription.status)}
            </span>
          )}
        </div>

        {/* Seat usage */}
        {seats.total > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
              <span>{t('subscription.seatUsage', { used: seats.used, count: seats.total })}</span>
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
            <label style={labelStyle}>{t('subscription.periodStart')}</label>
            <div style={{ fontSize: 14, color: '#111827' }}>
              {subscription.currentPeriodStart ? formatDate(subscription.currentPeriodStart) : '-'}
            </div>
          </div>
          <div>
            <label style={labelStyle}>{t('subscription.periodEnd')}</label>
            <div style={{ fontSize: 14, color: '#111827' }}>
              {subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : '-'}
            </div>
          </div>
          <div>
            <label style={labelStyle}>{t('subscription.trialEnd')}</label>
            <div style={{ fontSize: 14, color: '#111827' }}>
              {subscription.trialEnd ? formatDate(subscription.trialEnd) : '-'}
            </div>
          </div>
        </div>

        {/* Billing history */}
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 8 }}>{t('billing.title')}</h3>
        {billingEvents.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 14, padding: '12px 0' }}>{t('billing.empty')}</p>
        ) : (
          <>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={thStyle}>{t('billing.table.date')}</th>
                    <th style={thStyle}>{t('billing.table.type')}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{t('billing.table.amount')}</th>
                    <th style={thStyle}>{t('billing.table.stripeEventId')}</th>
                  </tr>
                </thead>
                <tbody>
                  {billingEvents.map(evt => (
                    <tr key={evt.id}>
                      <td style={tdStyle}>{formatDate(evt.createdAt)}</td>
                      <td style={tdStyle}>
                        <span>{enumLabel('billingEvent', evt.type)}</span>
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
                  {t('common:actions.previous')}
                </button>
                <span style={{ padding: '8px 12px', fontSize: 14, color: '#6b7280' }}>
                  {t('common:state.page', { page: billingPage, total: billingTotalPages })}
                </span>
                <button
                  style={btnOutline}
                  disabled={billingPage >= billingTotalPages}
                  onClick={() => setBillingPage(p => p + 1)}
                >
                  {t('common:actions.next')}
                </button>
              </div>
            )}
          </>
        )}

        {/* Cancel subscription */}
        {subscription.status && subscription.status !== 'cancelled' && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
            <button style={btnDanger} onClick={handleCancelSubscription}>
              {t('subscription.cancel')}
            </button>
            <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 12 }}>{t('subscription.cancelHint')}</span>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
