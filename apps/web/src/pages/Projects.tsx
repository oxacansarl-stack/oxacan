import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HardHat, Search } from 'lucide-react';
import { apiGet, ApiError } from '../lib/api';
import { formatDate, formatMoney, statusLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useCurrentUser } from '../lib/current-user';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardFooter } from '@/components/ui/card';
import { SearchInput } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { DataState, EmptyState, TableSkeleton } from '@/components/states';
import { Ref, TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

interface Client {
  id: string;
  name: string;
}

interface Project {
  id: string;
  reference: string;
  name: string;
  clientId: string;
  client?: Client;
  status: string;
  progressPercent: number;
  /** Absent for field roles (financials are stripped server-side). */
  budgetHtCents?: number | null;
  manager?: { id: string; firstName: string; lastName: string } | null;
  startDate?: string;
  endDate?: string;
  createdAt: string;
}

const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'] as const;

function managerName(m: Project['manager']): string {
  return m ? `${m.firstName} ${m.lastName}`.trim() : '';
}

/** 0–100, so a malformed percentage can never overflow the bar. */
function clampPercent(value: number | null | undefined): number {
  return Math.min(100, Math.max(0, Math.round(value ?? 0)));
}

export default function Projects() {
  const { t } = useTranslation('projects');
  const navigate = useNavigate();
  const { role } = useCurrentUser();

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  /**
   * The API strips every `*Cents` field for field roles, so a budget column would read as a
   * blank — or worse, as CHF 0.00. Only the office roles get the column at all.
   */
  const canSeeFinancials = role === 'ADMIN' || role === 'PROJECT_MANAGER';

  const projects = useQuery<Project[], ApiError>({
    queryKey: ['projects', statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter) params.set('status', statusFilter);
      return apiGet<Project[]>(`/projects?${params.toString()}`);
    },
    retry: false,
  });

  const rows = projects.data ?? [];

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (project) =>
        project.name.toLowerCase().includes(term) ||
        (project.reference ?? '').toLowerCase().includes(term) ||
        managerName(project.manager).toLowerCase().includes(term),
    );
  }, [rows, search]);

  // Only meaningful on the unfiltered view, where every status is present.
  const activeProjects = statusFilter ? null : rows.filter((project) => project.status === 'active');

  const columnCount = canSeeFinancials ? 8 : 7;

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        kicker={t('common:navGroup.sites')}
        meta={
          activeProjects && activeProjects.length > 0 ? (
            <span>{t('summary.active', { count: activeProjects.length })}</span>
          ) : undefined
        }
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft p-3">
          <div className="flex flex-wrap gap-0.5" role="group" aria-label={t('filters.status')}>
            {['', ...STATUSES].map((value) => (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={statusFilter === value}
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:text-ink',
                  statusFilter === value && 'bg-chalk font-medium text-ink',
                )}
              >
                {value ? statusLabel('project', value) : t('filters.all')}
              </button>
            ))}
          </div>
          <SearchInput
            icon={<Search className="size-4" />}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <DataState
          isLoading={projects.isPending}
          error={
            projects.isError
              ? projects.error.status === 401
                ? t('loginRequired')
                : errorMessage(projects.error, t('loadFailed'))
              : null
          }
          onRetry={() => projects.refetch()}
          isEmpty={visible.length === 0}
          empty={
            rows.length === 0 ? (
              <EmptyState
                icon={<HardHat className="size-5" />}
                title={t('empty')}
                description={t('emptyHelp')}
              />
            ) : (
              <EmptyState title={t('noMatch')} description={t('noMatchHelp')} />
            )
          }
          loading={<TableSkeleton cols={columnCount} />}
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('table.reference')}</TH>
                  <TH>{t('table.name')}</TH>
                  <TH>{t('table.client')}</TH>
                  <TH>{t('table.status')}</TH>
                  <TH>{t('table.progress')}</TH>
                  {canSeeFinancials ? <TH numeric>{t('table.budget')}</TH> : null}
                  <TH>{t('table.manager')}</TH>
                  <TH>{t('table.startDate')}</TH>
                </tr>
              </THead>
              <TBody>
                {visible.map((project) => {
                  const progressPct = clampPercent(project.progressPercent);
                  return (
                    <TR key={project.id} onActivate={() => navigate(`/projects/${project.id}`)}>
                      <TD>
                        <Ref>{project.reference || '—'}</Ref>
                      </TD>
                      <TD className="font-medium">{project.name}</TD>
                      <TD>{project.client?.name ?? '—'}</TD>
                      <TD>
                        <StatusBadge domain="project" value={project.status} />
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div
                            role="progressbar"
                            aria-label={t('table.progress')}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progressPct}
                            className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-line-soft"
                          >
                            {/* The one permitted inline style: a width only known at runtime. */}
                            <div
                              className={cn(
                                'h-full rounded-full',
                                progressPct >= 100 ? 'bg-ok' : progressPct >= 50 ? 'bg-copper' : 'bg-warn',
                              )}
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <span className="tnum text-xs text-muted">
                            {t('table.progressValue', { percent: progressPct })}
                          </span>
                        </div>
                      </TD>
                      {canSeeFinancials ? (
                        <TD numeric>
                          {project.budgetHtCents != null ? (
                            formatMoney(project.budgetHtCents)
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </TD>
                      ) : null}
                      <TD>{managerName(project.manager) || '—'}</TD>
                      <TD className="tnum text-muted">{formatDate(project.startDate)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('summary.count', { count: visible.length, total: rows.length })}</span>
            <span>{t('summary.sortedBy')}</span>
          </CardFooter>
        </DataState>
      </Card>
    </PageBody>
  );
}
