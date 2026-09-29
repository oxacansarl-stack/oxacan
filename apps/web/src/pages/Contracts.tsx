import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPost, apiPatch, ApiError } from '../lib/api';
import { formatDate, formatMoney, statusLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';

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

const STATUSES = ['draft', 'sent', 'signed', 'active', 'completed', 'terminated'] as const;

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f3f4f6', fg: '#374151' },
  sent: { bg: '#dbeafe', fg: '#1e40af' },
  signed: { bg: '#dcfce7', fg: '#166534' },
  active: { bg: '#d1fae5', fg: '#065f46' },
  completed: { bg: '#f1f5f9', fg: '#475569' },
  terminated: { bg: '#fee2e2', fg: '#991b1b' },
};

// DB CHECK contract_amendment.status
const AMENDMENT_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f3f4f6', fg: '#374151' },
  sent: { bg: '#fef3c7', fg: '#92400e' },
  signed: { bg: '#dcfce7', fg: '#166534' },
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

  const {
    data: contracts = [],
    isLoading,
    error,
  } = useQuery<Contract[], ApiError>({
    queryKey: ['contracts', statusFilter],
    queryFn: () => {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      return apiGet<Contract[]>(`/contracts${params}`);
    },
    retry: false,
  });

  const { data: acceptedOffers = [] } = useQuery<Offer[], ApiError>({
    queryKey: ['offers-accepted'],
    queryFn: () => apiGet<Offer[]>('/offers?status=accepted'),
    enabled: showForm,
    retry: false,
  });

  const {
    data: contractDetail,
  } = useQuery<Contract, ApiError>({
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

  /* --- Render: Auth error --- */

  if (error instanceof ApiError && error.status === 401) {
    return <div style={{ color: '#ef4444', padding: 20 }}>{t('loginRequired')}</div>;
  }

  /* --- Render: Detail view --- */

  if (selectedContractId && contractDetail) {
    const c = contractDetail;
    const colors = STATUS_COLORS[c.status] ?? STATUS_COLORS.draft;
    const amendments = c.amendments ?? [];

    return (
      <div>
        {/* Back nav */}
        <button
          onClick={() => setSelectedContractId(null)}
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
          &larr; {t('detail.back')}
        </button>

        {/* Header */}
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
              {c.reference || t('detail.fallbackTitle')}
            </h1>
            <div style={{ fontSize: 14, color: '#6b7280', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span>{c.client?.name ?? '-'}</span>
              <span style={{ color: '#d1d5db' }}>|</span>
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 10px',
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  background: colors.bg,
                  color: colors.fg,
                }}
              >
                {statusLabel('contract', c.status)}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {(c.status === 'draft' || c.status === 'sent') && (
              <button
                style={buttonStyle}
                onClick={() => signMutation.mutate()}
                disabled={signMutation.isPending}
              >
                {signMutation.isPending ? t('detail.signing') : t('detail.sign')}
              </button>
            )}
          </div>
        </div>

        {(signMutation.error || updateNotesMutation.error) && (
          <div style={{ color: '#ef4444', fontSize: 13, marginTop: -12, marginBottom: 16 }}>
            {errorMessage(signMutation.error || updateNotesMutation.error)}
          </div>
        )}

        {/* Info cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 16,
            marginBottom: 32,
          }}
        >
          <SummaryCard label={t('detail.summary.totalTtc')} value={formatMoney(c.totalTtcCents ?? 0)} highlight />
          <SummaryCard label={t('detail.summary.retentionRate')} value={`${(c.retentionRate / 100).toFixed(1)} %`} />
          <SummaryCard label={t('detail.summary.esignature')} value={statusLabel('esignature', c.esignatureStatus ?? 'none')} />
          <SummaryCard
            label={t('detail.summary.signedAt')}
            value={c.signedAt ? formatDate(c.signedAt) : t('detail.summary.notSigned')}
          />
        </div>

        {/* Links */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
          {c.offerId && (
            <button
              style={buttonSecondaryStyle}
              onClick={() => navigate(`/offers/${c.offerId}`)}
            >
              {t('detail.viewOffer')}
            </button>
          )}
          {c.projectId && (
            <button
              style={buttonSecondaryStyle}
              onClick={() => navigate(`/projects/${c.projectId}`)}
            >
              {t('detail.viewProject')}
            </button>
          )}
        </div>

        {/* Amendments section */}
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
              {t('amendments.title', { count: amendments.length })}
            </h2>
            <button
              style={buttonStyle}
              onClick={() => setShowAmendmentForm(!showAmendmentForm)}
            >
              {showAmendmentForm ? t('common:actions.cancel') : t('amendments.add')}
            </button>
          </div>

          {showAmendmentForm && (
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
                  gridTemplateColumns: '2fr 1fr',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <input
                  style={inputStyle}
                  placeholder={t('amendments.form.description')}
                  value={amendmentForm.description}
                  onChange={(e) =>
                    setAmendmentForm({ ...amendmentForm, description: e.target.value })
                  }
                />
                <input
                  style={inputStyle}
                  type="number"
                  step="0.05"
                  placeholder={t('amendments.form.amountDelta')}
                  value={amendmentForm.amountDeltaChf}
                  onChange={(e) =>
                    setAmendmentForm({
                      ...amendmentForm,
                      amountDeltaChf: e.target.value,
                    })
                  }
                />
              </div>
              <button
                style={buttonStyle}
                onClick={() =>
                  amendmentForm.description.trim() && addAmendmentMutation.mutate(amendmentForm)
                }
                disabled={addAmendmentMutation.isPending}
              >
                {addAmendmentMutation.isPending ? t('amendments.adding') : t('amendments.submit')}
              </button>
              {addAmendmentMutation.error && (
                <span style={{ color: '#ef4444', marginLeft: 12, fontSize: 13 }}>
                  {errorMessage(addAmendmentMutation.error)}
                </span>
              )}
            </div>
          )}

          {amendments.length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 14 }}>{t('amendments.empty')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[
                    t('amendments.table.number'),
                    t('amendments.table.description'),
                    t('amendments.table.amountDelta'),
                    t('amendments.table.status'),
                    t('amendments.table.createdAt'),
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
                {amendments.map((a) => {
                  const aColors = AMENDMENT_STATUS_COLORS[a.status] ?? AMENDMENT_STATUS_COLORS.draft;
                  return (
                    <tr key={a.id}>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                        {a.amendmentNumber}
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
                        {a.description}
                      </td>
                      <td
                        style={{
                          padding: '8px 10px',
                          borderBottom: '1px solid #f3f4f6',
                          fontSize: 14,
                          fontVariantNumeric: 'tabular-nums',
                          color: a.amountDeltaCents < 0 ? '#ef4444' : '#111827',
                        }}
                      >
                        {a.amountDeltaCents < 0 ? '-' : '+'}{formatMoney(Math.abs(a.amountDeltaCents))}
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            background: aColors.bg,
                            color: aColors.fg,
                          }}
                        >
                          {statusLabel('amendment', a.status)}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 13, color: '#6b7280' }}>
                        {formatDate(a.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Notes section */}
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: 0 }}>{t('notes.title')}</h2>
            {!editingNotes && (
              <button
                style={buttonSecondaryStyle}
                onClick={() => {
                  setNotesValue(c.notes ?? '');
                  setEditingNotes(true);
                }}
              >
                {t('notes.edit')}
              </button>
            )}
          </div>

          {editingNotes ? (
            <div>
              <textarea
                style={{
                  ...inputStyle,
                  minHeight: 100,
                  resize: 'vertical',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  style={buttonStyle}
                  onClick={() => updateNotesMutation.mutate(notesValue)}
                  disabled={updateNotesMutation.isPending}
                >
                  {updateNotesMutation.isPending ? t('common:actions.saving') : t('notes.save')}
                </button>
                <button
                  style={buttonSecondaryStyle}
                  onClick={() => setEditingNotes(false)}
                >
                  {t('common:actions.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                fontSize: 14,
                color: c.notes ? '#374151' : '#9ca3af',
                whiteSpace: 'pre-wrap',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 16,
                minHeight: 60,
              }}
            >
              {c.notes || t('notes.empty')}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* --- Render: List view --- */

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>
          {t('title')}
        </h1>
        <button style={buttonStyle} onClick={() => setShowForm(!showForm)}>
          {showForm ? t('common:actions.cancel') : t('actions.createFromOffer')}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div
          style={{
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              {t('form.selectLabel')}
            </label>
            <select
              style={{ ...inputStyle, maxWidth: 400 }}
              value={createForm.offerId}
              onChange={(e) => setCreateForm({ offerId: e.target.value })}
            >
              <option value="">{t('form.selectOffer')}</option>
              {acceptedOffers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.reference || o.projectName} - {o.client?.name ?? ''} ({formatMoney(o.totalTtcCents ?? 0)})
                </option>
              ))}
            </select>
          </div>
          <button
            style={buttonStyle}
            onClick={() => createForm.offerId && createMutation.mutate(createForm)}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? t('actions.creating') : t('actions.create')}
          </button>
          {createMutation.error && (
            <span style={{ color: '#ef4444', marginLeft: 12, fontSize: 13 }}>
              {errorMessage(createMutation.error)}
            </span>
          )}
        </div>
      )}

      {/* Status filter */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select
          style={{ ...inputStyle, maxWidth: 200 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">{t('filters.allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel('contract', s)}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ color: '#6b7280', padding: 20 }}>{t('common:state.loading')}</div>
      ) : error ? (
        <div style={{ color: '#ef4444', padding: 20 }}>{errorMessage(error)}</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {[
                t('table.reference'),
                t('table.client'),
                t('table.offer'),
                t('table.status'),
                t('table.totalTtc'),
                t('table.signedAt'),
                t('table.createdAt'),
              ].map(
                (h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderBottom: '2px solid #e5e7eb',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}
                >
                  {t('empty')}
                </td>
              </tr>
            )}
            {contracts.map((contract) => {
              const colors = STATUS_COLORS[contract.status] ?? STATUS_COLORS.draft;
              return (
                <tr
                  key={contract.id}
                  onClick={() => setSelectedContractId(contract.id)}
                  style={{ cursor: 'pointer' }}
                  onMouseOver={(e) => {
                    (e.currentTarget as HTMLElement).style.background = '#f9fafb';
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLElement).style.background = '';
                  }}
                >
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontWeight: 500 }}>
                    {contract.reference || '-'}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    {contract.client?.name ?? '-'}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 13, color: '#6b7280' }}>
                    {contract.offer?.reference ?? contract.offer?.projectName ?? '-'}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                        background: colors.bg,
                        color: colors.fg,
                      }}
                    >
                      {statusLabel('contract', contract.status)}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(contract.totalTtcCents ?? 0)}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 13, color: '#6b7280' }}>
                    {formatDate(contract.signedAt)}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 13, color: '#6b7280' }}>
                    {formatDate(contract.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SummaryCard                                                        */
/* ------------------------------------------------------------------ */

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
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
    </div>
  );
}
