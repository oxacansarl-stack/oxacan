import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, api } from '../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Notification {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

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

const apiPatch = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'PATCH',
    body: body != null ? JSON.stringify(body) : undefined,
  });

const apiPost = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'POST',
    body: body != null ? JSON.stringify(body) : undefined,
  });

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 30) return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`;
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const mins = Math.floor(diff / 60000);
  return mins > 0 ? `${mins} min${mins > 1 ? 's' : ''} ago` : 'just now';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let path = `/notifications?page=${page}`;
      if (filter === 'unread') path += '&isRead=false';
      const res = await apiGet<any>(path);
      if (Array.isArray(res)) {
        setNotifications(res);
        setTotalPages(1);
      } else if (res && typeof res === 'object' && 'data' in res) {
        setNotifications(res.data);
        setTotalPages(Math.ceil((res.meta?.total ?? res.data.length) / (res.meta?.pageSize ?? 25)));
      } else {
        setNotifications([]);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load notifications');
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    try {
      await apiPatch(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    try {
      await apiPost('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (e: any) {
      setError(e.message || 'Failed to mark all as read');
    }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#111827' }}>Notifications</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button style={btnPrimary} onClick={markAllRead}>
            Mark All Read
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 600 }}>x</button>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #e5e7eb' }}>
        {(['all', 'unread'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => { setFilter(tab); setPage(1); }}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderBottom: filter === tab ? '2px solid #2563eb' : '2px solid transparent',
              background: 'none',
              color: filter === tab ? '#2563eb' : '#6b7280',
              fontWeight: filter === tab ? 600 : 400,
              fontSize: 14,
              cursor: 'pointer',
              marginBottom: -2,
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Notification list */}
      {loading ? (
        <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>Loading notifications...</p>
      ) : notifications.length === 0 ? (
        <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>
          {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notifications.map(n => (
            <div
              key={n.id}
              onClick={() => { if (!n.isRead) markAsRead(n.id); }}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '16px 20px',
                borderLeft: !n.isRead ? '4px solid #2563eb' : '4px solid transparent',
                background: !n.isRead ? '#fafbff' : '#fff',
                cursor: !n.isRead ? 'pointer' : 'default',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {!n.isRead && (
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: '#2563eb',
                        display: 'inline-block',
                        flexShrink: 0,
                      }} />
                    )}
                    <span style={{ fontSize: 15, fontWeight: n.isRead ? 400 : 600, color: '#111827' }}>
                      {n.title}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 14, color: '#6b7280', lineHeight: 1.5 }}>
                    {n.body}
                  </p>
                </div>
                <span style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap', marginLeft: 16 }}>
                  {timeAgo(n.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button
            style={btnOutline}
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span style={{ padding: '8px 12px', fontSize: 14, color: '#6b7280' }}>
            Page {page} of {totalPages}
          </span>
          <button
            style={btnOutline}
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
