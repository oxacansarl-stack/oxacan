import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, ApiError, formatCHF } from '../lib/api';

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
  clientId: string;
  client?: Client;
  reference: string;
  status: string;
  version: number;
  marginFactor: number;
  vatRateBps: number;
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
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

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f3f4f6', fg: '#374151' },
  in_progress: { bg: '#dbeafe', fg: '#1e40af' },
  submitted: { bg: '#fef3c7', fg: '#92400e' },
  accepted: { bg: '#dcfce7', fg: '#166534' },
  rejected: { bg: '#fee2e2', fg: '#991b1b' },
  archived: { bg: '#f3f4f6', fg: '#6b7280' },
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Offers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    projectName: '',
    clientId: '',
    reference: '',
    marginFactor: 120,
    vatRateBps: 810,
  });

  /* --- Queries --- */

  const {
    data: offers = [],
    isLoading,
    error,
  } = useQuery<Offer[], ApiError>({
    queryKey: ['offers', statusFilter],
    queryFn: () => {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      return apiGet<Offer[]>(`/offers${params}`);
    },
    retry: false,
  });

  const { data: clients = [] } = useQuery<Client[], ApiError>({
    queryKey: ['clients-list'],
    queryFn: () => apiGet<Client[]>('/clients'),
    retry: false,
  });

  /* --- Mutations --- */

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiPost<Offer>('/offers', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      setShowForm(false);
      setForm({ projectName: '', clientId: '', reference: '', marginFactor: 120, vatRateBps: 810 });
    },
  });

  /* --- Derived --- */

  const clientMap = new Map(clients.map((c) => [c.id, c.name]));

  const filtered = offers.filter((o) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      o.projectName.toLowerCase().includes(term) ||
      (o.reference ?? '').toLowerCase().includes(term)
    );
  });

  /* --- Render --- */

  if (error instanceof ApiError && error.status === 401) {
    return <div style={{ color: '#ef4444', padding: 20 }}>Login required</div>;
  }

  function statusLabel(s: string) {
    return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

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
          Offers
        </h1>
        <button style={buttonStyle} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New Offer'}
        </button>
      </div>

      {/* --- Create form --- */}
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <input
              style={inputStyle}
              placeholder="Project Name *"
              value={form.projectName}
              onChange={(e) => setForm({ ...form, projectName: e.target.value })}
            />
            <select
              style={inputStyle}
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            >
              <option value="">Select Client *</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              style={inputStyle}
              placeholder="Reference"
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
            <div>
              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                Margin Factor (e.g. 120 = 1.20x)
              </label>
              <input
                style={inputStyle}
                type="number"
                value={form.marginFactor}
                onChange={(e) => setForm({ ...form, marginFactor: Number(e.target.value) })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                VAT Rate bps (e.g. 810 = 8.10%)
              </label>
              <input
                style={inputStyle}
                type="number"
                value={form.vatRateBps}
                onChange={(e) => setForm({ ...form, vatRateBps: Number(e.target.value) })}
              />
            </div>
          </div>
          <button
            style={buttonStyle}
            onClick={() =>
              form.projectName && form.clientId && createMutation.mutate(form)
            }
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Offer'}
          </button>
          {createMutation.error && (
            <span style={{ color: '#ef4444', marginLeft: 12, fontSize: 13 }}>
              {createMutation.error.message}
            </span>
          )}
        </div>
      )}

      {/* --- Filters --- */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input
          style={{ ...inputStyle, maxWidth: 300 }}
          placeholder="Search by project name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={{ ...inputStyle, maxWidth: 200 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      {/* --- Table --- */}
      {isLoading ? (
        <div style={{ color: '#6b7280', padding: 20 }}>Loading...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Project Name', 'Client', 'Status', 'Total TTC (CHF)', 'Version', 'Created'].map(
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
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}
                >
                  No offers found
                </td>
              </tr>
            )}
            {filtered.map((offer) => {
              const colors = STATUS_COLORS[offer.status] ?? STATUS_COLORS.draft;
              const clientName = offer.client?.name ?? clientMap.get(offer.clientId) ?? '-';
              return (
                <tr
                  key={offer.id}
                  onClick={() => navigate(`/offers/${offer.id}`)}
                  style={{ cursor: 'pointer' }}
                  onMouseOver={(e) => {
                    (e.currentTarget as HTMLElement).style.background = '#f9fafb';
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLElement).style.background = '';
                  }}
                >
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontWeight: 500 }}>
                    {offer.projectName}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    {clientName}
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
                      {statusLabel(offer.status)}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', fontVariantNumeric: 'tabular-nums' }}>
                    CHF {formatCHF(offer.totalTtcCents ?? 0)}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    v{offer.version ?? 1}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', color: '#6b7280', fontSize: 13 }}>
                    {offer.createdAt ? new Date(offer.createdAt).toLocaleDateString('fr-CH') : '-'}
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
