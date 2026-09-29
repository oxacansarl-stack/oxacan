import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPost, apiPut, apiDelete, apiDownload } from '../lib/api';
import { formatDate, statusLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';

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
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
}

interface Meeting {
  id: string;
  meetingNumber?: number;
  projectId: string;
  project?: { name: string; reference?: string };
  meetingDate: string;
  location?: string;
  agenda?: string;
  minutes?: string;
  status: 'scheduled' | 'in_progress' | 'completed';
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
  const { t } = useTranslation('meetings');
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
      setMeetings(await apiGet<Meeting[]>(`/meetings${qs}`));
    } catch (err: unknown) {
      setError(errorMessage(err, t('messages.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [projectFilter, statusFilter, t]);

  const fetchProjects = useCallback(async () => {
    try {
      setProjects(await apiGet<Project[]>('/projects?limit=100'));
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
      setDetailError(errorMessage(err, t('messages.detailFailed')));
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

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
      if (createForm.location.trim()) body.location = createForm.location.trim();
      if (createForm.agenda.trim()) body.agenda = createForm.agenda;
      await apiPost('/meetings', body);
      setCreateForm({ projectId: '', meetingDate: '', location: '', agenda: '' });
      setShowCreate(false);
      await fetchMeetings();
    } catch (err: unknown) {
      setError(errorMessage(err, t('messages.createFailed')));
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
      setDetailError(errorMessage(err, t('messages.addAttendeeFailed')));
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
      setDetailError(errorMessage(err, t('messages.removeAttendeeFailed')));
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
      setDetailError(errorMessage(err, t('messages.addActionFailed')));
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
      setDetailError(errorMessage(err, t('messages.updateActionFailed')));
    }
  };

  const handleSaveMinutes = async () => {
    if (!detail) return;
    setSavingMinutes(true);
    try {
      await apiPut(`/meetings/${detail.id}`, { minutes: minutesDraft });
      await fetchDetail(detail.id);
    } catch (err: unknown) {
      setDetailError(errorMessage(err, t('messages.saveMinutesFailed')));
    } finally {
      setSavingMinutes(false);
    }
  };

  const handleComplete = async () => {
    if (!detail) return;
    if (!window.confirm(t('messages.confirmComplete'))) return;
    setCompleting(true);
    try {
      await apiPost(`/meetings/${detail.id}/complete`);
      await fetchDetail(detail.id);
      await fetchMeetings();
    } catch (err: unknown) {
      setDetailError(errorMessage(err, t('messages.completeFailed')));
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
          {t('title')}
        </h1>
        <button
          style={btnPrimary}
          onClick={() => setShowCreate((prev) => !prev)}
        >
          {t('newMeeting')}
        </button>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          style={{ ...inputStyle, maxWidth: 260 }}
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">{t('filters.allProjects')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.reference ? `${p.reference} - ` : ''}{p.name}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['', 'scheduled', 'completed'] as const).map((s) => {
            const label = s === '' ? t('filters.allStatuses') : statusLabel('meeting', s);
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
            {t('form.title')}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
                {t('form.project')}
              </label>
              <select
                style={inputStyle}
                value={createForm.projectId}
                onChange={(e) => setCreateForm((f) => ({ ...f, projectId: e.target.value }))}
              >
                <option value="">{t('form.selectProject')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.reference ? `${p.reference} - ` : ''}{p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
                {t('form.date')}
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
                {t('form.location')}
              </label>
              <input
                style={inputStyle}
                placeholder={t('form.locationPlaceholder')}
                value={createForm.location}
                onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
              {t('form.agenda')}
            </label>
            <textarea
              style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
              placeholder={t('form.agendaPlaceholder')}
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
              {creating ? t('form.creating') : t('form.submit')}
            </button>
            <button style={btnOutline} onClick={() => setShowCreate(false)}>
              {t('common:actions.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Meetings table */}
      {loading ? (
        <div style={{ color: '#6b7280', padding: 20 }}>{t('common:state.loading')}</div>
      ) : meetings.length === 0 ? (
        <div style={{ color: '#9ca3af', padding: 20, textAlign: 'center' }}>
          {t('empty')}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {(['number', 'date', 'project', 'location', 'status', 'actions', 'created'] as const).map((h) => (
                <th key={h} style={thStyle}>{t(`table.${h}`)}</th>
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
                      {m.meetingNumber ?? m.id.slice(0, 8)}
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
                        {statusLabel('meeting', m.status)}
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
                          <div style={{ padding: 24, color: '#6b7280' }}>{t('detail.loading')}</div>
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
                            onDownloadPdf={() =>
                              apiDownload(`/meetings/${detail.id}/pdf`).catch((err) =>
                                setDetailError(errorMessage(err, t('messages.pdfFailed'))),
                              )
                            }
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
  onDownloadPdf: () => void;
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
  onDownloadPdf,
}: MeetingDetailProps) {
  const { t } = useTranslation('meetings');
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
            <span style={{ fontSize: 13, color: '#6b7280' }}>{t('detail.project')}</span>
            <span style={{ fontWeight: 500, color: '#111827' }}>
              {detail.project?.name ?? '-'}
              {detail.project?.reference ? ` (${detail.project.reference})` : ''}
            </span>
          </div>
          <div>
            <span style={{ fontSize: 13, color: '#6b7280' }}>{t('detail.date')}</span>
            <span style={{ fontWeight: 500, color: '#111827' }}>{formatDate(detail.meetingDate)}</span>
          </div>
          <div>
            <span style={{ fontSize: 13, color: '#6b7280' }}>{t('detail.location')}</span>
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
            {statusLabel('meeting', detail.status)}
          </span>
        </div>
      </div>

      {/* Agenda */}
      {detail.agenda && (
        <div style={sectionStyle}>
          <h4 style={sectionTitle}>{t('detail.agenda')}</h4>
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
        <h4 style={sectionTitle}>{t('detail.attendees.title', { count: attendees.length })}</h4>
        {attendees.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
            <thead>
              <tr>
                {(['name', 'role', 'organization', ''] as const).map((h) => (
                  <th key={h} style={{ ...thStyle, fontSize: 12 }}>{h ? t(`detail.attendees.${h}`) : ''}</th>
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
                      {t('detail.attendees.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {attendees.length === 0 && (
          <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 12 }}>{t('detail.attendees.empty')}</div>
        )}
        {/* Add attendee inline form */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>{t('detail.attendees.nameLabel')}</label>
            <input
              style={{ ...inputStyle, width: 180 }}
              placeholder={t('detail.attendees.name')}
              value={attendeeForm.name}
              onChange={(e) => setAttendeeForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>{t('detail.attendees.roleLabel')}</label>
            <input
              style={{ ...inputStyle, width: 150 }}
              placeholder={t('detail.attendees.role')}
              value={attendeeForm.role}
              onChange={(e) => setAttendeeForm((f) => ({ ...f, role: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>{t('detail.attendees.organizationLabel')}</label>
            <input
              style={{ ...inputStyle, width: 180 }}
              placeholder={t('detail.attendees.organization')}
              value={attendeeForm.organization}
              onChange={(e) => setAttendeeForm((f) => ({ ...f, organization: e.target.value }))}
            />
          </div>
          <button
            style={{ ...btnPrimary, padding: '8px 12px', fontSize: 13 }}
            onClick={onAddAttendee}
            disabled={addingAttendee || !attendeeForm.name}
          >
            {addingAttendee ? t('detail.attendees.adding') : t('detail.attendees.add')}
          </button>
        </div>
      </div>

      {/* Action Items */}
      <div style={sectionStyle}>
        <h4 style={sectionTitle}>{t('detail.actions.title', { count: actions.length })}</h4>
        {actions.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
            <thead>
              <tr>
                {(['description', 'responsible', 'dueDate', 'status'] as const).map((h) => (
                  <th key={h} style={{ ...thStyle, fontSize: 12 }}>{t(`detail.actions.${h}`)}</th>
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
                      {overdue && <span style={{ fontSize: 11, marginLeft: 4 }}>{t('detail.actions.overdue')}</span>}
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
                        <option value="open">{statusLabel('meetingAction', 'open')}</option>
                        <option value="in_progress">{statusLabel('meetingAction', 'in_progress')}</option>
                        <option value="done">{statusLabel('meetingAction', 'done')}</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {actions.length === 0 && (
          <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 12 }}>{t('detail.actions.empty')}</div>
        )}
        {/* Add action inline form */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>{t('detail.actions.descriptionLabel')}</label>
            <input
              style={{ ...inputStyle, width: 240 }}
              placeholder={t('detail.actions.descriptionPlaceholder')}
              value={actionForm.description}
              onChange={(e) => setActionForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>{t('detail.actions.responsibleLabel')}</label>
            <input
              style={{ ...inputStyle, width: 160 }}
              placeholder={t('detail.actions.responsiblePlaceholder')}
              value={actionForm.responsible}
              onChange={(e) => setActionForm((f) => ({ ...f, responsible: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>{t('detail.actions.dueDateLabel')}</label>
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
            {addingAction ? t('detail.actions.adding') : t('detail.actions.add')}
          </button>
        </div>
      </div>

      {/* Minutes */}
      <div style={sectionStyle}>
        <h4 style={sectionTitle}>{t('detail.minutes.title')}</h4>
        <textarea
          style={{ ...inputStyle, minHeight: 120, resize: 'vertical', marginBottom: 8 }}
          placeholder={t('detail.minutes.placeholder')}
          value={minutesDraft}
          onChange={(e) => setMinutesDraft(e.target.value)}
        />
        <div>
          <button
            style={btnPrimary}
            onClick={onSaveMinutes}
            disabled={savingMinutes}
          >
            {savingMinutes ? t('common:actions.saving') : t('detail.minutes.save')}
          </button>
        </div>
      </div>

      {/* Complete meeting */}
      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, display: 'flex', gap: 8 }}>
        <button style={btnOutline} onClick={onDownloadPdf}>
          {t('detail.downloadPdf')}
        </button>
        {detail.status === 'scheduled' && (
          <button
            style={btnSuccess}
            onClick={onComplete}
            disabled={completing}
          >
            {completing ? t('detail.completing') : t('detail.complete')}
          </button>
        )}
      </div>
    </div>
  );
}
