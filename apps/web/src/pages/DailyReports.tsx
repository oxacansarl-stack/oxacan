import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Project {
  id: string;
  name: string;
  reference?: string;
}

interface DailyReport {
  id: string;
  userId: string;
  projectId: string;
  project?: { name: string; reference?: string };
  date: string;
  workDescription?: string;
  weather?: string | null;
  temperatureCelsius?: number | null;
  /** JSONB array; this page writes { name } objects */
  materialsUsed?: Record<string, unknown>[];
  notes?: string | null;
  createdAt: string;
  updatedAt?: string;
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

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 80,
  resize: 'vertical' as const,
  fontFamily: 'inherit',
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
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(iso: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('fr-CH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateShort(iso: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('fr-CH');
}

/** 'YYYY-MM-DD' → local Date without timezone shift */
function parseDay(date: string): Date {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function materialLabel(m: Record<string, unknown>): string {
  const label = m.name ?? m.description ?? m.label;
  return typeof label === 'string' ? label : JSON.stringify(m);
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return `Not allowed: ${err.message}`;
    return err.message || fallback;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DailyReports() {
  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [formProjectId, setFormProjectId] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formWorkDescription, setFormWorkDescription] = useState('');
  const [formWeather, setFormWeather] = useState('');
  const [formTemperature, setFormTemperature] = useState('');
  const [formMaterials, setFormMaterials] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // List state
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [filterProject, setFilterProject] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // ---- Load projects ----
  useEffect(() => {
    apiGet<Project[]>('/projects')
      .then((list) => setProjects(list ?? []))
      .catch(() => {});
  }, []);

  // ---- Load reports ----
  const loadReports = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (filterProject) params.set('projectId', filterProject);
    if (filterDateFrom) params.set('dateFrom', filterDateFrom);
    if (filterDateTo) params.set('dateTo', filterDateTo);

    apiGet<DailyReport[]>(`/daily-reports?${params.toString()}`)
      .then((list) => {
        setReports(list ?? []);
        setError('');
      })
      .catch((err) => setError(errorMessage(err, 'Failed to load reports')))
      .finally(() => setLoading(false));
  }, [filterProject, filterDateFrom, filterDateTo]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  // ---- Reset form ----
  const resetForm = () => {
    setFormProjectId('');
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormWorkDescription('');
    setFormWeather('');
    setFormTemperature('');
    setFormMaterials('');
    setFormNotes('');
    setEditId(null);
  };

  // ---- Create / Update report ----
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formProjectId) return;

    const temperatureCelsius = formTemperature ? parseFloat(formTemperature) : null;
    if (temperatureCelsius != null && (!Number.isFinite(temperatureCelsius) || Math.abs(temperatureCelsius) > 60)) {
      setError('Temperature must be between -60 and 60 °C.');
      return;
    }
    setFormLoading(true);

    // One material per line → JSONB objects
    const materialsUsed = formMaterials
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name }));

    try {
      if (editId) {
        // Project and date are fixed once created; null clears a field.
        await apiPut(`/daily-reports/${editId}`, {
          workDescription: formWorkDescription || null,
          weather: formWeather || null,
          temperatureCelsius,
          materialsUsed,
          notes: formNotes || null,
        });
      } else {
        await apiPost('/daily-reports', {
          projectId: formProjectId,
          date: formDate,
          workDescription: formWorkDescription || undefined,
          weather: formWeather || undefined,
          temperatureCelsius: temperatureCelsius ?? undefined,
          materialsUsed: materialsUsed.length > 0 ? materialsUsed : undefined,
          notes: formNotes || undefined,
        });
      }
      resetForm();
      setShowForm(false);
      loadReports();
    } catch (err) {
      setError(errorMessage(err, 'Failed to save report'));
    } finally {
      setFormLoading(false);
    }
  };

  // ---- Edit ----
  const handleEdit = (report: DailyReport) => {
    setEditId(report.id);
    setFormProjectId(report.projectId);
    setFormDate(report.date ? report.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setFormWorkDescription(report.workDescription || '');
    setFormWeather(report.weather || '');
    setFormTemperature(report.temperatureCelsius != null ? String(report.temperatureCelsius) : '');
    setFormMaterials((report.materialsUsed || []).map(materialLabel).join('\n'));
    setFormNotes(report.notes || '');
    setShowForm(true);
  };

  // ---- Delete ----
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this daily report?')) return;
    try {
      await apiDelete(`/daily-reports/${id}`);
      loadReports();
    } catch (err) {
      setError(errorMessage(err, 'Delete failed'));
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Daily Reports</h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>Document daily work activities, weather, and materials</p>
        </div>
        <button
          style={{ ...btnPrimary }}
          onClick={() => { setShowForm(!showForm); if (showForm) resetForm(); }}
        >
          {showForm ? 'Cancel' : '+ New Report'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 16px', background: '#fee2e2', color: '#991b1b', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Create / Edit Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            background: '#f8f9fa',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 16 }}>
            {editId ? 'Edit Report' : 'New Daily Report'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Project *</label>
              <select style={{ ...inputStyle }} value={formProjectId} onChange={(e) => setFormProjectId(e.target.value)} required disabled={!!editId}>
                <option value="">Select a project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.reference ? `${p.reference} - ` : ''}{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Date *</label>
              <input type="date" style={{ ...inputStyle }} value={formDate} onChange={(e) => setFormDate(e.target.value)} required disabled={!!editId} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Weather</label>
              <input
                style={{ ...inputStyle }}
                placeholder="e.g. Sunny, Cloudy, Rain..."
                value={formWeather}
                onChange={(e) => setFormWeather(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Temperature (C)</label>
              <input
                type="number"
                step="0.5"
                style={{ ...inputStyle }}
                placeholder="e.g. 22"
                value={formTemperature}
                onChange={(e) => setFormTemperature(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Work Description</label>
            <textarea
              style={{ ...textareaStyle }}
              placeholder="Describe work performed today..."
              value={formWorkDescription}
              onChange={(e) => setFormWorkDescription(e.target.value)}
            />
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Materials Used (one per line)</label>
            <textarea
              style={{ ...textareaStyle, minHeight: 60 }}
              placeholder="Concrete 5m3&#10;Rebar 200kg&#10;Formwork panels 20x"
              value={formMaterials}
              onChange={(e) => setFormMaterials(e.target.value)}
            />
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Notes</label>
            <textarea
              style={{ ...textareaStyle, minHeight: 60 }}
              placeholder="Additional notes, issues, observations..."
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" style={{ ...btnOutline }} onClick={() => { setShowForm(false); resetForm(); }}>Cancel</button>
            <button type="submit" style={{ ...btnPrimary }} disabled={formLoading}>
              {formLoading ? 'Saving...' : editId ? 'Update Report' : 'Create Report'}
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 200px' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Project</label>
          <select style={{ ...inputStyle }} value={filterProject} onChange={(e) => setFilterProject(e.target.value)}>
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.reference ? `${p.reference} - ` : ''}{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>From</label>
          <input type="date" style={{ ...inputStyle, width: 150 }} value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>To</label>
          <input type="date" style={{ ...inputStyle, width: 150 }} value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
        </div>
      </div>

      {/* Reports List (Cards) */}
      {loading ? (
        <div style={{ color: '#6b7280', padding: 20 }}>Loading...</div>
      ) : reports.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
          No daily reports found
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reports.map((report) => {
            const isExpanded = expandedId === report.id;
            const materials = report.materialsUsed || [];

            return (
              <div
                key={report.id}
                style={{
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  overflow: 'hidden',
                  transition: 'box-shadow 0.15s',
                }}
              >
                {/* Card header (always visible) */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 20px',
                    cursor: 'pointer',
                    gap: 16,
                  }}
                  onClick={() => setExpandedId(isExpanded ? null : report.id)}
                  onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = '#f9fafb'; }}
                  onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, minWidth: 0 }}>
                    {/* Date badge */}
                    <div
                      style={{
                        flex: '0 0 auto',
                        background: '#eff6ff',
                        color: '#2563eb',
                        borderRadius: 8,
                        padding: '8px 12px',
                        textAlign: 'center',
                        minWidth: 60,
                      }}
                    >
                      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>
                        {report.date ? parseDay(report.date).getDate() : '-'}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 500, marginTop: 2 }}>
                        {report.date
                          ? parseDay(report.date).toLocaleDateString('fr-CH', { month: 'short' })
                          : ''}
                      </div>
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>
                        {report.project?.name || 'Unknown Project'}
                        {report.project?.reference && (
                          <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 8, fontSize: 13 }}>
                            ({report.project.reference})
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {report.workDescription || 'No description'}
                      </div>
                    </div>
                  </div>

                  {/* Weather info */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '0 0 auto' }}>
                    {report.weather && (
                      <span style={{ fontSize: 13, color: '#6b7280', background: '#f3f4f6', padding: '4px 10px', borderRadius: 6 }}>
                        {report.weather}
                        {report.temperatureCelsius != null && ` ${report.temperatureCelsius}°C`}
                      </span>
                    )}
                    <span style={{ fontSize: 18, color: '#9ca3af', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>
                      &#9662;
                    </span>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div style={{ padding: '0 20px 16px', borderTop: '1px solid #f3f4f6' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 16 }}>
                      {/* Work Description */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Work Description
                        </div>
                        <div style={{ fontSize: 14, color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                          {report.workDescription || 'None provided'}
                        </div>
                      </div>

                      {/* Materials */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Materials Used
                        </div>
                        {materials.length > 0 ? (
                          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: '#374151', lineHeight: 1.8 }}>
                            {materials.map((m, i) => (
                              <li key={i}>{materialLabel(m)}</li>
                            ))}
                          </ul>
                        ) : (
                          <div style={{ fontSize: 14, color: '#9ca3af' }}>None recorded</div>
                        )}
                      </div>
                    </div>

                    {/* Weather details */}
                    {(report.weather || report.temperatureCelsius != null) && (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Weather Conditions
                        </div>
                        <div style={{ fontSize: 14, color: '#374151' }}>
                          {report.weather || 'Not recorded'}
                          {report.temperatureCelsius != null && ` — ${report.temperatureCelsius}°C`}
                        </div>
                      </div>
                    )}

                    {/* Notes */}
                    {report.notes && (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Notes
                        </div>
                        <div style={{ fontSize: 14, color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                          {report.notes}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
                      <button style={{ ...btnOutline, fontSize: 13 }} onClick={() => handleEdit(report)}>
                        Edit
                      </button>
                      <button
                        style={{ ...btnDanger, fontSize: 13, background: 'none', color: '#dc2626', border: '1px solid #fecaca' }}
                        onClick={() => handleDelete(report.id)}
                      >
                        Delete
                      </button>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 12, color: '#9ca3af', alignSelf: 'center' }}>
                        Created {formatDateShort(report.createdAt)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
