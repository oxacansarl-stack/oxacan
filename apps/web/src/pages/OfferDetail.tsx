import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, apiDelete, ApiError, formatCHF } from '../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OfferLine {
  id: string;
  position: number;
  description: string;
  unit: string;
  quantity: number;
  unitPriceCents: number | null;
  totalCents: number;
  pricingStrategy: string;
  variantType: string;
}

interface Assumption {
  id: string;
  type: string;
  description: string;
  impactAmountCents: number;
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
  vatRateBps: number;
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  lines?: OfferLine[];
  assumptions?: Assumption[];
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUSES = [
  'draft',
  'in_progress',
  'submitted',
  'accepted',
  'rejected',
  'archived',
] as const;

const VARIANT_TYPES = [
  'BASE',
  'VARIANTE',
  'OPTION',
  'HYPOTHESE_A_VALIDER',
  'INFORMATION_MANQUANTE',
  'EXCLU',
] as const;

const PRICING_STRATEGIES = ['fixed', 'unit_rate', 'lump_sum', 'provisional'] as const;

const ASSUMPTION_TYPES = ['technical', 'commercial', 'planning', 'regulatory'] as const;

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f3f4f6', fg: '#374151' },
  in_progress: { bg: '#dbeafe', fg: '#1e40af' },
  submitted: { bg: '#fef3c7', fg: '#92400e' },
  accepted: { bg: '#dcfce7', fg: '#166534' },
  rejected: { bg: '#fee2e2', fg: '#991b1b' },
  archived: { bg: '#f3f4f6', fg: '#6b7280' },
};

const VARIANT_COLORS: Record<string, { bg: string; fg: string }> = {
  BASE: { bg: '#dbeafe', fg: '#1e40af' },
  VARIANTE: { bg: '#e0e7ff', fg: '#3730a3' },
  OPTION: { bg: '#fef3c7', fg: '#92400e' },
  HYPOTHESE_A_VALIDER: { bg: '#fce7f3', fg: '#9d174d' },
  INFORMATION_MANQUANTE: { bg: '#ffedd5', fg: '#9a3412' },
  EXCLU: { bg: '#f3f4f6', fg: '#6b7280' },
};

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

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const buttonSecondaryStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#f3f4f6',
  color: '#374151',
};

const buttonDangerStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#fee2e2',
  color: '#991b1b',
  fontWeight: 500,
  padding: '6px 12px',
  fontSize: 13,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function variantLabel(v: string): string {
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function OfferDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /* --- Local state --- */
  const [showLineForm, setShowLineForm] = useState(false);
  const [showAssumptionForm, setShowAssumptionForm] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);

  const [lineForm, setLineForm] = useState({
    description: '',
    unit: 'pce',
    quantity: 1,
    unitPriceCents: '' as string | number,
    pricingStrategy: 'fixed' as string,
    variantType: 'BASE' as string,
  });

  const [assumptionForm, setAssumptionForm] = useState({
    type: 'technical',
    description: '',
    impactAmountCents: 0,
  });

  /* --- Queries --- */

  const {
    data: offer,
    isLoading,
    error,
  } = useQuery<Offer, ApiError>({
    queryKey: ['offer', id],
    queryFn: () => apiGet<Offer>(`/offers/${id}`),
    enabled: !!id,
    retry: false,
  });

  /* --- Mutations --- */

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['offer', id] });

  const addLineMutation = useMutation({
    mutationFn: (data: {
      description: string;
      unit: string;
      quantity: number;
      unitPriceCents: number | null;
      pricingStrategy: string;
      variantType: string;
    }) => apiPost(`/offers/${id}/lines`, data),
    onSuccess: () => {
      invalidate();
      setShowLineForm(false);
      resetLineForm();
    },
  });

  const updateLineMutation = useMutation({
    mutationFn: (data: {
      lineId: string;
      description: string;
      unit: string;
      quantity: number;
      unitPriceCents: number | null;
      pricingStrategy: string;
      variantType: string;
    }) => {
      const { lineId, ...body } = data;
      return apiPut(`/offers/${id}/lines/${lineId}`, body);
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
    mutationFn: (data: typeof assumptionForm) => apiPost(`/offers/${id}/assumptions`, data),
    onSuccess: () => {
      invalidate();
      setShowAssumptionForm(false);
      setAssumptionForm({ type: 'technical', description: '', impactAmountCents: 0 });
    },
  });

  const recalcMutation = useMutation({
    mutationFn: () => apiPost(`/offers/${id}/recalculate`),
    onSuccess: invalidate,
  });

  const duplicateMutation = useMutation({
    mutationFn: () => apiPost<Offer>(`/offers/${id}/duplicate`),
    onSuccess: (newOffer) => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      if (newOffer?.id) navigate(`/offers/${newOffer.id}`);
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => apiPut(`/offers/${id}`, { status }),
    onSuccess: invalidate,
  });

  /* --- Helpers --- */

  function resetLineForm() {
    setLineForm({
      description: '',
      unit: 'pce',
      quantity: 1,
      unitPriceCents: '',
      pricingStrategy: 'fixed',
      variantType: 'BASE',
    });
  }

  function startEditLine(line: OfferLine) {
    setEditingLineId(line.id);
    setLineForm({
      description: line.description,
      unit: line.unit,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents ?? '',
      pricingStrategy: line.pricingStrategy,
      variantType: line.variantType,
    });
    setShowLineForm(false);
  }

  function submitLineForm() {
    const parsed = lineForm.unitPriceCents === '' ? null : Number(lineForm.unitPriceCents);
    const payload = {
      description: lineForm.description,
      unit: lineForm.unit,
      quantity: lineForm.quantity,
      unitPriceCents: parsed,
      pricingStrategy: lineForm.pricingStrategy,
      variantType: lineForm.variantType,
    };

    if (editingLineId) {
      updateLineMutation.mutate({ lineId: editingLineId, ...payload });
    } else {
      addLineMutation.mutate(payload);
    }
  }

  const lines = offer?.lines ?? [];
  const assumptions = offer?.assumptions ?? [];
  const hasUnpricedLines = lines.some((l) => l.unitPriceCents === null && l.variantType !== 'EXCLU');

  /* --- Render --- */

  if (error instanceof ApiError && error.status === 401) {
    return <div style={{ color: '#ef4444', padding: 20 }}>Login required</div>;
  }

  if (isLoading) {
    return <div style={{ color: '#6b7280', padding: 20 }}>Loading...</div>;
  }

  if (!offer) {
    return <div style={{ color: '#ef4444', padding: 20 }}>Offer not found</div>;
  }

  const statusColors = STATUS_COLORS[offer.status] ?? STATUS_COLORS.draft;

  return (
    <div>
      {/* --- Back nav --- */}
      <button
        onClick={() => navigate('/offers')}
        style={{
          background: 'none',
          border: 'none',
          color: '#2563eb',
          fontSize: 14,
          cursor: 'pointer',
          padding: 0,
          marginBottom: 16,
        }}
      >
        &larr; Back to Offers
      </button>

      {/* --- Header --- */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 6px 0' }}>
            {offer.projectName}
          </h1>
          <div style={{ fontSize: 14, color: '#6b7280', display: 'flex', gap: 12, alignItems: 'center' }}>
            <span>{offer.client?.name ?? '-'}</span>
            <span style={{ color: '#d1d5db' }}>|</span>
            <span>Ref: {offer.reference || '-'}</span>
            <span style={{ color: '#d1d5db' }}>|</span>
            <span>v{offer.version ?? 1}</span>
            <span style={{ color: '#d1d5db' }}>|</span>
            <span
              style={{
                display: 'inline-block',
                padding: '2px 10px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
                background: statusColors.bg,
                color: statusColors.fg,
              }}
            >
              {statusLabel(offer.status)}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            style={buttonSecondaryStyle}
            onClick={() => recalcMutation.mutate()}
            disabled={recalcMutation.isPending}
          >
            {recalcMutation.isPending ? 'Calculating...' : 'Recalculate Totals'}
          </button>
          <button
            style={buttonSecondaryStyle}
            onClick={() => duplicateMutation.mutate()}
            disabled={duplicateMutation.isPending}
          >
            {duplicateMutation.isPending ? 'Duplicating...' : 'Duplicate Offer'}
          </button>
          <div style={{ position: 'relative' }} title={hasUnpricedLines ? 'All lines must be priced before submission' : ''}>
            <button
              style={{
                ...buttonStyle,
                opacity: hasUnpricedLines ? 0.5 : 1,
                cursor: hasUnpricedLines ? 'not-allowed' : 'pointer',
              }}
              disabled={hasUnpricedLines}
              onClick={() => statusMutation.mutate('submitted')}
            >
              Submit Offer
            </button>
          </div>
          <select
            style={{ ...inputStyle, width: 'auto', minWidth: 140 }}
            value={offer.status}
            onChange={(e) => statusMutation.mutate(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* --- Summary cards --- */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 16,
          marginBottom: 32,
        }}
      >
        <SummaryCard label="Total HT" value={`CHF ${formatCHF(offer.totalHtCents ?? 0)}`} />
        <SummaryCard label="VAT" value={`CHF ${formatCHF(offer.totalVatCents ?? 0)}`} />
        <SummaryCard label="Total TTC" value={`CHF ${formatCHF(offer.totalTtcCents ?? 0)}`} highlight />
        <SummaryCard
          label="Margin Factor"
          value={`${(offer.marginFactor / 100).toFixed(2)}x`}
          sub={`stored: ${offer.marginFactor}`}
        />
        <SummaryCard
          label="VAT Rate"
          value={`${(offer.vatRateBps / 100).toFixed(2)}%`}
          sub={`stored: ${offer.vatRateBps} bps`}
        />
      </div>

      {/* --- Lines section --- */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: 0 }}>
            Lines ({lines.length})
          </h2>
          <button
            style={buttonStyle}
            onClick={() => {
              setShowLineForm(!showLineForm);
              setEditingLineId(null);
              if (!showLineForm) resetLineForm();
            }}
          >
            {showLineForm ? 'Cancel' : '+ Add Line'}
          </button>
        </div>

        {/* Line form (add or edit) */}
        {(showLineForm || editingLineId) && (
          <div
            style={{
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 12 }}>
              {editingLineId ? 'Edit Line' : 'New Line'}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
                gap: 10,
                marginBottom: 12,
              }}
            >
              <input
                style={inputStyle}
                placeholder="Description *"
                value={lineForm.description}
                onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })}
              />
              <input
                style={inputStyle}
                placeholder="Unit (pce, m2, ml...)"
                value={lineForm.unit}
                onChange={(e) => setLineForm({ ...lineForm, unit: e.target.value })}
              />
              <input
                style={inputStyle}
                type="number"
                placeholder="Quantity"
                value={lineForm.quantity}
                onChange={(e) => setLineForm({ ...lineForm, quantity: Number(e.target.value) })}
              />
              <input
                style={inputStyle}
                type="number"
                placeholder="Unit Price (centimes)"
                value={lineForm.unitPriceCents}
                onChange={(e) =>
                  setLineForm({
                    ...lineForm,
                    unitPriceCents: e.target.value === '' ? '' : Number(e.target.value),
                  })
                }
              />
              <select
                style={inputStyle}
                value={lineForm.pricingStrategy}
                onChange={(e) => setLineForm({ ...lineForm, pricingStrategy: e.target.value })}
              >
                {PRICING_STRATEGIES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <select
                style={inputStyle}
                value={lineForm.variantType}
                onChange={(e) => setLineForm({ ...lineForm, variantType: e.target.value })}
              >
                {VARIANT_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {variantLabel(v)}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                style={buttonStyle}
                onClick={submitLineForm}
                disabled={
                  !lineForm.description ||
                  addLineMutation.isPending ||
                  updateLineMutation.isPending
                }
              >
                {addLineMutation.isPending || updateLineMutation.isPending
                  ? 'Saving...'
                  : editingLineId
                    ? 'Update Line'
                    : 'Add Line'}
              </button>
              {editingLineId && (
                <button
                  style={buttonSecondaryStyle}
                  onClick={() => {
                    setEditingLineId(null);
                    resetLineForm();
                  }}
                >
                  Cancel Edit
                </button>
              )}
            </div>
            {(addLineMutation.error || updateLineMutation.error) && (
              <span style={{ color: '#ef4444', marginLeft: 12, fontSize: 13 }}>
                {(addLineMutation.error || updateLineMutation.error)?.message}
              </span>
            )}
          </div>
        )}

        {/* Lines table */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {[
                'Pos',
                'Description',
                'Unit',
                'Qty',
                'Unit Price (CHF)',
                'Total (CHF)',
                'Pricing',
                'Variant',
                'Actions',
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderBottom: '2px solid #e5e7eb',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#6b7280',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}
                >
                  No lines yet
                </td>
              </tr>
            )}
            {lines.map((line) => {
              const isExclu = line.variantType === 'EXCLU';
              const variantColors = VARIANT_COLORS[line.variantType] ?? VARIANT_COLORS.BASE;
              const cellStyle: React.CSSProperties = {
                padding: '8px 10px',
                borderBottom: '1px solid #f3f4f6',
                fontSize: 14,
                textDecoration: isExclu ? 'line-through' : 'none',
                color: isExclu ? '#9ca3af' : '#111827',
              };

              return (
                <tr key={line.id}>
                  <td style={cellStyle}>{line.position}</td>
                  <td style={{ ...cellStyle, maxWidth: 240 }}>{line.description}</td>
                  <td style={cellStyle}>{line.unit}</td>
                  <td style={{ ...cellStyle, fontVariantNumeric: 'tabular-nums' }}>
                    {line.quantity}
                  </td>
                  <td style={{ ...cellStyle, fontVariantNumeric: 'tabular-nums' }}>
                    {line.unitPriceCents !== null ? (
                      formatCHF(line.unitPriceCents)
                    ) : (
                      <span
                        style={{
                          color: '#d97706',
                          background: '#fef3c7',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                      >
                        Prix a completer
                      </span>
                    )}
                  </td>
                  <td style={{ ...cellStyle, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                    {formatCHF(line.totalCents ?? 0)}
                  </td>
                  <td style={{ ...cellStyle, fontSize: 12, color: '#6b7280' }}>
                    {line.pricingStrategy?.replace(/_/g, ' ') ?? '-'}
                  </td>
                  <td style={cellStyle}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        background: variantColors.bg,
                        color: variantColors.fg,
                      }}
                    >
                      {line.variantType}
                    </span>
                  </td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#2563eb',
                        cursor: 'pointer',
                        fontSize: 13,
                        padding: '2px 6px',
                      }}
                      onClick={() => startEditLine(line)}
                    >
                      Edit
                    </button>
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        fontSize: 13,
                        padding: '2px 6px',
                      }}
                      onClick={() => {
                        if (confirm('Delete this line?')) deleteLineMutation.mutate(line.id);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* --- Assumptions section --- */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: 0 }}>
            Assumptions ({assumptions.length})
          </h2>
          <button
            style={buttonStyle}
            onClick={() => setShowAssumptionForm(!showAssumptionForm)}
          >
            {showAssumptionForm ? 'Cancel' : '+ Add Assumption'}
          </button>
        </div>

        {/* Assumption form */}
        {showAssumptionForm && (
          <div
            style={{
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 2fr 1fr',
                gap: 10,
                marginBottom: 12,
              }}
            >
              <select
                style={inputStyle}
                value={assumptionForm.type}
                onChange={(e) =>
                  setAssumptionForm({ ...assumptionForm, type: e.target.value })
                }
              >
                {ASSUMPTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
              <input
                style={inputStyle}
                placeholder="Description *"
                value={assumptionForm.description}
                onChange={(e) =>
                  setAssumptionForm({ ...assumptionForm, description: e.target.value })
                }
              />
              <input
                style={inputStyle}
                type="number"
                placeholder="Impact (centimes)"
                value={assumptionForm.impactAmountCents}
                onChange={(e) =>
                  setAssumptionForm({
                    ...assumptionForm,
                    impactAmountCents: Number(e.target.value),
                  })
                }
              />
            </div>
            <button
              style={buttonStyle}
              onClick={() =>
                assumptionForm.description && addAssumptionMutation.mutate(assumptionForm)
              }
              disabled={addAssumptionMutation.isPending}
            >
              {addAssumptionMutation.isPending ? 'Adding...' : 'Add Assumption'}
            </button>
            {addAssumptionMutation.error && (
              <span style={{ color: '#ef4444', marginLeft: 12, fontSize: 13 }}>
                {addAssumptionMutation.error.message}
              </span>
            )}
          </div>
        )}

        {/* Assumptions list */}
        {assumptions.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 14 }}>No assumptions</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Type', 'Description', 'Impact (CHF)', 'Status'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderBottom: '2px solid #e5e7eb',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assumptions.map((a) => (
                <tr key={a.id}>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        background: '#e0e7ff',
                        color: '#3730a3',
                      }}
                    >
                      {a.type}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                    {a.description}
                  </td>
                  <td
                    style={{
                      padding: '8px 10px',
                      borderBottom: '1px solid #f3f4f6',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 14,
                    }}
                  >
                    CHF {formatCHF(a.impactAmountCents ?? 0)}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        background: a.status === 'confirmed' ? '#dcfce7' : '#fef3c7',
                        color: a.status === 'confirmed' ? '#166534' : '#92400e',
                      }}
                    >
                      {a.status ?? 'pending'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SummaryCard                                                        */
/* ------------------------------------------------------------------ */

function SummaryCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        background: highlight ? '#eff6ff' : '#fff',
        border: `1px solid ${highlight ? '#bfdbfe' : '#e5e7eb'}`,
        borderRadius: 8,
        padding: '16px 14px',
      }}
    >
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{label}</div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: highlight ? '#1d4ed8' : '#111827',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}
