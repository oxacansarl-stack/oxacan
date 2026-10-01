import { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Database, Download, FileJson, ListChecks, ShieldCheck } from 'lucide-react';
import { apiGet, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatNumber } from '../lib/format';
import type { PageProps } from '../lib/page-props';
import { PageBody, PageHeader } from '@/components/page-header';
import {
  Card,
  CardContent,
  CardCount,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataState, EmptyState, LoadingState } from '@/components/states';

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

/** What `/settings/export` returns, in the order the user sees it listed. */
const SECTION_KEYS = [
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
] as const;

/** The preview is a sample, not the file: past this the user downloads instead of reading. */
const PREVIEW_LIMIT = 5000;

const PRIVACY_EMAIL = 'privacy@oxacan.ch';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * The LPD/nLPD and RGPD data export (§24). Rendered as the "Données" tab of Administration,
 * so it honours `embedded` and lets the host page own the title.
 */
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

  const sections = SECTION_KEYS.map((key) => ({
    key,
    label: t(`sections.${key}.label`),
    description: t(`sections.${key}.description`),
  }));

  const json = useMemo(
    () => (exportData ? JSON.stringify(exportData, null, 2) : ''),
    [exportData],
  );
  const ready = exported && exportData !== null;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" onClick={fetchExport} disabled={loading}>
        <Database />
        {loading ? t('actions.preparing') : t('actions.exportAll')}
      </Button>
      {ready ? (
        <Button onClick={downloadJSON}>
          <Download />
          {t('actions.downloadJson')}
        </Button>
      ) : null}
    </div>
  );

  return (
    <PageBody>
      {embedded ? null : (
        <PageHeader title={t('title')} kicker={t('common:nav.admin')} actions={actions} />
      )}

      {/* The right the export answers to — kept verbatim from the LPD/RGPD notice. */}
      <p className="max-w-[86ch] text-[13.5px] text-muted">{t('intro')}</p>

      <Card>
        <CardHeader>
          <CardTitle>
            <ListChecks aria-hidden className="size-4 text-muted" />
            {t('included')}
            <CardCount>({sections.length})</CardCount>
          </CardTitle>
          {/* Embedded as a tab of Administration, whose header carries no actions — so this one does. */}
          {embedded ? actions : null}
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-5 gap-y-3.5">
            {sections.map((section) => (
              <li key={section.key} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className="mt-[7px] size-1.5 shrink-0 rounded-full bg-copper"
                />
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-[13.5px] font-medium text-ink">{section.label}</span>
                  <span className="text-xs text-muted">{section.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <FileJson aria-hidden className="size-4 text-muted" />
            {t('preview.title')}
          </CardTitle>
          {ready ? (
            <span className="tnum text-xs text-muted">
              {t('preview.characters', { count: json.length, chars: formatNumber(json.length) })}
            </span>
          ) : null}
        </CardHeader>

        <DataState
          isLoading={loading}
          error={error || null}
          onRetry={fetchExport}
          isEmpty={!ready}
          loading={<LoadingState label={t('actions.preparing')} />}
          empty={
            <EmptyState
              icon={<Database className="size-5" />}
              title={t('preview.empty')}
              description={t('preview.emptyHelp')}
              action={
                <Button variant="ghost" size="sm" onClick={fetchExport} disabled={loading}>
                  <Database />
                  {t('actions.exportAll')}
                </Button>
              }
            />
          }
        >
          <CardContent>
            {/* Focusable: a scrollable region must be reachable without a pointer. */}
            <pre
              role="region"
              tabIndex={0}
              aria-label={t('preview.title')}
              className="max-h-[400px] overflow-auto whitespace-pre-wrap break-all rounded-md border border-line-soft bg-paper-2 p-3.5 font-mono text-xs leading-relaxed text-ink-2"
            >
              {json.slice(0, PREVIEW_LIMIT)}
              {json.length > PREVIEW_LIMIT ? `\n\n${t('preview.truncated')}` : null}
            </pre>
          </CardContent>
        </DataState>
      </Card>

      <div className="flex items-start gap-3 rounded-card border border-line bg-info-bg px-4 py-3.5 text-[13px] leading-relaxed text-info">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p className="min-w-0">
          <Trans
            t={t}
            i18nKey="privacy"
            values={{ email: PRIVACY_EMAIL }}
            components={{ strong: <strong className="font-semibold" />, email: <span className="font-semibold" /> }}
          />
        </p>
      </div>
    </PageBody>
  );
}
