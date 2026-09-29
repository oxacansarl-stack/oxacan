import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from '../lib/api';

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
  article?: { designation?: string; unit?: string };
  locationId: string;
  location?: { name: string; type: string };
  quantity: number;
  minThreshold: number;
  createdAt: string;
}

interface StockMovement {
  id: string;
  stockItemId: string;
  stockItem?: { article?: { designation?: string }; location?: { name: string } };
  type: 'in' | 'out' | 'transfer' | 'adjustment';
  quantity: number;
  projectId?: string;
  project?: { name: string };
  reference?: string;
  createdBy?: string;
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

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-CH');
}

function unwrap<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === 'object' && 'data' in res) return (res as { data: T[] }).data ?? [];
  return [];
}

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
  return (
    <div style={{
      textAlign: 'center', padding: '48px 16px', color: '#6b7280', fontSize: 14,
    }}>
      Loading...
    </div>
  );
}

/* ── Locations Tab ─────────────────────────────────────────────────── */

function LocationsTab() {
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'warehouse' | 'vehicle' | 'site'>('warehouse');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet('/stock/locations?page=1');
      setLocations(unwrap<StockLocation>(res));
    } catch { /* empty */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiPost('/stock/locations', { name: name.trim(), type, address: address.trim() || undefined });
      setName(''); setAddress(''); setShowForm(false);
      await load();
    } catch { /* empty */ }
    setSaving(false);
  };

  if (loading) return <LoadingState />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827' }}>
          Storage Locations ({locations.length})
        </h3>
        <button style={btnOutline} onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ New Location'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
          padding: 20, marginBottom: 20,
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#111827' }}>Create Location</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Name *</label>
              <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Main warehouse" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Type *</label>
              <select style={inputStyle} value={type} onChange={e => setType(e.target.value as 'warehouse' | 'vehicle' | 'site')}>
                <option value="warehouse">Warehouse</option>
                <option value="vehicle">Vehicle</option>
                <option value="site">Site</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Address</label>
              <input style={inputStyle} value={address} onChange={e => setAddress(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? 'Creating...' : 'Create Location'}
          </button>
        </form>
      )}

      {locations.length === 0 ? (
        <EmptyState message="No locations found" />
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
                  <Badge label={loc.type} bg={badge.bg} color={badge.color} />
                </div>
                {loc.address && (
                  <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>{loc.address}</div>
                )}
                <div style={{ fontSize: 12, color: '#9ca3af' }}>Created {fmtDate(loc.createdAt)}</div>
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
  const [items, setItems] = useState<StockItem[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
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
        apiGet(`/stock/items?${params}`),
        apiGet('/stock/locations?page=1'),
      ]);
      setItems(unwrap<StockItem>(itemsRes));
      setLocations(unwrap<StockLocation>(locsRes));
    } catch { /* empty */ }
    setLoading(false);
  }, [filterLocation, belowOnly]);

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
    } catch { /* empty */ }
    setSaving(false);
  };

  if (loading) return <LoadingState />;

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 220px' }}>
          <select style={inputStyle} value={filterLocation} onChange={e => setFilterLocation(e.target.value)}>
            <option value="">All locations</option>
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
          {belowOnly ? '!! Below threshold' : 'Below threshold only'}
        </button>
        <div style={{ flex: 1 }} />
        <button style={btnOutline} onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ Add Item'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
          padding: 20, marginBottom: 20,
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#111827' }}>Add Stock Item</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Article ID *</label>
              <input style={inputStyle} value={newArticleId} onChange={e => setNewArticleId(e.target.value)} placeholder="Article ID" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Location *</label>
              <select style={inputStyle} value={newLocationId} onChange={e => setNewLocationId(e.target.value)}>
                <option value="">Select location</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Quantity</label>
              <input style={inputStyle} type="number" min={0} value={newQuantity} onChange={e => setNewQuantity(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Min Threshold</label>
              <input style={inputStyle} type="number" min={0} value={newThreshold} onChange={e => setNewThreshold(e.target.value)} placeholder="0" />
            </div>
          </div>
          <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? 'Adding...' : 'Add Item'}
          </button>
        </form>
      )}

      {items.length === 0 ? (
        <EmptyState message="No stock items found" />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Article / Designation</th>
                <th style={thStyle}>Location</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Quantity</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Min Threshold</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const isLow = item.quantity <= item.minThreshold;
                return (
                  <tr key={item.id} style={{
                    borderLeft: isLow ? '3px solid #f59e0b' : '3px solid transparent',
                    background: isLow ? '#fffbeb' : undefined,
                  }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 500 }}>
                        {item.article?.designation ?? item.canonicalArticleId ?? '-'}
                      </div>
                      {item.article?.unit && (
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{item.article.unit}</div>
                      )}
                    </td>
                    <td style={tdStyle}>{item.location?.name ?? '-'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {item.quantity}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {item.minThreshold}
                    </td>
                    <td style={tdStyle}>
                      {isLow
                        ? <Badge label="Low Stock" bg="#fee2e2" color="#991b1b" />
                        : <Badge label="OK" bg="#dcfce7" color="#166534" />
                      }
                    </td>
                    <td style={{ ...tdStyle, color: '#6b7280', fontSize: 13 }}>
                      {fmtDate(item.createdAt)}
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
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [newItemId, setNewItemId] = useState('');
  const [newType, setNewType] = useState<'in' | 'out' | 'transfer' | 'adjustment'>('in');
  const [newQty, setNewQty] = useState('');
  const [newRef, setNewRef] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [movRes, itemsRes] = await Promise.all([
        apiGet('/stock/movements?page=1'),
        apiGet('/stock/items?page=1'),
      ]);
      setMovements(unwrap<StockMovement>(movRes));
      setItems(unwrap<StockItem>(itemsRes));
    } catch { /* empty */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemId || !newQty) return;
    setSaving(true);
    try {
      await apiPost('/stock/movements', {
        stockItemId: newItemId,
        type: newType,
        quantity: Number(newQty),
        reference: newRef.trim() || undefined,
        projectId: newProjectId.trim() || undefined,
      });
      setNewItemId(''); setNewQty(''); setNewRef(''); setNewProjectId('');
      setShowForm(false);
      await load();
    } catch { /* empty */ }
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
          Movement Log ({movements.length})
        </h3>
        <button style={btnOutline} onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ Record Movement'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
          padding: 20, marginBottom: 20,
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#111827' }}>Record Movement</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Stock Item *</label>
              <select style={inputStyle} value={newItemId} onChange={e => setNewItemId(e.target.value)}>
                <option value="">Select item</option>
                {items.map(it => (
                  <option key={it.id} value={it.id}>
                    {it.article?.designation ?? it.canonicalArticleId ?? it.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Type *</label>
              <select style={inputStyle} value={newType} onChange={e => setNewType(e.target.value as 'in' | 'out' | 'transfer' | 'adjustment')}>
                <option value="in">In</option>
                <option value="out">Out</option>
                <option value="transfer">Transfer</option>
                <option value="adjustment">Adjustment</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Quantity *</label>
              <input style={inputStyle} type="number" min={0} value={newQty} onChange={e => setNewQty(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Reference</label>
              <input style={inputStyle} value={newRef} onChange={e => setNewRef(e.target.value)} placeholder="BL-2024-001" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Project ID</label>
              <input style={inputStyle} value={newProjectId} onChange={e => setNewProjectId(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? 'Recording...' : 'Record Movement'}
          </button>
        </form>
      )}

      {movements.length === 0 ? (
        <EmptyState message="No movements recorded" />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Article</th>
                <th style={thStyle}>Location</th>
                <th style={thStyle}>Type</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Quantity</th>
                <th style={thStyle}>Project</th>
                <th style={thStyle}>Reference</th>
              </tr>
            </thead>
            <tbody>
              {movements.map(mov => {
                const badge = movementBadgeColors[mov.type] ?? movementBadgeColors.in;
                return (
                  <tr key={mov.id}>
                    <td style={{ ...tdStyle, color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap' }}>
                      {fmtDate(mov.createdAt)}
                    </td>
                    <td style={tdStyle}>
                      {mov.stockItem?.article?.designation ?? '-'}
                    </td>
                    <td style={tdStyle}>
                      {mov.stockItem?.location?.name ?? '-'}
                    </td>
                    <td style={tdStyle}>
                      <Badge label={mov.type} bg={badge.bg} color={badge.color} />
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
  const [activeTab, setActiveTab] = useState<Tab>('Locations');

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
        Stock Management
      </h2>
      <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 20, marginTop: 0 }}>
        Manage inventory locations, stock levels, and material movements.
      </p>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '6px 16px', borderRadius: 6, border: '1px solid #e5e7eb',
            background: activeTab === tab ? '#2563eb' : '#fff',
            color: activeTab === tab ? '#fff' : '#4b5563',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}>{tab}</button>
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
