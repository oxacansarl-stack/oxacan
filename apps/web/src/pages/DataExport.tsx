import React, { useState } from 'react';
import { apiGet, ApiError } from '../lib/api';

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

export default function DataExport() {
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
        setError('Login required to export data.');
      } else {
        setError(e.message || 'Failed to export data. Please try again.');
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
    { label: 'Company profile', description: 'Company name, address, registration details' },
    { label: 'Users & roles', description: 'All user accounts and their assigned roles' },
    { label: 'Clients (CRM)', description: 'Client contacts, pipeline stages, interaction history' },
    { label: 'Offers & contracts', description: 'Offer documents, accepted contracts, amendments' },
    { label: 'Projects & tasks', description: 'Active and archived project data, work lots' },
    { label: 'Timekeeping', description: 'Clock-in/out entries, submitted and approved hours' },
    { label: 'Expenses', description: 'Expense records, receipts, approval status' },
    { label: 'Invoices & payments', description: 'Invoice history, payment records, credit notes' },
    { label: 'Accounting entries', description: 'Journal entries, chart of accounts, fiduciary exports' },
    { label: 'Daily reports', description: 'Site reports, weather, staff counts, issues' },
    { label: 'Notifications', description: 'All system notifications and read status' },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
        Data Export
      </h1>
      <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24, maxWidth: 640 }}>
        In compliance with the Swiss Federal Act on Data Protection (LPD/nDSG) and the EU
        General Data Protection Regulation (GDPR), you have the right to request a full export
        of all personal and company data stored in OXACAN.
      </p>

      {/* What will be exported */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 16, marginTop: 0 }}>
          Data included in the export
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
            Dismiss
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
          {loading ? 'Preparing export...' : 'Export All My Data'}
        </button>

        {exported && exportData && (
          <button
            style={{
              ...buttonStyle,
              background: '#16a34a',
            }}
            onClick={downloadJSON}
          >
            Download as JSON
          </button>
        )}
      </div>

      {/* Export result preview */}
      {exported && exportData && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginTop: 0, marginBottom: 12 }}>
            Export Preview
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
            {JSON.stringify(exportData, null, 2).length > 5000 && '\n\n... (truncated — download full file above)'}
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
        <strong>Privacy Notice:</strong> Your exported data is generated on-demand and is not
        stored on our servers after download. The JSON file contains all data associated with
        your company account. If you wish to request data deletion, please contact your system
        administrator or write to{' '}
        <span style={{ fontWeight: 600 }}>privacy@oxacan.ch</span>.
      </div>
    </div>
  );
}
