import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  Check,
  ChevronRight,
  Copy,
  FileDown,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete, apiDownload, ApiError } from '../lib/api';
import { enumLabel, formatAmount, formatDate, formatMoney, formatNumber, statusLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { MetaDivider, PageBody, PageHeader } from '@/components/page-header';
import { useDetailCrumb } from '@/components/shell/breadcrumbs';
import { useConfirm } from '@/components/confirm-dialog';
import { DataState, EmptyState } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Badge, Tag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, Input, Select } from '@/components/ui/input';
import { Ref, TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { TabCount, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OfferLine {
  id: string;
  positionNumber: number;
  description: string;
  unit: string;
  quantity: number;
  unitPriceCents: number | null;
  totalPriceCents: number | null;
  pricingStrategy: string | null;
  variantType: string;
}

interface Assumption {
  id: string;
  type: string;
  description: string;
  impactAmountCents: number | null;
  status: string;
}

interface Offer {
  id: string;
  projectName: string;
  clientId: string;
  client?: { id: string; name: string };
  reference: string;
  status: string;
  version: number;
  marginFactor: number;
  vatRate: number;
  /** Days the offer stays valid after it is sent (offer.validity_days). */
  validityDays?: number;
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  lines?: OfferLine[];
  assumptions?: Assumption[];
  createdAt: string;
  /** Set by GET /offers/:id: only draft / in-progress offers can change (§14 Versioning). */
  editable?: boolean;
  nextStatuses?: string[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const VARIANT_TYPES = [
  'BASE',
  'VARIANTE',
  'OPTION',
  'HYPOTHESE_A_VALIDER',
  'INFORMATION_MANQUANTE',
  'EXCLU',
] as const;

// DB CHECK offer_line.pricing_strategy
const PRICING_STRATEGIES = ['MANUAL', 'LATEST', 'MEDIAN_N', 'INDEXED', 'COMPOSED'] as const;

// DB CHECK offer_assumption.type
const ASSUMPTION_TYPES = [
  'HYPOTHESE_A_VALIDER',
  'INFORMATION_MANQUANTE',
  'VARIANTE',
  'OPTION',
  'EXCLU',
] as const;

/**
 * The only two line types the engine counts in HT / TVA / TTC — and, for exactly those two,
 * the only ones that must carry a price before sending (§7.8, §7.9; mirrors `inTotal` and
 * `mustBePriced` in api/offers/offer-pricing.ts). Everything else shows "—", never
 * "Prix à compléter".
 */
const COUNTED_TYPES: string[] = ['BASE', 'HYPOTHESE_A_VALIDER'];

/** Open hypotheses and missing information block submission, as lines or as assumptions (R005). */
const PENDING_TYPES: string[] = ['HYPOTHESE_A_VALIDER', 'INFORMATION_MANQUANTE'];

/** The lifecycle an offer walks through (§8.1); `rejected` and `archived` leave the path. */
const LIFECYCLE_STEPS = ['draft', 'in_progress', 'submitted', 'accepted'] as const;
const TERMINAL_STATUSES: string[] = ['rejected', 'archived'];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** CHF text input → integer centimes (null when blank). */
function chfToCents(chf: string): number | null {
  if (chf.trim() === '') return null;
  const n = Number(chf);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function centsToChfInput(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

/** Tone of a line- or assumption-type chip: what it does to the offer, not just its name. */
function typeTone(type: string): 'default' | 'warn' | 'dashed' {
  if (PENDING_TYPES.includes(type)) return 'warn';
  return COUNTED_TYPES.includes(type) ? 'default' : 'dashed';
}

interface LinePayload {
  description: string;
  unit: string;
  quantity: number;
  unitPriceCents: number | null;
  pricingStrategy?: string;
  variantType: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function OfferDetail() {
  const { t } = useTranslation('offerDetail');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  /* --- Local state --- */
  const [tab, setTab] = useState<'lines' | 'assumptions'>('lines');
  const [showLineForm, setShowLineForm] = useState(false);
  const [showAssumptionForm, setShowAssumptionForm] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);

  const [lineForm, setLineForm] = useState({
    description: '',
    unit: 'pce',
    quantity: 1,
    unitPriceChf: '',
    pricingStrategy: 'MANUAL' as string,
    variantType: 'BASE' as string,
  });

  const [assumptionForm, setAssumptionForm] = useState({
    type: 'HYPOTHESE_A_VALIDER' as string,
    description: '',
    impactChf: '',
  });

  /* --- Queries --- */

  const offerQuery = useQuery<Offer, ApiError>({
    queryKey: ['offer', id],
    queryFn: () => apiGet<Offer>(`/offers/${id}`),
    enabled: !!id,
    retry: false,
  });

  const offer = offerQuery.data;

  // "Ventes › Offres › OFF-2026-0001" in the top bar, so the page never repeats its location.
  useDetailCrumb(offer?.reference || offer?.projectName);

  /* --- Mutations --- */

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['offer', id] });

  const addLineMutation = useMutation({
    mutationFn: (data: LinePayload) => apiPost(`/offers/${id}/lines`, data),
    onSuccess: () => {
      invalidate();
      setShowLineForm(false);
      resetLineForm();
    },
  });

  const updateLineMutation = useMutation({
    mutationFn: (data: LinePayload & { lineId: string }) => {
      const { lineId, ...body } = data;
      return apiPatch(`/offers/${id}/lines/${lineId}`, body);
    },
    onSuccess: () => {
      invalidate();
      setEditingLineId(null);
      resetLineForm();
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: (lineId: string) => apiDelete(`/offers/${id}/lines/${lineId}`),
    onSuccess: invalidate,
  });

  const addAssumptionMutation = useMutation({
    mutationFn: (data: typeof assumptionForm) => {
      const impactAmountCents = chfToCents(data.impactChf);
      return apiPost(`/offers/${id}/assumptions`, {
        type: data.type,
        description: data.description.trim(),
        ...(impactAmountCents != null ? { impactAmountCents } : {}),
      });
    },
    onSuccess: () => {
      invalidate();
      setShowAssumptionForm(false);
      setAssumptionForm({ type: 'HYPOTHESE_A_VALIDER', description: '', impactChf: '' });
    },
  });

  const decideAssumptionMutation = useMutation({
    mutationFn: ({ assumptionId, status }: { assumptionId: string; status: 'confirmed' | 'rejected' }) =>
      apiPatch(`/offers/${id}/assumptions/${assumptionId}`, { status }),
    onSuccess: invalidate,
  });

  const recalcMutation = useMutation({
    mutationFn: () => apiPost(`/offers/${id}/recalculate`),
    onSuccess: invalidate,
  });

  const pdfMutation = useMutation({
    mutationFn: () => apiDownload(`/offers/${id}/pdf`),
  });

  const duplicateMutation = useMutation({
    mutationFn: () => apiPost<Offer>(`/offers/${id}/duplicate`),
    onSuccess: (newOffer) => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      if (newOffer?.id) navigate(`/offers/${newOffer.id}`);
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => apiPatch(`/offers/${id}/status`, { status }),
    onSuccess: invalidate,
  });

  /* --- Form helpers --- */

  function resetLineForm() {
    setLineForm({
      description: '',
      unit: 'pce',
      quantity: 1,
      unitPriceChf: '',
      pricingStrategy: 'MANUAL',
      variantType: 'BASE',
    });
  }

  function openNewLine() {
    setEditingLineId(null);
    resetLineForm();
    addLineMutation.reset();
    updateLineMutation.reset();
    setShowLineForm(true);
  }

  function startEditLine(line: OfferLine) {
    setShowLineForm(false);
    addLineMutation.reset();
    updateLineMutation.reset();
    setEditingLineId(line.id);
    setLineForm({
      description: line.description,
      unit: line.unit,
      quantity: line.quantity,
      unitPriceChf: centsToChfInput(line.unitPriceCents),
      pricingStrategy: line.pricingStrategy ?? '',
      variantType: line.variantType,
    });
  }

  function closeLineDialog() {
    setShowLineForm(false);
    setEditingLineId(null);
    resetLineForm();
    addLineMutation.reset();
    updateLineMutation.reset();
  }

  function submitLineForm() {
    // Matches Add/UpdateOfferLineDto: CHF input → integer centimes, blank price → null ("prix à compléter").
    const payload: LinePayload = {
      description: lineForm.description.trim(),
      unit: lineForm.unit.trim(),
      quantity: lineForm.quantity,
      unitPriceCents: chfToCents(lineForm.unitPriceChf),
      ...(lineForm.pricingStrategy ? { pricingStrategy: lineForm.pricingStrategy } : {}),
      variantType: lineForm.variantType,
    };

    if (editingLineId) {
      updateLineMutation.mutate({ lineId: editingLineId, ...payload });
    } else {
      addLineMutation.mutate(payload);
    }
  }

  function openNewAssumption() {
    addAssumptionMutation.reset();
    setShowAssumptionForm(true);
  }

  function closeAssumptionDialog() {
    setShowAssumptionForm(false);
    addAssumptionMutation.reset();
  }

  async function removeLine(line: OfferLine) {
    const ok = await confirm({
      title: t('lines.confirmDeleteTitle'),
      description: t('lines.confirmDeleteBody', { position: line.positionNumber }),
      tone: 'danger',
    });
    if (ok) deleteLineMutation.mutate(line.id);
  }

  async function archiveOffer() {
    const ok = await confirm({
      title: t('archive.confirmTitle'),
      description: t('archive.confirmBody'),
      confirmLabel: t('archive.confirmAction'),
      tone: 'danger',
    });
    if (ok) statusMutation.mutate('archived');
  }

  /* --- Shared view state --- */

  const loadError = offerQuery.isError
    ? offerQuery.error.status === 401
      ? t('loginRequired')
      : errorMessage(offerQuery.error, t('loadFailed'))
    : null;

  /* --- Loading, failure, not found: never an empty-looking page --- */

  if (!offer) {
    return (
      <PageBody>
        <PageHeader title={t('title')} kicker={t('common:navGroup.sales')} />
        <Card>
          <DataState
            isLoading={offerQuery.isPending}
            error={loadError}
            onRetry={() => offerQuery.refetch()}
            isEmpty
            empty={
              <EmptyState
                title={t('notFound')}
                description={t('notFoundHelp')}
                action={
                  <Button variant="ghost" size="sm" onClick={() => navigate('/offers')}>
                    {t('back')}
                  </Button>
                }
              />
            }
          >
            {null}
          </DataState>
        </Card>
      </PageBody>
    );
  }

  /* --- Derived offer state --- */

  const lines = offer.lines ?? [];
  const assumptions = offer.assumptions ?? [];
  const editable = offer.editable ?? true;
  const nextStatuses = offer.nextStatuses ?? [];

  const countedLines = lines.filter((line) => COUNTED_TYPES.includes(line.variantType));
  // Line totals are cost prices (centimes); Number() keeps the sum numeric whatever the JSON holds.
  const countedCostCents = countedLines.reduce((sum, line) => sum + Number(line.totalPriceCents ?? 0), 0);
  // 100 % rule (§7.9): every line counted in the total must be priced before sending.
  const unpricedCount = countedLines.filter((line) => line.unitPriceCents == null).length;
  // Mirrors VALIDATION_PENDING: open hypotheses / missing information block sending.
  const pendingCount =
    lines.filter((line) => PENDING_TYPES.includes(line.variantType)).length +
    assumptions.filter((a) => PENDING_TYPES.includes(a.type) && a.status === 'open').length;

  const statusAllowsSubmit = nextStatuses.includes('submitted');
  const blockedReason = !statusAllowsSubmit
    ? t('actions.submitStatusBlocked', { status: statusLabel('offer', offer.status) })
    : unpricedCount
      ? t('actions.submitBlocked', { count: unpricedCount })
      : pendingCount
        ? t('actions.submitPending', { count: pendingCount })
        : undefined;

  // Submission has its own button, archiving its own confirmed item.
  const transitions = nextStatuses.filter((s) => s !== 'submitted' && s !== 'archived');
  const canArchive = nextStatuses.includes('archived');

  const actionError =
    statusMutation.error ||
    recalcMutation.error ||
    duplicateMutation.error ||
    pdfMutation.error ||
    decideAssumptionMutation.error ||
    deleteLineMutation.error;

  const lineDialogOpen = showLineForm || editingLineId !== null;
  const lineFormValid = lineForm.description.trim().length > 0;
  const savingLine = addLineMutation.isPending || updateLineMutation.isPending;
  const lineFormError = addLineMutation.error || updateLineMutation.error;

  return (
    <PageBody>
      <PageHeader
        kicker={offer.client?.name ?? t('header.noClient')}
        title={
          <>
            {offer.projectName}
            <StatusBadge domain="offer" value={offer.status} />
          </>
        }
        meta={
          <>
            <Ref>{offer.reference || t('header.noReference')}</Ref>
            <MetaDivider />
            <span className="tnum">{t('header.version', { version: offer.version ?? 1 })}</span>
            <MetaDivider />
            <span className="tnum">{t('header.created', { date: formatDate(offer.createdAt) })}</span>
          </>
        }
        actions={
          <>
            <Button
              onClick={() => pdfMutation.mutate()}
              disabled={pdfMutation.isPending}
              aria-label={t('actions.downloadPdf')}
            >
              <FileDown />
              {pdfMutation.isPending ? t('actions.generatingPdf') : t('actions.pdf')}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="quiet" size="icon" aria-label={t('header.moreActions')}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>{t('header.moreActions')}</DropdownMenuLabel>
                {editable ? (
                  <DropdownMenuItem
                    disabled={recalcMutation.isPending}
                    onSelect={() => recalcMutation.mutate()}
                  >
                    <RefreshCw />
                    {recalcMutation.isPending ? t('actions.recalculating') : t('actions.recalculate')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  disabled={duplicateMutation.isPending}
                  onSelect={() => duplicateMutation.mutate()}
                >
                  <Copy />
                  {duplicateMutation.isPending ? t('actions.duplicating') : t('actions.duplicate')}
                </DropdownMenuItem>

                {transitions.length > 0 ? <DropdownMenuSeparator /> : null}
                {transitions.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    disabled={statusMutation.isPending}
                    onSelect={() => statusMutation.mutate(status)}
                  >
                    <ChevronRight />
                    {t('actions.setStatus', { status: statusLabel('offer', status) })}
                  </DropdownMenuItem>
                ))}

                {canArchive ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-bad [&_svg]:text-bad"
                      disabled={statusMutation.isPending}
                      onSelect={() => {
                        void archiveOffer();
                      }}
                    >
                      <Archive />
                      {t('actions.archive')}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>

            {editable ? (
              <Button
                variant="primary"
                blockedReason={blockedReason}
                disabled={blockedReason ? undefined : statusMutation.isPending}
                onClick={() => statusMutation.mutate('submitted')}
              >
                <Send />
                {statusMutation.isPending ? t('actions.submitting') : t('actions.submit')}
              </Button>
            ) : null}
          </>
        }
      />

      {actionError ? (
        <p role="alert" className="text-[13px] text-bad">
          {errorMessage(actionError, t('actionFailed'))}
        </p>
      ) : null}

      {editable ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-info-bg px-4 py-3 text-[13px] text-info">
          <span className="flex items-center gap-2">
            <Lock aria-hidden className="size-4 shrink-0" />
            {t('locked.message', { status: statusLabel('offer', offer.status) })}
          </span>
          <Button
            size="sm"
            onClick={() => duplicateMutation.mutate()}
            disabled={duplicateMutation.isPending}
          >
            <Copy />
            {t('locked.newVersion')}
          </Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ----- Left: the work ----- */}
        <div className="grid min-w-0 content-start gap-5">
          <LifecycleCard status={offer.status} editable={editable} nextStatuses={nextStatuses} />

          <Card>
            <Tabs value={tab} onValueChange={(value) => setTab(value as 'lines' | 'assumptions')}>
              <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-3.5">
                <TabsList className="self-end border-b-0">
                  <TabsTrigger value="lines">
                    {t('lines.tab')}
                    <TabCount>{lines.length}</TabCount>
                  </TabsTrigger>
                  <TabsTrigger value="assumptions">
                    {t('assumptions.tab')}
                    <TabCount>{assumptions.length}</TabCount>
                  </TabsTrigger>
                </TabsList>
                {editable ? (
                  <Button
                    size="sm"
                    onClick={tab === 'lines' ? openNewLine : openNewAssumption}
                    className="my-2"
                  >
                    <Plus />
                    {tab === 'lines' ? t('lines.add') : t('assumptions.add')}
                  </Button>
                ) : null}
              </div>

              <TabsContent value="lines">
                <DataState
                  isLoading={offerQuery.isPending}
                  error={loadError}
                  onRetry={() => offerQuery.refetch()}
                  isEmpty={lines.length === 0}
                  empty={
                    <EmptyState
                      title={t('lines.empty')}
                      description={t('lines.emptyHelp')}
                      action={
                        editable ? (
                          <Button variant="ghost" size="sm" onClick={openNewLine}>
                            <Plus />
                            {t('lines.add')}
                          </Button>
                        ) : undefined
                      }
                    />
                  }
                >
                  <TableWrap>
                    <Table>
                      <THead>
                        <tr>
                          <TH>{t('lines.table.position')}</TH>
                          <TH>{t('lines.table.description')}</TH>
                          <TH>{t('lines.table.variant')}</TH>
                          <TH>{t('lines.table.unit')}</TH>
                          <TH numeric>{t('lines.table.quantity')}</TH>
                          <TH numeric>{t('lines.table.unitCost')}</TH>
                          <TH numeric>{t('lines.table.totalCost')}</TH>
                          <TH>{t('lines.table.pricing')}</TH>
                          {editable ? (
                            <TH className="w-11">
                              <span className="sr-only">{t('lines.table.actions')}</span>
                            </TH>
                          ) : null}
                        </tr>
                      </THead>
                      <TBody>
                        {lines.map((line) => {
                          const counted = COUNTED_TYPES.includes(line.variantType);
                          const blocking = PENDING_TYPES.includes(line.variantType);
                          return (
                            <TR
                              key={line.id}
                              muted={!counted}
                              onActivate={editable ? () => startEditLine(line) : undefined}
                            >
                              <TD className="tnum text-muted">{line.positionNumber}</TD>
                              <TD
                                className={cn(
                                  'min-w-[180px] max-w-[320px] font-medium',
                                  line.variantType === 'EXCLU' && 'line-through',
                                )}
                              >
                                {line.description}
                              </TD>
                              <TD>
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <Tag tone={typeTone(line.variantType)}>
                                    {enumLabel('variantType', line.variantType)}
                                  </Tag>
                                  {blocking ? (
                                    <Tag tone="bad">{t('lines.blocking')}</Tag>
                                  ) : counted ? null : (
                                    <span className="text-xs text-muted">{t('lines.notCounted')}</span>
                                  )}
                                </span>
                              </TD>
                              <TD className="text-muted">{line.unit || '—'}</TD>
                              <TD numeric>{formatNumber(line.quantity)}</TD>
                              <TD numeric>
                                {line.unitPriceCents != null ? (
                                  formatAmount(line.unitPriceCents)
                                ) : counted ? (
                                  <Tag tone="warn">{t('lines.priceToComplete')}</Tag>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </TD>
                              <TD numeric className="font-medium">
                                {line.totalPriceCents != null ? formatAmount(line.totalPriceCents) : '—'}
                              </TD>
                              <TD className="text-xs text-muted">
                                {line.pricingStrategy
                                  ? enumLabel('pricingStrategy', line.pricingStrategy)
                                  : '—'}
                              </TD>
                              {editable ? (
                                <TD
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                >
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="quiet"
                                        size="iconSm"
                                        aria-label={t('lines.rowActions')}
                                      >
                                        <MoreHorizontal />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                      <DropdownMenuItem onSelect={() => startEditLine(line)}>
                                        <Pencil />
                                        {t('common:actions.edit')}
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-bad [&_svg]:text-bad"
                                        disabled={deleteLineMutation.isPending}
                                        onSelect={() => {
                                          void removeLine(line);
                                        }}
                                      >
                                        <Trash2 />
                                        {t('common:actions.delete')}
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TD>
                              ) : null}
                            </TR>
                          );
                        })}
                      </TBody>
                    </Table>
                  </TableWrap>
                  <CardFooter>
                    <span>{t('lines.footerCounted', { count: countedLines.length })}</span>
                    <span className="tnum">
                      {t('lines.footerCost', { amount: formatMoney(countedCostCents) })}
                    </span>
                  </CardFooter>
                </DataState>
              </TabsContent>

              <TabsContent value="assumptions">
                <DataState
                  isLoading={offerQuery.isPending}
                  error={loadError}
                  onRetry={() => offerQuery.refetch()}
                  isEmpty={assumptions.length === 0}
                  empty={
                    <EmptyState
                      title={t('assumptions.empty')}
                      description={t('assumptions.emptyHelp')}
                      action={
                        editable ? (
                          <Button variant="ghost" size="sm" onClick={openNewAssumption}>
                            <Plus />
                            {t('assumptions.add')}
                          </Button>
                        ) : undefined
                      }
                    />
                  }
                >
                  <TableWrap>
                    <Table>
                      <THead>
                        <tr>
                          <TH>{t('assumptions.table.type')}</TH>
                          <TH>{t('assumptions.table.description')}</TH>
                          <TH numeric>{t('assumptions.table.impact')}</TH>
                          <TH>{t('assumptions.table.status')}</TH>
                          {editable ? (
                            <TH className="w-[170px]">
                              <span className="sr-only">{t('assumptions.table.actions')}</span>
                            </TH>
                          ) : null}
                        </tr>
                      </THead>
                      <TBody>
                        {assumptions.map((a) => {
                          const status = a.status || 'open';
                          const blocking = PENDING_TYPES.includes(a.type) && status === 'open';
                          return (
                            <TR key={a.id}>
                              <TD>
                                <Tag tone={typeTone(a.type)}>{enumLabel('assumptionType', a.type)}</Tag>
                              </TD>
                              <TD className="min-w-[200px] max-w-[360px]">{a.description}</TD>
                              <TD numeric>
                                {a.impactAmountCents != null ? (
                                  formatAmount(a.impactAmountCents)
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </TD>
                              <TD>
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <StatusBadge domain="assumption" value={status} />
                                  {blocking ? <Tag tone="bad">{t('assumptions.blocking')}</Tag> : null}
                                </span>
                              </TD>
                              {editable ? (
                                <TD>
                                  {status === 'open' ? (
                                    <span className="flex flex-wrap gap-1.5">
                                      <Button
                                        size="sm"
                                        disabled={decideAssumptionMutation.isPending}
                                        onClick={() =>
                                          decideAssumptionMutation.mutate({
                                            assumptionId: a.id,
                                            status: 'confirmed',
                                          })
                                        }
                                      >
                                        <Check />
                                        {t('assumptions.confirm')}
                                      </Button>
                                      <Button
                                        variant="quiet"
                                        size="sm"
                                        className="text-bad hover:bg-bad-bg"
                                        disabled={decideAssumptionMutation.isPending}
                                        onClick={() =>
                                          decideAssumptionMutation.mutate({
                                            assumptionId: a.id,
                                            status: 'rejected',
                                          })
                                        }
                                      >
                                        <X />
                                        {t('assumptions.reject')}
                                      </Button>
                                    </span>
                                  ) : null}
                                </TD>
                              ) : null}
                            </TR>
                          );
                        })}
                      </TBody>
                    </Table>
                  </TableWrap>
                  <CardFooter>
                    <span>
                      {pendingCount > 0
                        ? t('assumptions.footerOpen', { count: pendingCount })
                        : t('assumptions.footerClear')}
                    </span>
                  </CardFooter>
                </DataState>
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        {/* ----- Right: the numbers ----- */}
        <aside className="grid content-start gap-5 lg:sticky lg:top-[calc(var(--spacing-topbar)_+_20px)] lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>{t('summary.title')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1">
                <span className="text-xs text-muted">{t('summary.totalTtc')}</span>
                <span className="tnum text-[26px] font-semibold leading-none tracking-[-0.01em]">
                  {formatMoney(offer.totalTtcCents ?? 0)}
                </span>
                <span className="text-xs text-muted">{t('summary.totalTtcHint')}</span>
              </div>

              <dl className="grid gap-2 border-t border-line-soft pt-3.5">
                <SummaryRow
                  label={t('summary.countedCost')}
                  value={formatMoney(countedCostCents)}
                  hint={t('summary.countedCostHint', { count: countedLines.length })}
                />
                <SummaryRow
                  label={t('summary.marginFactor')}
                  value={t('summary.marginValue', { value: (offer.marginFactor / 100).toFixed(2) })}
                />
                <SummaryRow label={t('summary.totalHt')} value={formatMoney(offer.totalHtCents ?? 0)} />
                <SummaryRow
                  label={t('summary.vat', { rate: (offer.vatRate / 100).toFixed(2) })}
                  value={formatMoney(offer.totalVatCents ?? 0)}
                />
                <SummaryRow
                  label={t('summary.validity')}
                  value={
                    offer.validityDays != null
                      ? t('summary.validityValue', { count: offer.validityDays })
                      : '—'
                  }
                />
              </dl>

              <p className="rounded-md bg-paper-2 p-2.5 text-xs text-muted">{t('summary.costNotice')}</p>
            </CardContent>
          </Card>

          {editable ? (
            <ChecklistCard
              status={offer.status}
              statusAllowsSubmit={statusAllowsSubmit}
              unpricedCount={unpricedCount}
              pendingCount={pendingCount}
            />
          ) : null}
        </aside>
      </div>

      {/* ----- Line dialog (add or edit) ----- */}
      <Dialog
        open={lineDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeLineDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLineId ? t('lines.editTitle') : t('lines.newTitle')}</DialogTitle>
            <DialogDescription>{t('lines.formHelp')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('lines.form.description')} htmlFor="line-description" required>
              <Input
                id="line-description"
                value={lineForm.description}
                onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('lines.form.unit')} htmlFor="line-unit" hint={t('lines.form.unitHint')}>
                <Input
                  id="line-unit"
                  value={lineForm.unit}
                  onChange={(e) => setLineForm({ ...lineForm, unit: e.target.value })}
                />
              </Field>
              <Field label={t('lines.form.quantity')} htmlFor="line-quantity">
                <Input
                  id="line-quantity"
                  type="number"
                  inputMode="decimal"
                  value={lineForm.quantity}
                  onChange={(e) => setLineForm({ ...lineForm, quantity: Number(e.target.value) })}
                />
              </Field>
              <Field
                label={t('lines.form.unitCost')}
                htmlFor="line-unit-cost"
                hint={t('lines.form.unitCostHint')}
              >
                <Input
                  id="line-unit-cost"
                  type="number"
                  inputMode="decimal"
                  step="0.05"
                  min="0"
                  value={lineForm.unitPriceChf}
                  onChange={(e) => setLineForm({ ...lineForm, unitPriceChf: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('lines.form.variantType')}
                htmlFor="line-variant"
                hint={t('lines.form.variantTypeHint')}
              >
                <Select
                  id="line-variant"
                  value={lineForm.variantType}
                  onChange={(e) => setLineForm({ ...lineForm, variantType: e.target.value })}
                >
                  {VARIANT_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {enumLabel('variantType', v)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('lines.form.pricingStrategy')} htmlFor="line-pricing">
                <Select
                  id="line-pricing"
                  value={lineForm.pricingStrategy}
                  onChange={(e) => setLineForm({ ...lineForm, pricingStrategy: e.target.value })}
                >
                  <option value="">{t('lines.form.pricingStrategyNone')}</option>
                  {PRICING_STRATEGIES.map((s) => (
                    <option key={s} value={s}>
                      {enumLabel('pricingStrategy', s)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {lineFormError ? (
              <p role="alert" className="text-[13px] text-bad">
                {errorMessage(lineFormError, t('lines.saveFailed'))}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={closeLineDialog}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!lineFormValid || savingLine}
              onClick={submitLineForm}
            >
              {savingLine
                ? t('common:actions.saving')
                : editingLineId
                  ? t('lines.submitUpdate')
                  : t('lines.submitAdd')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----- Assumption dialog ----- */}
      <Dialog
        open={showAssumptionForm}
        onOpenChange={(open) => {
          if (!open) closeAssumptionDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assumptions.newTitle')}</DialogTitle>
            <DialogDescription>{t('assumptions.formHelp')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('assumptions.form.type')} htmlFor="assumption-type" required>
              <Select
                id="assumption-type"
                value={assumptionForm.type}
                onChange={(e) => setAssumptionForm({ ...assumptionForm, type: e.target.value })}
              >
                {ASSUMPTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {enumLabel('assumptionType', type)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('assumptions.form.description')} htmlFor="assumption-description" required>
              <Input
                id="assumption-description"
                value={assumptionForm.description}
                onChange={(e) =>
                  setAssumptionForm({ ...assumptionForm, description: e.target.value })
                }
              />
            </Field>
            <Field
              label={t('assumptions.form.impact')}
              htmlFor="assumption-impact"
              hint={t('assumptions.form.impactHint')}
            >
              <Input
                id="assumption-impact"
                type="number"
                inputMode="decimal"
                step="0.05"
                value={assumptionForm.impactChf}
                onChange={(e) => setAssumptionForm({ ...assumptionForm, impactChf: e.target.value })}
              />
            </Field>
            {addAssumptionMutation.error ? (
              <p role="alert" className="text-[13px] text-bad">
                {errorMessage(addAssumptionMutation.error, t('actionFailed'))}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={closeAssumptionDialog}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={
                assumptionForm.description.trim().length === 0 || addAssumptionMutation.isPending
              }
              onClick={() => addAssumptionMutation.mutate(assumptionForm)}
            >
              {addAssumptionMutation.isPending ? t('assumptions.submitting') : t('assumptions.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

/* ------------------------------------------------------------------ */
/*  Lifecycle stepper                                                  */
/* ------------------------------------------------------------------ */

function LifecycleCard({
  status,
  editable,
  nextStatuses,
}: {
  status: string;
  editable: boolean;
  nextStatuses: string[];
}) {
  const { t } = useTranslation('offerDetail');

  const stepIndex = (LIFECYCLE_STEPS as readonly string[]).indexOf(status);
  const terminal = TERMINAL_STATUSES.includes(status) ? status : null;
  // A refused offer walked the path up to "submitted"; an archived one left it wherever it was.
  const reached = status === 'rejected' ? LIFECYCLE_STEPS.length - 1 : stepIndex;

  // The next step forward, never a step back: in_progress may also go back to draft.
  const nextStep = LIFECYCLE_STEPS.slice(Math.max(stepIndex, 0) + 1).find((s) =>
    nextStatuses.includes(s),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('lifecycle.title')}</CardTitle>
        <Tag tone={editable ? 'default' : 'dashed'}>
          {editable ? t('lifecycle.editable') : t('lifecycle.locked')}
        </Tag>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-2.5">
          {LIFECYCLE_STEPS.map((step, i) => {
            const done = i < reached;
            const current = i === stepIndex;
            return (
              <li key={step} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full border text-[11.5px] font-semibold',
                    done && 'border-ok bg-ok-bg text-ok',
                    current && 'border-graphite bg-graphite text-chalk',
                    !done && !current && 'border-line bg-paper-2 text-muted',
                  )}
                >
                  {done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span
                  aria-current={current ? 'step' : undefined}
                  className={cn('text-[13px]', current ? 'font-medium text-ink' : 'text-muted')}
                >
                  {statusLabel('offer', step)}
                </span>
                {i < LIFECYCLE_STEPS.length - 1 ? (
                  <ChevronRight aria-hidden className="size-4 text-line" />
                ) : null}
              </li>
            );
          })}

          {terminal ? (
            <li className="flex items-center gap-2">
              <ChevronRight aria-hidden className="size-4 text-line" />
              <span
                aria-hidden
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full border',
                  terminal === 'rejected' ? 'border-bad bg-bad-bg text-bad' : 'border-line bg-neu-bg text-neu',
                )}
              >
                {terminal === 'rejected' ? (
                  <X className="size-3.5" />
                ) : (
                  <Archive className="size-3.5" />
                )}
              </span>
              <span aria-current="step" className="text-[13px] font-medium text-ink">
                {statusLabel('offer', terminal)}
              </span>
            </li>
          ) : null}
        </ol>

        <p className="text-xs text-muted">
          {!editable
            ? t('lifecycle.lockedHint')
            : nextStep
              ? t('lifecycle.next', { status: statusLabel('offer', nextStep) })
              : t('lifecycle.noNext')}
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Summary row                                                        */
/* ------------------------------------------------------------------ */

function SummaryRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="tnum text-[13px] font-medium text-ink">{value}</dd>
      {hint ? <dd className="col-span-2 text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  "Avant soumission" checklist                                       */
/* ------------------------------------------------------------------ */

function ChecklistCard({
  status,
  statusAllowsSubmit,
  unpricedCount,
  pendingCount,
}: {
  status: string;
  statusAllowsSubmit: boolean;
  unpricedCount: number;
  pendingCount: number;
}) {
  const { t } = useTranslation('offerDetail');
  const ready = statusAllowsSubmit && unpricedCount === 0 && pendingCount === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('checklist.title')}</CardTitle>
        <Badge tone={ready ? 'ok' : 'warn'}>
          {ready ? t('checklist.readyTag') : t('checklist.blockedTag')}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-2">
          <ChecklistItem ok={unpricedCount === 0}>
            {unpricedCount === 0
              ? t('checklist.priced.ok')
              : t('checklist.priced.blocked', { count: unpricedCount })}
          </ChecklistItem>
          <ChecklistItem ok={pendingCount === 0}>
            {pendingCount === 0
              ? t('checklist.decided.ok')
              : t('checklist.decided.blocked', { count: pendingCount })}
          </ChecklistItem>
          <ChecklistItem ok={statusAllowsSubmit}>
            {statusAllowsSubmit
              ? t('checklist.status.ok')
              : t('checklist.status.blocked', { status: statusLabel('offer', status) })}
          </ChecklistItem>
        </ul>
        <p className="text-xs text-muted">{ready ? t('checklist.ready') : t('checklist.hint')}</p>
      </CardContent>
    </Card>
  );
}

function ChecklistItem({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden
        className={cn(
          'mt-px grid size-5 shrink-0 place-items-center rounded-full',
          ok ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn',
        )}
      >
        {ok ? <Check className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
      </span>
      <span className={cn('text-[13px]', ok ? 'text-muted' : 'text-ink')}>{children}</span>
    </li>
  );
}
