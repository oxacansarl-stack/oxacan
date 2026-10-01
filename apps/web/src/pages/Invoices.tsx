import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  Check,
  Clock,
  Download,
  FileMinus2,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { apiGet, apiList, apiPost, apiPatch, apiDownload } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { enumLabel, formatAmount, formatDate, formatMoney, formatNumber, statusLabel } from '../lib/format';
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
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ui/input';
import { Tag } from '@/components/ui/badge';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Project {
  id: string;
  name: string;
  reference?: string;
  clientId?: string;
}

interface Client {
  id: string;
  name: string;
}

interface InvoiceLine {
  id?: string;
  description: string;
  unit: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents?: number;
  /** Situations: the offer position the line bills; quantity is then the offer budget. */
  offerLineId?: string | null;
  cumulativeQuantity?: number | null;
  /** Situations: computed by the server from earlier situations — never sent by the client. */
  previousQuantity?: number | null;
  periodQuantity?: number | null;
}

/** GET /invoices/project/:projectId/situation-preview — the server's values for the next situation. */
interface SituationPosition {
  offerLineId: string;
  positionNumber: number;
  description: string;
  unit: string;
  variantType: string;
  offerQuantity: number;
  unitPriceCents: number | null;
  previousQuantity: number;
}

interface SituationPreview {
  projectId: string;
  situationNumber: number;
  acomptesToDeductCents: number;
  positions: SituationPosition[];
}

/**
 * GET /invoices/project/:projectId/final-preview — the server's values for the project's décompte
 * final. It returns much more (positions, plus-values, blockers); only the acomptes the final
 * invoice will deduct are read here, so the totals preview cannot disagree with what is created.
 */
interface FinalInvoicePreview {
  projectId: string;
  acomptesToDeductCents: number;
}

interface Payment {
  id: string;
  amountCents: number;
  paymentDate: string;
  paymentMethod: string;
  reference?: string;
  createdAt: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  type: 'invoice' | 'situation' | 'acompte' | 'credit_note' | 'final_invoice';
  /** Situations: Situation 1, 2, … per project. */
  situationNumber?: number | null;
  projectId: string;
  project?: { name: string; reference?: string };
  clientId: string;
  client?: { name: string };
  status: 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled';
  issueDate: string;
  dueDate?: string;
  /** Basis points: 810 = 8.10 % */
  vatRate: number;
  subtotalHtCents: number;
  vatAmountCents: number;
  retentionAmountCents: number | null;
  priorAcomptesCents: number | null;
  totalTtcCents: number;
  amountPaidCents: number | null;
  notes?: string;
  lines?: InvoiceLine[];
  payments?: Payment[];
  createdAt: string;
}

interface PlusValue {
  id: string;
  projectId: string;
  project?: { name: string };
  description: string;
  amountCents: number;
  status: 'detected' | 'submitted' | 'approved' | 'rejected' | 'invoiced';
  createdAt: string;
}

type Section = 'invoices' | 'plus-values';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** DB CHECK invoice.type */
const INVOICE_TYPES = ['invoice', 'situation', 'acompte', 'credit_note', 'final_invoice'] as const;

/**
 * Every stored invoice status (§15.4), so the filter can never hide a document: `draft`, `sent`,
 * `partially_paid`, `paid`, `overdue`, `cancelled`. The colours live in StatusBadge's `invoice`
 * table, the labels in common.json's `status.invoice`.
 */
const STATUS_TABS = ['all', 'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'] as const;

/** Statuses on which the server accepts a payment. */
const PAYABLE_STATUSES = new Set(['sent', 'partially_paid', 'overdue']);

/** DB CHECK payment.payment_method */
const PAYMENT_METHODS = ['bank_transfer', 'card', 'cash', 'other'] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** "8.10" (percent) → 810 (basis points), as the API expects. */
const percentToBps = (value: string): number => Math.round(parseFloat(value) * 100);

const swissRound = (cents: number): number => Math.round(cents / 5) * 5;

/** Quantities are stored as REAL: compare and subtract at the precision the server uses. */
const roundQuantity = (q: number): number => Math.round(q * 1e6) / 1e6;

/** A line the user left untouched (situations may consist of offer positions only). */
const isBlankLine = (l: InvoiceLine): boolean => !l.description.trim() && !l.unitPriceCents;

/** "Situation 2" when the server numbered it, else the type label. */
const typeLabel = (inv: Pick<Invoice, 'type' | 'situationNumber'>, t: (k: string, o?: any) => string): string =>
  inv.type === 'situation' && inv.situationNumber
    ? t('detail.situationNumber', { number: inv.situationNumber })
    : enumLabel('invoiceType', inv.type);

/** A credit note reverses a document, an acompte is only an advance: both read differently. */
const typeTone = (type: Invoice['type']): 'default' | 'warn' | 'bad' =>
  type === 'credit_note' ? 'bad' : type === 'acompte' ? 'warn' : 'default';

/**
 * A credit note keeps `draft` for ever — the server refuses any status change on it
 * (`CREDIT_NOTE_STATUS`) — so a status pill would label a final document "Brouillon". It is
 * shown by TYPE instead; every other document gets the six-status invoice badge.
 */
function InvoiceState({ invoice }: { invoice: Pick<Invoice, 'type' | 'status'> }) {
  if (invoice.type === 'credit_note') {
    return <Tag tone="bad">{enumLabel('invoiceType', 'credit_note')}</Tag>;
  }
  return <StatusBadge domain="invoice" value={invoice.status} />;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Invoices() {
  const { t } = useTranslation('invoices');
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();

  /* --- State --- */
  const [activeSection, setActiveSection] = useState<Section>('invoices');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  /** The invoice list's own failure: DataState shows it instead of an empty table. */
  const [listError, setListError] = useState('');
  /** A failed action (status change, PDF, credit note…): an inline alert, never an alert(). */
  const [actionError, setActionError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    projectId: '',
    clientId: '',
    type: 'invoice' as Invoice['type'],
    vatRate: '8.10',
    notes: '',
  });
  const [createLines, setCreateLines] = useState<InvoiceLine[]>([
    { description: '', unit: 'u', quantity: 1, unitPriceCents: 0 },
  ]);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  // Situations: the server's values for the project's next situation, and the cumulative
  // quantity typed per offer position ('' = position not billed on this situation).
  const [situationPreview, setSituationPreview] = useState<SituationPreview | null>(null);
  const [situationLoading, setSituationLoading] = useState(false);
  const [situationError, setSituationError] = useState('');
  const [situationReload, setSituationReload] = useState(0);
  const [cumulativeInputs, setCumulativeInputs] = useState<Record<string, string>>({});
  // Final invoice: the server's values for the project's décompte final — read only for the
  // acomptes it will deduct, which no figure on this page could derive on its own.
  const [finalPreview, setFinalPreview] = useState<FinalInvoicePreview | null>(null);
  const [finalError, setFinalError] = useState('');
  const isSituation = createForm.type === 'situation';
  const isFinal = createForm.type === 'final_invoice';

  // Detail view
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Invoice | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  // Payment form
  const [showPayment, setShowPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amountCents: 0,
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'bank_transfer',
    reference: '',
  });

  // Plus-values
  const [plusValues, setPlusValues] = useState<PlusValue[]>([]);
  const [pvLoading, setPvLoading] = useState(true);
  const [pvError, setPvError] = useState('');
  const [showPvCreate, setShowPvCreate] = useState(false);
  const [pvCreating, setPvCreating] = useState(false);
  const [pvForm, setPvForm] = useState({
    projectId: '',
    description: '',
    amountCents: 0,
  });

  /* --- Data loading --- */
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      let path = `/invoices?page=${page}`;
      if (statusFilter !== 'all') path += `&status=${statusFilter}`;
      if (typeFilter) path += `&type=${typeFilter}`;
      const { items, meta } = await apiList<Invoice>(path);
      setInvoices(items);
      setTotalPages(Math.max(1, meta?.totalPages ?? 1));
    } catch (e) {
      setListError(errorMessage(e, t('errors.loadInvoices')));
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, typeFilter, t]);

  const fetchReferenceData = useCallback(async () => {
    try {
      const [projectsRes, clientsRes] = await Promise.all([
        apiGet<any>('/projects'),
        apiGet<any>('/clients'),
      ]);
      setProjects(Array.isArray(projectsRes) ? projectsRes : projectsRes?.data ?? []);
      setClients(Array.isArray(clientsRes) ? clientsRes : clientsRes?.data ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchReferenceData(); }, [fetchReferenceData]);
  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  // The top bar's "Créer" menu links here with ?new=1.
  useEffect(() => {
    if (params.get('new') === '1') {
      setActiveSection('invoices');
      setCreateError('');
      setShowCreate(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  /* --- Plus-values --- */
  const fetchPlusValues = useCallback(async () => {
    setPvLoading(true);
    setPvError('');
    try {
      const items = await apiGet<PlusValue[]>('/invoices/plus-values?limit=500');
      setPlusValues(Array.isArray(items) ? items : []);
    } catch (e) {
      setPvError(errorMessage(e, t('errors.loadPlusValues')));
      setPlusValues([]);
    }
    finally { setPvLoading(false); }
  }, [t]);

  useEffect(() => {
    if (activeSection === 'plus-values') fetchPlusValues();
  }, [activeSection, fetchPlusValues]);

  /* --- Invoice detail --- */
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      setDetail(await apiGet<Invoice>(`/invoices/${id}`));
    } catch (e) {
      setDetail(null);
      setDetailError(errorMessage(e, t('errors.loadInvoice')));
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  const openDetail = (id: string) => {
    setActionError('');
    setDetail(null);
    setDetailError('');
    setSelectedId(id);
    void loadDetail(id);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    setDetailError('');
    setShowPayment(false);
  };

  /* --- Situation: load the server's values for the next situation of the project --- */
  useEffect(() => {
    setSituationPreview(null);
    setSituationError('');
    setCumulativeInputs({});
    if (!showCreate || !isSituation || !createForm.projectId) return;
    let stale = false;
    setSituationLoading(true);
    apiGet<SituationPreview>(`/invoices/project/${createForm.projectId}/situation-preview`)
      .then(preview => { if (!stale) setSituationPreview(preview); })
      .catch(e => { if (!stale) setSituationError(errorMessage(e, t('errors.loadSituation'))); })
      .finally(() => { if (!stale) setSituationLoading(false); });
    return () => { stale = true; };
  }, [showCreate, isSituation, createForm.projectId, situationReload, t]);

  /* --- Final invoice: the acomptes the server will deduct, from the same preview the final
         invoice is created from (its retention release stays the server's, see the totals). --- */
  useEffect(() => {
    setFinalPreview(null);
    setFinalError('');
    if (!showCreate || !isFinal || !createForm.projectId) return;
    let stale = false;
    apiGet<FinalInvoicePreview>(`/invoices/project/${createForm.projectId}/final-preview`)
      .then(preview => { if (!stale) setFinalPreview(preview); })
      .catch(e => { if (!stale) setFinalError(errorMessage(e, t('errors.loadFinalPreview'))); });
    return () => { stale = true; };
  }, [showCreate, isFinal, createForm.projectId, t]);

  // Preview of each position: period = cumulative typed − quantity already billed (from the server).
  const situationRows = (situationPreview?.positions ?? []).map(position => {
    const raw = (cumulativeInputs[position.offerLineId] ?? '').trim();
    const cumulative = raw === '' ? null : Number(raw);
    const period = cumulative == null || !Number.isFinite(cumulative) ? 0 : roundQuantity(cumulative - position.previousQuantity);
    const total = position.unitPriceCents == null ? 0 : Math.round(Math.max(period, 0) * position.unitPriceCents);
    return { position, cumulative, period, total };
  });
  const billedRows = situationRows.filter(r => r.cumulative != null);
  // On a situation, offer positions carry the billing; untouched free lines are simply left out.
  const freeLines = isSituation ? createLines.filter(l => !isBlankLine(l)) : createLines;

  /* --- Create invoice --- */
  const handleCreate = async () => {
    setCreateError('');
    if (!createForm.projectId) { setCreateError(t('validation.projectRequired')); return; }
    if (!createForm.clientId) { setCreateError(t('validation.clientRequired')); return; }
    if (freeLines.length + billedRows.length === 0) { setCreateError(t('validation.lineRequired')); return; }
    const hasEmpty = freeLines.some(l => !l.description.trim() || !Number.isInteger(l.unitPriceCents) || l.unitPriceCents <= 0);
    if (hasEmpty) { setCreateError(t('validation.linesIncomplete')); return; }
    if (freeLines.some(l => l.quantity < 0) || billedRows.some(r => !Number.isFinite(r.cumulative!) || r.cumulative! < 0)) {
      setCreateError(t('validation.negativeQuantity')); return;
    }
    const backwards = billedRows.find(r => roundQuantity(r.cumulative!) < r.position.previousQuantity);
    if (backwards) {
      setCreateError(t('validation.cumulativeBelowPrevious', {
        position: backwards.position.positionNumber,
        cumulative: backwards.cumulative,
        previous: backwards.position.previousQuantity,
      }));
      return;
    }
    const vatRateBps = percentToBps(createForm.vatRate);
    if (!Number.isFinite(vatRateBps) || vatRateBps < 0 || vatRateBps > 10000) {
      setCreateError(t('validation.vatRange')); return;
    }

    setCreating(true);
    try {
      await apiPost('/invoices', {
        projectId: createForm.projectId,
        clientId: createForm.clientId,
        type: createForm.type,
        vatRate: vatRateBps,
        lines: [
          // The server computes each position's previous quantity; only the cumulative is sent.
          ...billedRows.map(r => ({
            offerLineId: r.position.offerLineId,
            description: r.position.description,
            unit: r.position.unit,
            unitPriceCents: r.position.unitPriceCents!,
            cumulativeQuantity: r.cumulative!,
          })),
          ...freeLines.map(l => ({
            description: l.description.trim(),
            ...(l.unit.trim() ? { unit: l.unit.trim() } : {}),
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
          })),
        ],
        ...(createForm.notes.trim() ? { notes: createForm.notes.trim() } : {}),
      });
      setShowCreate(false);
      setCreateForm({ projectId: '', clientId: '', type: 'invoice', vatRate: '8.10', notes: '' });
      setCreateLines([{ description: '', unit: 'u', quantity: 1, unitPriceCents: 0 }]);
      setCumulativeInputs({});
      fetchInvoices();
    } catch (e) {
      setCreateError(errorMessage(e, t('errors.createInvoice')));
    } finally {
      setCreating(false);
    }
  };

  /* --- Auto-fill client from project --- */
  const handleProjectChange = (projectId: string) => {
    setCreateForm(prev => {
      const project = projects.find(p => p.id === projectId);
      return {
        ...prev,
        projectId,
        clientId: project?.clientId || prev.clientId,
      };
    });
  };

  /* --- Status change --- */
  const changeStatus = async (id: string, status: string) => {
    setActionError('');
    try {
      await apiPatch(`/invoices/${id}/status`, { status });
      fetchInvoices();
      if (selectedId === id) {
        void loadDetail(id);
      }
    } catch (e) {
      setActionError(errorMessage(e, t('errors.updateStatus')));
    }
  };

  /**
   * Voids a mistaken draft — PATCH /invoices/:id/status is the only route that sets `cancelled`,
   * and the server allows it from `draft` only (INVOICE_TRANSITIONS.draft = ['sent','cancelled']);
   * an issued invoice is neutralised with a credit note instead. Irreversible, hence the
   * confirmation: `cancelled` transitions nowhere.
   */
  const cancelInvoice = async (inv: Invoice) => {
    const ok = await confirm({
      title: t('confirm.cancelTitle'),
      description: t('confirm.cancelHelp', { number: inv.invoiceNumber }),
      confirmLabel: t('actions.cancelInvoice'),
      cancelLabel: t('confirm.keepDraft'),
    });
    if (!ok) return;
    await changeStatus(inv.id, 'cancelled');
  };

  /* --- PDF --- */
  const downloadPdf = async (id: string) => {
    setActionError('');
    try {
      await apiDownload(`/invoices/${id}/pdf`);
    } catch (e) {
      setActionError(errorMessage(e, t('errors.downloadPdf')));
    }
  };

  /* --- Credit note --- */
  const createCreditNote = async (inv: Invoice) => {
    const ok = await confirm({
      title: t('confirm.creditNoteTitle'),
      description: t('confirm.creditNoteHelp', { number: inv.invoiceNumber }),
      confirmLabel: t('actions.creditNote'),
    });
    if (!ok) return;
    setActionError('');
    try {
      await apiPost(`/invoices/${inv.id}/credit-note`);
      fetchInvoices();
      closeDetail();
    } catch (e) {
      setActionError(errorMessage(e, t('errors.createCreditNote')));
    }
  };

  /* --- Record payment --- */
  const openPayment = () => {
    setPaymentError('');
    setShowPayment(true);
  };

  const recordPayment = async () => {
    if (!detail) return;
    setPaymentError('');
    if (!Number.isInteger(paymentForm.amountCents) || paymentForm.amountCents <= 0) {
      setPaymentError(t('validation.paymentAmount')); return;
    }
    if (!paymentForm.paymentDate) { setPaymentError(t('validation.paymentDate')); return; }
    setSavingPayment(true);
    try {
      await apiPost(`/invoices/${detail.id}/payments`, {
        amountCents: paymentForm.amountCents,
        paymentDate: paymentForm.paymentDate,
        paymentMethod: paymentForm.paymentMethod,
        ...(paymentForm.reference.trim() ? { reference: paymentForm.reference.trim() } : {}),
      });
      setShowPayment(false);
      setPaymentForm({ amountCents: 0, paymentDate: new Date().toISOString().slice(0, 10), paymentMethod: 'bank_transfer', reference: '' });
      void loadDetail(detail.id);
      fetchInvoices();
    } catch (e) {
      setPaymentError(errorMessage(e, t('errors.recordPayment')));
    } finally {
      setSavingPayment(false);
    }
  };

  /* --- Plus-value create --- */
  const pvFormValid =
    Boolean(pvForm.projectId) &&
    pvForm.description.trim().length > 0 &&
    Number.isInteger(pvForm.amountCents) &&
    pvForm.amountCents > 0;

  const createPlusValue = async () => {
    if (!pvFormValid) return;
    setActionError('');
    setPvCreating(true);
    try {
      await apiPost('/invoices/plus-values', {
        projectId: pvForm.projectId,
        description: pvForm.description.trim(),
        amountCents: pvForm.amountCents,
      });
      setShowPvCreate(false);
      setPvForm({ projectId: '', description: '', amountCents: 0 });
      fetchPlusValues();
    } catch (e) {
      setActionError(errorMessage(e, t('errors.createPlusValue')));
    } finally {
      setPvCreating(false);
    }
  };

  /* --- Plus-value status --- */
  const updatePvStatus = async (id: string, status: string) => {
    setActionError('');
    try {
      await apiPatch(`/invoices/plus-values/${id}/status`, { status });
      fetchPlusValues();
    } catch (e) {
      setActionError(errorMessage(e, t('errors.updateStatus')));
    }
  };

  /* --- Line helpers --- */
  const addLine = () => {
    setCreateLines(prev => [...prev, { description: '', unit: 'u', quantity: 1, unitPriceCents: 0 }]);
  };

  const removeLine = (idx: number) => {
    setCreateLines(prev => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: keyof InvoiceLine, value: any) => {
    setCreateLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  /* --- Computed: the create form's preview --- */
  // Mirrors InvoicingService.createInvoice: offer positions bill the period quantity, free lines
  // quantity × price. The acomptes not yet deducted come off a situation AND off the final invoice
  // (invoicing.service.ts: `if (dto.type === 'situation' || isFinal)`), so both deduct them here.
  const lineTotal = (l: InvoiceLine): number => Math.round(l.quantity * l.unitPriceCents);
  const subtotalHt = freeLines.reduce((sum, l) => sum + lineTotal(l), 0)
    + billedRows.reduce((sum, r) => sum + r.total, 0);
  const vatRate = parseFloat(createForm.vatRate) || 8.10;
  const vatAmount = swissRound(Math.round(subtotalHt * Math.round(vatRate * 100) / 10000));
  // Always the server's own figure, from the preview of the very document being created — the
  // situation preview or the final invoice's — never one computed here. Until that preview
  // answers, the amount is unknown: the total then does not deduct it and says so.
  const acomptesAreDeducted = isSituation || isFinal;
  const acomptesPreview = isSituation ? situationPreview : isFinal ? finalPreview : null;
  const priorAcomptes = acomptesPreview?.acomptesToDeductCents ?? 0;
  const priorAcomptesKnown = acomptesAreDeducted && acomptesPreview != null;
  // NO RETENTION LINE HERE, ON PURPOSE. The server applies the rate of the project's contract,
  // falling back to the company default (invoicing.service.ts: `dto.retentionRate ??
  // contract.retention_rate ?? company.defaultRetentionRate`), and an acompte or a final invoice
  // holds none at all. Neither rate is in the data this page loads (/projects, /clients,
  // situation-preview), so the only way to show the line would be to hardcode 5 %, which is what
  // this preview used to do — and why it disagreed with the invoice the server then created.
  // Nor does the final invoice's retention release belong in the figure: the server computes what
  // the project still holds. So this total is provisional on every document that moves the
  // retention — before it is withheld, or before it is released — and the label says which.
  // Only an acompte, which neither withholds nor releases nor deducts, shows a plain Total TTC.
  const provisionalTotal = swissRound(subtotalHt + vatAmount - priorAcomptes);
  const retentionIsWithheld = createForm.type === 'invoice' || createForm.type === 'situation';

  const filteredInvoices = searchTerm
    ? invoices.filter(inv => inv.invoiceNumber?.toLowerCase().includes(searchTerm.toLowerCase()))
    : invoices;
  /** Tells "nothing here yet" apart from "nothing matches what you asked for". */
  const filtersActive = statusFilter !== 'all' || typeFilter !== '' || searchTerm.trim() !== '';

  /* ------------------------------------------------------------------ */
  /*  Create-invoice dialog (shared by both renders below)              */
  /* ------------------------------------------------------------------ */

  const createDialog = (
    <Dialog open={showCreate} onOpenChange={setShowCreate}>
      <DialogContent className="w-[min(1040px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>{t('form.createTitle')}</DialogTitle>
          <DialogDescription>{t('form.help')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('form.project')} htmlFor="invoice-project" required>
              <Select
                id="invoice-project"
                value={createForm.projectId}
                onChange={e => handleProjectChange(e.target.value)}
              >
                <option value="">{t('form.selectProject')}</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label={t('form.client')} htmlFor="invoice-client" required>
              <Select
                id="invoice-client"
                value={createForm.clientId}
                onChange={e => setCreateForm(f => ({ ...f, clientId: e.target.value }))}
              >
                <option value="">{t('form.selectClient')}</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label={t('form.type')} htmlFor="invoice-type">
              <Select
                id="invoice-type"
                value={createForm.type}
                onChange={e => setCreateForm(f => ({ ...f, type: e.target.value as Invoice['type'] }))}
              >
                <option value="invoice">{enumLabel('invoiceType', 'invoice')}</option>
                <option value="situation">{enumLabel('invoiceType', 'situation')}</option>
                <option value="acompte">{enumLabel('invoiceType', 'acompte')}</option>
                <option value="final_invoice">{enumLabel('invoiceType', 'final_invoice')}</option>
              </Select>
            </Field>
            <Field label={t('form.vatRate')} htmlFor="invoice-vat">
              <Input
                id="invoice-vat"
                type="number"
                step="0.01"
                inputMode="decimal"
                className="tnum text-right"
                value={createForm.vatRate}
                onChange={e => setCreateForm(f => ({ ...f, vatRate: e.target.value }))}
              />
            </Field>
          </div>

          {/* Situation: offer positions with the server's previously billed quantities */}
          {isSituation ? (
            <div className="grid gap-2">
              <div className="grid gap-1">
                <h3 className="text-[13px] font-semibold text-ink">
                  {situationPreview
                    ? t('form.situationTitle', { number: situationPreview.situationNumber })
                    : t('form.situationPositions')}
                </h3>
                <p className="text-xs text-muted">{t('form.situationHint')}</p>
              </div>
              {!createForm.projectId ? (
                <p className="text-[13px] text-muted">{t('form.situationSelectProject')}</p>
              ) : (
                <div className="overflow-hidden rounded-card border border-line">
                  <DataState
                    isLoading={situationLoading}
                    error={situationError || null}
                    onRetry={() => setSituationReload(n => n + 1)}
                    isEmpty={situationRows.length === 0}
                    loading={<TableSkeleton rows={3} cols={5} />}
                    empty={
                      <EmptyState
                        title={t('state.noPositionsTitle')}
                        description={t('state.noPositions')}
                      />
                    }
                  >
                    <TableWrap>
                      <Table>
                        <THead>
                          <tr>
                            <TH className="w-12">{t('table.position')}</TH>
                            <TH>{t('table.description')}</TH>
                            <TH className="w-16">{t('table.unit')}</TH>
                            <TH numeric>{t('table.offerQuantity')}</TH>
                            <TH numeric>{t('table.unitPriceChf')}</TH>
                            <TH numeric>{t('table.previouslyInvoiced')}</TH>
                            <TH numeric>{t('table.cumulativeQuantity')}</TH>
                            <TH numeric>{t('table.periodQuantity')}</TH>
                            <TH numeric>{t('table.budgetPercent')}</TH>
                            <TH numeric>{t('table.totalChf')}</TH>
                          </tr>
                        </THead>
                        <TBody>
                          {situationRows.map(({ position: p, cumulative, period, total }) => {
                            const executed = cumulative ?? p.previousQuantity;
                            const belowPrevious = cumulative != null && roundQuantity(cumulative) < p.previousQuantity;
                            const overBudget = Number.isFinite(executed) && executed > p.offerQuantity;
                            return (
                              <TR key={p.offerLineId}>
                                <TD className="tnum text-muted">{p.positionNumber}</TD>
                                <TD className="min-w-[180px] max-w-[280px]">{p.description}</TD>
                                <TD className="text-muted">{p.unit || '—'}</TD>
                                <TD numeric>{formatNumber(p.offerQuantity)}</TD>
                                <TD numeric>
                                  {p.unitPriceCents == null ? (
                                    <Tag tone="warn">{t('form.unpriced')}</Tag>
                                  ) : (
                                    formatAmount(p.unitPriceCents)
                                  )}
                                </TD>
                                <TD numeric className="text-muted">{formatNumber(p.previousQuantity)}</TD>
                                <TD numeric>
                                  <Input
                                    type="number"
                                    min={p.previousQuantity}
                                    step="any"
                                    disabled={p.unitPriceCents == null}
                                    aria-label={t('table.cumulativeQuantity')}
                                    aria-invalid={belowPrevious || undefined}
                                    placeholder={String(p.previousQuantity)}
                                    className={cn(
                                      'tnum h-8 w-24 text-right',
                                      belowPrevious && 'border-bad focus:border-bad focus:ring-bad/15',
                                    )}
                                    value={cumulativeInputs[p.offerLineId] ?? ''}
                                    onChange={e => setCumulativeInputs(prev => ({ ...prev, [p.offerLineId]: e.target.value }))}
                                  />
                                </TD>
                                <TD numeric className={belowPrevious ? 'text-bad' : 'text-muted'}>
                                  {cumulative == null ? '—' : formatNumber(period)}
                                </TD>
                                <TD numeric className={overBudget ? 'text-warn' : 'text-muted'}>
                                  {p.offerQuantity > 0 && Number.isFinite(executed)
                                    ? `${Math.round((executed / p.offerQuantity) * 100)} %`
                                    : '—'}
                                </TD>
                                <TD numeric className="font-medium">
                                  {cumulative == null ? '—' : formatAmount(total)}
                                </TD>
                              </TR>
                            );
                          })}
                        </TBody>
                      </Table>
                    </TableWrap>
                  </DataState>
                </div>
              )}
            </div>
          ) : null}

          {/* Free lines */}
          <div className="grid gap-2">
            <h3 className="text-[13px] font-semibold text-ink">
              {isSituation ? t('form.extraLines') : t('form.lines')}
            </h3>
            <div className="overflow-hidden rounded-card border border-line">
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <TH>{t('table.description')}</TH>
                      <TH className="w-20">{t('table.unit')}</TH>
                      <TH numeric>{t('table.quantity')}</TH>
                      <TH numeric>{t('table.unitPriceChf')}</TH>
                      <TH numeric>{t('table.totalChf')}</TH>
                      <TH className="w-11">
                        <span className="sr-only">{t('table.actions')}</span>
                      </TH>
                    </tr>
                  </THead>
                  <TBody>
                    {createLines.map((line, idx) => (
                      <TR key={idx}>
                        <TD>
                          <Input
                            className="h-8 min-w-[160px]"
                            aria-label={t('table.description')}
                            placeholder={t('form.descriptionPlaceholder')}
                            value={line.description}
                            onChange={e => updateLine(idx, 'description', e.target.value)}
                          />
                        </TD>
                        <TD>
                          <Input
                            className="h-8 w-16 text-center"
                            aria-label={t('table.unit')}
                            value={line.unit}
                            onChange={e => updateLine(idx, 'unit', e.target.value)}
                          />
                        </TD>
                        <TD numeric>
                          <Input
                            type="number"
                            step="any"
                            className="tnum h-8 w-20 text-right"
                            aria-label={t('table.quantity')}
                            value={line.quantity}
                            onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                          />
                        </TD>
                        <TD numeric>
                          <Input
                            type="number"
                            step="0.05"
                            inputMode="decimal"
                            className="tnum h-8 w-28 text-right"
                            aria-label={t('table.unitPriceChf')}
                            value={line.unitPriceCents / 100 || ''}
                            onChange={e => updateLine(idx, 'unitPriceCents', Math.round(parseFloat(e.target.value || '0') * 100))}
                          />
                        </TD>
                        <TD numeric className="font-medium">{formatAmount(lineTotal(line))}</TD>
                        <TD>
                          {createLines.length > 1 || isSituation ? (
                            <Button
                              variant="quiet"
                              size="iconSm"
                              aria-label={t('actions.removeLine')}
                              onClick={() => removeLine(idx)}
                            >
                              <Trash2 />
                            </Button>
                          ) : null}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
              <CardFooter>
                <Button variant="ghost" size="sm" onClick={addLine}>
                  <Plus />
                  {t('actions.addLine')}
                </Button>
              </CardFooter>
            </div>
          </div>

          {/* Totals preview */}
          <div className="ml-auto grid w-full max-w-[340px] gap-2 rounded-card border border-line bg-paper-2 p-3.5">
            <dl className="grid gap-2">
              <SummaryRow label={t('summary.subtotalHt')} value={formatMoney(subtotalHt)} />
              <SummaryRow label={t('summary.vat', { rate: vatRate.toFixed(2) })} value={formatMoney(vatAmount)} />
              {acomptesAreDeducted ? (
                <SummaryRow
                  label={t('summary.priorAcomptes')}
                  value={
                    priorAcomptesKnown
                      ? formatMoney(priorAcomptes === 0 ? 0 : -priorAcomptes)
                      : '—'
                  }
                />
              ) : null}
            </dl>
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2.5">
              <span className="text-[13px] font-medium text-ink">
                {retentionIsWithheld
                  ? t('summary.totalBeforeRetention')
                  : isFinal
                    ? t('summary.totalBeforeRelease')
                    : t('summary.totalTtc')}
              </span>
              <span className="tnum text-[19px] font-semibold tracking-[-0.01em]">
                {formatMoney(provisionalTotal)}
              </span>
            </div>
            {retentionIsWithheld ? (
              <p className="text-xs text-muted">{t('summary.retentionNote')}</p>
            ) : null}
            {isFinal ? (
              <p className="text-xs text-muted">{t('summary.finalReleaseNote')}</p>
            ) : null}
            {acomptesAreDeducted && !priorAcomptesKnown ? (
              <p className="text-xs text-muted">{t('summary.acomptesPendingNote')}</p>
            ) : null}
            {finalError ? (
              <p role="alert" className="text-[13px] text-bad">{finalError}</p>
            ) : null}
          </div>

          <Field label={t('form.notes')} htmlFor="invoice-notes">
            <Textarea
              id="invoice-notes"
              value={createForm.notes}
              onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
            />
          </Field>

          {createError ? (
            <p role="alert" className="text-[13px] text-bad">{createError}</p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowCreate(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button variant="primary" disabled={creating} onClick={handleCreate}>
            {creating ? t('actions.creating') : t('actions.createInvoice')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  /* ------------------------------------------------------------------ */
  /*  Render: detail view                                               */
  /* ------------------------------------------------------------------ */

  if (selectedId) {
    const inv = detail;
    const lines = inv?.lines ?? [];
    const payments = inv?.payments ?? [];
    const paidPct = inv && inv.totalTtcCents > 0
      ? Math.min(100, Math.round(((inv.amountPaidCents ?? 0) / inv.totalTtcCents) * 100))
      : 0;
    const retention = inv?.retentionAmountCents ?? 0;
    const prior = inv?.priorAcomptesCents ?? 0;
    const isCreditNote = inv?.type === 'credit_note';
    const canPay = inv != null && !isCreditNote && PAYABLE_STATUSES.has(inv.status);
    const canCredit = inv != null && !isCreditNote && !['draft', 'cancelled'].includes(inv.status);
    const situationColumns = inv?.type === 'situation';

    return (
      <PageBody>
        <div>
          <Button variant="quiet" size="sm" onClick={closeDetail}>
            <ArrowLeft />
            {t('actions.backToList')}
          </Button>
        </div>

        <PageHeader
          kicker={t('common:nav.invoices')}
          title={inv?.invoiceNumber || t('detail.fallbackTitle')}
          meta={
            inv ? (
              <>
                <span>{inv.client?.name ?? '—'}</span>
                <MetaDivider />
                <span>{inv.project?.name || inv.projectId}</span>
                <MetaDivider />
                <Tag tone={typeTone(inv.type)}>{typeLabel(inv, t)}</Tag>
                <InvoiceState invoice={inv} />
              </>
            ) : undefined
          }
          actions={
            inv ? (
              <>
                {canPay ? (
                  <Button variant="primary" onClick={openPayment}>
                    <Plus />
                    {t('actions.recordPayment')}
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t('actions.moreActions')}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => void downloadPdf(inv.id)}>
                      <Download />
                      {t('actions.downloadPdf')}
                    </DropdownMenuItem>
                    {inv.status === 'draft' && !isCreditNote ? (
                      <DropdownMenuItem onSelect={() => void changeStatus(inv.id, 'sent')}>
                        <Send />
                        {t('actions.markSent')}
                      </DropdownMenuItem>
                    ) : null}
                    {(inv.status === 'sent' || inv.status === 'partially_paid') && !isCreditNote ? (
                      <DropdownMenuItem onSelect={() => void changeStatus(inv.id, 'overdue')}>
                        <Clock />
                        {t('actions.markOverdue')}
                      </DropdownMenuItem>
                    ) : null}
                    {canCredit ? (
                      <DropdownMenuItem className="text-bad" onSelect={() => void createCreditNote(inv)}>
                        <FileMinus2 />
                        {t('actions.creditNote')}
                      </DropdownMenuItem>
                    ) : null}
                    {/* A draft is voided, not credited: the server refuses `cancelled` on anything
                        issued, and a credit note on a draft. */}
                    {inv.status === 'draft' && !isCreditNote ? (
                      <DropdownMenuItem className="text-bad" onSelect={() => void cancelInvoice(inv)}>
                        <Ban />
                        {t('actions.cancelInvoice')}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : undefined
          }
        />

        {actionError ? (
          <p role="alert" className="text-[13px] text-bad">{actionError}</p>
        ) : null}

        {inv ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid min-w-0 content-start gap-5">
              {/* Lines */}
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t('detail.lines')}
                    <CardCount>({lines.length})</CardCount>
                  </CardTitle>
                </CardHeader>
                <DataState
                  isLoading={detailLoading}
                  isEmpty={lines.length === 0}
                  loading={<TableSkeleton rows={4} cols={5} />}
                  empty={<EmptyState title={t('detail.noLines')} description={t('detail.noLinesHelp')} />}
                >
                  <TableWrap>
                    <Table>
                      <THead>
                        <tr>
                          <TH>{t('table.description')}</TH>
                          <TH className="w-16">{t('table.unit')}</TH>
                          <TH numeric>
                            {situationColumns ? t('table.offerQuantity') : t('table.quantity')}
                          </TH>
                          <TH numeric>{t('table.unitPriceChf')}</TH>
                          <TH numeric>{t('table.totalChf')}</TH>
                          {situationColumns ? (
                            <>
                              <TH numeric>{t('table.cumulativeQuantity')}</TH>
                              <TH numeric>{t('table.previousQuantity')}</TH>
                              <TH numeric>{t('table.periodQuantity')}</TH>
                              <TH numeric>{t('table.budgetPercent')}</TH>
                            </>
                          ) : null}
                        </tr>
                      </THead>
                      <TBody>
                        {lines.map((line, i) => (
                          <TR key={line.id || i}>
                            <TD className="min-w-[180px] max-w-[320px]">{line.description}</TD>
                            <TD className="text-muted">{line.unit || '—'}</TD>
                            <TD numeric>{formatNumber(line.quantity)}</TD>
                            <TD numeric>{formatAmount(line.unitPriceCents)}</TD>
                            <TD numeric className="font-medium">
                              {formatAmount(line.totalPriceCents ?? line.quantity * line.unitPriceCents)}
                            </TD>
                            {situationColumns ? (
                              <>
                                <TD numeric>{formatNumber(line.cumulativeQuantity)}</TD>
                                <TD numeric className="text-muted">{formatNumber(line.previousQuantity)}</TD>
                                <TD numeric>{formatNumber(line.periodQuantity)}</TD>
                                <TD numeric className="text-muted">
                                  {line.offerLineId && line.cumulativeQuantity != null && Number(line.quantity) > 0
                                    ? `${Math.round((line.cumulativeQuantity / Number(line.quantity)) * 100)} %`
                                    : '—'}
                                </TD>
                              </>
                            ) : null}
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </TableWrap>
                </DataState>
              </Card>

              {/* Payments */}
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t('detail.payments')}
                    <CardCount>({payments.length})</CardCount>
                  </CardTitle>
                  {canPay ? (
                    <Button variant="ghost" size="sm" onClick={openPayment}>
                      <Plus />
                      {t('actions.recordPayment')}
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent className="grid gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 text-[13px]">
                    <span className="text-muted">
                      {t('detail.paidAmount', { amount: formatMoney(inv.amountPaidCents ?? 0) })}
                    </span>
                    <span className="tnum font-medium">{t('detail.paidPercent', { percent: paidPct })}</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={t('detail.progressLabel')}
                    aria-valuenow={paidPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-2 overflow-hidden rounded-full bg-line-soft"
                  >
                    {/* A bar's width is a runtime value — the one inline style the conventions allow. */}
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-300',
                        paidPct >= 100 ? 'bg-ok' : 'bg-warn',
                      )}
                      style={{ width: `${paidPct}%` }}
                    />
                  </div>
                </CardContent>
                <DataState
                  isLoading={detailLoading}
                  isEmpty={payments.length === 0}
                  loading={<TableSkeleton rows={2} cols={4} />}
                  empty={<EmptyState title={t('detail.noPayments')} description={t('detail.noPaymentsHelp')} />}
                >
                  <TableWrap>
                    <Table>
                      <THead>
                        <tr>
                          <TH>{t('table.date')}</TH>
                          <TH>{t('table.method')}</TH>
                          <TH>{t('table.reference')}</TH>
                          <TH numeric>{t('table.amount')}</TH>
                        </tr>
                      </THead>
                      <TBody>
                        {payments.map(p => (
                          <TR key={p.id}>
                            <TD className="tnum">{formatDate(p.paymentDate)}</TD>
                            <TD>{enumLabel('paymentMethod', p.paymentMethod)}</TD>
                            <TD className="text-muted">{p.reference || '—'}</TD>
                            <TD numeric className="font-medium text-ok">{formatMoney(p.amountCents)}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </TableWrap>
                </DataState>
              </Card>

              {/* Notes */}
              {inv.notes ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('detail.notes')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-line text-[13.5px] text-ink-2">{inv.notes}</p>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            {/* The numbers */}
            <aside className="grid content-start gap-5 lg:sticky lg:top-[calc(var(--spacing-topbar)_+_20px)] lg:self-start">
              <Card>
                <CardHeader>
                  <CardTitle>{t('detail.summaryTitle')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-1">
                    <span className="text-xs text-muted">{t('summary.totalTtc')}</span>
                    <span className="tnum text-[26px] font-semibold leading-none tracking-[-0.01em]">
                      {formatMoney(inv.totalTtcCents)}
                    </span>
                  </div>

                  <dl className="grid gap-2 border-t border-line-soft pt-3.5">
                    <SummaryRow label={t('summary.subtotalHt')} value={formatMoney(inv.subtotalHtCents)} />
                    <SummaryRow
                      label={t('summary.vat', { rate: (inv.vatRate / 100).toFixed(2) })}
                      value={formatMoney(inv.vatAmountCents)}
                    />
                    {/* The server's own amount, in its effect on the total: withheld, or released
                        by the final invoice (a negative retention). The rate is not stored on the
                        invoice, so only the amount is shown. */}
                    <SummaryRow
                      label={retention < 0 ? t('summary.retentionReleased') : t('summary.retention')}
                      value={formatMoney(retention === 0 ? 0 : -retention)}
                    />
                    {prior !== 0 ? (
                      <SummaryRow label={t('summary.priorAcomptes')} value={formatMoney(-prior)} />
                    ) : null}
                    <SummaryRow label={t('detail.issueDate')} value={formatDate(inv.issueDate)} />
                    <SummaryRow label={t('detail.dueDate')} value={formatDate(inv.dueDate)} />
                  </dl>
                </CardContent>
              </Card>
            </aside>
          </div>
        ) : (
          /* No invoice yet: DataState decides between loading, a failed load and "not found". */
          <Card>
            <DataState
              isLoading={detailLoading}
              error={detailError || null}
              onRetry={() => void loadDetail(selectedId)}
              isEmpty
              loading={<TableSkeleton rows={4} cols={3} />}
              empty={<EmptyState title={t('detail.notFound')} description={t('detail.notFoundHelp')} />}
            >
              {null}
            </DataState>
          </Card>
        )}

        {/* Record a payment */}
        <Dialog open={showPayment} onOpenChange={setShowPayment}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('payment.title')}</DialogTitle>
              <DialogDescription>{t('payment.help')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('payment.amount')} htmlFor="payment-amount" required>
                  <Input
                    id="payment-amount"
                    type="number"
                    step="0.05"
                    inputMode="decimal"
                    className="tnum text-right"
                    value={paymentForm.amountCents / 100 || ''}
                    onChange={e => setPaymentForm(f => ({ ...f, amountCents: Math.round(parseFloat(e.target.value || '0') * 100) }))}
                  />
                </Field>
                <Field label={t('payment.date')} htmlFor="payment-date" required>
                  <Input
                    id="payment-date"
                    type="date"
                    value={paymentForm.paymentDate}
                    onChange={e => setPaymentForm(f => ({ ...f, paymentDate: e.target.value }))}
                  />
                </Field>
                <Field label={t('payment.method')} htmlFor="payment-method">
                  <Select
                    id="payment-method"
                    value={paymentForm.paymentMethod}
                    onChange={e => setPaymentForm(f => ({ ...f, paymentMethod: e.target.value }))}
                  >
                    {PAYMENT_METHODS.map(m => (
                      <option key={m} value={m}>{enumLabel('paymentMethod', m)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('payment.reference')} htmlFor="payment-reference">
                  <Input
                    id="payment-reference"
                    value={paymentForm.reference}
                    onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))}
                  />
                </Field>
              </div>
              {paymentError ? (
                <p role="alert" className="text-[13px] text-bad">{paymentError}</p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowPayment(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button variant="primary" disabled={savingPayment} onClick={recordPayment}>
                {savingPayment ? t('common:actions.saving') : t('actions.savePayment')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {createDialog}
      </PageBody>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Render: list view                                                 */
  /* ------------------------------------------------------------------ */

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        kicker={t('common:navGroup.finance')}
        meta={<span>{t('subtitle')}</span>}
        actions={
          activeSection === 'invoices' ? (
            <Button
              variant="primary"
              onClick={() => { setCreateError(''); setShowCreate(true); }}
            >
              <Plus />
              {t('actions.newInvoice')}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setShowPvCreate(true)}>
              <Plus />
              {t('actions.newPlusValue')}
            </Button>
          )
        }
      />

      {actionError ? (
        <p role="alert" className="text-[13px] text-bad">{actionError}</p>
      ) : null}

      <Tabs
        value={activeSection}
        onValueChange={value => setActiveSection(value as Section)}
        className="grid gap-5"
      >
        <TabsList aria-label={t('tabs.label')}>
          <TabsTrigger value="invoices">{t('tabs.invoices')}</TabsTrigger>
          <TabsTrigger value="plus-values">{t('tabs.plusValues')}</TabsTrigger>
        </TabsList>

        {/* ---------------- Invoices ---------------- */}
        <TabsContent value="invoices">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft p-3">
              <div className="flex flex-wrap gap-0.5" role="group" aria-label={t('filters.status')}>
                {STATUS_TABS.map(value => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={statusFilter === value}
                    onClick={() => { setStatusFilter(value); setPage(1); }}
                    className={cn(
                      'rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:text-ink',
                      statusFilter === value && 'bg-chalk font-medium text-ink',
                    )}
                  >
                    {value === 'all' ? t('filters.allStatuses') : statusLabel('invoice', value)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  className="w-[170px]"
                  aria-label={t('filters.type')}
                  value={typeFilter}
                  onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
                >
                  <option value="">{t('filters.allTypes')}</option>
                  {INVOICE_TYPES.map(k => (
                    <option key={k} value={k}>{enumLabel('invoiceType', k)}</option>
                  ))}
                </Select>
                <SearchInput
                  icon={<Search className="size-4" />}
                  placeholder={t('filters.searchPlaceholder')}
                  aria-label={t('filters.searchPlaceholder')}
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <DataState
              isLoading={loading}
              error={listError || null}
              onRetry={() => void fetchInvoices()}
              isEmpty={filteredInvoices.length === 0}
              loading={<TableSkeleton rows={6} cols={6} />}
              empty={
                filtersActive ? (
                  <EmptyState title={t('state.noMatch')} description={t('state.noMatchHelp')} />
                ) : (
                  <EmptyState
                    title={t('state.noInvoices')}
                    description={t('state.noInvoicesHelp')}
                    action={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setCreateError(''); setShowCreate(true); }}
                      >
                        <Plus />
                        {t('actions.newInvoice')}
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
                      <TH>{t('table.invoiceNumber')}</TH>
                      <TH>{t('table.type')}</TH>
                      <TH>{t('table.client')}</TH>
                      <TH>{t('table.project')}</TH>
                      <TH>{t('table.issueDate')}</TH>
                      <TH numeric>{t('table.totalTtc')}</TH>
                      <TH>{t('table.status')}</TH>
                      <TH numeric>{t('table.paid')}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {filteredInvoices.map(inv => (
                      <TR
                        key={inv.id}
                        muted={inv.status === 'cancelled'}
                        onActivate={() => openDetail(inv.id)}
                      >
                        <TD>
                          <Ref>{inv.invoiceNumber || '—'}</Ref>
                        </TD>
                        <TD>
                          <Tag tone={typeTone(inv.type)}>{typeLabel(inv, t)}</Tag>
                        </TD>
                        <TD>{inv.client?.name || '—'}</TD>
                        <TD>{inv.project?.name || '—'}</TD>
                        <TD className="tnum text-muted">{formatDate(inv.issueDate)}</TD>
                        <TD numeric className="font-medium">{formatMoney(inv.totalTtcCents)}</TD>
                        <TD>
                          <InvoiceState invoice={inv} />
                        </TD>
                        <TD numeric className="text-muted">{formatMoney(inv.amountPaidCents ?? 0)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </DataState>

            {/* Pagination stays reachable even when the filtered page shows nothing. */}
            {loading || listError ? null : (
              <CardFooter>
                <span>{t('summary.rowCount', { count: filteredInvoices.length })}</span>
                {totalPages > 1 ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                    >
                      {t('common:actions.previous')}
                    </Button>
                    <span className="tnum">{t('common:state.page', { page, total: totalPages })}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage(p => p + 1)}
                    >
                      {t('common:actions.next')}
                    </Button>
                  </div>
                ) : null}
              </CardFooter>
            )}
          </Card>
        </TabsContent>

        {/* ---------------- Plus-values ---------------- */}
        <TabsContent value="plus-values">
          <Card>
            <CardHeader>
              <CardTitle>
                {t('plusValues.title')}
                {pvLoading ? null : <CardCount>({plusValues.length})</CardCount>}
              </CardTitle>
            </CardHeader>
            <DataState
              isLoading={pvLoading}
              error={pvError || null}
              onRetry={() => void fetchPlusValues()}
              isEmpty={plusValues.length === 0}
              loading={<TableSkeleton rows={4} cols={4} />}
              empty={
                <EmptyState
                  title={t('state.noPlusValues')}
                  description={t('state.noPlusValuesHelp')}
                  action={
                    <Button variant="ghost" size="sm" onClick={() => setShowPvCreate(true)}>
                      <Plus />
                      {t('actions.newPlusValue')}
                    </Button>
                  }
                />
              }
            >
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <TH>{t('table.project')}</TH>
                      <TH>{t('table.description')}</TH>
                      <TH numeric>{t('table.amount')}</TH>
                      <TH>{t('table.status')}</TH>
                      <TH className="w-11">
                        <span className="sr-only">{t('table.actions')}</span>
                      </TH>
                    </tr>
                  </THead>
                  <TBody>
                    {plusValues.map(pv => (
                      <TR key={pv.id}>
                        <TD>{pv.project?.name || pv.projectId}</TD>
                        <TD className="min-w-[180px] max-w-[380px]">{pv.description}</TD>
                        <TD numeric className="font-medium">{formatMoney(pv.amountCents)}</TD>
                        <TD>
                          <StatusBadge domain="plusValue" value={pv.status} />
                        </TD>
                        <TD>
                          {pv.status === 'detected' || pv.status === 'submitted' ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="iconSm"
                                  aria-label={t('plusValues.rowActions')}
                                >
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                {pv.status === 'detected' ? (
                                  <DropdownMenuItem onSelect={() => void updatePvStatus(pv.id, 'submitted')}>
                                    <Send />
                                    {t('plusValues.submit')}
                                  </DropdownMenuItem>
                                ) : (
                                  <>
                                    <DropdownMenuItem onSelect={() => void updatePvStatus(pv.id, 'approved')}>
                                      <Check />
                                      {t('plusValues.approve')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-bad"
                                      onSelect={() => void updatePvStatus(pv.id, 'rejected')}
                                    >
                                      <X />
                                      {t('plusValues.reject')}
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
              <CardFooter>
                <span>{t('plusValues.rowCount', { count: plusValues.length })}</span>
              </CardFooter>
            </DataState>
          </Card>
        </TabsContent>
      </Tabs>

      {createDialog}

      {/* Create a plus-value */}
      <Dialog open={showPvCreate} onOpenChange={setShowPvCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('plusValues.createTitle')}</DialogTitle>
            <DialogDescription>{t('plusValues.help')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('plusValues.project')} htmlFor="pv-project" required>
              <Select
                id="pv-project"
                value={pvForm.projectId}
                onChange={e => setPvForm(f => ({ ...f, projectId: e.target.value }))}
              >
                <option value="">{t('plusValues.selectProject')}</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label={t('plusValues.description')} htmlFor="pv-description" required>
              <Input
                id="pv-description"
                value={pvForm.description}
                onChange={e => setPvForm(f => ({ ...f, description: e.target.value }))}
              />
            </Field>
            <Field label={t('plusValues.amount')} htmlFor="pv-amount" required>
              <Input
                id="pv-amount"
                type="number"
                step="0.05"
                inputMode="decimal"
                className="tnum text-right"
                value={pvForm.amountCents / 100 || ''}
                onChange={e => setPvForm(f => ({ ...f, amountCents: Math.round(parseFloat(e.target.value || '0') * 100) }))}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowPvCreate(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={pvCreating}
              blockedReason={pvFormValid ? undefined : t('plusValues.incomplete')}
              onClick={createPlusValue}
            >
              {pvCreating ? t('actions.creating') : t('common:actions.create')}
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
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="tnum text-[13px] font-medium text-ink">{value}</dd>
    </div>
  );
}
