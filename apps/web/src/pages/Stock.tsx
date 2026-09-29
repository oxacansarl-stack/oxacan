import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiList, apiPost } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { enumLabel, formatDate } from '../lib/format';

/* ── Types ─────────────────────────────────────────────────────────── */

interface StockLocation {
  id: string;
  name: string;
  type: 'warehouse' | 'vehicle' | 'site';
  address?: string;
  createdAt: string;
}

interface StockItem {
  id: string;
  canonicalArticleId?: string;
  canonicalArticle?: { description?: string; unit?: string };
  locationId: string;
  location?: { name: string; type: string };
  quantity: number;
  minThreshold: number | null;
  createdAt: string;
}

interface StockMovement {
  id: string;
  stockItemId: string;
  stockItem?: { canonicalArticle?: { description?: string }; location?: { name: string } };
  type: 'in' | 'out' | 'transfer' | 'adjustment';
  quantity: number;
  projectId?: string;
  project?: { name: string };
  reference?: string;
  performedBy?: string;
  createdAt: string;
}

type Tab = 'Locations' | 'Items' | 'Movements';

/* ── Style constants ───────────────────────────────────────────────── */

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6,
  fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, border: 'none',
  background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer',
};

const btnOutline: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, border: '1px solid #d1d5db',
  background: '#fff', color: '#374151', fontSize: 14, fontWeight: 500, cursor: 'pointer',
};

const typeBadgeColors: Record<string, { bg: string; color: string }> = {
  warehouse: { bg: '#dbeafe', color: '#1d4ed8' },
  vehicle:   { bg: '#fef3c7', color: '#92400e' },
  site:      { bg: '#dcfce7', color: '#166534' },
};

const movementBadgeColors: Record<string, { bg: string; color: string }> = {
  in:         { bg: '#dcfce7', color: '#166534' },
  out:        { bg: '#fee2e2', color: '#991b1b' },
  transfer:   { bg: '#dbeafe', color: '#1d4ed8' },
  adjustment: { bg: '#fef3c7', color: '#92400e' },
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 600,
  color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em',
  borderBottom: '2px solid #e5e7eb',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px', fontSize: 14, color: '#111827',
  borderBottom: '1px solid #f3f4f6',
};

/* ── Helpers ────────────────────────────────────────────────────────── */

const tabLabelKeys = { Locations: 'tabs.locations', Items: 'tabs.items', Movements: 'tabs.movements' } as const;

/* ── Sub-components ────────────────────────────────────────────────── */

function Badge({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12,
      fontSize: 12, fontWeight: 600, background: bg, color,
    }}>
      {label}
    </span>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div style={{
      padding: '10px 16px', marginBottom: 16, background: '#fee2e2', color: '#991b1b',
      borderRadius: 6, fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', fontWeight: 600 }}
      >
        &times;
      </button>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '48px 16px', color: '#6b7280', fontSize: 14,
    }}>
      {message}
    </div>
  );
}

function LoadingState() {
  const { t } = useTranslation();
  return (
    <div style={{
      textAlign: 'center', padding: '48px 16px', color: '#6b7280', fontSize: 14,
    }}>
      {t('state.loading')}
    </div>
  );
}

/* ── Locations Tab ─────────────────────────────────────────────────── */

function LocationsTab() {
  const { t } = useTranslation('stock');
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'warehouse' | 'vehicle' | 'site'>('warehouse');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items, meta } = await apiList<StockLocation>('/stock/locations?page=1&limit=100');
      setLocations(items);
      setTotal(meta?.total ?? items.length);
    } catch (err) {
      setError(errorMessage(err, t('messages.loadLocationsFailed')));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiPost('/stock/locations', { name: name.trim(), type, address: address.trim() || undefined });
      setName(''); setAddress(''); setShowForm(false);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('messages.createLocationFailed')));
    }
    setSaving(false);
  };

  if (loading) return <LoadingState />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827' }}>
          {t('locations.heading', { count: total })}
        </h3>
        <button style={btnOutline} onClick={() => setShowForm(v => !v)}>
          {showForm ? t('common:actions.cancel') : t('locations.new')}
        </button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {showForm && (
        <form onSubmit={handleCreate} style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
          padding: 20, marginBottom: 20,
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#111827' }}>{t('locations.formTitle')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('locations.name')}</label>
              <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder={t('locations.namePlaceholder')} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('locations.type')}</label>
              <select style={inputStyle} value={type} onChange={e => setType(e.target.value as 'warehouse' | 'vehicle' | 'site')}>
                <option value="warehouse">{enumLabel('stockLocationType', 'warehouse')}</option>
                <option value="vehicle">{enumLabel('stockLocationType', 'vehicle')}</option>
                <option value="site">{enumLabel('stockLocationType', 'site')}</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('locations.address')}</label>
              <input style={inputStyle} value={address} onChange={e => setAddress(e.target.value)} placeholder={t('locations.optional')} />
            </div>
          </div>
          <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? t('locations.creating') : t('locations.create')}
          </button>
        </form>
      )}

      {locations.length === 0 ? (
        <EmptyState message={t('locations.empty')} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {locations.map(loc => {
            const badge = typeBadgeColors[loc.type] ?? typeBadgeColors.warehouse;
            return (
              <div key={loc.id} style={{
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
                padding: 16,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{loc.name}</span>
                  <Badge label={enumLabel('stockLocationType', loc.type)} bg={badge.bg} color={badge.color} />
                </div>
                {loc.address && (
                  <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>{loc.address}</div>
                )}
                <div style={{ fontSize: 12, color: '#9ca3af' }}>{t('locations.created', { date: formatDate(loc.createdAt) })}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Items Tab ─────────────────────────────────────────────────────── */

function ItemsTab() {
  const { t } = useTranslation('stock');
  const [items, setItems] = useState<StockItem[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filterLocation, setFilterLocation] = useState('');
  const [belowOnly, setBelowOnly] = useState(false);

  const [newArticleId, setNewArticleId] = useState('');
  const [newLocationId, setNewLocationId] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [newThreshold, setNewThreshold] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1' });
      if (filterLocation) params.set('locationId', filterLocation);
      if (belowOnly) params.set('belowThreshold', 'true');
      const [itemsRes, locsRes] = await Promise.all([
        apiGet<StockItem[]>(`/stock/items?${params}`),
        apiGet<StockLocation[]>('/stock/locations?page=1&limit=100'),
      ]);
      setItems(itemsRes ?? []);
      setLocations(locsRes ?? []);
    } catch (err) {
      setError(errorMessage(err, t('messages.loadItemsFailed')));
    }
    setLoading(false);
  }, [filterLocation, belowOnly, t]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newArticleId.trim() || !newLocationId) return;
    setSaving(true);
    try {
      await apiPost('/stock/items', {
        canonicalArticleId: newArticleId.trim(),
        locationId: newLocationId,
        quantity: newQuantity ? Number(newQuantity) : undefined,
        minThreshold: newThreshold ? Number(newThreshold) : undefined,
      });
      setNewArticleId(''); setNewLocationId(''); setNewQuantity(''); setNewThreshold('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('messages.addItemFailed')));
    }
    setSaving(false);
  };

  if (loading) return <LoadingState />;

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 220px' }}>
          <select style={inputStyle} value={filterLocation} onChange={e => setFilterLocation(e.target.value)}>
            <option value="">{t('items.allLocations')}</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <button
          style={{
            ...btnOutline,
            background: belowOnly ? '#fef3c7' : '#fff',
            borderColor: belowOnly ? '#f59e0b' : '#d1d5db',
            color: belowOnly ? '#92400e' : '#374151',
          }}
          onClick={() => setBelowOnly(v => !v)}
        >
          {belowOnly ? t('items.belowThresholdActive') : t('items.belowThresholdOnly')}
        </button>
        <div style={{ flex: 1 }} />
        <button style={btnOutline} onClick={() => setShowForm(v => !v)}>
          {showForm ? t('common:actions.cancel') : t('items.new')}
        </button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {showForm && (
        <form onSubmit={handleCreate} style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
          padding: 20, marginBottom: 20,
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#111827' }}>{t('items.formTitle')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('items.articleId')}</label>
              <input style={inputStyle} value={newArticleId} onChange={e => setNewArticleId(e.target.value)} placeholder={t('items.articleIdPlaceholder')} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('items.location')}</label>
              <select style={inputStyle} value={newLocationId} onChange={e => setNewLocationId(e.target.value)}>
                <option value="">{t('items.selectLocation')}</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('items.quantity')}</label>
              <input style={inputStyle} type="number" min={0} value={newQuantity} onChange={e => setNewQuantity(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('items.minThreshold')}</label>
              <input style={inputStyle} type="number" min={0} value={newThreshold} onChange={e => setNewThreshold(e.target.value)} placeholder="0" />
            </div>
          </div>
          <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? t('items.adding') : t('items.add')}
          </button>
        </form>
      )}

      {items.length === 0 ? (
        <EmptyState message={t('items.empty')} />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>{t('items.table.article')}</th>
                <th style={thStyle}>{t('items.table.location')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t('items.table.quantity')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t('items.table.minThreshold')}</th>
                <th style={thStyle}>{t('items.table.status')}</th>
                <th style={thStyle}>{t('items.table.created')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const isLow = item.quantity <= (item.minThreshold ?? 0);
                return (
                  <tr key={item.id} style={{
                    borderLeft: isLow ? '3px solid #f59e0b' : '3px solid transparent',
                    background: isLow ? '#fffbeb' : undefined,
                  }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 500 }}>
                        {item.canonicalArticle?.description ?? item.canonicalArticleId ?? '-'}
                      </div>
                      {item.canonicalArticle?.unit && (
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{item.canonicalArticle.unit}</div>
                      )}
                    </td>
                    <td style={tdStyle}>{item.location?.name ?? '-'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {item.quantity}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {item.minThreshold ?? 0}
                    </td>
                    <td style={tdStyle}>
                      {isLow
                        ? <Badge label={t('items.lowStock')} bg="#fee2e2" color="#991b1b" />
                        : <Badge label={t('items.ok')} bg="#dcfce7" color="#166534" />
                      }
                    </td>
                    <td style={{ ...tdStyle, color: '#6b7280', fontSize: 13 }}>
                      {formatDate(item.createdAt)}
                    </td>
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

/* ── Movements Tab ─────────────────────────────────────────────────── */

function MovementsTab() {
  const { t } = useTranslation('stock');
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<StockItem[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [newItemId, setNewItemId] = useState('');
  const [newType, setNewType] = useState<'in' | 'out' | 'transfer' | 'adjustment'>('in');
  const [newQty, setNewQty] = useState('');
  const [newRef, setNewRef] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [newToLocationId, setNewToLocationId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [movRes, itemsRes, locsRes] = await Promise.all([
        apiList<StockMovement>('/stock/movements?page=1'),
        apiGet<StockItem[]>('/stock/items?page=1&limit=100'),
        apiGet<StockLocation[]>('/stock/locations?page=1&limit=100'),
      ]);
      setMovements(movRes.items);
      setTotal(movRes.meta?.total ?? movRes.items.length);
      setItems(itemsRes ?? []);
      setLocations(locsRes ?? []);
    } catch (err) {
      setError(errorMessage(err, t('messages.loadMovementsFailed')));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemId || !newQty) return;
    const isTransfer = newType === 'transfer';
    if (isTransfer && !newToLocationId) return;
    const sourceItem = items.find(it => it.id === newItemId);
    setSaving(true);
    try {
      await apiPost('/stock/movements', {
        stockItemId: newItemId,
        type: newType,
        quantity: Number(newQty),
        fromLocationId: isTransfer ? sourceItem?.locationId : undefined,
        toLocationId: isTransfer ? newToLocationId : undefined,
        reference: newRef.trim() || undefined,
        projectId: newProjectId.trim() || undefined,
      });
      setNewItemId(''); setNewQty(''); setNewRef(''); setNewProjectId(''); setNewToLocationId('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('messages.recordMovementFailed')));
    }
    setSaving(false);
  };

  function formatQty(mov: StockMovement): string {
    if (mov.type === 'out') return `- ${mov.quantity}`;
    if (mov.type === 'in') return `+ ${mov.quantity}`;
    if (mov.type === 'adjustment') return mov.quantity >= 0 ? `+ ${mov.quantity}` : `${mov.quantity}`;
    return String(mov.quantity);
  }

  if (loading) return <LoadingState />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827' }}>
          {t('movements.heading', { count: total })}
        </h3>
        <button style={btnOutline} onClick={() => setShowForm(v => !v)}>
          {showForm ? t('common:actions.cancel') : t('movements.new')}
        </button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {showForm && (
        <form onSubmit={handleCreate} style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
          padding: 20, marginBottom: 20,
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#111827' }}>{t('movements.formTitle')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('movements.stockItem')}</label>
              <select style={inputStyle} value={newItemId} onChange={e => setNewItemId(e.target.value)}>
                <option value="">{t('movements.selectItem')}</option>
                {items.map(it => (
                  <option key={it.id} value={it.id}>
                    {it.canonicalArticle?.description ?? it.canonicalArticleId ?? it.id}
                    {it.location?.name ? ` (${it.location.name})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('movements.type')}</label>
              <select style={inputStyle} value={newType} onChange={e => setNewType(e.target.value as 'in' | 'out' | 'transfer' | 'adjustment')}>
                <option value="in">{enumLabel('stockMovementType', 'in')}</option>
                <option value="out">{enumLabel('stockMovementType', 'out')}</option>
                <option value="transfer">{enumLabel('stockMovementType', 'transfer')}</option>
                <option value="adjustment">{enumLabel('stockMovementType', 'adjustment')}</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('movements.quantity')}</label>
              <input style={inputStyle} type="number" min={0} value={newQty} onChange={e => setNewQty(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('movements.reference')}</label>
              <input style={inputStyle} value={newRef} onChange={e => setNewRef(e.target.value)} placeholder="BL-2024-001" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('movements.projectId')}</label>
              <input style={inputStyle} value={newProjectId} onChange={e => setNewProjectId(e.target.value)} placeholder={t('movements.optional')} />
            </div>
            {newType === 'transfer' && (
              <div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{t('movements.toLocation')}</label>
                <select style={inputStyle} value={newToLocationId} onChange={e => setNewToLocationId(e.target.value)}>
                  <option value="">{t('movements.selectLocation')}</option>
                  {locations
                    .filter(l => l.id !== items.find(it => it.id === newItemId)?.locationId)
                    .map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? t('movements.recording') : t('movements.record')}
          </button>
        </form>
      )}

      {movements.length === 0 ? (
        <EmptyState message={t('movements.empty')} />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>{t('movements.table.date')}</th>
                <th style={thStyle}>{t('movements.table.article')}</th>
                <th style={thStyle}>{t('movements.table.location')}</th>
                <th style={thStyle}>{t('movements.table.type')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t('movements.table.quantity')}</th>
                <th style={thStyle}>{t('movements.table.project')}</th>
                <th style={thStyle}>{t('movements.table.reference')}</th>
              </tr>
            </thead>
            <tbody>
              {movements.map(mov => {
                const badge = movementBadgeColors[mov.type] ?? movementBadgeColors.in;
                return (
                  <tr key={mov.id}>
                    <td style={{ ...tdStyle, color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap' }}>
                      {formatDate(mov.createdAt)}
                    </td>
                    <td style={tdStyle}>
                      {mov.stockItem?.canonicalArticle?.description ?? '-'}
                    </td>
                    <td style={tdStyle}>
                      {mov.stockItem?.location?.name ?? '-'}
                    </td>
                    <td style={tdStyle}>
                      <Badge label={enumLabel('stockMovementType', mov.type)} bg={badge.bg} color={badge.color} />
                    </td>
                    <td style={{
                      ...tdStyle, textAlign: 'right', fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                      color: mov.type === 'out' ? '#991b1b' : '#166534',
                    }}>
                      {formatQty(mov)}
                    </td>
                    <td style={{ ...tdStyle, color: '#6b7280' }}>
                      {mov.project?.name ?? mov.projectId ?? '-'}
                    </td>
                    <td style={{ ...tdStyle, color: '#6b7280', fontSize: 13 }}>
                      {mov.reference ?? '-'}
                    </td>
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

/* ── Main Stock Page ───────────────────────────────────────────────── */

const tabs: Tab[] = ['Locations', 'Items', 'Movements'];

export default function Stock() {
  const { t } = useTranslation('stock');
  const [activeTab, setActiveTab] = useState<Tab>('Locations');

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
        {t('title')}
      </h2>
      <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 20, marginTop: 0 }}>
        {t('subtitle')}
      </p>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '6px 16px', borderRadius: 6, border: '1px solid #e5e7eb',
            background: activeTab === tab ? '#2563eb' : '#fff',
            color: activeTab === tab ? '#fff' : '#4b5563',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}>{t(tabLabelKeys[tab])}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 20 }}>
        {activeTab === 'Locations' && <LocationsTab />}
        {activeTab === 'Items' && <ItemsTab />}
        {activeTab === 'Movements' && <MovementsTab />}
      </div>
    </div>
  );
}
