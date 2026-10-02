import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Search } from 'lucide-react';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { formatDate, formatMoney, statusLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { PageBody, PageHeader, MetaDivider } from '@/components/page-header';
import { Card, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, SearchInput, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { DataState, EmptyState } from '@/components/states';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Ref, TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

interface Client {
  id: string;
  name: string;
}

interface Offer {
  id: string;
  projectName: string;
  clientId: string;
  client?: Client;
  reference: string;
  status: string;
  version: number;
  totalTtcCents: number;
  createdAt: string;
}

/** The engine's lifecycle (§8.1); `archived` is terminal and kept out of the default view. */
const STATUSES = ['draft', 'in_progress', 'submitted', 'accepted', 'rejected', 'archived'] as const;
const OPEN_STATUSES = new Set(['draft', 'in_progress', 'submitted']);

export default function Offers() {
  const { t } = useTranslation('offers');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    projectName: '',
    clientId: '',
    reference: '',
    marginFactor: 120,
    vatRate: 810,
  });

  // The top bar's "Créer" menu links here with ?new=1.
  useEffect(() => {
    if (params.get('new') === '1') {
      setFormOpen(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const offers = useQuery<Offer[], ApiError>({
    queryKey: ['offers', status],
    queryFn: () => apiGet<Offer[]>(`/offers${status ? `?status=${status}` : ''}`),
    retry: false,
  });

  const clients = useQuery<Client[], ApiError>({
    queryKey: ['clients-list'],
    queryFn: () => apiGet<Client[]>('/clients'),
    retry: false,
  });

  const create = useMutation({
    // CreateOfferDto: marginFactor is an integer percent (120 = 1.20×), vatRate basis points.
    mutationFn: (data: typeof form) =>
      apiPost<Offer>('/offers', {
        projectName: data.projectName.trim(),
        clientId: data.clientId,
        ...(data.reference.trim() ? { reference: data.reference.trim() } : {}),
        marginFactor: Math.round(data.marginFactor),
        vatRate: Math.round(data.vatRate),
      }),
    onSuccess: (offer) => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      setFormOpen(false);
      setForm({ projectName: '', clientId: '', reference: '', marginFactor: 120, vatRate: 810 });
      navigate(`/offers/${offer.id}`);
    },
  });

  const rows = offers.data ?? [];
  const clientName = useMemo(() => {
    const byId = new Map((clients.data ?? []).map((c) => [c.id, c.name]));
    return (offer: Offer) => offer.client?.name ?? byId.get(offer.clientId) ?? '—';
  }, [clients.data]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (offer) =>
        offer.projectName.toLowerCase().includes(term) ||
        (offer.reference ?? '').toLowerCase().includes(term),
    );
  }, [rows, search]);

  // Only meaningful on the unfiltered view, where every status is present.
  const openOffers = status ? null : rows.filter((offer) => OPEN_STATUSES.has(offer.status));

  const formValid = form.projectName.trim().length > 0 && form.clientId.length > 0;

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        kicker={t('common:navGroup.sales')}
        meta={
          openOffers && openOffers.length > 0 ? (
            <>
              <span>{t('summary.open', { count: openOffers.length })}</span>
              <MetaDivider />
              <span className="tnum">
                {formatMoney(openOffers.reduce((sum, offer) => sum + (offer.totalTtcCents ?? 0), 0))}
              </span>
            </>
          ) : undefined
        }
        actions={
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            <Plus />
            {t('actions.new')}
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft p-3">
          <div className="flex flex-wrap gap-0.5" role="group" aria-label={t('table.status')}>
            {['', ...STATUSES].map((value) => (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:text-ink',
                  status === value && 'bg-chalk font-medium text-ink',
                )}
              >
                {value ? statusLabel('offer', value) : t('filters.all')}
              </button>
            ))}
          </div>
          <SearchInput
            icon={<Search className="size-4" />}
            placeholder={t('filters.search')}
            aria-label={t('filters.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <DataState
          isLoading={offers.isPending}
          error={
            offers.isError
              ? offers.error.status === 401
                ? t('loginRequired')
                : errorMessage(offers.error, t('loadFailed'))
              : null
          }
          onRetry={() => offers.refetch()}
          isEmpty={visible.length === 0}
          empty={
            rows.length === 0 ? (
              <EmptyState
                title={t('empty')}
                description={t('emptyHelp')}
                action={
                  <Button variant="ghost" size="sm" onClick={() => setFormOpen(true)}>
                    <Plus />
                    {t('actions.new')}
                  </Button>
                }
              />
            ) : (
              <EmptyState title={t('noMatch')} description={t('noMatchHelp')} />
            )
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('table.reference')}</TH>
                  <TH>{t('table.projectName')}</TH>
                  <TH>{t('table.client')}</TH>
                  <TH>{t('table.status')}</TH>
                  <TH numeric>{t('table.totalTtc')}</TH>
                  <TH>{t('table.version')}</TH>
                  <TH>{t('table.createdAt')}</TH>
                </tr>
              </THead>
              <TBody>
                {visible.map((offer) => (
                  <TR key={offer.id} onActivate={() => navigate(`/offers/${offer.id}`)}>
                    <TD>
                      <Ref>{offer.reference || '—'}</Ref>
                    </TD>
                    <TD className="font-medium">{offer.projectName}</TD>
                    <TD>{clientName(offer)}</TD>
                    <TD>
                      <StatusBadge domain="offer" value={offer.status} />
                    </TD>
                    <TD numeric>{formatMoney(offer.totalTtcCents ?? 0)}</TD>
                    <TD className="text-muted">v{offer.version ?? 1}</TD>
                    <TD className="tnum text-muted">{formatDate(offer.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('summary.count', { count: visible.length, total: rows.length })}</span>
            <span>{t('summary.sortedBy')}</span>
          </CardFooter>
        </DataState>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('form.title')}</DialogTitle>
            <DialogDescription>{t('form.help')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('form.projectName')} htmlFor="offer-project" required>
              <Input
                id="offer-project"
                value={form.projectName}
                onChange={(e) => setForm({ ...form, projectName: e.target.value })}
              />
            </Field>
            <Field label={t('form.client')} htmlFor="offer-client" required>
              <Select
                id="offer-client"
                value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              >
                <option value="">{t('form.selectClient')}</option>
                {(clients.data ?? []).map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('form.reference')} htmlFor="offer-ref" hint={t('form.referenceHint')}>
              <Input
                id="offer-ref"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
              <Field label={t('form.marginFactor')} htmlFor="offer-margin" hint={t('form.marginFactorHint')}>
                <Input
                  id="offer-margin"
                  type="number"
                  inputMode="numeric"
                  value={form.marginFactor}
                  onChange={(e) => setForm({ ...form, marginFactor: Number(e.target.value) })}
                />
              </Field>
              <Field label={t('form.vatRate')} htmlFor="offer-vat" hint={t('form.vatRateHint')}>
                <Input
                  id="offer-vat"
                  type="number"
                  inputMode="numeric"
                  value={form.vatRate}
                  onChange={(e) => setForm({ ...form, vatRate: Number(e.target.value) })}
                />
              </Field>
            </div>
            {create.isError ? (
              <p role="alert" className="text-[13px] text-bad">
                {errorMessage(create.error, t('createFailed'))}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!formValid || create.isPending}
              onClick={() => create.mutate(form)}
            >
              {create.isPending ? t('actions.creating') : t('actions.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}
