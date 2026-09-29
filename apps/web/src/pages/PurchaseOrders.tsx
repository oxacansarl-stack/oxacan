import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, formatCHF } from '../lib/api';

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

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_TABS = ['all', 'draft', 'sent', 'confirmed', 'delivered'] as const;

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f3f4f6', fg: '#4b5563' },
  sent: { bg: '#dbeafe', fg: '#1d4ed8' },
  confirmed: { bg: '#dcfce7', fg: '#166534' },
  partially_delivered: { bg: '#fef3c7', fg: '#92400e' },
  delivered: { bg: '#f0fdf4', fg: '#15803d' },
  cancelled: { bg: '#fee2e2', fg: '#991b1b' },
};

const UNITS = ['pce', 'm', 'm2', 'm3', 'kg', 'l', 'h', 'fft'] as const;

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

const btnDanger: React.CSSProperties = { ...btnPrimary, background: '#dc2626' };
const btnSuccess: React.CSSProperties = { ...btnPrimary, background: '#16a34a' };

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

function parseCents(chfStr: string): number {
  const n = parseFloat(chfStr);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PurchaseOrders() {
  /* ---------- state ---------- */
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedPO, setExpandedPO] = useState<PurchaseOrder | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  /* create form */
  const [newSupplierId, setNewSupplierId] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([emptyDraftLine()]);
  const [creating, setCreating] = useState(false);

  /* detail add-line form */
  const [addLineDesc, setAddLineDesc] = useState('');
  const [addLineQty, setAddLineQty] = useState('');
  const [addLineUnit, setAddLineUnit] = useState('pce');
  const [addLinePrice, setAddLinePrice] = useState('');

  /* delivery recording */
  const [deliveryInputs, setDeliveryInputs] = useState<Record<string, string>>({});

  /* ---------- fetchers ---------- */

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusParam = activeTab !== 'all' ? `&status=${activeTab}` : '';
      const list = await apiGet<PurchaseOrder[]>(`/purchase-orders?page=1${statusParam}`);
      setPos(list ?? []);
    } catch (err: any) {
      setError(err.message || 'Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  const fetchDropdowns = useCallback(async () => {
    try {
      const [sRes, pRes] = await Promise.all([
        apiGet<Supplier[]>('/suppliers?limit=100'),
        apiGet<Project[]>('/projects'),
      ]);
      setSuppliers(sRes ?? []);
      setProjects(pRes ?? []);
    } catch {
      /* non-blocking */
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const po = await apiGet<PurchaseOrder>(`/purchase-orders/${id}`);
      setExpandedPO(po);
      /* init delivery inputs */
      const inputs: Record<string, string> = {};
      (po.lines ?? []).forEach((l) => {
        inputs[l.id] = String(l.deliveredQuantity);
      });
      setDeliveryInputs(inputs);
    } catch (err: any) {
      setError(err.message || 'Failed to load PO details');
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    fetchDropdowns();
  }, [fetchDropdowns]);

  /* ---------- create PO ---------- */

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

  const draftTotal = draftLines.reduce((sum, l) => {
    const qty = parseFloat(l.quantity) || 0;
    const price = parseCents(l.unitPrice);
    return sum + qty * price;
  }, 0);

  const handleCreate = async () => {
    if (!newSupplierId) return;
    const lines = draftLines
      .filter((l) => l.description.trim() && parseFloat(l.quantity) > 0)
      .map((l) => ({
        description: l.description.trim(),
        quantity: parseFloat(l.quantity),
        unit: l.unit,
        unitPriceCents: parseCents(l.unitPrice),
      }));
    if (lines.length === 0) return;

    setCreating(true);
    try {
      await apiPost('/purchase-orders', {
        supplierId: newSupplierId,
        projectId: newProjectId || undefined,
        lines,
      });
      setShowCreate(false);
      setNewSupplierId('');
      setNewProjectId('');
      setDraftLines([emptyDraftLine()]);
      fetchList();
    } catch (err: any) {
      setError(err.message || 'Failed to create PO');
    } finally {
      setCreating(false);
    }
  };

  /* ---------- status transition ---------- */

  const changeStatus = async (id: string, status: string) => {
    try {
      await apiPut(`/purchase-orders/${id}/status`, { status });
      fetchList();
      if (expandedId === id) fetchDetail(id);
    } catch (err: any) {
      setError(err.message || 'Failed to update status');
    }
  };

  /* ---------- add line to existing PO ---------- */

  const handleAddLine = async (poId: string) => {
    const qty = parseFloat(addLineQty);
    if (!addLineDesc.trim() || isNaN(qty) || qty < 0) return;
    try {
      await apiPost(`/purchase-orders/${poId}/lines`, {
        description: addLineDesc.trim(),
        quantity: qty,
        unit: addLineUnit,
        unitPriceCents: parseCents(addLinePrice),
      });
      setAddLineDesc('');
      setAddLineQty('');
      setAddLineUnit('pce');
      setAddLinePrice('');
      fetchDetail(poId);
      fetchList();
    } catch (err: any) {
      setError(err.message || 'Failed to add line');
    }
  };

  /* ---------- delete line ---------- */

  const handleDeleteLine = async (poId: string, lineId: string) => {
    try {
      await apiDelete(`/purchase-orders/${poId}/lines/${lineId}`);
      fetchDetail(poId);
      fetchList();
    } catch (err: any) {
      setError(err.message || 'Failed to delete line');
    }
  };

  /* ---------- record delivery ---------- */

  const handleRecordDelivery = async (poId: string, lineId: string) => {
    const val = parseFloat(deliveryInputs[lineId] ?? '0');
    if (isNaN(val) || val < 0) return;
    try {
      await apiPost(`/purchase-orders/${poId}/lines/${lineId}/delivery`, {
        deliveredQuantity: val,
      });
      fetchDetail(poId);
      fetchList();
    } catch (err: any) {
      setError(err.message || 'Failed to record delivery');
    }
  };

  /* ---------- row click ---------- */

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedPO(null);
    } else {
      setExpandedId(id);
      setExpandedPO(null);
      fetchDetail(id);
    }
  };

  /* ---------- render ---------- */

  const formatDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString('fr-CH') : '—';

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#111827' }}>
          Purchase Orders
        </h1>
        <button
          style={btnPrimary}
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? 'Cancel' : '+ New PO'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: '10px 16px',
            marginBottom: 16,
            background: '#fee2e2',
            color: '#991b1b',
            borderRadius: 6,
            fontSize: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', fontWeight: 600 }}
            onClick={() => setError(null)}
          >
            &times;
          </button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#111827' }}>
            New Purchase Order
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Supplier */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                Supplier *
              </label>
              <select
                style={inputStyle}
                value={newSupplierId}
                onChange={(e) => setNewSupplierId(e.target.value)}
              >
                <option value="">Select supplier...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Project */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                Project (optional)
              </label>
              <select
                style={inputStyle}
                value={newProjectId}
                onChange={(e) => setNewProjectId(e.target.value)}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.reference ? `${p.reference} — ${p.name}` : p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Draft lines */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Lines</span>
              <button
                style={btnOutline}
                onClick={() => setDraftLines((prev) => [...prev, emptyDraftLine()])}
              >
                + Add Line
              </button>
            </div>

            {/* Column headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 80px 90px 110px 100px 36px',
                gap: 8,
                marginBottom: 4,
                fontSize: 12,
                fontWeight: 600,
                color: '#6b7280',
                textTransform: 'uppercase',
              }}
            >
              <span>Description</span>
              <span>Qty</span>
              <span>Unit</span>
              <span>Unit Price (CHF)</span>
              <span style={{ textAlign: 'right' }}>Total</span>
              <span />
            </div>

            {draftLines.map((line, idx) => {
              const qty = parseFloat(line.quantity) || 0;
              const priceCents = parseCents(line.unitPrice);
              const lineTotalCents = qty * priceCents;

              return (
                <div
                  key={idx}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 80px 90px 110px 100px 36px',
                    gap: 8,
                    marginBottom: 6,
                    alignItems: 'center',
                  }}
                >
                  <input
                    style={inputStyle}
                    placeholder="Description"
                    value={line.description}
                    onChange={(e) => updateDraftLine(idx, 'description', e.target.value)}
                  />
                  <input
                    style={inputStyle}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={line.quantity}
                    onChange={(e) => updateDraftLine(idx, 'quantity', e.target.value)}
                  />
                  <select
                    style={inputStyle}
                    value={line.unit}
                    onChange={(e) => updateDraftLine(idx, 'unit', e.target.value)}
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                  <input
                    style={inputStyle}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={line.unitPrice}
                    onChange={(e) => updateDraftLine(idx, 'unitPrice', e.target.value)}
                  />
                  <span style={{ textAlign: 'right', fontSize: 14, fontWeight: 500, color: '#111827' }}>
                    {formatCHF(lineTotalCents)}
                  </span>
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#dc2626',
                      fontSize: 18,
                      padding: 0,
                      lineHeight: 1,
                    }}
                    title="Remove line"
                    onClick={() => removeDraftLine(idx)}
                  >
                    &times;
                  </button>
                </div>
              );
            })}

            {/* Running total */}
            <div style={{ textAlign: 'right', fontSize: 15, fontWeight: 600, color: '#111827', marginTop: 8 }}>
              Total HT: CHF {formatCHF(draftTotal)}
            </div>
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button style={btnOutline} onClick={() => setShowCreate(false)}>
              Cancel
            </button>
            <button
              style={{
                ...btnPrimary,
                opacity: !newSupplierId || draftLines.every((l) => !l.description.trim()) || creating ? 0.6 : 1,
              }}
              disabled={!newSupplierId || draftLines.every((l) => !l.description.trim()) || creating}
              onClick={handleCreate}
            >
              {creating ? 'Creating...' : 'Create PO'}
            </button>
          </div>
        </div>
      )}

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e5e7eb', paddingBottom: 0 }}>
        {STATUS_TABS.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setExpandedId(null); setExpandedPO(null); }}
              style={{
                padding: '8px 16px',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#2563eb' : '#6b7280',
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
                cursor: 'pointer',
                textTransform: 'capitalize',
                marginBottom: -1,
              }}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: '#6b7280', fontSize: 14 }}>
          Loading purchase orders...
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && pos.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: '#6b7280', fontSize: 14 }}>
          No purchase orders found.
        </div>
      )}

      {/* Table */}
      {!loading && pos.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8f9fa' }}>
                {['Reference', 'Supplier', 'Project', 'Status', 'Total HT', 'Expected Delivery', 'Created'].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 14px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: '#374151',
                        borderBottom: '1px solid #e5e7eb',
                        fontSize: 13,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {pos.map((po) => {
                const sc = STATUS_COLORS[po.status] ?? { bg: '#f3f4f6', fg: '#4b5563' };
                const isExpanded = expandedId === po.id;

                return (
                  <React.Fragment key={po.id}>
                    <tr
                      onClick={() => toggleExpand(po.id)}
                      style={{
                        cursor: 'pointer',
                        background: isExpanded ? '#f0f7ff' : '#fff',
                        borderBottom: isExpanded ? 'none' : undefined,
                      }}
                      onMouseEnter={(e) => {
                        if (!isExpanded) (e.currentTarget as HTMLElement).style.background = '#f8f9fa';
                      }}
                      onMouseLeave={(e) => {
                        if (!isExpanded) (e.currentTarget as HTMLElement).style.background = '#fff';
                      }}
                    >
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', fontWeight: 500, color: '#2563eb' }}>
                        {po.reference}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', color: '#111827' }}>
                        {po.supplier?.name ?? '—'}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                        {po.project ? (po.project.reference ? `${po.project.reference}` : po.project.name) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: 12,
                            fontSize: 12,
                            fontWeight: 600,
                            background: sc.bg,
                            color: sc.fg,
                            textTransform: 'capitalize',
                          }}
                        >
                          {po.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', fontWeight: 500, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>
                        CHF {formatCHF(po.totalHtCents)}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                        {formatDate(po.expectedDelivery)}
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                        {formatDate(po.createdAt)}
                      </td>
                    </tr>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid #e5e7eb' }}>
                          <ExpandedDetail
                            po={expandedPO}
                            onStatusChange={(status) => changeStatus(po.id, status)}
                            onAddLine={() => handleAddLine(po.id)}
                            onDeleteLine={(lineId) => handleDeleteLine(po.id, lineId)}
                            onRecordDelivery={(lineId) => handleRecordDelivery(po.id, lineId)}
                            addLineDesc={addLineDesc}
                            setAddLineDesc={setAddLineDesc}
                            addLineQty={addLineQty}
                            setAddLineQty={setAddLineQty}
                            addLineUnit={addLineUnit}
                            setAddLineUnit={setAddLineUnit}
                            addLinePrice={addLinePrice}
                            setAddLinePrice={setAddLinePrice}
                            deliveryInputs={deliveryInputs}
                            setDeliveryInputs={setDeliveryInputs}
                            formatDate={formatDate}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Expanded Detail Sub-component                                      */
/* ------------------------------------------------------------------ */

interface ExpandedDetailProps {
  po: PurchaseOrder | null;
  onStatusChange: (status: string) => void;
  onAddLine: () => void;
  onDeleteLine: (lineId: string) => void;
  onRecordDelivery: (lineId: string) => void;
  addLineDesc: string;
  setAddLineDesc: (v: string) => void;
  addLineQty: string;
  setAddLineQty: (v: string) => void;
  addLineUnit: string;
  setAddLineUnit: (v: string) => void;
  addLinePrice: string;
  setAddLinePrice: (v: string) => void;
  deliveryInputs: Record<string, string>;
  setDeliveryInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  formatDate: (iso?: string) => string;
}

function ExpandedDetail({
  po,
  onStatusChange,
  onAddLine,
  onDeleteLine,
  onRecordDelivery,
  addLineDesc,
  setAddLineDesc,
  addLineQty,
  setAddLineQty,
  addLineUnit,
  setAddLineUnit,
  addLinePrice,
  setAddLinePrice,
  deliveryInputs,
  setDeliveryInputs,
  formatDate,
}: ExpandedDetailProps) {
  if (!po) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
        Loading details...
      </div>
    );
  }

  const sc = STATUS_COLORS[po.status] ?? { bg: '#f3f4f6', fg: '#4b5563' };
  const lines = po.lines ?? [];
  const isDraft = po.status === 'draft';

  return (
    <div style={{ padding: 20, background: '#f8f9fa' }}>
      {/* PO info header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 20,
          padding: 16,
          background: '#fff',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>Reference</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{po.reference}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>Supplier</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>{po.supplier?.name ?? '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>Project</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>
            {po.project ? (po.project.reference ? `${po.project.reference} — ${po.project.name}` : po.project.name) : '—'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>Status</div>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 10px',
              borderRadius: 12,
              fontSize: 12,
              fontWeight: 600,
              background: sc.bg,
              color: sc.fg,
              textTransform: 'capitalize',
            }}
          >
            {po.status}
          </span>
        </div>
      </div>

      {/* Lines table */}
      {lines.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 16,
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                  Description
                </th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                  Qty Ordered
                </th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                  Qty Delivered
                </th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', minWidth: 140 }}>
                  Progress
                </th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                  Unit Price
                </th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                  Total
                </th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const pct = line.quantity > 0 ? Math.min((line.deliveredQuantity / line.quantity) * 100, 100) : 0;
                const isComplete = pct >= 100;

                return (
                  <tr key={line.id}>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6', color: '#111827' }}>
                      {line.description}
                    </td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6', textAlign: 'right', color: '#111827', fontVariantNumeric: 'tabular-nums' }}>
                      {line.quantity} {line.unit}
                    </td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6', textAlign: 'right', color: '#111827', fontVariantNumeric: 'tabular-nums' }}>
                      {line.deliveredQuantity} {line.unit}
                    </td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div
                          style={{
                            flex: 1,
                            height: 8,
                            background: '#e5e7eb',
                            borderRadius: 4,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: isComplete ? '#16a34a' : '#2563eb',
                              borderRadius: 4,
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 12, color: '#6b7280', minWidth: 36, textAlign: 'right' }}>
                          {Math.round(pct)}%
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6', textAlign: 'right', color: '#111827', fontVariantNumeric: 'tabular-nums' }}>
                      CHF {formatCHF(line.unitPriceCents)}
                    </td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6', textAlign: 'right', fontWeight: 500, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>
                      CHF {formatCHF(line.totalPriceCents)}
                    </td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        {/* Delivery recording */}
                        {po.status !== 'cancelled' && po.status !== 'draft' && (
                          <>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={deliveryInputs[line.id] ?? ''}
                              onChange={(e) =>
                                setDeliveryInputs((prev) => ({ ...prev, [line.id]: e.target.value }))
                              }
                              onClick={(e) => e.stopPropagation()}
                              style={{ ...inputStyle, width: 64, textAlign: 'right', padding: '4px 6px', fontSize: 13 }}
                            />
                            <button
                              style={{ ...btnSuccess, padding: '4px 8px', fontSize: 12 }}
                              onClick={(e) => { e.stopPropagation(); onRecordDelivery(line.id); }}
                              title="Record delivery"
                            >
                              Save
                            </button>
                          </>
                        )}
                        {/* Delete line (draft only) */}
                        {isDraft && (
                          <button
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: '#dc2626',
                              fontSize: 16,
                              padding: '4px',
                              lineHeight: 1,
                            }}
                            title="Delete line"
                            onClick={(e) => { e.stopPropagation(); onDeleteLine(line.id); }}
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {lines.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: 24,
            color: '#6b7280',
            fontSize: 14,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          No lines on this purchase order.
        </div>
      )}

      {/* Add line form (for existing POs) */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
          Add Line
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 90px 110px auto', gap: 8, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 2 }}>Description</label>
            <input
              style={inputStyle}
              placeholder="Description"
              value={addLineDesc}
              onChange={(e) => setAddLineDesc(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 2 }}>Qty</label>
            <input
              style={inputStyle}
              type="number"
              min="0"
              step="any"
              placeholder="0"
              value={addLineQty}
              onChange={(e) => setAddLineQty(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 2 }}>Unit</label>
            <select style={inputStyle} value={addLineUnit} onChange={(e) => setAddLineUnit(e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 2 }}>Price (CHF)</label>
            <input
              style={inputStyle}
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={addLinePrice}
              onChange={(e) => setAddLinePrice(e.target.value)}
            />
          </div>
          <button style={{ ...btnPrimary, padding: '8px 14px' }} onClick={onAddLine}>
            Add
          </button>
        </div>
      </div>

      {/* Status transition buttons */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {po.status === 'draft' && (
          <button style={btnPrimary} onClick={() => onStatusChange('sent')}>
            Send
          </button>
        )}
        {po.status === 'sent' && (
          <button style={btnSuccess} onClick={() => onStatusChange('confirmed')}>
            Confirm
          </button>
        )}
        {po.status === 'confirmed' && (
          <button style={btnSuccess} onClick={() => onStatusChange('delivered')}>
            Mark Delivered
          </button>
        )}
        {po.status !== 'delivered' && po.status !== 'cancelled' && (
          <button style={btnDanger} onClick={() => onStatusChange('cancelled')}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
