import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, ApiError } from '../lib/api';

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
    return <div style={{ color: '#ef4444', padding: 20 }}>Login required</div>;
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
          Plans
        </h1>
        <button style={buttonStyle} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Upload Plan'}
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
              placeholder="Plan name *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder="File URL (placeholder)"
              value={form.fileUrl}
              onChange={(e) => setForm({ ...form, fileUrl: e.target.value })}
            />
            <select
              style={inputStyle}
              value={form.fileType}
              onChange={(e) => setForm({ ...form, fileType: e.target.value })}
            >
              {FILE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </select>
            <input
              style={inputStyle}
              placeholder="Floor (e.g. RDC, 1er, Sous-sol)"
              value={form.floor}
              onChange={(e) => setForm({ ...form, floor: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder="Scale (e.g. 1:50)"
              value={form.scale}
              onChange={(e) => setForm({ ...form, scale: e.target.value })}
            />
          </div>
          <button
            style={buttonStyle}
            onClick={() => form.name && createMutation.mutate(form)}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Plan'}
          </button>
          {createMutation.error && (
            <span style={{ color: '#ef4444', marginLeft: 12, fontSize: 13 }}>
              {createMutation.error.message}
            </span>
          )}
        </div>
      )}

      {/* Plans grid */}
      {isLoading ? (
        <div style={{ color: '#6b7280', padding: 20 }}>Loading...</div>
      ) : error ? (
        <div style={{ color: '#ef4444', padding: 20 }}>{error.message}</div>
      ) : plans.length === 0 ? (
        <div style={{ color: '#9ca3af', padding: 20, textAlign: 'center' }}>
          No plans yet
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
                {plan.fileType.toUpperCase()}
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
                <span>Floor: {plan.floor || '—'}</span>
                <span>Scale: {plan.scale || '—'}</span>
                <span>Type: {plan.fileType.toUpperCase()}</span>
                <span>v{plan.version ?? 1}</span>
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
                    Annotations
                  </h4>
                  {planDetail.annotations && planDetail.annotations.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
                      {planDetail.annotations.map((a) => (
                        <li key={a.id} style={{ color: '#4b5563', marginBottom: 4 }}>
                          <strong>{a.label || a.type}</strong>: {a.type}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>
                      No annotations
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
