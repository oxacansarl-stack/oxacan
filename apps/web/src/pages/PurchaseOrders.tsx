import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  MoreHorizontal,
  Plus,
  Send,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatAmount, formatDate, formatMoney, formatNumber, statusLabel } from '../lib/format';
import type { PageProps } from '../lib/page-props';
import { MetaDivider, PageBody, PageHeader } from '@/components/page-header';
import { Card, CardCount, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { DataState, EmptyState, TableSkeleton } from '@/components/states';
import { useConfirm } from '@/components/confirm-dialog';
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

interface Supplier {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  reference?: string;
}

interface POLine {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  totalPriceCents: number;
  deliveredQuantity: number;
}

interface PurchaseOrder {
  id: string;
  reference: string;
  supplierId: string;
  supplier?: { name: string };
  projectId?: string;
  project?: { name: string; reference?: string };
  status: 'draft' | 'sent' | 'confirmed' | 'partially_delivered' | 'delivered' | 'cancelled';
  totalHtCents: number;
  expectedDelivery?: string;
  lines?: POLine[];
  createdAt: string;
}

interface NewLine {
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_TABS = ['all', 'draft', 'sent', 'confirmed', 'delivered'] as const;

const UNITS = ['pce', 'm', 'm2', 'm3', 'kg', 'l', 'h', 'fft'] as const;

/** Unit codes are stored values; only their display label is translated. */
const UNIT_KEYS = new Set<string>(UNITS);

/** Columns of the orders table, so the expanded detail row spans the whole width. */
const COLUMN_COUNT = 8;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface DraftLine {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

const emptyDraftLine = (): DraftLine => ({
  description: '',
  quantity: '',
  unit: 'pce',
  unitPrice: '',
});

/** A CHF amount typed into a field → integer centimes, as the API stores them. */
function parseCents(chfStr: string): number {
  const n = parseFloat(chfStr);
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
}

/** 0–100, so a delivery beyond the ordered quantity can never overflow the bar. */
function deliveredPercent(line: POLine): number {
  if (!(line.quantity > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((line.deliveredQuantity / line.quantity) * 100)));
}

/** "2026-004" when the project carries a reference, its name otherwise. */
function projectShort(po: PurchaseOrder): string {
  if (!po.project) return '—';
  return po.project.reference ? po.project.reference : po.project.name;
}

/** "2026-004 — Villa Dupont" for the detail panel, where there is room for both. */
function projectLong(po: PurchaseOrder): string {
  if (!po.project) return '—';
  return po.project.reference ? `${po.project.reference} — ${po.project.name}` : po.project.name;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PurchaseOrders({ embedded = false }: PageProps) {
  const { t } = useTranslation('purchaseOrders');
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Failures of a row action: shown in the card, never as a browser alert. */
  const [actionAlert, setActionAlert] = useState<string | null>(null);

  /* create form */
  const [createOpen, setCreateOpen] = useState(false);
  const [newSupplierId, setNewSupplierId] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([emptyDraftLine()]);
  const [linesError, setLinesError] = useState<string | null>(null);

  /* add-line form, for the expanded order */
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [addLineDesc, setAddLineDesc] = useState('');
  const [addLineQty, setAddLineQty] = useState('');
  const [addLineUnit, setAddLineUnit] = useState('pce');
  const [addLinePrice, setAddLinePrice] = useState('');
  const [addLineErrors, setAddLineErrors] = useState<{ description?: string; quantity?: string }>({});

  /* delivery recording */
  const [deliveryInputs, setDeliveryInputs] = useState<Record<string, string>>({});

  const unitLabel = (unit: string) => (UNIT_KEYS.has(unit) ? t(`units.${unit}`) : unit);

  /* ---------- queries ---------- */

  const orders = useQuery<PurchaseOrder[], ApiError>({
    queryKey: ['purchase-orders', activeTab],
    queryFn: () =>
      apiGet<PurchaseOrder[]>(
        `/purchase-orders?page=1${activeTab !== 'all' ? `&status=${activeTab}` : ''}`,
      ),
    retry: false,
  });

  // Dropdown sources: a failure leaves the select empty rather than blocking the page.
  const suppliers = useQuery<Supplier[], ApiError>({
    queryKey: ['suppliers-options'],
    queryFn: () => apiGet<Supplier[]>('/suppliers?limit=100'),
    retry: false,
  });

  const projects = useQuery<Project[], ApiError>({
    queryKey: ['projects-options'],
    queryFn: () => apiGet<Project[]>('/projects'),
    retry: false,
  });

  const detail = useQuery<PurchaseOrder, ApiError>({
    queryKey: ['purchase-order', expandedId],
    queryFn: () => apiGet<PurchaseOrder>(`/purchase-orders/${expandedId}`),
    enabled: expandedId !== null,
    retry: false,
  });

  // Each delivery field starts at the quantity already recorded, and is reseeded after a save.
  useEffect(() => {
    const po = detail.data;
    if (!po) return;
    const inputs: Record<string, string> = {};
    (po.lines ?? []).forEach((line) => {
      inputs[line.id] = String(line.deliveredQuantity);
    });
    setDeliveryInputs(inputs);
  }, [detail.data]);

  /* ---------- mutations ---------- */

  const invalidateList = () => queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
  const invalidateDetail = (id: string) =>
    queryClient.invalidateQueries({ queryKey: ['purchase-order', id] });

  const create = useMutation({
    mutationFn: (body: { supplierId: string; projectId?: string; lines: NewLine[] }) =>
      apiPost('/purchase-orders', body),
    onSuccess: () => {
      setCreateOpen(false);
      setNewSupplierId('');
      setNewProjectId('');
      setDraftLines([emptyDraftLine()]);
      setLinesError(null);
      invalidateList();
    },
  });

  const changeStatus = useMutation({
    mutationFn: (vars: { id: string; status: string }) =>
      apiPut(`/purchase-orders/${vars.id}/status`, { status: vars.status }),
    onMutate: () => setActionAlert(null),
    onSuccess: (_data, vars) => {
      invalidateList();
      if (expandedId === vars.id) invalidateDetail(vars.id);
    },
    onError: (err) => setActionAlert(errorMessage(err, t('messages.statusFailed'))),
  });

  const addLine = useMutation({
    mutationFn: (vars: { poId: string; body: NewLine }) =>
      apiPost(`/purchase-orders/${vars.poId}/lines`, vars.body),
    onSuccess: (_data, vars) => {
      setAddLineDesc('');
      setAddLineQty('');
      setAddLineUnit('pce');
      setAddLinePrice('');
      setAddLineErrors({});
      setAddLineOpen(false);
      invalidateDetail(vars.poId);
      invalidateList();
    },
  });

  const deleteLine = useMutation({
    mutationFn: (vars: { poId: string; lineId: string }) =>
      apiDelete(`/purchase-orders/${vars.poId}/lines/${vars.lineId}`),
    onMutate: () => setActionAlert(null),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.poId);
      invalidateList();
    },
    onError: (err) => setActionAlert(errorMessage(err, t('messages.deleteLineFailed'))),
  });

  const recordDelivery = useMutation({
    mutationFn: (vars: { poId: string; lineId: string; deliveredQuantity: number }) =>
      apiPost(`/purchase-orders/${vars.poId}/lines/${vars.lineId}/delivery`, {
        deliveredQuantity: vars.deliveredQuantity,
      }),
    onMutate: () => setActionAlert(null),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.poId);
      invalidateList();
    },
    onError: (err) => setActionAlert(errorMessage(err, t('messages.deliveryFailed'))),
  });

  /* ---------- derived ---------- */

  const rows = orders.data ?? [];
  const totalHt = rows.reduce((sum, po) => sum + (po.totalHtCents ?? 0), 0);

  const draftTotal = draftLines.reduce((sum, line) => {
    const qty = parseFloat(line.quantity) || 0;
    const price = parseCents(line.unitPrice);
    return sum + qty * price;
  }, 0);

  const createValid =
    newSupplierId.length > 0 && draftLines.some((line) => line.description.trim().length > 0);

  const detailBusy =
    changeStatus.isPending || deleteLine.isPending || recordDelivery.isPending || addLine.isPending;

  /* ---------- handlers ---------- */

  const selectTab = (tab: string) => {
    setActiveTab(tab);
    setExpandedId(null);
    setActionAlert(null);
  };

  const toggleExpand = (id: string) => {
    setActionAlert(null);
    setExpandedId((current) => (current === id ? null : id));
  };

  const openCreate = () => {
    create.reset();
    setLinesError(null);
    setCreateOpen(true);
  };

  const updateDraftLine = (idx: number, field: keyof DraftLine, value: string) => {
    setDraftLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const removeDraftLine = (idx: number) => {
    setDraftLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!newSupplierId) return;
    const lines: NewLine[] = draftLines
      .filter((line) => line.description.trim() && parseFloat(line.quantity) > 0)
      .map((line) => ({
        description: line.description.trim(),
        quantity: parseFloat(line.quantity),
        unit: line.unit,
        unitPriceCents: parseCents(line.unitPrice),
      }));
    if (lines.length === 0) {
      setLinesError(t('messages.noValidLines'));
      return;
    }
    setLinesError(null);
    create.mutate({
      supplierId: newSupplierId,
      projectId: newProjectId || undefined,
      lines,
    });
  };

  const openAddLine = () => {
    addLine.reset();
    setAddLineDesc('');
    setAddLineQty('');
    setAddLineUnit('pce');
    setAddLinePrice('');
    setAddLineErrors({});
    setAddLineOpen(true);
  };

  const handleAddLine = (event: FormEvent) => {
    event.preventDefault();
    if (!expandedId) return;
    const qty = parseFloat(addLineQty);
    const errors: { description?: string; quantity?: string } = {};
    if (!addLineDesc.trim()) errors.description = t('messages.descriptionRequired');
    if (Number.isNaN(qty) || qty < 0) errors.quantity = t('messages.invalidQuantity');
    if (errors.description || errors.quantity) {
      setAddLineErrors(errors);
      return;
    }
    setAddLineErrors({});
    addLine.mutate({
      poId: expandedId,
      body: {
        description: addLineDesc.trim(),
        quantity: qty,
        unit: addLineUnit,
        unitPriceCents: parseCents(addLinePrice),
      },
    });
  };

  const handleDeleteLine = async (poId: string, line: POLine) => {
    if (
      !(await confirm({
        title: t('prompts.deleteLineTitle'),
        description: t('prompts.deleteLineHelp', { description: line.description }),
      }))
    ) {
      return;
    }
    deleteLine.mutate({ poId, lineId: line.id });
  };

  const handleRecordDelivery = (poId: string, lineId: string) => {
    const value = parseFloat(deliveryInputs[lineId] ?? '0');
    if (Number.isNaN(value) || value < 0) {
      setActionAlert(t('messages.invalidQuantity'));
      return;
    }
    recordDelivery.mutate({ poId, lineId, deliveredQuantity: value });
  };

  const handleCancelOrder = async (po: PurchaseOrder) => {
    if (
      !(await confirm({
        title: t('prompts.cancelOrderTitle'),
        description: t('prompts.cancelOrderHelp', { reference: po.reference }),
        confirmLabel: t('actions.cancelOrder'),
        cancelLabel: t('prompts.keepOrder'),
      }))
    ) {
      return;
    }
    changeStatus.mutate({ id: po.id, status: 'cancelled' });
  };

  /* ---------- render ---------- */

  const newOrderButton = (
    <Button variant="primary" onClick={openCreate}>
      <Plus />
      {t('actions.new')}
    </Button>
  );

  return (
    <PageBody>
      {/* Rendered as a tab of Achats, which already carries the title and the kicker. */}
      {embedded ? null : (
        <PageHeader
          title={t('title')}
          kicker={t('common:navGroup.procurement')}
          meta={
            rows.length > 0 ? (
              <>
                <span>{t('summary.count', { count: rows.length })}</span>
                <MetaDivider />
                <span className="tnum">{t('summary.total', { amount: formatMoney(totalHt) })}</span>
              </>
            ) : undefined
          }
          actions={newOrderButton}
        />
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft p-3">
          <div className="flex flex-wrap gap-0.5" role="group" aria-label={t('filters.status')}>
            {STATUS_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={activeTab === tab}
                onClick={() => selectTab(tab)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:text-ink',
                  activeTab === tab && 'bg-chalk font-medium text-ink',
                )}
              >
                {tab === 'all' ? t('tabs.all') : statusLabel('purchaseOrder', tab)}
              </button>
            ))}
          </div>
          {embedded ? newOrderButton : null}
        </div>

        {actionAlert ? (
          <div
            role="alert"
            className="flex items-start justify-between gap-2 border-b border-line-soft bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad"
          >
            <span>{actionAlert}</span>
            <Button
              variant="quiet"
              size="iconSm"
              className="shrink-0 text-bad hover:bg-bad-bg"
              aria-label={t('actions.dismissAlert')}
              onClick={() => setActionAlert(null)}
            >
              <X />
            </Button>
          </div>
        ) : null}

        <DataState
          isLoading={orders.isPending}
          error={orders.isError ? errorMessage(orders.error, t('messages.loadFailed')) : null}
          onRetry={() => orders.refetch()}
          isEmpty={rows.length === 0}
          loading={<TableSkeleton rows={6} cols={6} />}
          empty={
            activeTab === 'all' ? (
              <EmptyState
                icon={<ShoppingCart className="size-5" />}
                title={t('empty.none')}
                description={t('empty.noneHelp')}
                action={
                  <Button variant="ghost" size="sm" onClick={openCreate}>
                    <Plus />
                    {t('actions.new')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<ShoppingCart className="size-5" />}
                title={t('empty.filtered')}
                description={t('empty.filteredHelp')}
              />
            )
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH className="w-9">
                    <span className="sr-only">{t('table.expand')}</span>
                  </TH>
                  <TH>{t('table.reference')}</TH>
                  <TH>{t('table.supplier')}</TH>
                  <TH>{t('table.project')}</TH>
                  <TH>{t('table.status')}</TH>
                  <TH numeric>{t('table.totalHt')}</TH>
                  <TH>{t('table.expectedDelivery')}</TH>
                  <TH>{t('table.created')}</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((po) => {
                  const isExpanded = expandedId === po.id;
                  return (
                    <Fragment key={po.id}>
                      <TR
                        onActivate={() => toggleExpand(po.id)}
                        aria-expanded={isExpanded}
                        className={cn(isExpanded && '[&>td]:bg-chalk')}
                      >
                        <TD className="text-muted">
                          {isExpanded ? (
                            <ChevronDown aria-hidden className="size-4" />
                          ) : (
                            <ChevronRight aria-hidden className="size-4" />
                          )}
                        </TD>
                        <TD>
                          <Ref>{po.reference}</Ref>
                        </TD>
                        <TD className="font-medium">{po.supplier?.name ?? '—'}</TD>
                        <TD className="text-muted">{projectShort(po)}</TD>
                        <TD>
                          <StatusBadge domain="purchaseOrder" value={po.status} />
                        </TD>
                        <TD numeric className="font-medium">
                          {formatMoney(po.totalHtCents)}
                        </TD>
                        <TD className="tnum text-muted">{formatDate(po.expectedDelivery)}</TD>
                        <TD className="tnum text-muted">{formatDate(po.createdAt)}</TD>
                      </TR>

                      {isExpanded ? (
                        <tr>
                          <TD colSpan={COLUMN_COUNT} className="h-auto bg-chalk p-0">
                            <div className="p-3.5">
                              <DataState
                                isLoading={detail.isPending}
                                error={
                                  detail.isError
                                    ? errorMessage(detail.error, t('messages.loadDetailFailed'))
                                    : null
                                }
                                onRetry={() => detail.refetch()}
                                loading={<TableSkeleton rows={3} cols={5} />}
                              >
                                {detail.data ? (
                                  <OrderDetail
                                    po={detail.data}
                                    busy={detailBusy}
                                    deliveryInputs={deliveryInputs}
                                    unitLabel={unitLabel}
                                    onDeliveryInputChange={(lineId, value) =>
                                      setDeliveryInputs((prev) => ({ ...prev, [lineId]: value }))
                                    }
                                    onRecordDelivery={handleRecordDelivery}
                                    onDeleteLine={(poId, line) => {
                                      void handleDeleteLine(poId, line);
                                    }}
                                    onAddLine={openAddLine}
                                    onStatusChange={(poId, status) =>
                                      changeStatus.mutate({ id: poId, status })
                                    }
                                    onCancelOrder={(order) => {
                                      void handleCancelOrder(order);
                                    }}
                                  />
                                ) : null}
                              </DataState>
                            </div>
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
            <span>{t('summary.count', { count: rows.length })}</span>
            <span className="tnum">{t('summary.total', { amount: formatMoney(totalHt) })}</span>
          </CardFooter>
        </DataState>
      </Card>

      {/* Create: a dialog, so the list is never pushed down the page. */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>{t('form.title')}</DialogTitle>
              <DialogDescription>{t('form.help')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <Field label={t('form.supplier')} htmlFor="po-supplier" required>
                  <Select
                    id="po-supplier"
                    value={newSupplierId}
                    onChange={(e) => setNewSupplierId(e.target.value)}
                  >
                    <option value="">{t('form.selectSupplier')}</option>
                    {(suppliers.data ?? []).map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('form.project')} htmlFor="po-project" hint={t('form.projectHint')}>
                  <Select
                    id="po-project"
                    value={newProjectId}
                    onChange={(e) => setNewProjectId(e.target.value)}
                  >
                    <option value="">{t('form.noProject')}</option>
                    {(projects.data ?? []).map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.reference ? `${project.reference} — ${project.name}` : project.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink-2">{t('form.lines')}</span>
                  <Button
                    size="sm"
                    onClick={() => setDraftLines((prev) => [...prev, emptyDraftLine()])}
                  >
                    <Plus />
                    {t('actions.addLine')}
                  </Button>
                </div>

                {draftLines.map((line, idx) => {
                  const qty = parseFloat(line.quantity) || 0;
                  const lineTotalCents = qty * parseCents(line.unitPrice);
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-md border border-line-soft bg-paper-2 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-ink-2">
                          {t('form.line', { index: idx + 1 })}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="tnum text-[13px] font-medium text-ink">
                            {t('form.lineTotal', { amount: formatAmount(lineTotalCents) })}
                          </span>
                          <Button
                            variant="quiet"
                            size="iconSm"
                            className="text-bad hover:bg-bad-bg"
                            aria-label={t('actions.removeLine')}
                            title={t('actions.removeLine')}
                            onClick={() => removeDraftLine(idx)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>

                      <Field label={t('form.description')} htmlFor={`po-line-${idx}-description`}>
                        <Input
                          id={`po-line-${idx}-description`}
                          value={line.description}
                          onChange={(e) => updateDraftLine(idx, 'description', e.target.value)}
                        />
                      </Field>

                      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
                        <Field label={t('form.quantity')} htmlFor={`po-line-${idx}-quantity`}>
                          <Input
                            id={`po-line-${idx}-quantity`}
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            placeholder="0"
                            value={line.quantity}
                            onChange={(e) => updateDraftLine(idx, 'quantity', e.target.value)}
                          />
                        </Field>
                        <Field label={t('form.unit')} htmlFor={`po-line-${idx}-unit`}>
                          <Select
                            id={`po-line-${idx}-unit`}
                            value={line.unit}
                            onChange={(e) => updateDraftLine(idx, 'unit', e.target.value)}
                          >
                            {UNITS.map((unit) => (
                              <option key={unit} value={unit}>
                                {unitLabel(unit)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label={t('form.unitPriceChf')} htmlFor={`po-line-${idx}-price`}>
                          <Input
                            id={`po-line-${idx}-price`}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={line.unitPrice}
                            onChange={(e) => updateDraftLine(idx, 'unitPrice', e.target.value)}
                          />
                        </Field>
                      </div>
                    </div>
                  );
                })}

                <p className="tnum text-right text-[13.5px] font-semibold text-ink">
                  {t('form.totalHt', { amount: formatMoney(draftTotal) })}
                </p>
              </div>

              {linesError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {linesError}
                </p>
              ) : null}
              {create.isError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {errorMessage(create.error, t('messages.createFailed'))}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!createValid || create.isPending}
              >
                {create.isPending ? t('actions.creating') : t('actions.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add a line to the order that is open below. */}
      <Dialog open={addLineOpen} onOpenChange={setAddLineOpen}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          <form onSubmit={handleAddLine}>
            <DialogHeader>
              <DialogTitle>{t('detail.addLineTitle')}</DialogTitle>
              <DialogDescription>
                {t('detail.addLineHelp', { reference: detail.data?.reference ?? '—' })}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field
                label={t('form.description')}
                htmlFor="po-new-line-description"
                error={addLineErrors.description}
                required
              >
                <Input
                  id="po-new-line-description"
                  value={addLineDesc}
                  onChange={(e) => setAddLineDesc(e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
                <Field
                  label={t('form.quantity')}
                  htmlFor="po-new-line-quantity"
                  error={addLineErrors.quantity}
                  required
                >
                  <Input
                    id="po-new-line-quantity"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0"
                    value={addLineQty}
                    onChange={(e) => setAddLineQty(e.target.value)}
                  />
                </Field>
                <Field label={t('form.unit')} htmlFor="po-new-line-unit">
                  <Select
                    id="po-new-line-unit"
                    value={addLineUnit}
                    onChange={(e) => setAddLineUnit(e.target.value)}
                  >
                    {UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unitLabel(unit)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('detail.priceChf')} htmlFor="po-new-line-price">
                  <Input
                    id="po-new-line-price"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={addLinePrice}
                    onChange={(e) => setAddLinePrice(e.target.value)}
                  />
                </Field>
              </div>
              {addLine.isError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {errorMessage(addLine.error, t('messages.addLineFailed'))}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAddLineOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={addLine.isPending}>
                {addLine.isPending ? t('actions.adding') : t('common:actions.add')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

/* ------------------------------------------------------------------ */
/*  Expanded detail                                                    */
/* ------------------------------------------------------------------ */

interface OrderDetailProps {
  po: PurchaseOrder;
  /** True while any order mutation is in flight. */
  busy: boolean;
  deliveryInputs: Record<string, string>;
  /** Translates a unit code for display; the stored code is never changed. */
  unitLabel: (unit: string) => string;
  onDeliveryInputChange: (lineId: string, value: string) => void;
  onRecordDelivery: (poId: string, lineId: string) => void;
  onDeleteLine: (poId: string, line: POLine) => void;
  onAddLine: () => void;
  onStatusChange: (poId: string, status: string) => void;
  onCancelOrder: (po: PurchaseOrder) => void;
}

function OrderDetail({
  po,
  busy,
  deliveryInputs,
  unitLabel,
  onDeliveryInputChange,
  onRecordDelivery,
  onDeleteLine,
  onAddLine,
  onStatusChange,
  onCancelOrder,
}: OrderDetailProps) {
  const { t } = useTranslation('purchaseOrders');

  const lines = po.lines ?? [];
  const isDraft = po.status === 'draft';
  // A delivery can only be recorded once the order has left the draft, and never on a cancelled one.
  const canRecordDelivery = po.status !== 'cancelled' && po.status !== 'draft';
  const canCancel = po.status !== 'delivered' && po.status !== 'cancelled';

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <Card>
        <dl className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
            <dt className="text-xs text-muted">{t('detail.reference')}</dt>
            <dd>
              <Ref>{po.reference}</Ref>
            </dd>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
            <dt className="text-xs text-muted">{t('detail.supplier')}</dt>
            <dd className="text-[13.5px] font-medium text-ink">{po.supplier?.name ?? '—'}</dd>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
            <dt className="text-xs text-muted">{t('detail.project')}</dt>
            <dd className="text-[13.5px] text-ink">{projectLong(po)}</dd>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
            <dt className="text-xs text-muted">{t('detail.status')}</dt>
            <dd>
              <StatusBadge domain="purchaseOrder" value={po.status} />
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('form.lines')}
            <CardCount>{lines.length}</CardCount>
          </CardTitle>
          <Button size="sm" onClick={onAddLine} disabled={busy}>
            <Plus />
            {t('actions.addLine')}
          </Button>
        </CardHeader>

        {lines.length === 0 ? (
          <EmptyState
            title={t('detail.noLines')}
            description={t('detail.noLinesHelp')}
            action={
              <Button variant="ghost" size="sm" onClick={onAddLine} disabled={busy}>
                <Plus />
                {t('actions.addLine')}
              </Button>
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('lines.description')}</TH>
                  <TH numeric>{t('lines.qtyOrdered')}</TH>
                  <TH numeric>{t('lines.qtyDelivered')}</TH>
                  <TH className="min-w-[140px]">{t('lines.progress')}</TH>
                  <TH numeric>{t('lines.unitPrice')}</TH>
                  <TH numeric>{t('lines.total')}</TH>
                  <TH numeric>{t('lines.actions')}</TH>
                </tr>
              </THead>
              <TBody>
                {lines.map((line) => {
                  const percent = deliveredPercent(line);
                  return (
                    <TR key={line.id}>
                      <TD className="min-w-[180px] max-w-[320px] font-medium">{line.description}</TD>
                      <TD numeric className="whitespace-nowrap">
                        {formatNumber(line.quantity)} {unitLabel(line.unit)}
                      </TD>
                      <TD numeric className="whitespace-nowrap">
                        {formatNumber(line.deliveredQuantity)} {unitLabel(line.unit)}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div
                            role="progressbar"
                            aria-label={t('lines.progress')}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={percent}
                            className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-line-soft"
                          >
                            {/* The one permitted inline style: a width only known at runtime. */}
                            <div
                              className={cn('h-full rounded-full', percent >= 100 ? 'bg-ok' : 'bg-copper')}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span className="tnum text-xs text-muted">
                            {t('lines.progressValue', { percent })}
                          </span>
                        </div>
                      </TD>
                      <TD numeric>{formatMoney(line.unitPriceCents)}</TD>
                      <TD numeric className="font-medium">
                        {formatMoney(line.totalPriceCents)}
                      </TD>
                      <TD>
                        <div className="flex items-center justify-end gap-1.5">
                          {canRecordDelivery ? (
                            <>
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                inputMode="decimal"
                                className="tnum h-7 w-[76px] px-2 text-right text-[13px]"
                                aria-label={t('lines.deliveryFor', { description: line.description })}
                                value={deliveryInputs[line.id] ?? ''}
                                onChange={(e) => onDeliveryInputChange(line.id, e.target.value)}
                              />
                              <Button
                                size="iconSm"
                                aria-label={t('actions.recordDelivery')}
                                title={t('actions.recordDelivery')}
                                disabled={busy}
                                onClick={() => onRecordDelivery(po.id, line.id)}
                              >
                                <Check />
                              </Button>
                            </>
                          ) : null}
                          {isDraft ? (
                            <Button
                              variant="quiet"
                              size="iconSm"
                              className="text-bad hover:bg-bad-bg"
                              aria-label={t('actions.deleteLine')}
                              title={t('actions.deleteLine')}
                              disabled={busy}
                              onClick={() => onDeleteLine(po.id, line)}
                            >
                              <Trash2 />
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        )}

        <CardFooter>
          <span className="tnum">{t('form.totalHt', { amount: formatMoney(po.totalHtCents) })}</span>
        </CardFooter>
      </Card>

      {/* Lifecycle: draft → envoyée → confirmée → livrée, with a cancel until delivery. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {po.status === 'draft' ? (
          <Button disabled={busy} onClick={() => onStatusChange(po.id, 'sent')}>
            <Send />
            {t('actions.send')}
          </Button>
        ) : null}
        {po.status === 'sent' ? (
          <Button disabled={busy} onClick={() => onStatusChange(po.id, 'confirmed')}>
            <Check />
            {t('actions.confirm')}
          </Button>
        ) : null}
        {po.status === 'confirmed' ? (
          <Button disabled={busy} onClick={() => onStatusChange(po.id, 'delivered')}>
            <CircleCheck />
            {t('actions.markDelivered')}
          </Button>
        ) : null}
        {canCancel ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="quiet" size="icon" aria-label={t('actions.orderActions')}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                className="text-bad"
                disabled={busy}
                onSelect={() => onCancelOrder(po)}
              >
                <X />
                {t('actions.cancelOrder')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}
