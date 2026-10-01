import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { formatAmount } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { CsvImportError, decodeCsv, parseCsv, type ImportRow } from '../lib/csv-import';

interface Article {
  id: string;
  npkNumber: string | null;
  description: string;
  unit: string;
  category: string | null;
  medianPriceCents: number | null;
  observationCount: number;
}

/** Response of POST /catalogue/import */
interface ImportResponse {
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  reviewRows: number;
  warnings: { lineNumber: number; type: 'INTERNAL_CODE' | 'UNIT_MISMATCH' | 'TOTAL_MISMATCH' }[];
}

interface ImportResult {
  matched: number;
  unmatched: number;
  review?: number;
  totalMismatch?: number;
  errors: string[];
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  outline: 'none',
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

export default function Catalogue() {
  const { t } = useTranslation('catalogue');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [documentDate, setDocumentDate] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: articles = [], isLoading, error } = useQuery<Article[], ApiError>({
    queryKey: ['catalogue', categoryFilter],
    queryFn: () => {
      const params = categoryFilter ? `&category=${encodeURIComponent(categoryFilter)}` : '';
      return apiGet<Article[]>(`/catalogue/articles?limit=200${params}`);
    },
    retry: false,
  });

  const importMutation = useMutation<ImportResponse, ApiError, { filename: string; documentDate?: string; rows: ImportRow[] }>({
    mutationFn: (payload) => apiPost<ImportResponse>('/catalogue/import', payload),
    onSuccess: (result) => {
      setImportResult({
        matched: result.matchedRows,
        unmatched: result.unmatchedRows,
        review: result.reviewRows,
        totalMismatch: result.warnings.filter((w) => w.type === 'TOTAL_MISMATCH').length,
        errors: [],
      });
      queryClient.invalidateQueries({ queryKey: ['catalogue'] });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset file input so the same file can be selected again
    if (fileRef.current) fileRef.current.value = '';
    let rows: ImportRow[];
    try {
      rows = parseCsv(decodeCsv(await file.arrayBuffer()));
    } catch (err) {
      const key = err instanceof CsvImportError && err.code === 'NO_HEADER' ? 'messages.noHeader' : 'messages.noValidRows';
      setImportResult({ matched: 0, unmatched: 0, errors: [t(key)] });
      return;
    }
    importMutation.mutate({ filename: file.name, rows, ...(documentDate ? { documentDate } : {}) });
  };

  // Collect unique categories for filter
  const categories = [
    ...new Set(articles.map((a) => a.category).filter((c): c is string => !!c)),
  ].sort();

  const filtered = articles.filter((a) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      (a.npkNumber ?? '').toLowerCase().includes(term) ||
      a.description.toLowerCase().includes(term)
    );
  });

  if (error instanceof ApiError && error.status === 401) {
    return <div style={{ color: '#ef4444', padding: 20 }}>{t('common:auth.sessionExpired')}</div>;
  }

  if (error && !(error instanceof ApiError && error.status === 401)) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 20 }}>
          {t('title')}
        </h1>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 60,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: '#fef2f2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              fontSize: 22,
              color: '#dc2626',
              fontWeight: 700,
            }}
          >
            !
          </div>
          <div style={{ fontSize: 14, color: '#dc2626', marginBottom: 12, textAlign: 'center' }}>
            {errorMessage(error, t('messages.loadFailed'))}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('common:actions.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: '#374151' }}>
            {t('import.documentDate')}{' '}
            <input
              type="date"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              style={{ ...inputStyle, padding: '6px 8px' }}
            />
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          <button
            style={buttonStyle}
            onClick={() => fileRef.current?.click()}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? t('actions.importing') : t('actions.importCsv')}
          </button>
        </div>
      </div>

      {/* Import result banner */}
      {importResult && (
        <div
          style={{
            background: importResult.errors.length > 0 ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${importResult.errors.length > 0 ? '#fecaca' : '#bbf7d0'}`,
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <strong>{t('import.complete')}</strong>{' '}
          {t('import.summary', { matched: importResult.matched, unmatched: importResult.unmatched })}
          {!!importResult.review && <div>{t('import.review', { count: importResult.review })}</div>}
          {!!importResult.totalMismatch && <div>{t('import.totalMismatch', { count: importResult.totalMismatch })}</div>}
          {importResult.errors.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 16 }}>
              {importResult.errors.map((err, i) => (
                <li key={i} style={{ color: '#dc2626' }}>
                  {err}
                </li>
              ))}
            </ul>
          )}
          <button
            style={{
              marginLeft: 12,
              background: 'none',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              fontSize: 13,
              textDecoration: 'underline',
            }}
            onClick={() => setImportResult(null)}
          >
            {t('actions.dismiss')}
          </button>
        </div>
      )}

      {importMutation.error && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 13,
            color: '#dc2626',
          }}
        >
          {t('import.failed', { message: errorMessage(importMutation.error) })}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input
          style={{ ...inputStyle, maxWidth: 300 }}
          placeholder={t('filters.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={{ ...inputStyle, maxWidth: 200 }}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">{t('filters.allCategories')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 60,
            color: '#6b7280',
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              border: '3px solid #e5e7eb',
              borderTopColor: '#2563eb',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              marginBottom: 16,
            }}
          />
          <span style={{ fontSize: 14 }}>{t('state.loading')}</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : articles.length === 0 && !search && !categoryFilter ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 60,
            color: '#9ca3af',
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 12,
              border: '2px dashed #d1d5db',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              fontSize: 28,
              color: '#d1d5db',
            }}
          >
            ?
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>
            {t('empty.articles')}
          </div>
          <div style={{ fontSize: 13, color: '#9ca3af', maxWidth: 320, textAlign: 'center' }}>
            {t('empty.hint')}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[
                  t('table.npkNumber'),
                  t('table.description'),
                  t('table.unit'),
                  t('table.category'),
                  t('table.medianPrice'),
                  t('table.observations'),
                ].map(
                  (h, i) => (
                    <th
                      key={h}
                      style={{
                        textAlign: i === 4 ? 'right' : 'left',
                        padding: '10px 12px',
                        borderBottom: '2px solid #e5e7eb',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#6b7280',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}
                  >
                    {t('empty.articles')}
                  </td>
                </tr>
              )}
              {filtered.map((article) => (
                <tr
                  key={article.id}
                  onMouseOver={(e) =>
                    ((e.currentTarget as HTMLElement).style.background = '#f9fafb')
                  }
                  onMouseOut={(e) =>
                    ((e.currentTarget as HTMLElement).style.background = '')
                  }
                >
                  <td
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #f3f4f6',
                      fontFamily: 'monospace',
                      fontSize: 13,
                    }}
                  >
                    {article.npkNumber}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #f3f4f6',
                      maxWidth: 300,
                    }}
                  >
                    {article.description}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    {article.unit}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                    {article.category}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #f3f4f6',
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {article.medianPriceCents != null ? formatAmount(article.medianPriceCents) : '—'}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #f3f4f6',
                      color: '#6b7280',
                      fontSize: 13,
                    }}
                  >
                    {article.observationCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
