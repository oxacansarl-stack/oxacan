import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPost, apiDelete, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { enumLabel, formatDate, formatMoney, statusLabel } from '../lib/format';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Project {
  id: string;
  name: string;
  reference?: string;
}

interface Expense {
  id: string;
  userId: string;
  projectId?: string;
  project?: { name: string; reference?: string };
  date: string;
  category: string;
  description: string;
  amountCents: number;
  receiptUrl?: string;
  isBillable: boolean;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  rejectionReason?: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  { value: 'material', color: '#2563eb' },
  { value: 'travel', color: '#8b5cf6' },
  { value: 'per_diem', color: '#f59e0b' },
  { value: 'subcontractor', color: '#ec4899' },
  { value: 'equipment_rental', color: '#14b8a6' },
  { value: 'other', color: '#6b7280' },
] as const;

const CATEGORY_COLORS: Record<string, { bg: string; fg: string }> = {
  material: { bg: '#dbeafe', fg: '#1d4ed8' },
  travel: { bg: '#ede9fe', fg: '#6d28d9' },
  per_diem: { bg: '#fef3c7', fg: '#92400e' },
  subcontractor: { bg: '#fce7f3', fg: '#be185d' },
  equipment_rental: { bg: '#ccfbf1', fg: '#0f766e' },
  other: { bg: '#f3f4f6', fg: '#4b5563' },
};

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f3f4f6', fg: '#4b5563' },
  submitted: { bg: '#fef3c7', fg: '#92400e' },
  approved: { bg: '#dcfce7', fg: '#166534' },
  rejected: { bg: '#fee2e2', fg: '#991b1b' },
};

const STATUS_TABS = ['all', 'draft', 'submitted', 'approved', 'rejected'] as const;

const APPROVER_ROLES = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER'];

interface Profile {
  id: string;
  role: string;
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Expenses() {
  const { t } = useTranslation('expenses');
  // Form state
  const [showForm, setShowForm] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [formProjectId, setFormProjectId] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formCategory, setFormCategory] = useState('material');
  const [formDescription, setFormDescription] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formBillable, setFormBillable] = useState(false);
  const [formLoading, setFormLoading] = useState(false);

  // List state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  // Caller (own drafts / approve rights); null until loaded or if unavailable
  const [me, setMe] = useState<Profile | null>(null);
  const canApprove = me ? APPROVER_ROLES.includes(me.role) : true;

  // ---- Load profile & projects ----
  useEffect(() => {
    apiGet<Profile>('/auth/profile')
      .then(setMe)
      .catch(() => {});
    apiGet<Project[]>('/projects')
      .then((list) => setProjects(list ?? []))
      .catch(() => {});
  }, []);

  // ---- Load expenses ----
  const loadExpenses = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
    if (categoryFilter) params.set('category', categoryFilter);

    apiGet<Expense[]>(`/expenses?${params.toString()}`)
      .then((list) => {
        setExpenses(list ?? []);
        setError('');
      })
      .catch((err) => setError(errorMessage(err, t('messages.loadFailed'))))
      .finally(() => setLoading(false));
  }, [statusFilter, categoryFilter]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  // ---- Create expense ----
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDescription || !formAmount) return;
    // CHF → integer centimes (API rejects negatives and non-integers)
    const amountCents = Math.round(parseFloat(formAmount) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 0) {
      setError(t('messages.invalidAmount'));
      return;
    }
    setFormLoading(true);
    try {
      await apiPost('/expenses', {
        projectId: formProjectId || undefined,
        date: formDate,
        category: formCategory,
        description: formDescription,
        amountCents,
        isBillable: formBillable,
      });
      // Reset form
      setFormProjectId('');
      setFormDate(new Date().toISOString().slice(0, 10));
      setFormCategory('material');
      setFormDescription('');
      setFormAmount('');
      setFormBillable(false);
      setShowForm(false);
      loadExpenses();
    } catch (err) {
      setError(errorMessage(err, t('messages.createFailed')));
    } finally {
      setFormLoading(false);
    }
  };

  // ---- Actions ----
  const handleSubmit = async () => {
    if (selected.size === 0) return;
    // Only the caller's own drafts can be submitted.
    const expenseIds = me
      ? expenses.filter((e) => selected.has(e.id) && e.userId === me.id && (e.status === 'draft' || e.status === 'rejected')).map((e) => e.id)
      : Array.from(selected);
    if (expenseIds.length === 0) {
      setError(t('messages.selectOwnDrafts'));
      return;
    }
    setActionLoading(true);
    try {
      await apiPost('/expenses/submit', { expenseIds });
      setSelected(new Set());
      loadExpenses();
    } catch (err) {
      setError(errorMessage(err, t('messages.submitFailed')));
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    if (selected.size === 0) return;
    setActionLoading(true);
    try {
      await apiPost('/expenses/approve', { expenseIds: Array.from(selected) });
      setSelected(new Set());
      loadExpenses();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? t('messages.approveForbidden')
          : errorMessage(err, t('messages.approveFailed')),
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (selected.size === 0) return;
    const reason = prompt(t('prompts.rejectionReason'));
    if (!reason) return;
    setActionLoading(true);
    try {
      await apiPost('/expenses/reject', { expenseIds: Array.from(selected), reason });
      setSelected(new Set());
      loadExpenses();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? t('messages.rejectForbidden')
          : errorMessage(err, t('messages.rejectFailed')),
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm(t('prompts.confirmDelete'))) return;
    try {
      await apiDelete(`/expenses/${id}`);
      loadExpenses();
    } catch (err) {
      setError(errorMessage(err, t('messages.deleteFailed')));
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === expenses.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(expenses.map((e) => e.id)));
    }
  };

  // ---- Category summary ----
  const categorySummary = CATEGORIES.map((cat) => {
    const total = expenses
      .filter((e) => e.category === cat.value)
      .reduce((sum, e) => sum + e.amountCents, 0);
    return { ...cat, total };
  }).filter((c) => c.total > 0);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>{t('title')}</h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>{t('subtitle')}</p>
        </div>
        <button
          style={{ ...btnPrimary }}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? t('common:actions.cancel') : t('actions.new')}
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 16px', background: '#fee2e2', color: '#991b1b', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Create Form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          style={{
            background: '#f8f9fa',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 16 }}>{t('form.title')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>{t('form.project')}</label>
              <select style={{ ...inputStyle }} value={formProjectId} onChange={(e) => setFormProjectId(e.target.value)}>
                <option value="">{t('form.noProject')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.reference ? `${p.reference} - ` : ''}{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>{t('form.date')}</label>
              <input type="date" style={{ ...inputStyle }} value={formDate} onChange={(e) => setFormDate(e.target.value)} required />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>{t('form.category')}</label>
              <select style={{ ...inputStyle }} value={formCategory} onChange={(e) => setFormCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{enumLabel('expenseCategory', c.value)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>{t('form.amount')}</label>
              <input
                type="number"
                step="0.05"
                min="0"
                style={{ ...inputStyle }}
                placeholder="0.00"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                required
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>{t('form.description')}</label>
              <input
                style={{ ...inputStyle }}
                placeholder={t('form.descriptionPlaceholder')}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                required
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
              <input type="checkbox" checked={formBillable} onChange={(e) => setFormBillable(e.target.checked)} />
              {t('form.billable')}
            </label>
            <div style={{ flex: 1 }} />
            <button type="button" style={{ ...btnOutline }} onClick={() => setShowForm(false)}>{t('common:actions.cancel')}</button>
            <button type="submit" style={{ ...btnPrimary }} disabled={formLoading}>
              {formLoading ? t('actions.creating') : t('actions.create')}
            </button>
          </div>
        </form>
      )}

      {/* Category Summary */}
      {categorySummary.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          {categorySummary.map((cat) => (
            <div
              key={cat.value}
              style={{
                flex: '1 1 120px',
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '12px 16px',
                borderLeft: `3px solid ${cat.color}`,
              }}
            >
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>{enumLabel('expenseCategory', cat.value)}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(cat.total)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => { setStatusFilter(tab); setSelected(new Set()); }}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid #e5e7eb',
                background: statusFilter === tab ? '#2563eb' : '#fff',
                color: statusFilter === tab ? '#fff' : '#4b5563',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {tab === 'all' ? t('tabs.all') : statusLabel('expense', tab)}
            </button>
          ))}
        </div>
        <select
          style={{ ...inputStyle, maxWidth: 200 }}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">{t('filters.allCategories')}</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{enumLabel('expenseCategory', c.value)}</option>
          ))}
        </select>
      </div>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button style={{ ...btnPrimary }} onClick={handleSubmit} disabled={actionLoading}>
            {t('actions.submit', { count: selected.size })}
          </button>
          {canApprove && (
            <>
              <button style={{ ...btnSuccess }} onClick={handleApprove} disabled={actionLoading}>
                {t('actions.approve', { count: selected.size })}
              </button>
              <button style={{ ...btnDanger }} onClick={handleReject} disabled={actionLoading}>
                {t('actions.reject', { count: selected.size })}
              </button>
            </>
          )}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: '#6b7280', padding: 20 }}>{t('common:state.loading')}</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ padding: '10px 8px', borderBottom: '2px solid #e5e7eb', textAlign: 'left', width: 32 }}>
                <input
                  type="checkbox"
                  checked={expenses.length > 0 && selected.size === expenses.length}
                  onChange={toggleSelectAll}
                />
              </th>
              {['date', 'category', 'description', 'project', 'amount', 'billable', 'status', ''].map((h) => (
                <th
                  key={h || 'actions'}
                  style={{
                    textAlign: h === 'amount' ? 'right' : 'left',
                    padding: '10px 12px',
                    borderBottom: '2px solid #e5e7eb',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#6b7280',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  {h ? t(`table.${h}`) : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>
                  {t('empty')}
                </td>
              </tr>
            )}
            {expenses.map((expense) => {
              const sCols = STATUS_COLORS[expense.status] ?? STATUS_COLORS.draft;
              const cCols = CATEGORY_COLORS[expense.category] ?? CATEGORY_COLORS.other;
              return (
                <tr
                  key={expense.id}
                  style={{ borderBottom: '1px solid #f3f4f6' }}
                  onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = '#f9fafb'; }}
                  onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td style={{ padding: '10px 8px' }}>
                    <input
                      type="checkbox"
                      checked={selected.has(expense.id)}
                      onChange={() => toggleSelect(expense.id)}
                    />
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {formatDate(expense.date)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 9999,
                        fontSize: 12,
                        fontWeight: 600,
                        background: cCols.bg,
                        color: cCols.fg,
                      }}
                    >
                      {enumLabel('expenseCategory', expense.category)}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {expense.description}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, color: '#6b7280' }}>
                    {expense.project?.name || '-'}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 14, textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(expense.amountCents)}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 13 }}>
                    {expense.isBillable ? (
                      <span style={{ color: '#16a34a', fontWeight: 500 }}>{t('common:actions.yes')}</span>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>{t('common:actions.no')}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 9999,
                        fontSize: 12,
                        fontWeight: 600,
                        background: sCols.bg,
                        color: sCols.fg,
                      }}
                    >
                      {statusLabel('expense', expense.status)}
                    </span>
                    {expense.status === 'rejected' && expense.rejectionReason && (
                      <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 4, maxWidth: 260 }}>
                        {t('table.reason', { reason: expense.rejectionReason })}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {expense.status === 'draft' && (
                      <button
                        onClick={() => handleDeleteExpense(expense.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#dc2626',
                          fontSize: 13,
                          cursor: 'pointer',
                          padding: '4px 8px',
                        }}
                        title={t('common:actions.delete')}
                      >
                        {t('common:actions.delete')}
                      </button>
                    )}
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
