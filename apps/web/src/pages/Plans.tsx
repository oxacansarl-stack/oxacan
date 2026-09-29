import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { enumLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';

interface Plan {
  id: string;
  name: string;
  fileUrl: string;
  fileType: string;
  floor: string;
  scale: string;
  version: number;
  annotations?: Annotation[];
}

interface Annotation {
  id: string;
  type: string;
  label: string | null;
  color: string;
  geometry: Record<string, unknown>;
}

type PlanForm = {
  name: string;
  fileUrl: string;
  fileType: string;
  floor: string;
  scale: string;
};

const EMPTY_FORM: PlanForm = { name: '', fileUrl: '', fileType: 'pdf', floor: '', scale: '1:50' };

/** Drop empty optional fields so the payload matches CreatePlanDto. */
function toCreatePayload(form: PlanForm): Record<string, string> {
  const payload: Record<string, string> = {
    name: form.name.trim(),
    fileUrl: form.fileUrl.trim(),
    fileType: form.fileType,
  };
  if (form.floor.trim()) payload.floor = form.floor.trim();
  if (form.scale.trim()) payload.scale = form.scale.trim();
  return payload;
}

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

// Values must match the plan.file_type CHECK constraint (lower-case).
const FILE_TYPES = ['pdf', 'dwg', 'dxf', 'png', 'jpg'] as const;

export default function Plans() {
  const { t } = useTranslation('plans');
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);

  const { data: plans = [], isLoading, error } = useQuery<Plan[], ApiError>({
    queryKey: ['plans'],
    queryFn: () => apiGet<Plan[]>('/plans'),
    retry: false,
  });

  const { data: planDetail } = useQuery<Plan, ApiError>({
    queryKey: ['plan', selectedPlanId],
    queryFn: () => apiGet<Plan>(`/plans/${selectedPlanId}`),
    enabled: !!selectedPlanId,
    retry: false,
  });

  const createMutation = useMutation<Plan, ApiError, PlanForm>({
    mutationFn: (data) => apiPost<Plan>('/plans', toCreatePayload(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
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
          {showForm ? t('common:actions.cancel') : t('actions.upload')}
        </button>
      </div>

      {/* Upload form */}
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
              gridTemplateColumns: '1fr 1fr',
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
            <input
              style={inputStyle}
              placeholder={t('form.fileUrl')}
              value={form.fileUrl}
              onChange={(e) => setForm({ ...form, fileUrl: e.target.value })}
            />
            <select
              style={inputStyle}
              value={form.fileType}
              onChange={(e) => setForm({ ...form, fileType: e.target.value })}
            >
              {FILE_TYPES.map((ft) => (
                <option key={ft} value={ft}>
                  {enumLabel('fileType', ft)}
                </option>
              ))}
            </select>
            <input
              style={inputStyle}
              placeholder={t('form.floor')}
              value={form.floor}
              onChange={(e) => setForm({ ...form, floor: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder={t('form.scale')}
              value={form.scale}
              onChange={(e) => setForm({ ...form, scale: e.target.value })}
            />
          </div>
          <button
            style={buttonStyle}
            onClick={() => form.name && createMutation.mutate(form)}
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

      {/* Plans grid */}
      {isLoading ? (
        <div style={{ color: '#6b7280', padding: 20 }}>{t('common:state.loading')}</div>
      ) : error ? (
        <div style={{ color: '#ef4444', padding: 20 }}>{errorMessage(error, t('messages.loadFailed'))}</div>
      ) : plans.length === 0 ? (
        <div style={{ color: '#9ca3af', padding: 20, textAlign: 'center' }}>
          {t('empty.plans')}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {plans.map((plan) => (
            <div
              key={plan.id}
              onClick={() =>
                setSelectedPlanId(selectedPlanId === plan.id ? null : plan.id)
              }
              style={{
                background: selectedPlanId === plan.id ? '#eff6ff' : '#fff',
                border: `1px solid ${selectedPlanId === plan.id ? '#93c5fd' : '#e5e7eb'}`,
                borderRadius: 8,
                padding: 16,
                cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}
              onMouseOver={(e) => {
                if (selectedPlanId !== plan.id)
                  (e.currentTarget as HTMLElement).style.borderColor = '#93c5fd';
              }}
              onMouseOut={(e) => {
                if (selectedPlanId !== plan.id)
                  (e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb';
              }}
            >
              {/* File type icon placeholder */}
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  background: '#dbeafe',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#2563eb',
                  marginBottom: 12,
                }}
              >
                {enumLabel('fileType', plan.fileType)}
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#111827',
                  marginBottom: 8,
                }}
              >
                {plan.name}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 4,
                  fontSize: 13,
                  color: '#6b7280',
                }}
              >
                <span>{t('card.floor', { value: plan.floor || '—' })}</span>
                <span>{t('card.scale', { value: plan.scale || '—' })}</span>
                <span>{t('card.type', { value: enumLabel('fileType', plan.fileType) })}</span>
                <span>{t('card.version', { version: plan.version ?? 1 })}</span>
              </div>

              {/* Annotations panel */}
              {selectedPlanId === plan.id && planDetail && (
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: '1px solid #e5e7eb',
                  }}
                >
                  <h4
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#374151',
                      marginBottom: 6,
                      marginTop: 0,
                    }}
                  >
                    {t('annotations.title')}
                  </h4>
                  {planDetail.annotations && planDetail.annotations.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
                      {planDetail.annotations.map((a) => (
                        <li key={a.id} style={{ color: '#4b5563', marginBottom: 4 }}>
                          <strong>{a.label || enumLabel('annotationType', a.type)}</strong> : {enumLabel('annotationType', a.type)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>
                      {t('annotations.empty')}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
