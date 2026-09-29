import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Lot {
  id: string;
  name: string;
  taskCount: number;
}

interface Milestone {
  id: string;
  name: string;
  status: string;
  dueDate?: string;
}

interface DailyReport {
  id: string;
  date: string;
  summary: string;
}

interface TaskOverview {
  todo: number;
  in_progress: number;
  done: number;
}

interface PortalData {
  project: {
    name: string;
    status: string;
    progress: number;
  };
  lots: Lot[];
  milestones: Milestone[];
  recentReports: DailyReport[];
  taskOverview: TaskOverview;
}

/** Raw shape of GET /portal/view/:token (inside the response envelope). */
interface PortalApiResponse {
  project: { name: string; status: string; progressPercent: number | null };
  lots: { id: string; name: string }[];
  milestones: { id: string; name: string; status: string; targetDate: string | null }[];
  tasks: { id: string; lotId: string | null; status: string }[];
  dailyReports: { id: string; date: string; workDescription: string | null }[];
}

function toPortalData(raw: PortalApiResponse): PortalData {
  const tasks = raw.tasks ?? [];
  const countStatus = (st: string) => tasks.filter(t => t.status === st).length;
  return {
    project: {
      name: raw.project.name,
      status: raw.project.status,
      progress: raw.project.progressPercent ?? 0,
    },
    lots: (raw.lots ?? []).map(l => ({
      id: l.id,
      name: l.name,
      taskCount: tasks.filter(t => t.lotId === l.id).length,
    })),
    milestones: (raw.milestones ?? []).map(m => ({
      id: m.id,
      name: m.name,
      status: m.status,
      dueDate: m.targetDate ?? undefined,
    })),
    recentReports: (raw.dailyReports ?? []).map(r => ({
      id: r.id,
      date: r.date,
      summary: r.workDescription ?? '',
    })),
    taskOverview: {
      todo: countStatus('todo'),
      in_progress: countStatus('in_progress'),
      // 'validated' is a signed-off 'done'
      done: countStatus('done') + countStatus('validated'),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  not_started: { bg: '#f3f4f6', fg: '#4b5563' },
  in_progress: { bg: '#dbeafe', fg: '#1d4ed8' },
  completed: { bg: '#dcfce7', fg: '#166534' },
  on_hold: { bg: '#fef3c7', fg: '#92400e' },
  active: { bg: '#dbeafe', fg: '#1d4ed8' },
  done: { bg: '#dcfce7', fg: '#166534' },
  todo: { bg: '#f3f4f6', fg: '#4b5563' },
  overdue: { bg: '#fee2e2', fg: '#dc2626' },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PortalView() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    fetch(`/api/portal/view/${token}`)
      .then(async res => {
        if (!res.ok) {
          const body = await res.text();
          let msg: string;
          try {
            const parsed = JSON.parse(body);
            msg = parsed?.error?.message || parsed?.message || res.statusText;
          }
          catch { msg = body || res.statusText; }
          throw new Error(msg);
        }
        return res.json();
      })
      .then(res => {
        setData(toPortalData((res?.data ?? res) as PortalApiResponse));
      })
      .catch(e => {
        setError(e.message || 'Failed to load portal data');
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#f8f9fa',
      }}>
        <p style={{ color: '#6b7280', fontSize: 16 }}>Loading project portal...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#f8f9fa',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, color: '#d1d5db', marginBottom: 16 }}>!</div>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: '#111827', margin: '0 0 8px' }}>Portal Unavailable</h2>
          <p style={{ color: '#6b7280', fontSize: 14 }}>{error || 'This portal link is invalid or has expired.'}</p>
        </div>
      </div>
    );
  }

  const project = data.project;
  const totalTasks = (data.taskOverview?.todo ?? 0) + (data.taskOverview?.in_progress ?? 0) + (data.taskOverview?.done ?? 0);

  return (
    <div style={{
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: '#f8f9fa',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <header style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        padding: '16px 32px',
      }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
                OXACAN Project Portal
              </div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111827' }}>
                {project.name}
              </h1>
            </div>
            <span style={{
              display: 'inline-block',
              padding: '4px 14px',
              borderRadius: 9999,
              fontSize: 13,
              fontWeight: 500,
              background: (STATUS_COLORS[project.status] || STATUS_COLORS.active).bg,
              color: (STATUS_COLORS[project.status] || STATUS_COLORS.active).fg,
              textTransform: 'capitalize',
            }}>
              {project.status?.replace(/_/g, ' ') || 'Active'}
            </span>
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              <span>Overall Progress</span>
              <span>{project.progress ?? 0}%</span>
            </div>
            <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${project.progress ?? 0}%`,
                height: '100%',
                background: '#2563eb',
                borderRadius: 4,
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, padding: '24px 32px', maxWidth: 960, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* Task Overview */}
        {totalTasks > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111827', margin: '0 0 12px' }}>Task Overview</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <div style={{
                background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#6b7280' }}>{data.taskOverview.todo}</div>
                <div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', marginTop: 4 }}>To Do</div>
              </div>
              <div style={{
                background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#2563eb' }}>{data.taskOverview.in_progress}</div>
                <div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', marginTop: 4 }}>In Progress</div>
              </div>
              <div style={{
                background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#16a34a' }}>{data.taskOverview.done}</div>
                <div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', marginTop: 4 }}>Done</div>
              </div>
            </div>
          </div>
        )}

        {/* Lots */}
        {data.lots && data.lots.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111827', margin: '0 0 12px' }}>Lots</h2>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
              {data.lots.map((lot, i) => (
                <div
                  key={lot.id}
                  style={{
                    padding: '12px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: i > 0 ? '1px solid #f3f4f6' : 'none',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>{lot.name}</span>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{lot.taskCount} task{lot.taskCount !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Milestones */}
        {data.milestones && data.milestones.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111827', margin: '0 0 12px' }}>Milestones</h2>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
              {data.milestones.map((ms, i) => (
                <div
                  key={ms.id}
                  style={{
                    padding: '12px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: i > 0 ? '1px solid #f3f4f6' : 'none',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>{ms.name}</span>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      {ms.dueDate ? new Date(ms.dueDate).toLocaleDateString() : ''}
                    </span>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 10px',
                      borderRadius: 9999,
                      fontSize: 12,
                      fontWeight: 500,
                      background: (STATUS_COLORS[ms.status] || STATUS_COLORS.not_started).bg,
                      color: (STATUS_COLORS[ms.status] || STATUS_COLORS.not_started).fg,
                      textTransform: 'capitalize',
                    }}>
                      {ms.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Updates */}
        {data.recentReports && data.recentReports.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111827', margin: '0 0 12px' }}>Recent Updates</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.recentReports.map(report => (
                <div
                  key={report.id}
                  style={{
                    background: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    padding: 16,
                  }}
                >
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                    {new Date(report.date).toLocaleDateString()}
                  </div>
                  <div style={{ fontSize: 14, color: '#111827', lineHeight: 1.5 }}>
                    {report.summary}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        padding: '16px 32px',
        borderTop: '1px solid #e5e7eb',
        textAlign: 'center',
        background: '#fff',
      }}>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>Powered by </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>OXACAN</span>
      </footer>
    </div>
  );
}
