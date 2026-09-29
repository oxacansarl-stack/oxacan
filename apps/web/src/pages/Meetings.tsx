import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Project {
  id: string;
  name: string;
  reference?: string;
}

interface Attendee {
  id: string;
  name: string;
  role?: string;
  organization?: string;
}

interface ActionItem {
  id: string;
  description: string;
  responsible: string;
  dueDate?: string;
  status: 'open' | 'in_progress' | 'done';
}

interface Meeting {
  id: string;
  number?: number;
  projectId: string;
  project?: { name: string; reference?: string };
  meetingDate: string;
  location?: string;
  agenda?: string;
  minutes?: string;
  status: 'scheduled' | 'completed';
  attendees?: Attendee[];
  actions?: ActionItem[];
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  scheduled: { bg: '#dbeafe', fg: '#1d4ed8' },
  completed: { bg: '#dcfce7', fg: '#166534' },
};

const ACTION_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  open: { bg: '#fee2e2', fg: '#991b1b' },
  in_progress: { bg: '#fef3c7', fg: '#92400e' },
  done: { bg: '#dcfce7', fg: '#166534' },
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

const btnSuccess: React.CSSProperties = { ...btnPrimary, background: '#16a34a' };

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

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '2px solid #e5e7eb',
  fontSize: 13,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #f3f4f6',
  fontSize: 14,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('fr-CH');
}

function isPastDue(iso?: string): boolean {
  if (!iso) return false;
  const due = new Date(iso);
  due.setHours(23, 59, 59, 999);
  return due < new Date();
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Meetings() {
  /* ----- list state ----- */
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  /* ----- create form state ----- */
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    projectId: '',
    meetingDate: '',
    location: '',
    agenda: '',
  });
  const [creating, setCreating] = useState(false);

  /* ----- detail state ----- */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Meeting | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  /* ----- attendee form ----- */
  const [attendeeForm, setAttendeeForm] = useState({ name: '', role: '', organization: '' });
  const [addingAttendee, setAddingAttendee] = useState(false);

  /* ----- action form ----- */
  const [actionForm, setActionForm] = useState({ description: '', responsible: '', dueDate: '' });
  const [addingAction, setAddingAction] = useState(false);

  /* ----- minutes ----- */
  const [minutesDraft, setMinutesDraft] = useState('');
  const [savingMinutes, setSavingMinutes] = useState(false);

  /* ----- completing ----- */
  const [completing, setCompleting] = useState(false);

  /* ---------------------------------------------------------------- */
  /*  Data fetching                                                    */
  /* ---------------------------------------------------------------- */

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (projectFilter) params.set('projectId', projectFilter);
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await apiGet<Meeting[] | { data: Meeting[] }>(`/meetings${qs}`);
      const list = Array.isArray(res) ? res : res.data ?? [];
      setMeetings(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  }, [projectFilter, statusFilter]);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await apiGet<Project[] | { data: Project[] }>('/projects');
      const list = Array.isArray(res) ? res : res.data ?? [];
      setProjects(list);
    } catch {
      /* projects dropdown is best-effort */
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      const res = await apiGet<Meeting>(`/meetings/${id}`);
      setDetail(res);
      setMinutesDraft(res.minutes ?? '');
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load meeting');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  useEffect(() => {
    if (selectedId) {
      fetchDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, fetchDetail]);

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                         */
  /* ---------------------------------------------------------------- */

  const handleCreate = async () => {
    if (!createForm.projectId || !createForm.meetingDate) return;
    setCreating(true);
    try {
      const body: Record<string, string> = {
        projectId: createForm.projectId,
        meetingDate: createForm.meetingDate,
      };
      if (createForm.location) body.location = createForm.location;
      if (createForm.agenda) body.agenda = createForm.agenda;
      await apiPost('/meetings', body);
      setCreateForm({ projectId: '', meetingDate: '', location: '', agenda: '' });
      setShowCreate(false);
      await fetchMeetings();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create meeting');
    } finally {
      setCreating(false);
    }
  };

  const handleAddAttendee = async () => {
    if (!detail || !attendeeForm.name) return;
    setAddingAttendee(true);
    try {
      const body: Record<string, string> = { name: attendeeForm.name };
      if (attendeeForm.role) body.role = attendeeForm.role;
      if (attendeeForm.organization) body.organization = attendeeForm.organization;
      await apiPost(`/meetings/${detail.id}/attendees`, body);
      setAttendeeForm({ name: '', role: '', organization: '' });
      await fetchDetail(detail.id);
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : 'Failed to add attendee');
    } finally {
      setAddingAttendee(false);
    }
  };

  const handleRemoveAttendee = async (attendeeId: string) => {
    if (!detail) return;
    try {
      await apiDelete(`/meetings/${detail.id}/attendees/${attendeeId}`);
      await fetchDetail(detail.id);
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : 'Failed to remove attendee');
    }
  };

  const handleAddAction = async () => {
    if (!detail || !actionForm.description || !actionForm.responsible) return;
    setAddingAction(true);
    try {
      const body: Record<string, string> = {
        description: actionForm.description,
        responsible: actionForm.responsible,
      };
      if (actionForm.dueDate) body.dueDate = actionForm.dueDate;
      await apiPost(`/meetings/${detail.id}/actions`, body);
      setActionForm({ description: '', responsible: '', dueDate: '' });
      await fetchDetail(detail.id);
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : 'Failed to add action');
    } finally {
      setAddingAction(false);
    }
  };

  const handleUpdateActionStatus = async (actionId: string, status: string) => {
    if (!detail) return;
    try {
      await apiPut(`/meetings/${detail.id}/actions/${actionId}`, { status });
      await fetchDetail(detail.id);
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : 'Failed to update action');
    }
  };

  const handleSaveMinutes = async () => {
    if (!detail) return;
    setSavingMinutes(true);
    try {
      await apiPut(`/meetings/${detail.id}`, { minutes: minutesDraft });
      await fetchDetail(detail.id);
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : 'Failed to save minutes');
    } finally {
      setSavingMinutes(false);
    }
  };

  const handleComplete = async () => {
    if (!detail) return;
    if (!window.confirm('Are you sure you want to mark this meeting as completed?')) return;
    setCompleting(true);
    try {
      await apiPost(`/meetings/${detail.id}/complete`);
      await fetchDetail(detail.id);
      await fetchMeetings();
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : 'Failed to complete meeting');
    } finally {
      setCompleting(false);
    }
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

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
          Site Meetings
        </h1>
        <button
          style={btnPrimary}
          onClick={() => setShowCreate((prev) => !prev)}
        >
          + New Meeting
        </button>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          style={{ ...inputStyle, maxWidth: 260 }}
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.reference ? `${p.reference} - ` : ''}{p.name}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['', 'scheduled', 'completed'] as const).map((s) => {
            const label = s === '' ? 'All' : statusLabel(s);
            const active = statusFilter === s;
            return (
              <button
                key={s}
                style={{
                  ...btnOutline,
                  background: active ? '#2563eb' : '#fff',
                  color: active ? '#fff' : '#374151',
                  borderColor: active ? '#2563eb' : '#d1d5db',
                }}
                onClick={() => setStatusFilter(s)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: '#dc2626', padding: '8px 0', fontSize: 14, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div
          style={{
            background: '#f8f9fa',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#111827' }}>
            New Meeting
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
                Project *
              </label>
              <select
                style={inputStyle}
                value={createForm.projectId}
                onChange={(e) => setCreateForm((f) => ({ ...f, projectId: e.target.value }))}
              >
                <option value="">Select project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.reference ? `${p.reference} - ` : ''}{p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
                Date *
              </label>
              <input
                type="date"
                style={inputStyle}
                value={createForm.meetingDate}
                onChange={(e) => setCreateForm((f) => ({ ...f, meetingDate: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
                Location
              </label>
              <input
                style={inputStyle}
                placeholder="e.g. Site office, room A"
                value={createForm.location}
                onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
              Agenda
            </label>
            <textarea
              style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
              placeholder="Meeting agenda..."
              value={createForm.agenda}
              onChange={(e) => setCreateForm((f) => ({ ...f, agenda: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={btnPrimary}
              onClick={handleCreate}
              disabled={creating || !createForm.projectId || !createForm.meetingDate}
            >
              {creating ? 'Creating...' : 'Create Meeting'}
            </button>
            <button style={btnOutline} onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Meetings table */}
      {loading ? (
        <div style={{ color: '#6b7280', padding: 20 }}>Loading...</div>
      ) : meetings.length === 0 ? (
        <div style={{ color: '#9ca3af', padding: 20, textAlign: 'center' }}>
          No meetings found
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['#', 'Date', 'Project', 'Location', 'Status', 'Actions', 'Created'].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meetings.map((m) => {
              const colors = STATUS_COLORS[m.status] ?? STATUS_COLORS.scheduled;
              const isSelected = selectedId === m.id;
              return (
                <React.Fragment key={m.id}>
                  <tr
                    onClick={() => setSelectedId(isSelected ? null : m.id)}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? '#f0f4ff' : undefined,
                    }}
                    onMouseOver={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#f9fafb';
                    }}
                    onMouseOut={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLElement).style.background = '';
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 500 }}>
                      {m.number ?? m.id.slice(0, 8)}
                    </td>
                    <td style={tdStyle}>{formatDate(m.meetingDate)}</td>
                    <td style={tdStyle}>{m.project?.name ?? '-'}</td>
                    <td style={tdStyle}>{m.location ?? '-'}</td>
                    <td style={tdStyle}>
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
                        {statusLabel(m.status)}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>
                      {m.actions?.length ?? 0}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 13, color: '#6b7280' }}>
                      {formatDate(m.createdAt)}
                    </td>
                  </tr>

                  {/* Detail row */}
                  {isSelected && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid #e5e7eb' }}>
                        {detailLoading ? (
                          <div style={{ padding: 24, color: '#6b7280' }}>Loading meeting details...</div>
                        ) : detailError ? (
                          <div style={{ padding: 24, color: '#dc2626' }}>{detailError}</div>
                        ) : detail ? (
                          <MeetingDetail
                            detail={detail}
                            attendeeForm={attendeeForm}
                            setAttendeeForm={setAttendeeForm}
                            addingAttendee={addingAttendee}
                            onAddAttendee={handleAddAttendee}
                            onRemoveAttendee={handleRemoveAttendee}
                            actionForm={actionForm}
                            setActionForm={setActionForm}
                            addingAction={addingAction}
                            onAddAction={handleAddAction}
                            onUpdateActionStatus={handleUpdateActionStatus}
                            minutesDraft={minutesDraft}
                            setMinutesDraft={setMinutesDraft}
                            savingMinutes={savingMinutes}
                            onSaveMinutes={handleSaveMinutes}
                            completing={completing}
                            onComplete={handleComplete}
                          />
                        ) : null}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Detail sub-component                                               */
/* ------------------------------------------------------------------ */

interface MeetingDetailProps {
  detail: Meeting;
  attendeeForm: { name: string; role: string; organization: string };
  setAttendeeForm: React.Dispatch<React.SetStateAction<{ name: string; role: string; organization: string }>>;
  addingAttendee: boolean;
  onAddAttendee: () => void;
  onRemoveAttendee: (id: string) => void;
  actionForm: { description: string; responsible: string; dueDate: string };
  setActionForm: React.Dispatch<React.SetStateAction<{ description: string; responsible: string; dueDate: string }>>;
  addingAction: boolean;
  onAddAction: () => void;
  onUpdateActionStatus: (actionId: string, status: string) => void;
  minutesDraft: string;
  setMinutesDraft: (v: string) => void;
  savingMinutes: boolean;
  onSaveMinutes: () => void;
  completing: boolean;
  onComplete: () => void;
}

function MeetingDetail({
  detail,
  attendeeForm,
  setAttendeeForm,
  addingAttendee,
  onAddAttendee,
  onRemoveAttendee,
  actionForm,
  setActionForm,
  addingAction,
  onAddAction,
  onUpdateActionStatus,
  minutesDraft,
  setMinutesDraft,
  savingMinutes,
  onSaveMinutes,
  completing,
  onComplete,
}: MeetingDetailProps) {
  const attendees = detail.attendees ?? [];
  const actions = detail.actions ?? [];
  const colors = STATUS_COLORS[detail.status] ?? STATUS_COLORS.scheduled;

  const sectionStyle: React.CSSProperties = {
    marginBottom: 24,
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 15,
    fontWeight: 600,
    color: '#111827',
    margin: '0 0 10px',
  };

  return (
    <div style={{ padding: 24, background: '#fafbfc' }}>
      {/* Meeting info */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <span style={{ fontSize: 13, color: '#6b7280' }}>Project: </span>
            <span style={{ fontWeight: 500, color: '#111827' }}>
              {detail.project?.name ?? '-'}
              {detail.project?.reference ? ` (${detail.project.reference})` : ''}
            </span>
          </div>
          <div>
            <span style={{ fontSize: 13, color: '#6b7280' }}>Date: </span>
            <span style={{ fontWeight: 500, color: '#111827' }}>{formatDate(detail.meetingDate)}</span>
          </div>
          <div>
            <span style={{ fontSize: 13, color: '#6b7280' }}>Location: </span>
            <span style={{ fontWeight: 500, color: '#111827' }}>{detail.location ?? '-'}</span>
          </div>
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
            {statusLabel(detail.status)}
          </span>
        </div>
      </div>

      {/* Agenda */}
      {detail.agenda && (
        <div style={sectionStyle}>
          <h4 style={sectionTitle}>Agenda</h4>
          <pre
            style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              padding: 12,
              fontSize: 14,
              color: '#374151',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
              fontFamily: 'inherit',
            }}
          >
            {detail.agenda}
          </pre>
        </div>
      )}

      {/* Attendees */}
      <div style={sectionStyle}>
        <h4 style={sectionTitle}>Attendees ({attendees.length})</h4>
        {attendees.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
            <thead>
              <tr>
                {['Name', 'Role', 'Organization', ''].map((h) => (
                  <th key={h} style={{ ...thStyle, fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attendees.map((a) => (
                <tr key={a.id}>
                  <td style={tdStyle}>{a.name}</td>
                  <td style={tdStyle}>{a.role ?? '-'}</td>
                  <td style={tdStyle}>{a.organization ?? '-'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button
                      style={{ ...btnDanger, padding: '4px 10px', fontSize: 12 }}
                      onClick={() => onRemoveAttendee(a.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {attendees.length === 0 && (
          <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 12 }}>No attendees yet</div>
        )}
        {/* Add attendee inline form */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>Name *</label>
            <input
              style={{ ...inputStyle, width: 180 }}
              placeholder="Name"
              value={attendeeForm.name}
              onChange={(e) => setAttendeeForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>Role</label>
            <input
              style={{ ...inputStyle, width: 150 }}
              placeholder="Role"
              value={attendeeForm.role}
              onChange={(e) => setAttendeeForm((f) => ({ ...f, role: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>Organization</label>
            <input
              style={{ ...inputStyle, width: 180 }}
              placeholder="Organization"
              value={attendeeForm.organization}
              onChange={(e) => setAttendeeForm((f) => ({ ...f, organization: e.target.value }))}
            />
          </div>
          <button
            style={{ ...btnPrimary, padding: '8px 12px', fontSize: 13 }}
            onClick={onAddAttendee}
            disabled={addingAttendee || !attendeeForm.name}
          >
            {addingAttendee ? 'Adding...' : 'Add Attendee'}
          </button>
        </div>
      </div>

      {/* Action Items */}
      <div style={sectionStyle}>
        <h4 style={sectionTitle}>Action Items ({actions.length})</h4>
        {actions.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
            <thead>
              <tr>
                {['Description', 'Responsible', 'Due Date', 'Status'].map((h) => (
                  <th key={h} style={{ ...thStyle, fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => {
                const ac = ACTION_STATUS_COLORS[a.status] ?? ACTION_STATUS_COLORS.open;
                const overdue = a.status !== 'done' && isPastDue(a.dueDate);
                return (
                  <tr key={a.id}>
                    <td style={tdStyle}>{a.description}</td>
                    <td style={tdStyle}>{a.responsible}</td>
                    <td style={{ ...tdStyle, color: overdue ? '#dc2626' : undefined, fontWeight: overdue ? 600 : undefined }}>
                      {a.dueDate ? formatDate(a.dueDate) : '-'}
                      {overdue && <span style={{ fontSize: 11, marginLeft: 4 }}>(overdue)</span>}
                    </td>
                    <td style={tdStyle}>
                      <select
                        style={{
                          padding: '3px 8px',
                          borderRadius: 10,
                          border: 'none',
                          fontSize: 12,
                          fontWeight: 600,
                          background: ac.bg,
                          color: ac.fg,
                          cursor: 'pointer',
                          outline: 'none',
                        }}
                        value={a.status}
                        onChange={(e) => onUpdateActionStatus(a.id, e.target.value)}
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="done">Done</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {actions.length === 0 && (
          <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 12 }}>No action items yet</div>
        )}
        {/* Add action inline form */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>Description *</label>
            <input
              style={{ ...inputStyle, width: 240 }}
              placeholder="Action description"
              value={actionForm.description}
              onChange={(e) => setActionForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>Responsible *</label>
            <input
              style={{ ...inputStyle, width: 160 }}
              placeholder="Responsible"
              value={actionForm.responsible}
              onChange={(e) => setActionForm((f) => ({ ...f, responsible: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>Due Date</label>
            <input
              type="date"
              style={{ ...inputStyle, width: 160 }}
              value={actionForm.dueDate}
              onChange={(e) => setActionForm((f) => ({ ...f, dueDate: e.target.value }))}
            />
          </div>
          <button
            style={{ ...btnPrimary, padding: '8px 12px', fontSize: 13 }}
            onClick={onAddAction}
            disabled={addingAction || !actionForm.description || !actionForm.responsible}
          >
            {addingAction ? 'Adding...' : 'Add Action'}
          </button>
        </div>
      </div>

      {/* Minutes */}
      <div style={sectionStyle}>
        <h4 style={sectionTitle}>Minutes</h4>
        <textarea
          style={{ ...inputStyle, minHeight: 120, resize: 'vertical', marginBottom: 8 }}
          placeholder="Meeting minutes..."
          value={minutesDraft}
          onChange={(e) => setMinutesDraft(e.target.value)}
        />
        <div>
          <button
            style={btnPrimary}
            onClick={onSaveMinutes}
            disabled={savingMinutes}
          >
            {savingMinutes ? 'Saving...' : 'Save Minutes'}
          </button>
        </div>
      </div>

      {/* Complete meeting */}
      {detail.status === 'scheduled' && (
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
          <button
            style={btnSuccess}
            onClick={onComplete}
            disabled={completing}
          >
            {completing ? 'Completing...' : 'Complete Meeting'}
          </button>
        </div>
      )}
    </div>
  );
}
