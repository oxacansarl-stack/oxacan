import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Building2, FileText, MoreHorizontal, PenLine, Pencil, Plus } from 'lucide-react';
import { apiGet, apiPost, apiPatch, ApiError } from '../lib/api';
import { formatDate, formatMoney, statusLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { MetaDivider, PageBody, PageHeader } from '@/components/page-header';
import {
  Card,
  CardContent,
  CardCount,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Ref, TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Client {
  id: string;
  name: string;
}

interface Offer {
  id: string;
  projectName: string;
  reference: string;
  status: string;
  totalTtcCents: number;
  client?: Client;
}

interface Amendment {
  id: string;
  amendmentNumber: number;
  description: string;
  amountDeltaCents: number;
  status: string;
  createdAt: string;
}

interface Contract {
  id: string;
  reference: string;
  clientId: string;
  client?: Client;
  offerId: string;
  offer?: Offer;
  projectId?: string;
  status: string;
  totalTtcCents: number;
  retentionRate: number;
  esignatureStatus: string;
  signedAt?: string;
  notes?: string;
  amendments?: Amendment[];
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

// DB CHECK contract.status — colours come from StatusBadge domain="contract".
const STATUSES = ['draft', 'sent', 'signed', 'active', 'completed', 'terminated'] as const;

/** Only a draft or a sent contract can still be signed. */
const SIGNABLE = new Set(['draft', 'sent']);

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Contracts() {
  const { t } = useTranslation('contracts');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ offerId: '' });

  /* Amendment form */
  const [showAmendmentForm, setShowAmendmentForm] = useState(false);
  const [amendmentForm, setAmendmentForm] = useState({
    description: '',
    amountDeltaChf: '',
  });

  /* Notes editing */
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');

  /* --- Queries --- */

  const contractsQuery = useQuery<Contract[], ApiError>({
    queryKey: ['contracts', statusFilter],
    queryFn: () => {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      return apiGet<Contract[]>(`/contracts${params}`);
    },
    retry: false,
  });

  const acceptedOffersQuery = useQuery<Offer[], ApiError>({
    queryKey: ['offers-accepted'],
    queryFn: () => apiGet<Offer[]>('/offers?status=accepted'),
    enabled: showForm,
    retry: false,
  });

  const contractQuery = useQuery<Contract, ApiError>({
    queryKey: ['contract', selectedContractId],
    queryFn: () => apiGet<Contract>(`/contracts/${selectedContractId}`),
    enabled: !!selectedContractId,
    retry: false,
  });

  /* --- Mutations --- */

  const invalidateContract = () => {
    queryClient.invalidateQueries({ queryKey: ['contract', selectedContractId] });
    queryClient.invalidateQueries({ queryKey: ['contracts'] });
  };

  const createMutation = useMutation({
    mutationFn: (data: { offerId: string }) => apiPost<Contract>('/contracts/from-offer', data),
    onSuccess: (newContract) => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      setShowForm(false);
      setCreateForm({ offerId: '' });
      if (newContract?.id) setSelectedContractId(newContract.id);
    },
  });

  const signMutation = useMutation({
    mutationFn: () => apiPatch(`/contracts/${selectedContractId}/status`, { status: 'signed' }),
    onSuccess: invalidateContract,
  });

  const addAmendmentMutation = useMutation({
    // Matches AddContractAmendmentDto: CHF input → signed integer centimes.
    mutationFn: (data: typeof amendmentForm) => {
      const chf = Number(data.amountDeltaChf);
      return apiPost(`/contracts/${selectedContractId}/amendments`, {
        description: data.description.trim(),
        amountDeltaCents: Number.isFinite(chf) ? Math.round(chf * 100) : 0,
      });
    },
    onSuccess: () => {
      invalidateContract();
      setShowAmendmentForm(false);
      setAmendmentForm({ description: '', amountDeltaChf: '' });
    },
  });

  const updateNotesMutation = useMutation({
    mutationFn: (notes: string) => apiPatch(`/contracts/${selectedContractId}`, { notes }),
    onSuccess: () => {
      invalidateContract();
      setEditingNotes(false);
    },
  });

  /* --- Render: detail view --- */

  if (selectedContractId) {
    const c = contractQuery.data;
    const amendments = c?.amendments ?? [];
    const detailError = contractQuery.isError
      ? contractQuery.error.status === 401
        ? t('loginRequired')
        : errorMessage(contractQuery.error, t('detail.loadFailed'))
      : null;

    return (
      <PageBody>
        <div>
          <Button variant="quiet" size="sm" onClick={() => setSelectedContractId(null)}>
            <ArrowLeft />
            {t('detail.back')}
          </Button>
        </div>

        <PageHeader
          kicker={t('common:nav.contracts')}
          title={c?.reference || t('detail.fallbackTitle')}
          meta={
            c ? (
              <>
                <span>{c.client?.name ?? '—'}</span>
                <MetaDivider />
                <StatusBadge domain="contract" value={c.status} />
              </>
            ) : undefined
          }
          actions={
            c ? (
              <>
                {SIGNABLE.has(c.status) ? (
                  <Button
                    variant="primary"
                    disabled={signMutation.isPending}
                    onClick={() => signMutation.mutate()}
                  >
                    <PenLine />
                    {signMutation.isPending ? t('detail.signing') : t('detail.sign')}
                  </Button>
                ) : null}
                {c.offerId || c.projectId ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t('detail.moreActions')}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {c.offerId ? (
                        <DropdownMenuItem onSelect={() => navigate(`/offers/${c.offerId}`)}>
                          <FileText />
                          {t('detail.viewOffer')}
                        </DropdownMenuItem>
                      ) : null}
                      {c.projectId ? (
                        <DropdownMenuItem onSelect={() => navigate(`/projects/${c.projectId}`)}>
                          <Building2 />
                          {t('detail.viewProject')}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </>
            ) : undefined
          }
        />

        {signMutation.isError ? (
          <p role="alert" className="text-[13px] text-bad">
            {errorMessage(signMutation.error, t('detail.signFailed'))}
          </p>
        ) : null}

        {c ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 content-start gap-5">
              {/* Amendments */}
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t('amendments.title')}
                    <CardCount>({amendments.length})</CardCount>
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setShowAmendmentForm(true)}>
                    <Plus />
                    {t('amendments.add')}
                  </Button>
                </CardHeader>
                <DataState
                  isLoading={contractQuery.isPending}
                  error={detailError}
                  onRetry={() => contractQuery.refetch()}
                  isEmpty={amendments.length === 0}
                  empty={
                    <EmptyState title={t('amendments.empty')} description={t('amendments.emptyHelp')} />
                  }
                >
                  <TableWrap>
                    <Table>
                      <THead>
                        <tr>
                          <TH>{t('amendments.table.number')}</TH>
                          <TH>{t('amendments.table.description')}</TH>
                          <TH numeric>{t('amendments.table.amountDelta')}</TH>
                          <TH>{t('amendments.table.status')}</TH>
                          <TH>{t('amendments.table.createdAt')}</TH>
                        </tr>
                      </THead>
                      <TBody>
                        {amendments.map((a) => {
                          const negative = a.amountDeltaCents < 0;
                          return (
                            <TR key={a.id}>
                              <TD className="tnum text-muted">{a.amendmentNumber}</TD>
                              <TD>{a.description}</TD>
                              <TD numeric className={negative ? 'text-bad' : 'text-ink'}>
                                {t(negative ? 'amendments.delta.negative' : 'amendments.delta.positive', {
                                  amount: formatMoney(Math.abs(a.amountDeltaCents)),
                                })}
                              </TD>
                              <TD>
                                <StatusBadge domain="amendment" value={a.status} />
                              </TD>
                              <TD className="tnum text-muted">{formatDate(a.createdAt)}</TD>
                            </TR>
                          );
                        })}
                      </TBody>
                    </Table>
                  </TableWrap>
                  <CardFooter>
                    <span>{t('amendments.count', { count: amendments.length })}</span>
                  </CardFooter>
                </DataState>
              </Card>

              {/* Notes */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('notes.title')}</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setNotesValue(c.notes ?? '');
                      setEditingNotes(true);
                    }}
                  >
                    <Pencil />
                    {t('notes.edit')}
                  </Button>
                </CardHeader>
                <CardContent>
                  <p
                    className={cn(
                      'whitespace-pre-wrap text-[13.5px]',
                      c.notes ? 'text-ink-2' : 'text-muted',
                    )}
                  >
                    {c.notes || t('notes.empty')}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Summary */}
            <Card className="lg:sticky lg:top-5 lg:self-start">
              <CardHeader>
                <CardTitle>{t('detail.summary.title')}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
                <SummaryRow
                  label={t('detail.summary.totalTtc')}
                  value={
                    <span className="tnum text-[17px] font-semibold">
                      {formatMoney(c.totalTtcCents ?? 0)}
                    </span>
                  }
                />
                <SummaryRow
                  label={t('detail.summary.retentionRate')}
                  value={
                    <span className="tnum">
                      {t('detail.summary.percent', {
                        value: ((c.retentionRate ?? 0) / 100).toFixed(1),
                      })}
                    </span>
                  }
                />
                <SummaryRow
                  label={t('detail.summary.esignature')}
                  value={<StatusBadge domain="esignature" value={c.esignatureStatus || 'none'} />}
                />
                <SummaryRow
                  label={t('detail.summary.signedAt')}
                  value={
                    c.signedAt ? (
                      <span className="tnum">{formatDate(c.signedAt)}</span>
                    ) : (
                      <span className="text-muted">{t('detail.summary.notSigned')}</span>
                    )
                  }
                />
              </CardContent>
            </Card>
          </div>
        ) : (
          /* No contract yet: DataState decides between loading, a failed load and "not found". */
          <Card>
            <DataState
              isLoading={contractQuery.isPending}
              error={detailError}
              onRetry={() => contractQuery.refetch()}
              isEmpty
              loading={<TableSkeleton rows={4} cols={3} />}
              empty={<EmptyState title={t('detail.notFound')} description={t('detail.notFoundHelp')} />}
            >
              {null}
            </DataState>
          </Card>
        )}

        {/* Add an amendment */}
        <Dialog open={showAmendmentForm} onOpenChange={setShowAmendmentForm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('amendments.form.title')}</DialogTitle>
              <DialogDescription>{t('amendments.form.help')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field
                label={t('amendments.form.description')}
                htmlFor="amendment-description"
                required
              >
                <Input
                  id="amendment-description"
                  value={amendmentForm.description}
                  onChange={(e) =>
                    setAmendmentForm({ ...amendmentForm, description: e.target.value })
                  }
                />
              </Field>
              <Field
                label={t('amendments.form.amountDelta')}
                htmlFor="amendment-amount"
                hint={t('amendments.form.amountDeltaHint')}
              >
                <Input
                  id="amendment-amount"
                  type="number"
                  step="0.05"
                  inputMode="decimal"
                  value={amendmentForm.amountDeltaChf}
                  onChange={(e) =>
                    setAmendmentForm({ ...amendmentForm, amountDeltaChf: e.target.value })
                  }
                />
              </Field>
              {addAmendmentMutation.isError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {errorMessage(addAmendmentMutation.error, t('amendments.addFailed'))}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowAmendmentForm(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={!amendmentForm.description.trim() || addAmendmentMutation.isPending}
                onClick={() => addAmendmentMutation.mutate(amendmentForm)}
              >
                {addAmendmentMutation.isPending ? t('amendments.adding') : t('amendments.submit')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit the notes */}
        <Dialog open={editingNotes} onOpenChange={setEditingNotes}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('notes.dialogTitle')}</DialogTitle>
              <DialogDescription>{t('notes.hint')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label={t('notes.label')} htmlFor="contract-notes">
                <Textarea
                  id="contract-notes"
                  className="min-h-28"
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                />
              </Field>
              {updateNotesMutation.isError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {errorMessage(updateNotesMutation.error, t('notes.saveFailed'))}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditingNotes(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={updateNotesMutation.isPending}
                onClick={() => updateNotesMutation.mutate(notesValue)}
              >
                {updateNotesMutation.isPending ? t('common:actions.saving') : t('notes.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    );
  }

  /* --- Render: list view --- */

  const contracts = contractsQuery.data ?? [];
  const acceptedOffers = acceptedOffersQuery.data ?? [];

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        kicker={t('common:navGroup.sales')}
        actions={
          <Button variant="primary" onClick={() => setShowForm(true)}>
            <Plus />
            {t('actions.createFromOffer')}
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft p-3">
          <div className="flex flex-wrap gap-0.5" role="group" aria-label={t('filters.status')}>
            {['', ...STATUSES].map((value) => (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={statusFilter === value}
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:text-ink',
                  statusFilter === value && 'bg-chalk font-medium text-ink',
                )}
              >
                {value ? statusLabel('contract', value) : t('filters.all')}
              </button>
            ))}
          </div>
        </div>

        <DataState
          isLoading={contractsQuery.isPending}
          error={
            contractsQuery.isError
              ? contractsQuery.error.status === 401
                ? t('loginRequired')
                : errorMessage(contractsQuery.error, t('loadFailed'))
              : null
          }
          onRetry={() => contractsQuery.refetch()}
          isEmpty={contracts.length === 0}
          empty={
            statusFilter ? (
              <EmptyState
                title={t('emptyFiltered')}
                description={t('emptyFilteredHelp')}
                action={
                  <Button variant="ghost" size="sm" onClick={() => setStatusFilter('')}>
                    {t('filters.showAll')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title={t('empty')}
                description={t('emptyHelp')}
                action={
                  <Button variant="ghost" size="sm" onClick={() => setShowForm(true)}>
                    <Plus />
                    {t('actions.createFromOffer')}
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
                  <TH>{t('table.reference')}</TH>
                  <TH>{t('table.client')}</TH>
                  <TH>{t('table.offer')}</TH>
                  <TH>{t('table.status')}</TH>
                  <TH numeric>{t('table.totalTtc')}</TH>
                  <TH>{t('table.signedAt')}</TH>
                  <TH>{t('table.createdAt')}</TH>
                </tr>
              </THead>
              <TBody>
                {contracts.map((contract) => (
                  <TR key={contract.id} onActivate={() => setSelectedContractId(contract.id)}>
                    <TD>
                      <Ref>{contract.reference || '—'}</Ref>
                    </TD>
                    <TD className="font-medium">{contract.client?.name ?? '—'}</TD>
                    <TD className="text-muted">
                      {contract.offer?.reference ?? contract.offer?.projectName ?? '—'}
                    </TD>
                    <TD>
                      <StatusBadge domain="contract" value={contract.status} />
                    </TD>
                    <TD numeric>{formatMoney(contract.totalTtcCents ?? 0)}</TD>
                    <TD className="tnum text-muted">{formatDate(contract.signedAt)}</TD>
                    <TD className="tnum text-muted">{formatDate(contract.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('summary.count', { count: contracts.length })}</span>
            <span>{t('summary.sortedBy')}</span>
          </CardFooter>
        </DataState>
      </Card>

      {/* Create from an accepted offer */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('form.title')}</DialogTitle>
            <DialogDescription>{t('form.help')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('form.offer')} htmlFor="contract-offer" required>
              <Select
                id="contract-offer"
                value={createForm.offerId}
                onChange={(e) => setCreateForm({ offerId: e.target.value })}
              >
                <option value="">{t('form.selectOffer')}</option>
                {acceptedOffers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {t('form.offerOption', {
                      reference: o.reference || o.projectName,
                      client: o.client?.name ?? '—',
                      total: formatMoney(o.totalTtcCents ?? 0),
                    })}
                  </option>
                ))}
              </Select>
            </Field>

            {/* A failed offer load must not read as "no accepted offer". */}
            {acceptedOffersQuery.isError ? (
              <p role="alert" className="text-[13px] text-bad">
                {errorMessage(acceptedOffersQuery.error, t('form.offersLoadFailed'))}
              </p>
            ) : !acceptedOffersQuery.isPending && acceptedOffers.length === 0 ? (
              <p className="text-[13px] text-muted">{t('form.noOffers')}</p>
            ) : null}

            {createMutation.isError ? (
              <p role="alert" className="text-[13px] text-bad">
                {errorMessage(createMutation.error, t('createFailed'))}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!createForm.offerId || createMutation.isPending}
              onClick={() => createMutation.mutate(createForm)}
            >
              {createMutation.isPending ? t('actions.creating') : t('actions.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

/* ------------------------------------------------------------------ */
/*  Summary row                                                        */
/* ------------------------------------------------------------------ */

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-[13.5px] text-ink">{value}</span>
    </div>
  );
}
