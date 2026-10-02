import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Search, SearchX, Upload, X } from 'lucide-react';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { formatAmount } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useCurrentUser } from '../lib/current-user';
import { CsvImportError, decodeCsv, parseCsv, type ImportRow } from '../lib/csv-import';
import { MetaDivider, PageBody, PageHeader } from '@/components/page-header';
import { Card, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, SearchInput, Select } from '@/components/ui/input';
import { Tag } from '@/components/ui/badge';
import { DataState, EmptyState, TableSkeleton } from '@/components/states';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Ref, TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

interface Article {
  id: string;
  npkNumber: string | null;
  description: string;
  unit: string;
  category: string | null;
  /** Stripped by the API for every non-office role — never rendered for a team leader. */
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

/** Stable empty list so the effect that collects categories does not re-run on every render. */
const NO_ARTICLES: Article[] = [];

export default function Catalogue() {
  const { t } = useTranslation('catalogue');
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();

  /**
   * The API strips every `*Cents` field for field roles (§ role gating), so for a team leader a
   * price column, a price figure or a price history would only ever read "—". They are not
   * rendered at all. The import endpoint is office-only too, so its action is hidden as well.
   */
  const isOffice = role === 'ADMIN' || role === 'PROJECT_MANAGER';

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [documentDate, setDocumentDate] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const articlesQuery = useQuery<Article[], ApiError>({
    queryKey: ['catalogue', categoryFilter],
    queryFn: () => {
      const params = categoryFilter ? `&category=${encodeURIComponent(categoryFilter)}` : '';
      return apiGet<Article[]>(`/catalogue/articles?limit=200${params}`);
    },
    retry: false,
  });

  const importMutation = useMutation<
    ImportResponse,
    ApiError,
    { filename: string; documentDate?: string; rows: ImportRow[] }
  >({
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

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset file input so the same file can be selected again
    if (fileRef.current) fileRef.current.value = '';
    // The import runs on selection; the dialog has nothing left to ask.
    setImportOpen(false);
    let rows: ImportRow[];
    try {
      rows = parseCsv(decodeCsv(await file.arrayBuffer()));
    } catch (err) {
      const key =
        err instanceof CsvImportError && err.code === 'NO_HEADER'
          ? 'messages.noHeader'
          : 'messages.noValidRows';
      setImportResult({ matched: 0, unmatched: 0, errors: [t(key)] });
      return;
    }
    importMutation.mutate({ filename: file.name, rows, ...(documentDate ? { documentDate } : {}) });
  };

  const articles = articlesQuery.data ?? NO_ARTICLES;

  /**
   * The list is filtered server-side, so the categories present in the current response shrink
   * to the one being filtered on. Every category ever seen is kept, otherwise picking one
   * removes every other option from the filter.
   */
  const [knownCategories, setKnownCategories] = useState<string[]>([]);
  useEffect(() => {
    const seen = articles
      .map((article) => article.category)
      .filter((category): category is string => !!category && category.trim().length > 0);
    if (seen.length === 0) return;
    setKnownCategories((previous) => {
      const next = new Set(previous);
      const before = next.size;
      for (const category of seen) next.add(category);
      return next.size === before ? previous : [...next].sort((a, b) => a.localeCompare(b, 'fr'));
    });
  }, [articles]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return articles;
    return articles.filter(
      (article) =>
        (article.npkNumber ?? '').toLowerCase().includes(term) ||
        article.description.toLowerCase().includes(term),
    );
  }, [articles, search]);

  // Only meaningful on the unfiltered view, where the response is the whole catalogue page.
  const pricedCount = categoryFilter
    ? null
    : articles.filter((article) => article.medianPriceCents != null).length;

  const loadError = articlesQuery.isError
    ? articlesQuery.error.status === 401
      ? t('common:auth.sessionExpired')
      : errorMessage(articlesQuery.error, t('messages.loadFailed'))
    : null;

  const importFailed = importResult !== null && importResult.errors.length > 0;
  const columns = isOffice ? 6 : 5;

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        kicker={t('common:navGroup.reference')}
        meta={
          !categoryFilter && articles.length > 0 ? (
            <>
              <span>{t('summary.articles', { count: articles.length })}</span>
              {isOffice && pricedCount !== null ? (
                <>
                  <MetaDivider />
                  <span>{t('summary.priced', { count: pricedCount })}</span>
                </>
              ) : null}
            </>
          ) : undefined
        }
        actions={
          isOffice ? (
            <Button
              variant="primary"
              onClick={() => setImportOpen(true)}
              disabled={importMutation.isPending}
            >
              <Upload />
              {importMutation.isPending ? t('actions.importing') : t('actions.importCsv')}
            </Button>
          ) : undefined
        }
      />

      {importResult ? (
        <div
          role={importFailed ? 'alert' : 'status'}
          className={cn(
            'flex flex-wrap items-start justify-between gap-2.5 rounded-card border border-line px-3.5 py-2.5 text-[13px]',
            importFailed ? 'bg-bad-bg text-bad' : 'bg-ok-bg text-ok',
          )}
        >
          <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 gap-1">
            {importFailed ? (
              importResult.errors.map((message) => <span key={message}>{message}</span>)
            ) : (
              <>
                <span>
                  <span className="font-medium">{t('import.complete')}</span>{' '}
                  {t('import.summary', {
                    matched: importResult.matched,
                    unmatched: importResult.unmatched,
                  })}
                </span>
                {importResult.review ? (
                  <span>{t('import.review', { count: importResult.review })}</span>
                ) : null}
                {importResult.totalMismatch ? (
                  <span>{t('import.totalMismatch', { count: importResult.totalMismatch })}</span>
                ) : null}
              </>
            )}
          </div>
          <Button
            variant="quiet"
            size="iconSm"
            className="shrink-0 text-current hover:bg-transparent"
            aria-label={t('actions.dismiss')}
            onClick={() => setImportResult(null)}
          >
            <X />
          </Button>
        </div>
      ) : null}

      {importMutation.isError ? (
        <p
          role="alert"
          className="rounded-card border border-line bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad"
        >
          {t('import.failed', { message: errorMessage(importMutation.error) })}
        </p>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft p-3">
          <SearchInput
            icon={<Search className="size-4" />}
            placeholder={t('filters.search')}
            aria-label={t('filters.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            className="w-auto min-w-[180px]"
            aria-label={t('filters.category')}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">{t('filters.allCategories')}</option>
            {knownCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </div>

        <DataState
          isLoading={articlesQuery.isPending}
          error={loadError}
          onRetry={() => articlesQuery.refetch()}
          loading={<TableSkeleton rows={6} cols={columns} />}
          isEmpty={filtered.length === 0}
          empty={
            articles.length === 0 ? (
              <EmptyState
                title={t('empty.articles')}
                description={t('empty.hint')}
                icon={<BookOpen className="size-5" />}
                action={
                  isOffice ? (
                    <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}>
                      <Upload />
                      {t('actions.importCsv')}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState
                title={t('empty.noMatch')}
                description={t('empty.noMatchHint')}
                icon={<SearchX className="size-5" />}
              />
            )
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('table.npkNumber')}</TH>
                  <TH>{t('table.description')}</TH>
                  <TH>{t('table.unit')}</TH>
                  <TH>{t('table.category')}</TH>
                  {isOffice ? <TH numeric>{t('table.medianPrice')}</TH> : null}
                  <TH numeric>{t('table.observations')}</TH>
                </tr>
              </THead>
              <TBody>
                {filtered.map((article) => (
                  <TR key={article.id}>
                    <TD>
                      <Ref>{article.npkNumber || '—'}</Ref>
                    </TD>
                    <TD className="max-w-[360px] font-medium">{article.description}</TD>
                    <TD className="text-muted">{article.unit || '—'}</TD>
                    <TD>
                      {article.category ? (
                        <Tag>{article.category}</Tag>
                      ) : (
                        <span className="text-muted">{t('table.uncategorised')}</span>
                      )}
                    </TD>
                    {isOffice ? (
                      <TD numeric>
                        {article.medianPriceCents != null
                          ? formatAmount(article.medianPriceCents)
                          : '—'}
                      </TD>
                    ) : null}
                    <TD numeric className="text-muted">
                      {article.observationCount}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('summary.count', { count: filtered.length, total: articles.length })}</span>
            <span>{t('summary.sortedBy')}</span>
          </CardFooter>
        </DataState>
      </Card>

      {isOffice ? (
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('import.title')}</DialogTitle>
              <DialogDescription>{t('import.help')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field
                label={t('import.documentDate')}
                htmlFor="catalogue-import-date"
                hint={t('import.documentDateHint')}
              >
                <Input
                  id="catalogue-import-date"
                  type="date"
                  className="w-auto"
                  value={documentDate}
                  onChange={(e) => setDocumentDate(e.target.value)}
                />
              </Field>
              <Field
                label={t('import.file')}
                htmlFor="catalogue-import-file"
                hint={t('import.fileHint')}
              >
                <Input
                  ref={fileRef}
                  id="catalogue-import-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-chalk file:px-2.5 file:py-1 file:text-[13px] file:font-medium file:text-ink-2"
                  onChange={handleFileSelect}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setImportOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </PageBody>
  );
}
