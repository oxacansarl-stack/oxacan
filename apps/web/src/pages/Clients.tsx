import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { enumLabel, formatDate } from '../lib/format';
import { errorMessage } from '../lib/errors';

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

export default function Clients() {
  const { t } = useTranslation('clients');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM);

  const { data: clients = [], isLoading, error } = useQuery<Client[], ApiError>({
    queryKey: ['clients', stageFilter],
    queryFn: () => {
      const params = stageFilter ? `&stage=${encodeURIComponent(stageFilter)}` : '';
      return apiGet<Client[]>(`/clients?limit=100${params}`);
    },
    retry: false,
  });

  const createMutation = useMutation<Client, ApiError, ClientForm>({
    mutationFn: (data) => apiPost<Client>('/clients', toCreatePayload(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
  });

  const { data: clientDetail } = useQuery<Client, ApiError>({
    queryKey: ['client', expandedId],
    queryFn: () => apiGet<Client>(`/clients/${expandedId}`),
    enabled: !!expandedId,
    retry: false,
  });

  const filtered = clients.filter((c) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      c.city?.toLowerCase().includes(term) ||
      c.phone?.includes(term)
    );
  });

  if (error instanceof ApiError && error.status === 401) {
    return <div style={{ color: '#ef4444', padding: 20 }}>{t('common:auth.sessionExpired')}</div>;
  }

  return (
    <div>
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
          {showForm ? t('common:actions.cancel') : t('actions.new')}
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
              placeholder={t('form.name')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <select
              style={inputStyle}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {CLIENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {enumLabel('clientType', value)}
                </option>
              ))}
            </select>
            <input
              style={inputStyle}
              placeholder={t('form.email')}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder={t('form.phone')}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder={t('form.city')}
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder={t('form.canton')}
              value={form.canton}
              onChange={(e) => setForm({ ...form, canton: e.target.value })}
            />
          </div>
          <button
            style={buttonStyle}
            onClick={() => form.name.trim() && createMutation.mutate(form)}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? t('actions.creating') : t('actions.create')}
          </button>
          {createMutation.error && (
            <span style={{ color: '#ef4444', marginLeft: 12, fontSize: 13 }}>
              {errorMessage(createMutation.error, t('messages.createFailed'))}
            </span>
          )}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input
          style={{ ...inputStyle, maxWidth: 300 }}
          placeholder={t('filters.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={{ ...inputStyle, maxWidth: 200 }}
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
        >
          <option value="">{t('filters.allStages')}</option>
          {PIPELINE_STAGES.map((s) => (
            <option key={s} value={s}>
              {t(`stage.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ color: '#6b7280', padding: 20 }}>{t('common:state.loading')}</div>
      ) : error ? (
        <div style={{ color: '#ef4444', padding: 20 }}>{errorMessage(error, t('messages.loadFailed'))}</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {[t('table.name'), t('table.type'), t('table.stage'), t('table.city'), t('table.phone')].map((h) => (
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
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}
                >
                  {t('empty.clients')}
                </td>
              </tr>
            )}
            {filtered.map((client) => (
              <React.Fragment key={client.id}>
                <tr
                  onClick={() =>
                    setExpandedId(expandedId === client.id ? null : client.id)
                  }
                  style={{
                    cursor: 'pointer',
                    background: expandedId === client.id ? '#eff6ff' : undefined,
                  }}
                  onMouseOver={(e) => {
                    if (expandedId !== client.id)
                      (e.currentTarget as HTMLElement).style.background = '#f9fafb';
                  }}
                  onMouseOut={(e) => {
                    if (expandedId !== client.id)
                      (e.currentTarget as HTMLElement).style.background = '';
                  }}
                >
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    {client.name}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    {enumLabel('clientType', client.type)}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                        background:
                          client.pipelineStage === 'active'
                            ? '#dcfce7'
                            : client.pipelineStage === 'qualified'
                              ? '#dbeafe'
                              : client.pipelineStage === 'prospect'
                                ? '#fef3c7'
                                : '#f3f4f6',
                        color:
                          client.pipelineStage === 'active'
                            ? '#166534'
                            : client.pipelineStage === 'qualified'
                              ? '#1e40af'
                              : client.pipelineStage === 'prospect'
                                ? '#92400e'
                                : '#374151',
                      }}
                    >
                      {client.pipelineStage ? t(`stage.${client.pipelineStage}`, { defaultValue: client.pipelineStage }) : ''}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    {client.city}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    {client.phone}
                  </td>
                </tr>

                {/* Expanded detail */}
                {expandedId === client.id && clientDetail && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        padding: '16px 12px',
                        borderBottom: '1px solid #e5e7eb',
                        background: '#f9fafb',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 32 }}>
                        {/* Contacts */}
                        <div style={{ flex: 1 }}>
                          <h3
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: '#374151',
                              marginBottom: 8,
                              marginTop: 0,
                            }}
                          >
                            {t('detail.contacts')}
                          </h3>
                          {clientDetail.contacts && clientDetail.contacts.length > 0 ? (
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                              {clientDetail.contacts.map((c) => (
                                <li
                                  key={c.id}
                                  style={{ fontSize: 13, color: '#4b5563', marginBottom: 4 }}
                                >
                                  <strong>
                                    {c.firstName} {c.lastName}
                                  </strong>
                                  {c.role ? ` (${c.role})` : ''} — {c.email}{' '}
                                  {c.phone}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>
                              {t('empty.contacts')}
                            </p>
                          )}
                        </div>

                        {/* Interactions */}
                        <div style={{ flex: 1 }}>
                          <h3
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: '#374151',
                              marginBottom: 8,
                              marginTop: 0,
                            }}
                          >
                            {t('detail.interactions')}
                          </h3>
                          {clientDetail.interactions &&
                          clientDetail.interactions.length > 0 ? (
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                              {clientDetail.interactions.map((i) => (
                                <li
                                  key={i.id}
                                  style={{ fontSize: 13, color: '#4b5563', marginBottom: 4 }}
                                >
                                  <strong>{enumLabel('interactionType', i.type)}</strong> —{' '}
                                  {formatDate(i.interactionDate)} :{' '}
                                  {i.subject || i.body}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>
                              {t('empty.interactions')}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
