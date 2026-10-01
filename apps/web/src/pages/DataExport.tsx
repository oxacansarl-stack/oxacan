import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { apiGet, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import type { PageProps } from '../lib/page-props';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ExportData {
  company?: Record<string, unknown>;
  users?: Record<string, unknown>[];
  clients?: Record<string, unknown>[];
  projects?: Record<string, unknown>[];
  invoices?: Record<string, unknown>[];
  timekeeping?: Record<string, unknown>[];
  expenses?: Record<string, unknown>[];
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const buttonStyle: React.CSSProperties = {
  padding: '10px 20px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const cardStyle: React.CSSProperties = {
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 20,
  marginBottom: 16,
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DataExport({ embedded = false }: PageProps) {
  const { t } = useTranslation('dataExport');
  const [exportData, setExportData] = useState<ExportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exported, setExported] = useState(false);

  const fetchExport = async () => {
    setLoading(true);
    setError('');
    setExported(false);
    try {
      const data = await apiGet<ExportData>('/settings/export');
      setExportData(data);
      setExported(true);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) {
        setError(t('messages.loginRequired'));
      } else {
        setError(errorMessage(e, t('messages.failed')));
      }
    } finally {
      setLoading(false);
    }
  };

  const downloadJSON = () => {
    if (!exportData) return;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `oxacan-data-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const dataSections = [
    'company',
    'users',
    'clients',
    'offers',
    'projects',
    'timekeeping',
    'expenses',
    'invoices',
    'accounting',
    'dailyReports',
    'notifications',
  ].map((key) => ({ label: t(`sections.${key}.label`), description: t(`sections.${key}.description`) }));

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24, maxWidth: 640 }}>
        {t('intro')}
      </p>

      {/* What will be exported */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 16, marginTop: 0 }}>
          {t('included')}
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {dataSections.map((section) => (
            <div
              key={section.label}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 0',
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#2563eb',
                  marginTop: 6,
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>
                  {section.label}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{section.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 14,
            color: '#dc2626',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError('')}
            style={{
              background: 'none',
              border: 'none',
              color: '#dc2626',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {t('actions.dismiss')}
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button
          style={{
            ...buttonStyle,
            opacity: loading ? 0.6 : 1,
          }}
          onClick={fetchExport}
          disabled={loading}
        >
          {loading ? t('actions.preparing') : t('actions.exportAll')}
        </button>

        {exported && exportData && (
          <button
            style={{
              ...buttonStyle,
              background: '#16a34a',
            }}
            onClick={downloadJSON}
          >
            {t('actions.downloadJson')}
          </button>
        )}
      </div>

      {/* Export result preview */}
      {exported && exportData && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginTop: 0, marginBottom: 12 }}>
            {t('preview.title')}
          </h3>
          <div
            style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              padding: 16,
              maxHeight: 400,
              overflow: 'auto',
              fontSize: 12,
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: '#374151',
            }}
          >
            {JSON.stringify(exportData, null, 2).slice(0, 5000)}
            {JSON.stringify(exportData, null, 2).length > 5000 && `\n\n${t('preview.truncated')}`}
          </div>
        </div>
      )}

      {/* Privacy notice */}
      <div
        style={{
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: 8,
          padding: 16,
          fontSize: 13,
          color: '#1e40af',
          lineHeight: 1.6,
        }}
      >
        <Trans
          t={t}
          i18nKey="privacy"
          values={{ email: 'privacy@oxacan.ch' }}
          components={{ strong: <strong />, email: <span style={{ fontWeight: 600 }} /> }}
        />
      </div>
    </div>
  );
}
