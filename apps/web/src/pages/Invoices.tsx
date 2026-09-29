import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiList, apiPost, apiPatch, apiDownload } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { enumLabel, formatDate, formatMoney, statusLabel } from '../lib/format';

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
  cumulativeQuantity?: number;
  previousQuantity?: number;
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

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  invoice: { bg: '#dbeafe', fg: '#1d4ed8' },
  situation: { bg: '#ede9fe', fg: '#7c3aed' },
  acompte: { bg: '#fef3c7', fg: '#92400e' },
  credit_note: { bg: '#fee2e2', fg: '#dc2626' },
  final_invoice: { bg: '#dcfce7', fg: '#166534' },
};

/** DB CHECK invoice.type */
const INVOICE_TYPES = ['invoice', 'situation', 'acompte', 'credit_note', 'final_invoice'] as const;

const STATUS_COLORS: Record<string, { bg: string; fg: string; strike?: boolean }> = {
  draft: { bg: '#f3f4f6', fg: '#4b5563' },
  sent: { bg: '#dbeafe', fg: '#1d4ed8' },
  paid: { bg: '#dcfce7', fg: '#166534' },
  partially_paid: { bg: '#fef3c7', fg: '#92400e' },
  overdue: { bg: '#fee2e2', fg: '#dc2626' },
  cancelled: { bg: '#f3f4f6', fg: '#9ca3af', strike: true },
};

const STATUS_TABS = ['all', 'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'] as const;

const PV_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  detected: { bg: '#f3f4f6', fg: '#4b5563' },
  submitted: { bg: '#fef3c7', fg: '#92400e' },
  approved: { bg: '#dcfce7', fg: '#166534' },
  rejected: { bg: '#fee2e2', fg: '#991b1b' },
  invoiced: { bg: '#dbeafe', fg: '#1d4ed8' },
};

/** DB CHECK payment.payment_method */
const PAYMENT_METHODS = ['bank_transfer', 'card', 'cash', 'other'] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** "8.10" (percent) → 810 (basis points), as the API expects. */
const percentToBps = (value: string): number => Math.round(parseFloat(value) * 100);

const swissRound = (cents: number): number => Math.round(cents / 5) * 5;

/* ------------------------------------------------------------------ */
/*  Shared styles                                                      */
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

const btnSuccess: React.CSSProperties = {
  ...btnPrimary,
  background: '#16a34a',
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Invoices() {
  const { t } = useTranslation('invoices');
  /* --- State --- */
  const [activeSection, setActiveSection] = useState<'invoices' | 'plus-values'>('invoices');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
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

  // Detail view
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Payment form
  const [showPayment, setShowPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amountCents: 0,
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'bank_transfer',
    reference: '',
  });

  // Plus-values
  const [plusValues, setPlusValues] = useState<PlusValue[]>([]);
  const [pvLoading, setPvLoading] = useState(false);
  const [showPvCreate, setShowPvCreate] = useState(false);
  const [pvForm, setPvForm] = useState({
    projectId: '',
    description: '',
    amountCents: 0,
  });

  /* --- Data loading --- */
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let path = `/invoices?page=${page}`;
      if (statusFilter !== 'all') path += `&status=${statusFilter}`;
      if (typeFilter) path += `&type=${typeFilter}`;
      const { items, meta } = await apiList<Invoice>(path);
      setInvoices(items);
      setTotalPages(Math.max(1, meta?.totalPages ?? 1));
    } catch (e) {
      setError(errorMessage(e, t('errors.loadInvoices')));
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, typeFilter]);

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

  /* --- Plus-values --- */
  const fetchPlusValues = useCallback(async () => {
    setPvLoading(true);
    try {
      const items = await apiGet<PlusValue[]>('/invoices/plus-values?limit=500');
      setPlusValues(Array.isArray(items) ? items : []);
    } catch (e) {
      setError(errorMessage(e, t('errors.loadPlusValues')));
    }
    finally { setPvLoading(false); }
  }, []);

  useEffect(() => {
    if (activeSection === 'plus-values') fetchPlusValues();
  }, [activeSection, fetchPlusValues]);

  /* --- Invoice detail --- */
  const openDetail = async (inv: Invoice) => {
    setDetailLoading(true);
    try {
      const detail = await apiGet<Invoice>(`/invoices/${inv.id}`);
      setSelectedInvoice(detail);
    } catch (e) {
      setError(errorMessage(e, t('errors.loadInvoice')));
    } finally {
      setDetailLoading(false);
    }
  };

  /* --- Create invoice --- */
  const handleCreate = async () => {
    setCreateError('');
    if (!createForm.projectId) { setCreateError(t('validation.projectRequired')); return; }
    if (!createForm.clientId) { setCreateError(t('validation.clientRequired')); return; }
    if (createLines.length === 0) { setCreateError(t('validation.lineRequired')); return; }
    const hasEmpty = createLines.some(l => !l.description.trim() || !Number.isInteger(l.unitPriceCents) || l.unitPriceCents <= 0);
    if (hasEmpty) { setCreateError(t('validation.linesIncomplete')); return; }
    if (createLines.some(l => l.quantity < 0 || (l.cumulativeQuantity ?? 0) < 0 || (l.previousQuantity ?? 0) < 0)) {
      setCreateError(t('validation.negativeQuantity')); return;
    }
    const vatRateBps = percentToBps(createForm.vatRate);
    if (!Number.isFinite(vatRateBps) || vatRateBps < 0 || vatRateBps > 10000) {
      setCreateError(t('validation.vatRange')); return;
    }

    try {
      await apiPost('/invoices', {
        projectId: createForm.projectId,
        clientId: createForm.clientId,
        type: createForm.type,
        vatRate: vatRateBps,
        lines: createLines.map(l => ({
          description: l.description.trim(),
          ...(l.unit.trim() ? { unit: l.unit.trim() } : {}),
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          ...(createForm.type === 'situation' ? {
            cumulativeQuantity: l.cumulativeQuantity ?? 0,
            previousQuantity: l.previousQuantity ?? 0,
          } : {}),
        })),
        ...(createForm.notes.trim() ? { notes: createForm.notes.trim() } : {}),
      });
      setShowCreate(false);
      setCreateForm({ projectId: '', clientId: '', type: 'invoice', vatRate: '8.10', notes: '' });
      setCreateLines([{ description: '', unit: 'u', quantity: 1, unitPriceCents: 0 }]);
      fetchInvoices();
    } catch (e) {
      setCreateError(errorMessage(e, t('errors.createInvoice')));
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
    try {
      await apiPatch(`/invoices/${id}/status`, { status });
      fetchInvoices();
      if (selectedInvoice?.id === id) {
        openDetail(selectedInvoice);
      }
    } catch (e) {
      setError(errorMessage(e, t('errors.updateStatus')));
    }
  };

  /* --- PDF --- */
  const downloadPdf = async (id: string) => {
    try {
      await apiDownload(`/invoices/${id}/pdf`);
    } catch (e) {
      setError(errorMessage(e, t('errors.downloadPdf')));
    }
  };

  /* --- Credit note --- */
  const createCreditNote = async (id: string) => {
    if (!confirm(t('confirm.creditNote'))) return;
    try {
      await apiPost(`/invoices/${id}/credit-note`);
      fetchInvoices();
      setSelectedInvoice(null);
    } catch (e) {
      setError(errorMessage(e, t('errors.createCreditNote')));
    }
  };

  /* --- Record payment --- */
  const recordPayment = async () => {
    if (!selectedInvoice) return;
    if (!Number.isInteger(paymentForm.amountCents) || paymentForm.amountCents <= 0) {
      setError(t('validation.paymentAmount')); return;
    }
    if (!paymentForm.paymentDate) { setError(t('validation.paymentDate')); return; }
    try {
      await apiPost(`/invoices/${selectedInvoice.id}/payments`, {
        amountCents: paymentForm.amountCents,
        paymentDate: paymentForm.paymentDate,
        paymentMethod: paymentForm.paymentMethod,
        ...(paymentForm.reference.trim() ? { reference: paymentForm.reference.trim() } : {}),
      });
      setShowPayment(false);
      setPaymentForm({ amountCents: 0, paymentDate: new Date().toISOString().slice(0, 10), paymentMethod: 'bank_transfer', reference: '' });
      openDetail(selectedInvoice);
      fetchInvoices();
    } catch (e) {
      setError(errorMessage(e, t('errors.recordPayment')));
    }
  };

  /* --- Plus-value create --- */
  const createPlusValue = async () => {
    if (!pvForm.projectId || !pvForm.description.trim() || !Number.isInteger(pvForm.amountCents) || pvForm.amountCents <= 0) return;
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
      setError(errorMessage(e, t('errors.createPlusValue')));
    }
  };

  /* --- Plus-value status --- */
  const updatePvStatus = async (id: string, status: string) => {
    try {
      await apiPatch(`/invoices/plus-values/${id}/status`, { status });
      fetchPlusValues();
    } catch (e) {
      setError(errorMessage(e, t('errors.updateStatus')));
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

  /* --- Computed --- */
  // Preview mirrors InvoicingService.createInvoice (situation lines bill the period quantity).
  const lineTotal = (l: InvoiceLine): number =>
    createForm.type === 'situation'
      ? Math.round(((l.cumulativeQuantity ?? 0) - (l.previousQuantity ?? 0)) * l.unitPriceCents)
      : Math.round(l.quantity * l.unitPriceCents);
  const subtotalHt = createLines.reduce((sum, l) => sum + lineTotal(l), 0);
  const vatRate = parseFloat(createForm.vatRate) || 8.10;
  const vatAmount = swissRound(Math.round(subtotalHt * Math.round(vatRate * 100) / 10000));
  const retentionAmount = swissRound(Math.round(subtotalHt * 500 / 10000));
  const totalTtc = swissRound(subtotalHt + vatAmount - retentionAmount);

  const filteredInvoices = searchTerm
    ? invoices.filter(inv => inv.invoiceNumber?.toLowerCase().includes(searchTerm.toLowerCase()))
    : invoices;

  /* ------------------------------------------------------------------ */
  /*  Render: Detail view                                               */
  /* ------------------------------------------------------------------ */

  if (selectedInvoice) {
    const inv = selectedInvoice;
    const paidPct = inv.totalTtcCents > 0 ? Math.min(100, Math.round(((inv.amountPaidCents ?? 0) / inv.totalTtcCents) * 100)) : 0;

    return (
      <div>
        {/* Back button */}
        <button onClick={() => setSelectedInvoice(null)} style={{ ...btnOutline, marginBottom: 16 }}>
          {t('actions.backToList')}
        </button>

        {detailLoading && <p style={{ color: '#6b7280' }}>{t('common:state.loading')}</p>}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#111827' }}>
              {inv.invoiceNumber || t('detail.fallbackTitle')}
            </h1>
            <div style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
              {inv.client?.name} &middot; {inv.project?.name || inv.projectId}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Badge color={TYPE_COLORS[inv.type]}>{enumLabel('invoiceType', inv.type)}</Badge>
            <Badge color={STATUS_COLORS[inv.status]} strike={STATUS_COLORS[inv.status]?.strike}>
              {statusLabel('invoice', inv.status)}
            </Badge>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <SummaryCard label={t('summary.subtotalHt')} value={formatMoney(inv.subtotalHtCents)} />
          <SummaryCard label={t('summary.vat', { rate: (inv.vatRate / 100).toFixed(2) })} value={formatMoney(inv.vatAmountCents)} />
          <SummaryCard label={t('summary.retention')} value={`- ${formatMoney(inv.retentionAmountCents ?? 0)}`} />
          <div style={{
            background: '#f0f9ff', borderRadius: 8, padding: 16, border: '1px solid #bae6fd',
          }}>
            <div style={{ fontSize: 12, color: '#0369a1', fontWeight: 600, textTransform: 'uppercase' }}>{t('summary.totalTtc')}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#111827', marginTop: 4 }}>{formatMoney(inv.totalTtcCents)}</div>
          </div>
        </div>

        {/* Info row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          <InfoField label={t('detail.issueDate')} value={formatDate(inv.issueDate)} />
          <InfoField label={t('detail.dueDate')} value={formatDate(inv.dueDate)} />
          <InfoField label={t('detail.notes')} value={inv.notes || '-'} />
        </div>

        {/* Lines table */}
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 8 }}>{t('detail.lines')}</h3>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={thStyle}>{t('table.description')}</th>
                <th style={thStyle}>{t('table.unit')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t('table.quantity')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t('table.unitPrice')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t('table.total')}</th>
                {inv.type === 'situation' && (
                  <>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{t('table.cumulativeQuantity')}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{t('table.previousQuantity')}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {(inv.lines || []).map((line, i) => (
                <tr key={line.id || i}>
                  <td style={tdStyle}>{line.description}</td>
                  <td style={tdStyle}>{line.unit}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{line.quantity}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{formatMoney(line.unitPriceCents)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                    {formatMoney(line.totalPriceCents ?? line.quantity * line.unitPriceCents)}
                  </td>
                  {inv.type === 'situation' && (
                    <>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{line.cumulativeQuantity ?? '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{line.previousQuantity ?? '-'}</td>
                    </>
                  )}
                </tr>
              ))}
              {(!inv.lines || inv.lines.length === 0) && (
                <tr><td style={{ ...tdStyle, textAlign: 'center', color: '#9ca3af' }} colSpan={5}>{t('detail.noLines')}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Payment progress */}
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 8 }}>{t('detail.payments')}</h3>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
            <span>{t('detail.paidAmount', { amount: formatMoney(inv.amountPaidCents ?? 0) })}</span>
            <span>{t('detail.paidPercent', { percent: paidPct })}</span>
          </div>
          <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${paidPct}%`,
              height: '100%',
              background: paidPct >= 100 ? '#16a34a' : paidPct > 0 ? '#f59e0b' : '#e5e7eb',
              borderRadius: 4,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>

        {/* Payment history */}
        {(inv.payments && inv.payments.length > 0) && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: '#f9fafb' }}>
                <tr>
                  <th style={thStyle}>{t('table.date')}</th>
                  <th style={thStyle}>{t('table.method')}</th>
                  <th style={thStyle}>{t('table.reference')}</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>{t('table.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {inv.payments.map(p => (
                  <tr key={p.id}>
                    <td style={tdStyle}>{formatDate(p.paymentDate)}</td>
                    <td style={tdStyle}>{enumLabel('paymentMethod', p.paymentMethod)}</td>
                    <td style={tdStyle}>{p.reference || '-'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>
                      {formatMoney(p.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Record payment form */}
        {showPayment && (
          <div style={{ background: '#f9fafb', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #e5e7eb' }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>{t('payment.title')}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('payment.amount')}</label>
                <input
                  type="number"
                  step="0.05"
                  style={inputStyle}
                  value={paymentForm.amountCents / 100 || ''}
                  onChange={e => setPaymentForm(f => ({ ...f, amountCents: Math.round(parseFloat(e.target.value || '0') * 100) }))}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('payment.date')}</label>
                <input
                  type="date"
                  style={inputStyle}
                  value={paymentForm.paymentDate}
                  onChange={e => setPaymentForm(f => ({ ...f, paymentDate: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('payment.method')}</label>
                <select
                  style={inputStyle}
                  value={paymentForm.paymentMethod}
                  onChange={e => setPaymentForm(f => ({ ...f, paymentMethod: e.target.value }))}
                >
                  {PAYMENT_METHODS.map(m => (
                    <option key={m} value={m}>{enumLabel('paymentMethod', m)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('payment.reference')}</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={paymentForm.reference}
                  onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button style={btnSuccess} onClick={recordPayment}>{t('actions.savePayment')}</button>
              <button style={btnOutline} onClick={() => setShowPayment(false)}>{t('common:actions.cancel')}</button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button style={btnOutline} onClick={() => downloadPdf(inv.id)}>
            {t('actions.downloadPdf')}
          </button>
          {!showPayment && inv.type !== 'credit_note' && ['sent', 'partially_paid', 'overdue'].includes(inv.status) && (
            <button style={btnPrimary} onClick={() => setShowPayment(true)}>{t('actions.recordPayment')}</button>
          )}
          {inv.status === 'draft' && (
            <button style={{ ...btnPrimary, background: '#0ea5e9' }} onClick={() => changeStatus(inv.id, 'sent')}>
              {t('actions.markSent')}
            </button>
          )}
          {(inv.status === 'sent' || inv.status === 'partially_paid') && (
            <button style={{ ...btnPrimary, background: '#f59e0b' }} onClick={() => changeStatus(inv.id, 'overdue')}>
              {t('actions.markOverdue')}
            </button>
          )}
          {!['draft', 'cancelled'].includes(inv.status) && inv.type !== 'credit_note' && (
            <button style={btnDanger} onClick={() => createCreditNote(inv.id)}>
              {t('actions.creditNote')}
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Render: List / Create views                                       */
  /* ------------------------------------------------------------------ */

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111827' }}>{t('title')}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>{t('subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {activeSection === 'invoices' && (
            <button style={btnPrimary} onClick={() => setShowCreate(!showCreate)}>
              {showCreate ? t('common:actions.cancel') : t('actions.newInvoice')}
            </button>
          )}
          {activeSection === 'plus-values' && (
            <button style={btnPrimary} onClick={() => setShowPvCreate(!showPvCreate)}>
              {showPvCreate ? t('common:actions.cancel') : t('actions.newPlusValue')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 600 }}>x</button>
        </div>
      )}

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #e5e7eb' }}>
        {(['invoices', 'plus-values'] as const).map(sec => (
          <button
            key={sec}
            onClick={() => setActiveSection(sec)}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderBottom: activeSection === sec ? '2px solid #2563eb' : '2px solid transparent',
              background: 'none',
              color: activeSection === sec ? '#2563eb' : '#6b7280',
              fontWeight: activeSection === sec ? 600 : 400,
              fontSize: 14,
              cursor: 'pointer',
              marginBottom: -2,
            }}
          >
            {sec === 'invoices' ? t('tabs.invoices') : t('tabs.plusValues')}
          </button>
        ))}
      </div>

      {/* ============================================================ */}
      {/*  INVOICES TAB                                                 */}
      {/* ============================================================ */}

      {activeSection === 'invoices' && (
        <>
          {/* Create form */}
          {showCreate && (
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: 20, marginBottom: 20, border: '1px solid #e5e7eb' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>{t('form.createTitle')}</h3>
              {createError && (
                <div style={{ background: '#fee2e2', color: '#dc2626', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
                  {createError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('form.project')}</label>
                  <select style={inputStyle} value={createForm.projectId} onChange={e => handleProjectChange(e.target.value)}>
                    <option value="">{t('form.selectProject')}</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('form.client')}</label>
                  <select style={inputStyle} value={createForm.clientId} onChange={e => setCreateForm(f => ({ ...f, clientId: e.target.value }))}>
                    <option value="">{t('form.selectClient')}</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('form.type')}</label>
                  <select
                    style={inputStyle}
                    value={createForm.type}
                    onChange={e => setCreateForm(f => ({ ...f, type: e.target.value as Invoice['type'] }))}
                  >
                    <option value="invoice">{enumLabel('invoiceType', 'invoice')}</option>
                    <option value="situation">{enumLabel('invoiceType', 'situation')}</option>
                    <option value="acompte">{enumLabel('invoiceType', 'acompte')}</option>
                    <option value="final_invoice">{enumLabel('invoiceType', 'final_invoice')}</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('form.vatRate')}</label>
                  <input
                    type="number"
                    step="0.01"
                    style={inputStyle}
                    value={createForm.vatRate}
                    onChange={e => setCreateForm(f => ({ ...f, vatRate: e.target.value }))}
                  />
                </div>
              </div>

              {/* Lines */}
              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>{t('form.lines')}</h4>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ background: '#f3f4f6' }}>
                    <tr>
                      <th style={thStyle}>{t('table.description')}</th>
                      <th style={{ ...thStyle, width: 80 }}>{t('table.unit')}</th>
                      <th style={{ ...thStyle, width: 80, textAlign: 'right' }}>{t('table.quantity')}</th>
                      <th style={{ ...thStyle, width: 120, textAlign: 'right' }}>{t('table.unitPriceChf')}</th>
                      <th style={{ ...thStyle, width: 120, textAlign: 'right' }}>{t('table.total')}</th>
                      {createForm.type === 'situation' && (
                        <>
                          <th style={{ ...thStyle, width: 90, textAlign: 'right' }}>{t('table.cumulativeQuantity')}</th>
                          <th style={{ ...thStyle, width: 90, textAlign: 'right' }}>{t('table.previousQuantity')}</th>
                          <th style={{ ...thStyle, width: 90, textAlign: 'right' }}>{t('table.periodQuantity')}</th>
                        </>
                      )}
                      <th style={{ ...thStyle, width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {createLines.map((line, idx) => {
                      const periodQty = (line.cumulativeQuantity ?? 0) - (line.previousQuantity ?? 0);
                      return (
                        <tr key={idx}>
                          <td style={tdStyle}>
                            <input
                              style={{ ...inputStyle, border: 'none', padding: '4px 8px' }}
                              placeholder={t('form.descriptionPlaceholder')}
                              value={line.description}
                              onChange={e => updateLine(idx, 'description', e.target.value)}
                            />
                          </td>
                          <td style={tdStyle}>
                            <input
                              style={{ ...inputStyle, border: 'none', padding: '4px 8px', textAlign: 'center' }}
                              value={line.unit}
                              onChange={e => updateLine(idx, 'unit', e.target.value)}
                            />
                          </td>
                          <td style={tdStyle}>
                            <input
                              type="number"
                              style={{ ...inputStyle, border: 'none', padding: '4px 8px', textAlign: 'right' }}
                              value={line.quantity}
                              onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td style={tdStyle}>
                            <input
                              type="number"
                              step="0.05"
                              style={{ ...inputStyle, border: 'none', padding: '4px 8px', textAlign: 'right' }}
                              value={line.unitPriceCents / 100 || ''}
                              onChange={e => updateLine(idx, 'unitPriceCents', Math.round(parseFloat(e.target.value || '0') * 100))}
                            />
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, fontSize: 13 }}>
                            {formatMoney(lineTotal(line))}
                          </td>
                          {createForm.type === 'situation' && (
                            <>
                              <td style={tdStyle}>
                                <input
                                  type="number"
                                  style={{ ...inputStyle, border: 'none', padding: '4px 8px', textAlign: 'right' }}
                                  value={line.cumulativeQuantity ?? ''}
                                  onChange={e => updateLine(idx, 'cumulativeQuantity', parseFloat(e.target.value) || 0)}
                                />
                              </td>
                              <td style={tdStyle}>
                                <input
                                  type="number"
                                  style={{ ...inputStyle, border: 'none', padding: '4px 8px', textAlign: 'right' }}
                                  value={line.previousQuantity ?? ''}
                                  onChange={e => updateLine(idx, 'previousQuantity', parseFloat(e.target.value) || 0)}
                                />
                              </td>
                              <td style={{ ...tdStyle, textAlign: 'right', fontSize: 13, color: '#6b7280' }}>
                                {periodQty}
                              </td>
                            </>
                          )}
                          <td style={tdStyle}>
                            {createLines.length > 1 && (
                              <button
                                onClick={() => removeLine(idx)}
                                style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16 }}
                              >
                                &times;
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button style={btnOutline} onClick={addLine}>{t('actions.addLine')}</button>

              {/* Summary */}
              <div style={{
                marginTop: 16,
                padding: 16,
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                maxWidth: 360,
                marginLeft: 'auto',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
                  <span style={{ color: '#6b7280' }}>{t('summary.subtotalHt')}</span>
                  <span>{formatMoney(subtotalHt)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
                  <span style={{ color: '#6b7280' }}>{t('summary.vat', { rate: vatRate })}</span>
                  <span>{formatMoney(vatAmount)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
                  <span style={{ color: '#6b7280' }}>{t('summary.retention')}</span>
                  <span style={{ color: '#dc2626' }}>- {formatMoney(retentionAmount)}</span>
                </div>
                <div style={{ borderTop: '2px solid #e5e7eb', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{t('summary.totalTtc')}</span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: '#111827' }}>{formatMoney(totalTtc)}</span>
                </div>
              </div>

              {/* Notes */}
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('form.notes')}</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 60 }}
                  value={createForm.notes}
                  onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button style={btnPrimary} onClick={handleCreate}>{t('actions.createInvoice')}</button>
                <button style={btnOutline} onClick={() => setShowCreate(false)}>{t('common:actions.cancel')}</button>
              </div>
            </div>
          )}

          {/* Filters */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            {/* Status tabs */}
            <div style={{ display: 'flex', gap: 0, flex: 1, flexWrap: 'wrap' }}>
              {STATUS_TABS.map(s => (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setPage(1); }}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 9999,
                    border: 'none',
                    background: statusFilter === s ? '#2563eb' : '#f3f4f6',
                    color: statusFilter === s ? '#fff' : '#4b5563',
                    fontSize: 13,
                    fontWeight: statusFilter === s ? 600 : 400,
                    cursor: 'pointer',
                    marginRight: 4,
                    marginBottom: 4,
                  }}
                >
                  {s === 'all' ? t('filters.allStatuses') : statusLabel('invoice', s)}
                </button>
              ))}
            </div>

            {/* Type filter */}
            <select
              style={{ ...inputStyle, width: 160 }}
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
            >
              <option value="">{t('filters.allTypes')}</option>
              {INVOICE_TYPES.map(k => (
                <option key={k} value={k}>{enumLabel('invoiceType', k)}</option>
              ))}
            </select>

            {/* Search */}
            <input
              type="text"
              placeholder={t('filters.searchPlaceholder')}
              style={{ ...inputStyle, width: 200 }}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Invoice table */}
          {loading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>{t('state.loadingInvoices')}</p>
          ) : filteredInvoices.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>{t('state.noInvoices')}</p>
          ) : (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={thStyle}>{t('table.invoiceNumber')}</th>
                    <th style={thStyle}>{t('table.type')}</th>
                    <th style={thStyle}>{t('table.client')}</th>
                    <th style={thStyle}>{t('table.project')}</th>
                    <th style={thStyle}>{t('table.issueDate')}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{t('table.totalTtc')}</th>
                    <th style={thStyle}>{t('table.status')}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{t('table.paid')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map(inv => (
                    <tr
                      key={inv.id}
                      onClick={() => openDetail(inv)}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ ...tdStyle, fontWeight: 600, color: '#2563eb' }}>{inv.invoiceNumber}</td>
                      <td style={tdStyle}>
                        <Badge color={TYPE_COLORS[inv.type]}>{enumLabel('invoiceType', inv.type)}</Badge>
                      </td>
                      <td style={tdStyle}>{inv.client?.name || '-'}</td>
                      <td style={tdStyle}>{inv.project?.name || '-'}</td>
                      <td style={tdStyle}>{formatDate(inv.issueDate)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{formatMoney(inv.totalTtcCents)}</td>
                      <td style={tdStyle}>
                        <Badge color={STATUS_COLORS[inv.status]} strike={STATUS_COLORS[inv.status]?.strike}>
                          {statusLabel('invoice', inv.status)}
                        </Badge>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{formatMoney(inv.amountPaidCents ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button
                style={btnOutline}
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                {t('common:actions.previous')}
              </button>
              <span style={{ padding: '8px 12px', fontSize: 14, color: '#6b7280' }}>
                {t('common:state.page', { page, total: totalPages })}
              </span>
              <button
                style={btnOutline}
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                {t('common:actions.next')}
              </button>
            </div>
          )}
        </>
      )}

      {/* ============================================================ */}
      {/*  PLUS-VALUES TAB                                              */}
      {/* ============================================================ */}

      {activeSection === 'plus-values' && (
        <>
          {/* Create form */}
          {showPvCreate && (
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: 20, marginBottom: 20, border: '1px solid #e5e7eb' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>{t('plusValues.createTitle')}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('form.project')}</label>
                  <select style={inputStyle} value={pvForm.projectId} onChange={e => setPvForm(f => ({ ...f, projectId: e.target.value }))}>
                    <option value="">{t('form.selectProject')}</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('plusValues.description')}</label>
                  <input
                    style={inputStyle}
                    value={pvForm.description}
                    onChange={e => setPvForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('plusValues.amount')}</label>
                  <input
                    type="number"
                    step="0.05"
                    style={inputStyle}
                    value={pvForm.amountCents / 100 || ''}
                    onChange={e => setPvForm(f => ({ ...f, amountCents: Math.round(parseFloat(e.target.value || '0') * 100) }))}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnPrimary} onClick={createPlusValue}>{t('common:actions.create')}</button>
                <button style={btnOutline} onClick={() => setShowPvCreate(false)}>{t('common:actions.cancel')}</button>
              </div>
            </div>
          )}

          {pvLoading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>{t('state.loadingPlusValues')}</p>
          ) : plusValues.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>{t('state.noPlusValues')}</p>
          ) : (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={thStyle}>{t('table.project')}</th>
                    <th style={thStyle}>{t('table.description')}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{t('table.amount')}</th>
                    <th style={thStyle}>{t('table.status')}</th>
                    <th style={thStyle}>{t('table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plusValues.map(pv => (
                    <tr key={pv.id}>
                      <td style={tdStyle}>{pv.project?.name || pv.projectId}</td>
                      <td style={tdStyle}>{pv.description}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{formatMoney(pv.amountCents)}</td>
                      <td style={tdStyle}>
                        <Badge color={PV_STATUS_COLORS[pv.status]}>{statusLabel('plusValue', pv.status)}</Badge>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {pv.status === 'detected' && (
                            <button
                              style={{ ...btnOutline, padding: '4px 10px', fontSize: 12 }}
                              onClick={() => updatePvStatus(pv.id, 'submitted')}
                            >
                              {t('plusValues.submit')}
                            </button>
                          )}
                          {pv.status === 'submitted' && (
                            <>
                              <button
                                style={{ ...btnSuccess, padding: '4px 10px', fontSize: 12 }}
                                onClick={() => updatePvStatus(pv.id, 'approved')}
                              >
                                {t('plusValues.approve')}
                              </button>
                              <button
                                style={{ ...btnDanger, padding: '4px 10px', fontSize: 12 }}
                                onClick={() => updatePvStatus(pv.id, 'rejected')}
                              >
                                {t('plusValues.reject')}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable sub-components                                            */
/* ------------------------------------------------------------------ */

function Badge({ color, strike, children }: { color: { bg: string; fg: string }; strike?: boolean; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 9999,
      fontSize: 12,
      fontWeight: 500,
      background: color.bg,
      color: color.fg,
      textDecoration: strike ? 'line-through' : 'none',
    }}>
      {children}
    </span>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb' }}>
      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginTop: 4 }}>{value}</div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#111827' }}>{value}</div>
    </div>
  );
}
