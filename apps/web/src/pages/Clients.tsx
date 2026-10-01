import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Building2, ChevronDown, ChevronRight, Plus, Search } from 'lucide-react';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { enumLabel, formatDate } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, Tag, type BadgeTone } from '@/components/ui/badge';
import { Field, Input, SearchInput, Select } from '@/components/ui/input';
import { DataState, EmptyState, TableSkeleton } from '@/components/states';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

interface Client {
  id: string;
  name: string;
  type: string;
  email: string;
  phone: string;
  city: string;
  canton: string;
  pipelineStage: string;
  contacts?: Contact[];
  interactions?: Interaction[];
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

interface Interaction {
  id: string;
  type: string | null;
  subject: string | null;
  body: string | null;
  interactionDate: string;
}

// Must match the client.type CHECK constraint.
const CLIENT_TYPES = [
  'entreprise_generale',
  'maitre_ouvrage',
  'architecte',
  'sous_traitant',
  'fournisseur',
  'autre',
] as const;

type ClientForm = {
  name: string;
  type: string;
  email: string;
  phone: string;
  city: string;
  canton: string;
};

const EMPTY_FORM: ClientForm = {
  name: '',
  type: 'entreprise_generale',
  email: '',
  phone: '',
  city: '',
  canton: '',
};

/** Drop empty optional fields: the API validates e.g. `email` and rejects "". */
function toCreatePayload(form: ClientForm): Record<string, string> {
  const payload: Record<string, string> = { name: form.name.trim() };
  for (const key of ['type', 'email', 'phone', 'city', 'canton'] as const) {
    const v = form[key].trim();
    if (v) payload[key] = v;
  }
  return payload;
}

const PIPELINE_STAGES = ['prospect', 'qualified', 'active', 'inactive', 'archived'] as const;

/**
 * Colour per commercial stage. There is no `status.client` table in common.json, so the label
 * comes from this page's own `stage.*` keys rather than from `StatusBadge`.
 */
const STAGE_TONES: Record<string, BadgeTone> = {
  prospect: 'warn',
  qualified: 'info',
  active: 'ok',
  inactive: 'neutral',
  archived: 'neutral',
};

const DASH = <span className="text-muted">—</span>;

export default function Clients() {
  const { t } = useTranslation('clients');
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM);

  // The top bar's "Créer" menu links here with ?new=1.
  useEffect(() => {
    if (params.get('new') === '1') {
      setFormOpen(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const clients = useQuery<Client[], ApiError>({
    queryKey: ['clients', stageFilter],
    queryFn: () => {
      const stage = stageFilter ? `&stage=${encodeURIComponent(stageFilter)}` : '';
      return apiGet<Client[]>(`/clients?limit=100${stage}`);
    },
    retry: false,
  });

  const create = useMutation<Client, ApiError, ClientForm>({
    mutationFn: (data) => apiPost<Client>('/clients', toCreatePayload(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setFormOpen(false);
      setForm(EMPTY_FORM);
    },
  });

  const detail = useQuery<Client, ApiError>({
    queryKey: ['client', expandedId],
    queryFn: () => apiGet<Client>(`/clients/${expandedId}`),
    enabled: !!expandedId,
    retry: false,
  });

  const rows = clients.data ?? [];

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (client) =>
        client.name.toLowerCase().includes(term) ||
        (client.city ?? '').toLowerCase().includes(term) ||
        (client.phone ?? '').includes(term),
    );
  }, [rows, search]);

  // Only meaningful on the unfiltered view, where every stage is present.
  const activeClients = stageFilter ? null : rows.filter((client) => client.pipelineStage === 'active');

  // The detail panel renders inside DataState, whose children are built before it decides what to
  // show — so these must stay safe while the record is still loading.
  const contacts = detail.data?.contacts ?? [];
  const interactions = detail.data?.interactions ?? [];

  const formValid = form.name.trim().length > 0;
  const filtering = stageFilter.length > 0 || search.trim().length > 0;

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        kicker={t('common:navGroup.sales')}
        meta={
          activeClients && activeClients.length > 0 ? (
            <span>{t('summary.active', { count: activeClients.length })}</span>
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
          <div className="flex flex-wrap gap-0.5" role="group" aria-label={t('table.stage')}>
            {['', ...PIPELINE_STAGES].map((value) => (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={stageFilter === value}
                onClick={() => setStageFilter(value)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:text-ink',
                  stageFilter === value && 'bg-chalk font-medium text-ink',
                )}
              >
                {value ? t(`stage.${value}`) : t('filters.all')}
              </button>
            ))}
          </div>
          <SearchInput
            icon={<Search className="size-4" />}
            placeholder={t('filters.search')}
            aria-label={t('filters.searchLabel')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <DataState
          isLoading={clients.isPending}
          error={
            clients.isError
              ? clients.error.status === 401
                ? t('common:auth.sessionExpired')
                : errorMessage(clients.error, t('messages.loadFailed'))
              : null
          }
          onRetry={() => clients.refetch()}
          isEmpty={visible.length === 0}
          loading={<TableSkeleton rows={6} cols={5} />}
          empty={
            filtering ? (
              <EmptyState title={t('empty.noMatch')} description={t('empty.noMatchHelp')} />
            ) : (
              <EmptyState
                icon={<Building2 className="size-5" />}
                title={t('empty.clients')}
                description={t('empty.clientsHelp')}
                action={
                  <Button variant="ghost" size="sm" onClick={() => setFormOpen(true)}>
                    <Plus />
                    {t('actions.new')}
                  </Button>
                }
              />
            )
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('table.name')}</TH>
                  <TH>{t('table.type')}</TH>
                  <TH>{t('table.stage')}</TH>
                  <TH>{t('table.city')}</TH>
                  <TH>{t('table.phone')}</TH>
                </tr>
              </THead>
              <TBody>
                {visible.map((client) => {
                  const open = expandedId === client.id;
                  const Chevron = open ? ChevronDown : ChevronRight;
                  return (
                    <Fragment key={client.id}>
                      <TR
                        onActivate={() => setExpandedId(open ? null : client.id)}
                        aria-expanded={open}
                        aria-controls={open ? `client-detail-${client.id}` : undefined}
                        className={cn(open && '[&>td]:bg-chalk hover:[&>td]:bg-chalk')}
                      >
                        <TD className="font-medium">
                          <span className="flex items-center gap-1.5">
                            <Chevron aria-hidden className="size-3.5 shrink-0 text-muted" />
                            {client.name}
                          </span>
                        </TD>
                        <TD>{client.type ? <Tag>{enumLabel('clientType', client.type)}</Tag> : DASH}</TD>
                        <TD>
                          {client.pipelineStage ? (
                            <Badge tone={STAGE_TONES[client.pipelineStage] ?? 'neutral'}>
                              {t(`stage.${client.pipelineStage}`, { defaultValue: client.pipelineStage })}
                            </Badge>
                          ) : (
                            DASH
                          )}
                        </TD>
                        <TD>{client.city || DASH}</TD>
                        <TD className="tnum text-muted">{client.phone || '—'}</TD>
                      </TR>

                      {open ? (
                        <tr id={`client-detail-${client.id}`}>
                          <TD colSpan={5} className="h-auto bg-chalk p-0 align-top">
                            <DataState
                              isLoading={detail.isPending}
                              error={
                                detail.isError
                                  ? errorMessage(detail.error, t('messages.detailFailed'))
                                  : null
                              }
                              onRetry={() => detail.refetch()}
                              loading={<TableSkeleton rows={3} cols={2} />}
                            >
                              <div className="grid gap-5 px-3.5 py-4 md:grid-cols-2">
                                <section className="grid content-start gap-2">
                                  <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                                    {t('detail.contacts')}
                                    <span className="tnum font-normal text-muted">{contacts.length}</span>
                                  </h3>
                                  {contacts.length > 0 ? (
                                    <ul className="grid gap-2">
                                      {contacts.map((contact) => (
                                        <li key={contact.id} className="grid gap-0.5 text-[13px]">
                                          <span className="font-medium text-ink">
                                            {contact.firstName} {contact.lastName}
                                            {contact.role ? (
                                              <span className="font-normal text-muted"> · {contact.role}</span>
                                            ) : null}
                                          </span>
                                          <span className="text-muted">
                                            {[contact.email, contact.phone].filter(Boolean).join(' · ') || '—'}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="text-[13px] text-muted">{t('empty.contacts')}</p>
                                  )}
                                </section>

                                <section className="grid content-start gap-2">
                                  <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                                    {t('detail.interactions')}
                                    <span className="tnum font-normal text-muted">{interactions.length}</span>
                                  </h3>
                                  {interactions.length > 0 ? (
                                    <ul className="grid gap-2">
                                      {interactions.map((interaction) => (
                                        <li key={interaction.id} className="grid gap-0.5 text-[13px]">
                                          <span className="flex flex-wrap items-center gap-2">
                                            <Tag>{enumLabel('interactionType', interaction.type)}</Tag>
                                            <span className="tnum text-muted">
                                              {formatDate(interaction.interactionDate)}
                                            </span>
                                          </span>
                                          <span className="text-ink-2">
                                            {interaction.subject || interaction.body || '—'}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="text-[13px] text-muted">{t('empty.interactions')}</p>
                                  )}
                                </section>
                              </div>
                            </DataState>
                          </TD>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
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
            <Field label={t('form.name')} htmlFor="client-name" required>
              <Input
                id="client-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('form.type')} htmlFor="client-type">
                <Select
                  id="client-type"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  {CLIENT_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {enumLabel('clientType', value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('form.email')} htmlFor="client-email">
                <Input
                  id="client-email"
                  type="email"
                  inputMode="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label={t('form.phone')} htmlFor="client-phone">
                <Input
                  id="client-phone"
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field label={t('form.city')} htmlFor="client-city">
                <Input
                  id="client-city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </Field>
              <Field label={t('form.canton')} htmlFor="client-canton">
                <Input
                  id="client-canton"
                  value={form.canton}
                  onChange={(e) => setForm({ ...form, canton: e.target.value })}
                />
              </Field>
            </div>
            {create.isError ? (
              <p role="alert" className="text-[13px] text-bad">
                {errorMessage(create.error, t('messages.createFailed'))}
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
