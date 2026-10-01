import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, Receipt, X } from 'lucide-react';
import { apiGet, apiList, apiPost, apiPut } from '../lib/api';
import { useCurrentUser } from '../lib/current-user';
import { enumLabel, formatDate, formatMoney } from '../lib/format';
import { errorMessage } from '../lib/errors';
import type { PageProps } from '../lib/page-props';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { DataState, EmptyState, LoadingState, TableSkeleton } from '@/components/states';
import { useConfirm } from '@/components/confirm-dialog';
import { Ref, TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

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
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Swiss 5-centime rounding, as the invoice total is rounded before it is charged. */
const displayCHF = (cents: number): string => formatMoney(Math.round(cents / 5) * 5);

/** "CH4431999123000889012" → "CH44 3199 9123 0008 8901 2" (as printed by banks). */
function formatIban(value: string): string {
  return value.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

/** One read-only label/value pair in a details grid. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-[13.5px] text-ink">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Settings({ embedded = false }: PageProps) {
  const { t } = useTranslation('settings');
  const confirm = useConfirm();
  // Project managers may view the defaults; changing them and the subscription is admin-only.
  const isAdmin = useCurrentUser().role === 'ADMIN';

  const [settings, setSettings] = useState<CompanySettings>({});
  const [subscription, setSubscription] = useState<Subscription>({});
  const [seats, setSeats] = useState<SeatInfo>({ used: 0, total: 0 });
  const [billingEvents, setBillingEvents] = useState<BillingEvent[]>([]);
  const [billingPage, setBillingPage] = useState(1);
  const [billingTotalPages, setBillingTotalPages] = useState(1);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [subLoading, setSubLoading] = useState(true);
  const [subError, setSubError] = useState('');
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState('');

  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

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
      setLoadError('');
    } catch (e: any) {
      setLoadError(errorMessage(e, t('messages.loadFailed')));
    }
  }, [t]);

  const fetchSubscription = useCallback(async () => {
    setSubLoading(true);
    try {
      const [sub, s] = await Promise.all([
        apiGet<Subscription>('/subscription'),
        apiGet<Partial<SeatInfo>>('/subscription/seats'),
      ]);
      // A company without a subscription gets `null`, which the empty state covers; a real
      // failure must not read as "no subscription", so it is reported instead of swallowed.
      setSubscription(sub ?? {});
      setSeats({ used: s?.used ?? 0, total: s?.total ?? 0 });
      setSubError('');
    } catch (e: any) {
      setSubError(errorMessage(e, t('messages.subscriptionLoadFailed')));
    } finally {
      setSubLoading(false);
    }
  }, [t]);

  const fetchBilling = useCallback(async () => {
    setBillingLoading(true);
    try {
      const { items, meta } = await apiList<BillingEvent>(`/subscription/billing?page=${billingPage}`);
      setBillingEvents(items);
      setBillingTotalPages(Math.max(1, meta?.totalPages ?? 1));
      setBillingError('');
    } catch (e: any) {
      setBillingError(errorMessage(e, t('messages.billingLoadFailed')));
    } finally {
      setBillingLoading(false);
    }
  }, [billingPage, t]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSettings(), isAdmin ? fetchSubscription() : undefined]).finally(() => setLoading(false));
  }, [fetchSettings, fetchSubscription, isAdmin]);

  useEffect(() => { if (isAdmin) fetchBilling(); }, [fetchBilling, isAdmin]);

  const handleSaveDefaults = async () => {
    setSaving(true);
    setSaveError('');
    setNotice('');
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
      setSaveError(t('messages.invalidRates'));
      setSaving(false);
      return;
    }
    try {
      await apiPut('/settings', payload);
      setNotice(t('messages.saved'));
      fetchSettings();
    } catch (e: any) {
      setSaveError(errorMessage(e, t('messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSubscription = async () => {
    const confirmed = await confirm({
      title: t('subscription.cancel'),
      description: t('subscription.confirmCancel'),
      confirmLabel: t('subscription.cancelShort'),
      tone: 'danger',
    });
    if (!confirmed) return;
    setCancelling(true);
    setCancelError('');
    setNotice('');
    try {
      await apiPost('/subscription/cancel');
      setNotice(t('messages.subscriptionCancelled'));
      fetchSubscription();
    } catch (e: any) {
      setCancelError(errorMessage(e, t('messages.cancelFailed')));
    } finally {
      setCancelling(false);
    }
  };

  const seatPct = seats.total > 0 ? Math.min(100, Math.round((seats.used / seats.total) * 100)) : 0;
  const hasSubscription = Boolean(subscription.tier || subscription.status);
  const canCancel = Boolean(subscription.status) && subscription.status !== 'cancelled';

  return (
    <PageBody>
      {embedded ? null : (
        <PageHeader
          title={t('title')}
          kicker={t('common:nav.admin')}
          meta={<span>{t('subtitle')}</span>}
        />
      )}

      {notice ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2.5 rounded-card border border-line bg-ok-bg px-3.5 py-2 text-[13px] text-ok"
        >
          <span>{notice}</span>
          <Button
            variant="quiet"
            size="iconSm"
            className="text-current"
            aria-label={t('common:actions.close')}
            onClick={() => setNotice('')}
          >
            <X />
          </Button>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/*  Company — read-only; the API has no edit endpoint for these.     */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{t('company.title')}</CardTitle>
        </CardHeader>
        <DataState
          isLoading={loading}
          error={loadError || null}
          onRetry={() => void fetchSettings()}
          loading={<LoadingState label={t('state.loading')} />}
        >
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label={t('company.name')}>{settings.companyName || '—'}</Detail>
              <Detail label={t('company.legalName')}>{settings.legalName || '—'}</Detail>
              <Detail label={t('company.address')}>{settings.address || '—'}</Detail>
              <Detail label={t('company.vatNumber')}>
                {settings.vatNumber ? <Ref className="text-[13.5px] text-ink">{settings.vatNumber}</Ref> : '—'}
              </Detail>
            </dl>
          </CardContent>
        </DataState>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/*  Defaults — a project manager reads them, an admin edits them.    */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{t('defaults.title')}</CardTitle>
        </CardHeader>
        <DataState
          isLoading={loading}
          error={loadError || null}
          onRetry={() => void fetchSettings()}
          loading={<LoadingState label={t('state.loading')} />}
        >
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t('defaults.vatRate')} htmlFor="settings-vat" hint={t('defaults.vatRateHint')}>
                <Input
                  id="settings-vat"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  className="tnum"
                  placeholder="8.10"
                  value={vatRate}
                  onChange={(e) => setVatRate(e.target.value)}
                  disabled={!isAdmin}
                />
              </Field>
              <Field
                label={t('defaults.retentionRate')}
                htmlFor="settings-retention"
                hint={t('defaults.retentionRateHint')}
              >
                <Input
                  id="settings-retention"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  className="tnum"
                  placeholder="5.00"
                  value={retentionRate}
                  onChange={(e) => setRetentionRate(e.target.value)}
                  disabled={!isAdmin}
                />
              </Field>
              <Field
                label={t('defaults.marginFactor')}
                htmlFor="settings-margin"
                hint={t('defaults.marginFactorHint')}
              >
                <Input
                  id="settings-margin"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  className="tnum"
                  placeholder="1.20"
                  value={marginFactor}
                  onChange={(e) => setMarginFactor(e.target.value)}
                  disabled={!isAdmin}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Field label={t('billing.iban')} htmlFor="settings-iban" hint={t('billing.ibanHint')}>
                <Input
                  id="settings-iban"
                  className="tnum"
                  placeholder={t('billing.ibanPlaceholder')}
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  disabled={!isAdmin}
                />
              </Field>
              <Field
                label={t('billing.paymentTerms')}
                htmlFor="settings-terms"
                hint={t('billing.paymentTermsHint')}
              >
                <Input
                  id="settings-terms"
                  type="number"
                  min={0}
                  max={365}
                  inputMode="numeric"
                  className="tnum"
                  value={paymentTermsDays}
                  onChange={(e) => setPaymentTermsDays(e.target.value)}
                  disabled={!isAdmin}
                />
              </Field>
            </div>

            <div className="grid gap-1.5">
              <label
                htmlFor="settings-geo"
                className={cn(
                  'flex items-center gap-2 text-[13.5px] text-ink',
                  isAdmin ? 'cursor-pointer' : 'cursor-not-allowed',
                )}
              >
                <input
                  id="settings-geo"
                  type="checkbox"
                  className="size-3.5 shrink-0 accent-graphite disabled:cursor-not-allowed"
                  checked={geoEnabled}
                  onChange={(e) => setGeoEnabled(e.target.checked)}
                  disabled={!isAdmin}
                />
                {t('defaults.geolocation')}
              </label>
              <p className="pl-[22px] text-xs text-muted">{t('defaults.geolocationHint')}</p>
            </div>

            {saveError ? (
              <p role="alert" className="text-[13px] text-bad">
                {saveError}
              </p>
            ) : null}
          </CardContent>

          <CardFooter>
            {isAdmin ? (
              <Button variant="primary" onClick={() => void handleSaveDefaults()} disabled={saving}>
                {saving ? t('common:actions.saving') : t('defaults.save')}
              </Button>
            ) : (
              <span>{t('defaults.readOnly')}</span>
            )}
          </CardFooter>
        </DataState>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/*  Subscription — admin-only, read-only plus cancel; the company        */}
      {/*  cannot edit tier, seats or dates, so nothing here is a form.         */}
      {/* ---------------------------------------------------------------- */}
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('subscription.title')}</CardTitle>
          </CardHeader>
          <DataState
            isLoading={subLoading}
            error={subError || null}
            onRetry={() => void fetchSubscription()}
            isEmpty={!hasSubscription}
            loading={<LoadingState label={t('state.loading')} />}
            empty={
              <EmptyState
                icon={<CreditCard className="size-5" />}
                title={t('subscription.empty')}
                description={t('subscription.emptyHelp')}
              />
            }
          >
            <CardContent className="grid gap-5">
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label={t('subscription.tierLabel')}>
                  {subscription.tier ? <Tag>{enumLabel('subscriptionTier', subscription.tier)}</Tag> : '—'}
                </Detail>
                <Detail label={t('subscription.statusLabel')}>
                  <StatusBadge domain="subscription" value={subscription.status} />
                </Detail>
                <Detail label={t('subscription.trialEnd')}>
                  <span className="tnum">{formatDate(subscription.trialEnd)}</span>
                </Detail>
                <Detail label={t('subscription.periodStart')}>
                  <span className="tnum">{formatDate(subscription.currentPeriodStart)}</span>
                </Detail>
                <Detail label={t('subscription.periodEnd')}>
                  <span className="tnum">{formatDate(subscription.currentPeriodEnd)}</span>
                </Detail>
              </dl>

              {seats.total > 0 ? (
                <div className="grid gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 text-[13px]">
                    <span className="text-muted">
                      {t('subscription.seatUsage', { used: seats.used, count: seats.total })}
                    </span>
                    <span className="tnum font-medium">{t('subscription.seatPct', { pct: seatPct })}</span>
                  </div>
                  <div aria-hidden className="h-2.5 overflow-hidden rounded-full bg-line-soft">
                    {/* A bar's width is a runtime value — the one inline style the conventions allow. */}
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-300',
                        seatPct >= 90 ? 'bg-bad' : seatPct >= 70 ? 'bg-warn' : 'bg-graphite',
                      )}
                      style={{ width: `${seatPct}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {cancelError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {cancelError}
                </p>
              ) : null}
            </CardContent>

            {canCancel ? (
              <CardFooter>
                <Button
                  variant="danger"
                  disabled={cancelling}
                  onClick={() => void handleCancelSubscription()}
                >
                  {cancelling ? t('subscription.cancelling') : t('subscription.cancel')}
                </Button>
                <span>{t('subscription.cancelHint')}</span>
              </CardFooter>
            ) : null}
          </DataState>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/*  Billing history — admin-only, read-only.                        */}
      {/* ---------------------------------------------------------------- */}
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('billing.title')}</CardTitle>
          </CardHeader>
          <DataState
            isLoading={billingLoading}
            error={billingError || null}
            onRetry={() => void fetchBilling()}
            isEmpty={billingEvents.length === 0}
            loading={<TableSkeleton rows={4} cols={4} />}
            empty={
              <EmptyState
                icon={<Receipt className="size-5" />}
                title={t('billing.empty')}
                description={t('billing.emptyHelp')}
              />
            }
          >
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>{t('billing.table.date')}</TH>
                    <TH>{t('billing.table.type')}</TH>
                    <TH numeric>{t('billing.table.amount')}</TH>
                    <TH>{t('billing.table.stripeEventId')}</TH>
                  </tr>
                </THead>
                <TBody>
                  {billingEvents.map((evt) => (
                    <TR key={evt.id}>
                      <TD className="tnum whitespace-nowrap">{formatDate(evt.createdAt)}</TD>
                      <TD>
                        <Tag>{enumLabel('billingEvent', evt.type)}</Tag>
                      </TD>
                      <TD numeric className="font-medium">
                        {displayCHF(evt.amountCents)}
                      </TD>
                      <TD>
                        <Ref className="text-muted">{evt.stripeEventId || '—'}</Ref>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <CardFooter>
              <span>{t('billing.count', { count: billingEvents.length })}</span>
              {billingTotalPages > 1 ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={billingPage <= 1}
                    onClick={() => setBillingPage((p) => Math.max(1, p - 1))}
                  >
                    {t('common:actions.previous')}
                  </Button>
                  <span className="tnum">
                    {t('common:state.page', { page: billingPage, total: billingTotalPages })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={billingPage >= billingTotalPages}
                    onClick={() => setBillingPage((p) => Math.min(billingTotalPages, p + 1))}
                  >
                    {t('common:actions.next')}
                  </Button>
                </div>
              ) : null}
            </CardFooter>
          </DataState>
        </Card>
      ) : null}
    </PageBody>
  );
}
