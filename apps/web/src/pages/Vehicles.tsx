import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiList, apiPost, apiPut, apiDelete } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatNumber } from '../lib/format';
import type { PageProps } from '../lib/page-props';

interface Vehicle {
  id: string;
  registration: string;
  make?: string;
  model?: string;
  assignedTeamId?: string;
  assignedTeam?: { name: string } | null;
  assignedProjectId?: string;
  assignedProject?: { name: string } | null;
  odometerKm?: number;
  nextServiceDate?: string;
  insuranceExpiry?: string;
  createdAt: string;
}

interface Team {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  reference?: string;
}

interface VehicleForm {
  registration: string;
  make: string;
  model: string;
  assignedTeamId: string;
  assignedProjectId: string;
  odometerKm: string;
  nextServiceDate: string;
  insuranceExpiry: string;
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

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const emptyForm: VehicleForm = {
  registration: '',
  make: '',
  model: '',
  assignedTeamId: '',
  assignedProjectId: '',
  odometerKm: '',
  nextServiceDate: '',
  insuranceExpiry: '',
};

export default function Vehicles({ embedded = false }: PageProps) {
  const { t } = useTranslation('vehicles');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const fetchVehicles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { items, meta } = await apiList<Vehicle>(`/vehicles?page=${page}`);
      setVehicles(items);
      setTotal(meta?.total ?? items.length);
      setTotalPages(Math.max(1, meta?.totalPages ?? 1));
    } catch (err: any) {
      setError(errorMessage(err, t('messages.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [page, t]);

  const fetchDropdowns = useCallback(async () => {
    try {
      const [teamsRes, projectsRes] = await Promise.all([
        apiGet<Team[]>('/hr/teams'),
        apiGet<Project[]>('/projects'),
      ]);
      setTeams(teamsRes ?? []);
      setProjects(projectsRes ?? []);
    } catch {
      // Dropdowns are non-critical; silently ignore
    }
  }, []);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  useEffect(() => {
    fetchDropdowns();
  }, [fetchDropdowns]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (v: Vehicle) => {
    setEditingId(v.id);
    setForm({
      registration: v.registration,
      make: v.make ?? '',
      model: v.model ?? '',
      assignedTeamId: v.assignedTeamId ?? '',
      assignedProjectId: v.assignedProjectId ?? '',
      odometerKm: v.odometerKm != null ? String(v.odometerKm) : '',
      nextServiceDate: v.nextServiceDate ? v.nextServiceDate.slice(0, 10) : '',
      insuranceExpiry: v.insuranceExpiry ? v.insuranceExpiry.slice(0, 10) : '',
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleChange = (field: keyof VehicleForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!form.registration.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, any> = {
        registration: form.registration.trim(),
      };
      if (form.make.trim()) body.make = form.make.trim();
      if (form.model.trim()) body.model = form.model.trim();
      if (form.assignedTeamId) body.assignedTeamId = form.assignedTeamId;
      if (form.assignedProjectId) body.assignedProjectId = form.assignedProjectId;

      if (editingId) {
        if (form.odometerKm.trim()) body.odometerKm = Math.round(Number(form.odometerKm));
        if (form.nextServiceDate) body.nextServiceDate = form.nextServiceDate;
        if (form.insuranceExpiry) body.insuranceExpiry = form.insuranceExpiry;
        await apiPut(`/vehicles/${editingId}`, body);
      } else {
        await apiPost('/vehicles', body);
      }
      closeForm();
      await fetchVehicles();
    } catch (err: any) {
      setError(errorMessage(err, t('messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await apiDelete(`/vehicles/${id}`);
      setDeleteConfirmId(null);
      await fetchVehicles();
    } catch (err: any) {
      setError(errorMessage(err, t('messages.deleteFailed')));
    } finally {
      setDeleting(false);
    }
  };

  const renderServiceBadge = (v: Vehicle) => {
    const days = daysUntil(v.nextServiceDate);
    if (days === null) return null;
    if (days < 0) {
      return (
        <span style={{ ...badgeBase, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {t('badges.serviceOverdue')}
        </span>
      );
    }
    if (days <= 30) {
      return (
        <span style={{ ...badgeBase, background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>
          {t('badges.serviceSoon')}
        </span>
      );
    }
    return (
      <span style={{ ...badgeBase, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
        {t('badges.serviceOk')}
      </span>
    );
  };

  const renderInsuranceBadge = (v: Vehicle) => {
    const days = daysUntil(v.insuranceExpiry);
    if (days === null) return null;
    if (days < 0) {
      return (
        <span style={{ ...badgeBase, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {t('badges.insuranceExpired')}
        </span>
      );
    }
    if (days <= 30) {
      return (
        <span style={{ ...badgeBase, background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>
          {t('badges.insuranceExpiring')}
        </span>
      );
    }
    return (
      <span style={{ ...badgeBase, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
        {t('badges.insured')}
      </span>
    );
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#111827' }}>{t('title')}</h1>
          <span style={{ fontSize: 14, color: '#6b7280' }}>
            {t('count', { count: total })}
          </span>
        </div>
        <button style={btnPrimary} onClick={openCreate}>
          {t('actions.add')}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: 16,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            color: '#dc2626',
            fontSize: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16 }}
          >
            x
          </button>
        </div>
      )}

      {/* Create / Edit form */}
      {showForm && (
        <div
          style={{
            marginBottom: 24,
            padding: 20,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          <h2 style={{ margin: '0 0 16px 0', fontSize: 18, fontWeight: 600, color: '#111827' }}>
            {editingId ? t('form.editTitle') : t('form.newTitle')}
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {/* Registration */}
            <div>
              <label style={labelStyle}>{t('form.registration')}</label>
              <input
                style={inputStyle}
                value={form.registration}
                onChange={(e) => handleChange('registration', e.target.value)}
                placeholder={t('form.registrationPlaceholder')}
              />
            </div>

            {/* Make */}
            <div>
              <label style={labelStyle}>{t('form.make')}</label>
              <input
                style={inputStyle}
                value={form.make}
                onChange={(e) => handleChange('make', e.target.value)}
                placeholder={t('form.makePlaceholder')}
              />
            </div>

            {/* Model */}
            <div>
              <label style={labelStyle}>{t('form.model')}</label>
              <input
                style={inputStyle}
                value={form.model}
                onChange={(e) => handleChange('model', e.target.value)}
                placeholder={t('form.modelPlaceholder')}
              />
            </div>

            {/* Assigned Team */}
            <div>
              <label style={labelStyle}>{t('form.assignedTeam')}</label>
              <select
                style={inputStyle}
                value={form.assignedTeamId}
                onChange={(e) => handleChange('assignedTeamId', e.target.value)}
              >
                <option value="">{t('form.none')}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Assigned Project */}
            <div>
              <label style={labelStyle}>{t('form.assignedProject')}</label>
              <select
                style={inputStyle}
                value={form.assignedProjectId}
                onChange={(e) => handleChange('assignedProjectId', e.target.value)}
              >
                <option value="">{t('form.none')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.reference ? `${p.reference} - ${p.name}` : p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Edit-only fields */}
            {editingId && (
              <>
                <div>
                  <label style={labelStyle}>{t('form.odometer')}</label>
                  <input
                    style={inputStyle}
                    type="number"
                    value={form.odometerKm}
                    onChange={(e) => handleChange('odometerKm', e.target.value)}
                    placeholder={t('form.odometerPlaceholder')}
                  />
                </div>

                <div>
                  <label style={labelStyle}>{t('form.nextServiceDate')}</label>
                  <input
                    style={inputStyle}
                    type="date"
                    value={form.nextServiceDate}
                    onChange={(e) => handleChange('nextServiceDate', e.target.value)}
                  />
                </div>

                <div>
                  <label style={labelStyle}>{t('form.insuranceExpiry')}</label>
                  <input
                    style={inputStyle}
                    type="date"
                    value={form.insuranceExpiry}
                    onChange={(e) => handleChange('insuranceExpiry', e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button style={btnPrimary} onClick={handleSubmit} disabled={saving}>
              {saving ? t('common:actions.saving') : editingId ? t('actions.update') : t('common:actions.create')}
            </button>
            <button style={btnOutline} onClick={closeForm} disabled={saving}>
              {t('common:actions.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: '#6b7280', fontSize: 15 }}>
          {t('state.loading')}
        </div>
      )}

      {/* Empty state */}
      {!loading && vehicles.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: 48,
            background: '#f8f9fa',
            borderRadius: 10,
            border: '1px dashed #d1d5db',
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>&#128666;</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 4 }}>{t('empty.title')}</div>
          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
            {t('empty.text')}
          </div>
          <button style={btnPrimary} onClick={openCreate}>
            {t('actions.add')}
          </button>
        </div>
      )}

      {/* Vehicle grid */}
      {!loading && vehicles.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 20,
          }}
        >
          {vehicles.map((v) => (
            <div
              key={v.id}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                overflow: 'hidden',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* License plate header */}
              <div
                style={{
                  background: '#111827',
                  color: '#fff',
                  padding: '14px 16px',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    padding: '6px 20px',
                    border: '2px solid #fff',
                    borderRadius: 6,
                    fontSize: 20,
                    fontWeight: 700,
                    letterSpacing: 2,
                    fontFamily: 'monospace',
                  }}
                >
                  {v.registration}
                </div>
                {v.make || v.model ? (
                  <div style={{ marginTop: 6, fontSize: 13, color: '#9ca3af' }}>
                    {[v.make, v.model].filter(Boolean).join(' ')}
                  </div>
                ) : null}
              </div>

              {/* Card body */}
              <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Team */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <span style={{ color: '#6b7280', minWidth: 60 }}>{t('card.team')}</span>
                  <span style={{ color: v.assignedTeam ? '#111827' : '#9ca3af', fontWeight: v.assignedTeam ? 500 : 400 }}>
                    {v.assignedTeam?.name ?? t('card.unassigned')}
                  </span>
                </div>

                {/* Project */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <span style={{ color: '#6b7280', minWidth: 60 }}>{t('card.project')}</span>
                  <span style={{ color: v.assignedProject ? '#111827' : '#9ca3af', fontWeight: v.assignedProject ? 500 : 400 }}>
                    {v.assignedProject?.name ?? t('card.noProject')}
                  </span>
                </div>

                {/* Odometer */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <span style={{ color: '#6b7280', minWidth: 60 }}>{t('card.odometer')}</span>
                  <span style={{ color: '#111827', fontWeight: 500 }}>
                    {v.odometerKm != null ? t('card.odometerValue', { value: formatNumber(v.odometerKm) }) : '-'}
                  </span>
                </div>

                {/* Badges */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {renderServiceBadge(v)}
                  {renderInsuranceBadge(v)}
                </div>

                {/* Created at */}
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 'auto', paddingTop: 8 }}>
                  {t('card.added', { date: formatDate(v.createdAt) })}
                </div>
              </div>

              {/* Card actions */}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: '12px 16px',
                  borderTop: '1px solid #f3f4f6',
                  background: '#fafafa',
                }}
              >
                {deleteConfirmId === v.id ? (
                  <>
                    <span style={{ fontSize: 13, color: '#dc2626', alignSelf: 'center', flex: 1 }}>
                      {t('card.deleteConfirm')}
                    </span>
                    <button
                      style={btnDanger}
                      onClick={() => handleDelete(v.id)}
                      disabled={deleting}
                    >
                      {deleting ? t('actions.deleting') : t('common:actions.yes')}
                    </button>
                    <button
                      style={btnOutline}
                      onClick={() => setDeleteConfirmId(null)}
                      disabled={deleting}
                    >
                      {t('common:actions.no')}
                    </button>
                  </>
                ) : (
                  <>
                    <button style={btnOutline} onClick={() => openEdit(v)}>
                      {t('common:actions.edit')}
                    </button>
                    <button
                      style={{ ...btnOutline, color: '#dc2626', borderColor: '#fecaca' }}
                      onClick={() => setDeleteConfirmId(v.id)}
                    >
                      {t('common:actions.delete')}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && vehicles.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}>
          <button
            style={{ ...btnOutline, opacity: page <= 1 ? 0.5 : 1 }}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            {t('common:actions.previous')}
          </button>
          <span
            style={{
              padding: '8px 16px',
              fontSize: 14,
              color: '#6b7280',
              alignSelf: 'center',
            }}
          >
            {t('pagination.page', { page })}
          </span>
          <button
            style={{ ...btnOutline, opacity: page >= totalPages ? 0.5 : 1 }}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            {t('common:actions.next')}
          </button>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: '#374151',
  marginBottom: 4,
};

const badgeBase: React.CSSProperties = {
  display: 'inline-block',
  padding: '3px 10px',
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 600,
};
