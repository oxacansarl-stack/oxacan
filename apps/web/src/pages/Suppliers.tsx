import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiList, apiPost, apiPut, apiDelete } from '../lib/api';
import { errorMessage } from '../lib/errors';
import type { PageProps } from '../lib/page-props';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  paymentTermsDays: number;
  createdAt: string;
}

interface SupplierForm {
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  paymentTermsDays: number;
}

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

const emptyForm: SupplierForm = {
  name: '',
  contactPerson: '',
  email: '',
  phone: '',
  address: '',
  paymentTermsDays: 30,
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Suppliers({ embedded = false }: PageProps) {
  const { t } = useTranslation('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<SupplierForm>({ ...emptyForm });
  const [creating, setCreating] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<SupplierForm>({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Hover
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  /* ---- Fetch ---- */

  const fetchSuppliers = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    const qs = params.toString();
    apiList<Supplier>(`/suppliers${qs ? `?${qs}` : ''}`)
      .then(({ items, meta }) => {
        setSuppliers(items);
        setTotal(meta?.total ?? items.length);
      })
      .catch((err) => {
        setError(errorMessage(err, t('messages.loadFailed')));
      })
      .finally(() => setLoading(false));
  }, [search, t]);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  /* ---- Create ---- */

  const handleCreate = () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    const body: Record<string, unknown> = { name: createForm.name.trim() };
    if (createForm.contactPerson.trim()) body.contactPerson = createForm.contactPerson.trim();
    if (createForm.email.trim()) body.email = createForm.email.trim();
    if (createForm.phone.trim()) body.phone = createForm.phone.trim();
    if (createForm.address.trim()) body.address = createForm.address.trim();
    body.paymentTermsDays = createForm.paymentTermsDays;

    apiPost<Supplier>('/suppliers', body)
      .then(() => {
        setCreateForm({ ...emptyForm });
        setShowCreate(false);
        fetchSuppliers();
      })
      .catch((err) => {
        setError(errorMessage(err, t('messages.createFailed')));
      })
      .finally(() => setCreating(false));
  };

  /* ---- Edit ---- */

  const startEdit = (supplier: Supplier) => {
    setEditingId(supplier.id);
    setEditForm({
      name: supplier.name,
      contactPerson: supplier.contactPerson ?? '',
      email: supplier.email ?? '',
      phone: supplier.phone ?? '',
      address: supplier.address ?? '',
      paymentTermsDays: supplier.paymentTermsDays,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ ...emptyForm });
  };

  const handleSave = () => {
    if (!editingId || !editForm.name.trim()) return;
    setSaving(true);
    const body: Record<string, unknown> = { name: editForm.name.trim() };
    body.contactPerson = editForm.contactPerson.trim() || null;
    body.email = editForm.email.trim() || null;
    body.phone = editForm.phone.trim() || null;
    body.address = editForm.address.trim() || null;
    body.paymentTermsDays = editForm.paymentTermsDays;

    apiPut<Supplier>(`/suppliers/${editingId}`, body)
      .then(() => {
        setEditingId(null);
        setEditForm({ ...emptyForm });
        fetchSuppliers();
      })
      .catch((err) => {
        setError(errorMessage(err, t('messages.updateFailed')));
      })
      .finally(() => setSaving(false));
  };

  /* ---- Delete ---- */

  const handleDelete = (id: string) => {
    apiDelete(`/suppliers/${id}`)
      .then(() => {
        setDeletingId(null);
        fetchSuppliers();
      })
      .catch((err) => {
        setError(errorMessage(err, t('messages.deleteFailed')));
        setDeletingId(null);
      });
  };

  /* ---- Render ---- */

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#111827' }}>
            {t('title')}
          </h1>
          {!loading && (
            <span style={{ fontSize: 14, color: '#6b7280' }}>
              {t('count', { count: total })}
            </span>
          )}
        </div>
        <button
          style={btnPrimary}
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? t('common:actions.cancel') : t('actions.new')}
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
            color: '#991b1b',
            fontSize: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
          >
            {t('actions.dismiss')}
          </button>
        </div>
      )}

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <input
          type="text"
          placeholder={t('search.placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, maxWidth: 400 }}
        />
      </div>

      {/* Create form */}
      {showCreate && (
        <div
          style={{
            marginBottom: 24,
            padding: 20,
            background: '#f8f9fa',
            borderRadius: 8,
            border: '1px solid #e5e7eb',
          }}
        >
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#111827' }}>
            {t('form.title')}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                {t('form.name')} <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                style={inputStyle}
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('form.namePlaceholder')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                {t('form.contactPerson')}
              </label>
              <input
                style={inputStyle}
                value={createForm.contactPerson}
                onChange={(e) => setCreateForm((f) => ({ ...f, contactPerson: e.target.value }))}
                placeholder={t('form.contactPersonPlaceholder')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                {t('form.email')}
              </label>
              <input
                type="email"
                style={inputStyle}
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                placeholder={t('form.emailPlaceholder')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                {t('form.phone')}
              </label>
              <input
                type="tel"
                style={inputStyle}
                value={createForm.phone}
                onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder={t('form.phonePlaceholder')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                {t('form.paymentTermsDays')}
              </label>
              <input
                type="number"
                min={0}
                style={inputStyle}
                value={createForm.paymentTermsDays}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, paymentTermsDays: parseInt(e.target.value, 10) || 0 }))
                }
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                {t('form.address')}
              </label>
              <textarea
                style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
                value={createForm.address}
                onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                placeholder={t('form.addressPlaceholder')}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              style={{ ...btnPrimary, opacity: creating || !createForm.name.trim() ? 0.6 : 1 }}
              disabled={creating || !createForm.name.trim()}
              onClick={handleCreate}
            >
              {creating ? t('actions.creating') : t('actions.create')}
            </button>
            <button
              style={btnOutline}
              onClick={() => {
                setShowCreate(false);
                setCreateForm({ ...emptyForm });
              }}
            >
              {t('common:actions.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: '#6b7280', fontSize: 15 }}>
          {t('state.loading')}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && suppliers.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: '#6b7280', fontSize: 15 }}>
          {search
            ? t('empty.search', { search })
            : t('empty.none')}
        </div>
      )}

      {/* Table */}
      {!loading && suppliers.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 14,
              background: '#fff',
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid #e5e7eb',
            }}
          >
            <thead>
              <tr style={{ background: '#f8f9fa', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                  {t('table.name')}
                </th>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                  {t('table.contactPerson')}
                </th>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                  {t('table.email')}
                </th>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                  {t('table.phone')}
                </th>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                  {t('table.paymentTerms')}
                </th>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', width: 180 }}>
                  {t('table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => {
                const isEditing = editingId === supplier.id;
                const isDeleting = deletingId === supplier.id;

                return (
                  <tr
                    key={supplier.id}
                    style={{
                      borderBottom: '1px solid #e5e7eb',
                      background: isEditing ? '#f0f4ff' : hoveredId === supplier.id ? '#f9fafb' : '#fff',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={() => setHoveredId(supplier.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    {isEditing ? (
                      <>
                        <td style={{ padding: '8px 14px' }}>
                          <input
                            style={{ ...inputStyle, width: '100%' }}
                            value={editForm.name}
                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          />
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          <input
                            style={{ ...inputStyle, width: '100%' }}
                            value={editForm.contactPerson}
                            onChange={(e) => setEditForm((f) => ({ ...f, contactPerson: e.target.value }))}
                          />
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          <input
                            type="email"
                            style={{ ...inputStyle, width: '100%' }}
                            value={editForm.email}
                            onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                          />
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          <input
                            type="tel"
                            style={{ ...inputStyle, width: '100%' }}
                            value={editForm.phone}
                            onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                          />
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          <input
                            type="number"
                            min={0}
                            style={{ ...inputStyle, width: 80 }}
                            value={editForm.paymentTermsDays}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, paymentTermsDays: parseInt(e.target.value, 10) || 0 }))
                            }
                          />
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              style={{ ...btnPrimary, padding: '6px 12px', fontSize: 13, opacity: saving || !editForm.name.trim() ? 0.6 : 1 }}
                              disabled={saving || !editForm.name.trim()}
                              onClick={handleSave}
                            >
                              {saving ? t('common:actions.saving') : t('common:actions.save')}
                            </button>
                            <button
                              style={{ ...btnOutline, padding: '6px 12px', fontSize: 13 }}
                              onClick={cancelEdit}
                            >
                              {t('common:actions.cancel')}
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '10px 14px', color: '#111827', fontWeight: 500 }}>
                          {supplier.name}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#374151' }}>
                          {supplier.contactPerson || <span style={{ color: '#9ca3af' }}>--</span>}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#374151' }}>
                          {supplier.email ? (
                            <a href={`mailto:${supplier.email}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                              {supplier.email}
                            </a>
                          ) : (
                            <span style={{ color: '#9ca3af' }}>--</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#374151' }}>
                          {supplier.phone || <span style={{ color: '#9ca3af' }}>--</span>}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#374151' }}>
                          {t('table.days', { count: supplier.paymentTermsDays })}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {isDeleting ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ fontSize: 13, color: '#991b1b' }}>{t('delete.question')}</span>
                              <button
                                style={{ ...btnDanger, padding: '6px 12px', fontSize: 13 }}
                                onClick={() => handleDelete(supplier.id)}
                              >
                                {t('common:actions.confirm')}
                              </button>
                              <button
                                style={{ ...btnOutline, padding: '6px 12px', fontSize: 13 }}
                                onClick={() => setDeletingId(null)}
                              >
                                {t('common:actions.no')}
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                style={{ ...btnOutline, padding: '6px 12px', fontSize: 13 }}
                                onClick={() => startEdit(supplier)}
                              >
                                {t('common:actions.edit')}
                              </button>
                              <button
                                style={{ ...btnDanger, padding: '6px 12px', fontSize: 13 }}
                                onClick={() => setDeletingId(supplier.id)}
                              >
                                {t('common:actions.delete')}
                              </button>
                            </div>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
