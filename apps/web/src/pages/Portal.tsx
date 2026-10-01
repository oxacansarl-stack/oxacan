import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiGet, apiList, apiPost, apiDelete } from '../lib/api';
import { formatDate } from '../lib/format';
import { errorMessage } from '../lib/errors';
import type { PageProps } from '../lib/page-props';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Project {
  id: string;
  name: string;
}

interface PortalToken {
  id: string;
  token: string;
  projectId: string;
  project?: { name: string };
  expiresAt?: string;
  isActive: boolean;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
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
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 14,
  color: '#111827',
  borderTop: '1px solid #f3f4f6',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  display: 'block',
  marginBottom: 4,
  fontWeight: 600,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function maskToken(token: string): string {
  if (token.length <= 8) return token;
  return token.slice(0, 4) + '...' + token.slice(-4);
}

function timeAgo(dateStr: string, t: TFunction): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 30) return t('timeAgo.months', { count: Math.floor(days / 30) });
  if (days > 0) return t('timeAgo.days', { count: days });
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return t('timeAgo.hours', { count: hours });
  const mins = Math.floor(diff / 60000);
  return mins > 0 ? t('timeAgo.minutes', { count: mins }) : t('timeAgo.justNow');
}

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Portal({ embedded = false }: PageProps) {
  const { t } = useTranslation('portal');
  const [tokens, setTokens] = useState<PortalToken[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    projectId: '',
    expiresAt: '',
  });
  const [createError, setCreateError] = useState('');

  // Copied state for visual feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { items, meta } = await apiList<PortalToken>(`/portal/tokens?page=${page}`);
      setTokens(items);
      setTotalPages(Math.max(1, meta?.totalPages ?? 1));
    } catch (e: unknown) {
      setError(errorMessage(e, t('messages.loadFailed')));
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }, [page, t]);

  const fetchProjects = useCallback(async () => {
    try {
      setProjects(await apiGet<Project[]>('/projects?limit=100'));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchTokens(); }, [fetchTokens]);

  const handleCreate = async () => {
    setCreateError('');
    if (!createForm.projectId) { setCreateError(t('messages.projectRequired')); return; }
    try {
      const body: { projectId: string; expiresAt?: string } = { projectId: createForm.projectId };
      // expiresAt is a timestamp: the link stays valid until the end of the chosen (local) day.
      if (createForm.expiresAt) {
        body.expiresAt = new Date(`${createForm.expiresAt}T23:59:59`).toISOString();
      }
      await apiPost('/portal/tokens', body);
      setShowCreate(false);
      setCreateForm({ projectId: '', expiresAt: '' });
      setSuccess(t('messages.created'));
      fetchTokens();
    } catch (e: unknown) {
      setCreateError(errorMessage(e, t('messages.createFailed')));
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm(t('messages.confirmRevoke'))) return;
    try {
      await apiDelete(`/portal/tokens/${id}`);
      setSuccess(t('messages.revoked'));
      fetchTokens();
    } catch (e: unknown) {
      setError(errorMessage(e, t('messages.revokeFailed')));
    }
  };

  const handleCopyUrl = (token: string, id: string) => {
    const url = `${window.location.origin}/portal/view/${token}`;
    copyToClipboard(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyToken = (token: string, id: string) => {
    copyToClipboard(token);
    setCopiedId(id + '-tok');
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#111827' }}>{t('title')}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>{t('subtitle')}</p>
        </div>
        <button style={btnPrimary} onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? t('common:actions.cancel') : t('newToken')}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 600 }}>x</button>
        </div>
      )}

      {success && (
        <div style={{ background: '#dcfce7', color: '#166534', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {success}
          <button onClick={() => setSuccess('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#166534', fontWeight: 600 }}>x</button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div style={{ background: '#f9fafb', borderRadius: 8, padding: 20, marginBottom: 20, border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>{t('form.title')}</h3>
          {createError && (
            <div style={{ background: '#fee2e2', color: '#dc2626', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
              {createError}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>{t('form.project')}</label>
              <select
                style={inputStyle}
                value={createForm.projectId}
                onChange={e => setCreateForm(f => ({ ...f, projectId: e.target.value }))}
              >
                <option value="">{t('form.selectProject')}</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('form.expiresAt')}</label>
              <input
                type="date"
                style={inputStyle}
                value={createForm.expiresAt}
                onChange={e => setCreateForm(f => ({ ...f, expiresAt: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnPrimary} onClick={handleCreate}>{t('form.submit')}</button>
            <button style={btnOutline} onClick={() => setShowCreate(false)}>{t('common:actions.cancel')}</button>
          </div>
        </div>
      )}

      {/* Tokens table */}
      {loading ? (
        <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>{t('state.loading')}</p>
      ) : tokens.length === 0 ? (
        <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>{t('state.empty')}</p>
      ) : (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={thStyle}>{t('table.project')}</th>
                <th style={thStyle}>{t('table.token')}</th>
                <th style={thStyle}>{t('table.created')}</th>
                <th style={thStyle}>{t('table.expires')}</th>
                <th style={thStyle}>{t('table.status')}</th>
                <th style={thStyle}>{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(tok => (
                <tr key={tok.id}>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{tok.project?.name || tok.projectId}</td>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#6b7280' }}>
                      {maskToken(tok.token)}
                    </span>
                    <button
                      onClick={() => handleCopyToken(tok.token, tok.id)}
                      style={{
                        marginLeft: 8,
                        background: 'none',
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        cursor: 'pointer',
                        color: copiedId === tok.id + '-tok' ? '#16a34a' : '#6b7280',
                      }}
                    >
                      {copiedId === tok.id + '-tok' ? t('actions.copied') : t('actions.copy')}
                    </button>
                  </td>
                  <td style={{ ...tdStyle, color: '#6b7280', fontSize: 13 }}>{timeAgo(tok.createdAt, t)}</td>
                  <td style={{ ...tdStyle, color: '#6b7280', fontSize: 13 }}>
                    {tok.expiresAt ? formatDate(tok.expiresAt) : t('state.never')}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 10px',
                      borderRadius: 9999,
                      fontSize: 12,
                      fontWeight: 500,
                      background: tok.isActive ? '#dcfce7' : '#fee2e2',
                      color: tok.isActive ? '#166534' : '#dc2626',
                    }}>
                      {tok.isActive ? t('state.active') : t('state.revoked')}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => handleCopyUrl(tok.token, tok.id)}
                        style={{
                          ...btnOutline,
                          padding: '4px 10px',
                          fontSize: 12,
                          color: copiedId === tok.id ? '#16a34a' : '#374151',
                          borderColor: copiedId === tok.id ? '#16a34a' : '#d1d5db',
                        }}
                      >
                        {copiedId === tok.id ? t('actions.copied') : t('actions.copyUrl')}
                      </button>
                      {tok.isActive && (
                        <button
                          onClick={() => handleRevoke(tok.id)}
                          style={{ ...btnDanger, padding: '4px 10px', fontSize: 12 }}
                        >
                          {t('actions.revoke')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            {t('common:actions.previous')}
          </button>
          <span style={{ padding: '8px 12px', fontSize: 14, color: '#6b7280' }}>
            {t('common:state.page', { page, total: totalPages })}
          </span>
          <button
            style={btnOutline}
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            {t('common:actions.next')}
          </button>
        </div>
      )}
    </div>
  );
}
