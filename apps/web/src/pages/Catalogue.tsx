import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, formatCHF, ApiError } from '../lib/api';

interface Article {
  id: string;
  npkNumber: string;
  description: string;
  unit: string;
  category: string;
  medianPriceCentimes: number;
  observations: string;
}

interface ImportResult {
  matched: number;
  created: number;
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

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(';').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(';').map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });
    return row;
  });
}

export default function Catalogue() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: articles = [], isLoading, error } = useQuery<Article[], ApiError>({
    queryKey: ['catalogue', categoryFilter],
    queryFn: () => {
      const params = categoryFilter ? `?category=${encodeURIComponent(categoryFilter)}` : '';
      return apiGet<Article[]>(`/catalogue${params}`);
    },
    retry: false,
  });

  const importMutation = useMutation({
    mutationFn: (rows: Record<string, string>[]) =>
      apiPost<ImportResult>('/catalogue/import', { rows }),
    onSuccess: (result) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ['catalogue'] });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) {
      setImportResult({ matched: 0, created: 0, errors: ['No valid rows found in CSV'] });
      return;
    }
    importMutation.mutate(rows);
    // Reset file input so same file can be selected again
    if (fileRef.current) fileRef.current.value = '';
  };

  // Collect unique categories for filter
  const categories = [...new Set(articles.map((a) => a.category).filter(Boolean))].sort();

  const filtered = articles.filter((a) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      a.npkNumber.toLowerCase().includes(term) ||
      a.description.toLowerCase().includes(term) ||
      a.observations?.toLowerCase().includes(term)
    );
  });

  if (error instanceof ApiError && error.status === 401) {
    return <div style={{ color: '#ef4444', padding: 20 }}>Login required</div>;
  }

  if (error && !(error instanceof ApiError && error.status === 401)) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 20 }}>
          Catalogue
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
            {error.message || 'Failed to load catalogue articles'}
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
            Retry
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
          Catalogue
        </h1>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          <button
            style={buttonStyle}
            onClick={() => fileRef.current?.click()}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? 'Importing...' : 'Import CSV'}
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
          <strong>Import complete:</strong> {importResult.matched} matched,{' '}
          {importResult.created} created
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
            Dismiss
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
          Import failed: {importMutation.error.message}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input
          style={{ ...inputStyle, maxWidth: 300 }}
          placeholder="Search articles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={{ ...inputStyle, maxWidth: 200 }}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All Categories</option>
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
          <span style={{ fontSize: 14 }}>Loading catalogue articles...</span>
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
            No articles found
          </div>
          <div style={{ fontSize: 13, color: '#9ca3af', maxWidth: 320, textAlign: 'center' }}>
            Import a CSV file with your NPK article catalogue to get started.
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['NPK Number', 'Description', 'Unit', 'Category', 'Median Price (CHF)', 'Observations'].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: h === 'Median Price (CHF)' ? 'right' : 'left',
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
                    No articles found
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
                    {formatCHF(article.medianPriceCentimes)}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #f3f4f6',
                      color: '#6b7280',
                      fontSize: 13,
                    }}
                  >
                    {article.observations}
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
