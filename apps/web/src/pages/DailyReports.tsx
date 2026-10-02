import { useEffect, useState, type FormEvent, type SyntheticEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, MoreHorizontal, Pencil, Plus, StickyNote, Trash2 } from 'lucide-react';
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, todayIso } from '../lib/format';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Tag } from '@/components/ui/badge';
import { DataState, EmptyState, TableSkeleton } from '@/components/states';
import { useConfirm } from '@/components/confirm-dialog';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Ref, TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Project {
  id: string;
  name: string;
  reference?: string;
}

interface DailyReport {
  id: string;
  userId: string;
  projectId: string;
  project?: { name: string; reference?: string };
  date: string;
  workDescription?: string;
  weather?: string | null;
  temperatureCelsius?: number | null;
  /** JSONB array; this page writes { name } objects */
  materialsUsed?: Record<string, unknown>[];
  notes?: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface ReportForm {
  projectId: string;
  date: string;
  workDescription: string;
  weather: string;
  temperature: string;
  materials: string;
  notes: string;
}

/** What the form sends; `id` set means an update of an existing report. */
interface SavePayload {
  id: string | null;
  projectId: string;
  date: string;
  workDescription: string;
  weather: string;
  temperatureCelsius: number | null;
  materialsUsed: { name: string }[];
  notes: string;
}

/* ------------------------------------------------------------------ */
/*  Constants and helpers                                             */
/* ------------------------------------------------------------------ */

/** The list asks for one page of the API's date-descending feed. */
const PAGE_LIMIT = 100;

/** The API rejects anything outside this range (DailyReportFieldsDto). */
const TEMPERATURE_LIMIT = 60;

const today = () => todayIso();

const emptyForm = (): ReportForm => ({
  projectId: '',
  date: today(),
  workDescription: '',
  weather: '',
  temperature: '',
  materials: '',
  notes: '',
});

/** Keeps a control inside a row from also opening the row's record. */
const stopRowActivation = (event: SyntheticEvent) => event.stopPropagation();

function materialLabel(m: Record<string, unknown>): string {
  const label = m.name ?? m.description ?? m.label;
  return typeof label === 'string' ? label : JSON.stringify(m);
}

/** "2026-004 — Villa Dubois"; plain data, so it needs no translation. */
function projectOption(project: Project | { name: string; reference?: string }): string {
  return project.reference ? `${project.reference} — ${project.name}` : project.name;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DailyReports() {
  const { t } = useTranslation('dailyReports');
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  // Filters (applied by the API)
  const [filterProject, setFilterProject] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Create / edit dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ReportForm>(emptyForm);

  // A failed row action is reported above the table, where the row was.
  const [actionAlert, setActionAlert] = useState<string | null>(null);

  // The top bar's "Créer" menu links here with ?new=1.
  useEffect(() => {
    if (params.get('new') === '1') {
      setFormOpen(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  /* --- Queries --- */

  const reports = useQuery<DailyReport[], ApiError>({
    queryKey: ['daily-reports', filterProject, filterDateFrom, filterDateTo],
    queryFn: () => {
      const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (filterProject) query.set('projectId', filterProject);
      if (filterDateFrom) query.set('dateFrom', filterDateFrom);
      if (filterDateTo) query.set('dateTo', filterDateTo);
      return apiGet<DailyReport[]>(`/daily-reports?${query.toString()}`);
    },
    retry: false,
  });

  const projects = useQuery<Project[], ApiError>({
    queryKey: ['projects-list'],
    queryFn: () => apiGet<Project[]>('/projects'),
    retry: false,
  });

  /* --- Mutations --- */

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['daily-reports'] });

  const closeForm = () => {
    setFormOpen(false);
    setEditId(null);
    setForm(emptyForm());
  };

  const save = useMutation({
    mutationFn: (payload: SavePayload) =>
      payload.id
        ? // Project and date are fixed once created; null clears a field.
          apiPut(`/daily-reports/${payload.id}`, {
            workDescription: payload.workDescription || null,
            weather: payload.weather || null,
            temperatureCelsius: payload.temperatureCelsius,
            materialsUsed: payload.materialsUsed,
            notes: payload.notes || null,
          })
        : apiPost('/daily-reports', {
            projectId: payload.projectId,
            date: payload.date,
            workDescription: payload.workDescription || undefined,
            weather: payload.weather || undefined,
            temperatureCelsius: payload.temperatureCelsius ?? undefined,
            materialsUsed: payload.materialsUsed.length > 0 ? payload.materialsUsed : undefined,
            notes: payload.notes || undefined,
          }),
    onSuccess: () => {
      closeForm();
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/daily-reports/${id}`),
    onMutate: () => setActionAlert(null),
    onSuccess: () => invalidate(),
    onError: (err) => setActionAlert(errorMessage(err, t('messages.deleteFailed'))),
  });

  /* --- Form plumbing --- */

  const openCreate = () => {
    save.reset();
    setEditId(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (report: DailyReport) => {
    save.reset();
    setEditId(report.id);
    setForm({
      projectId: report.projectId,
      date: report.date ? report.date.slice(0, 10) : today(),
      workDescription: report.workDescription || '',
      weather: report.weather || '',
      temperature: report.temperatureCelsius != null ? String(report.temperatureCelsius) : '',
      materials: (report.materialsUsed || []).map(materialLabel).join('\n'),
      notes: report.notes || '',
    });
    setFormOpen(true);
  };

  // The API accepts −60…60 °C only; the field says so before the request is made.
  const temperatureCelsius = form.temperature ? parseFloat(form.temperature) : null;
  const temperatureInvalid =
    temperatureCelsius != null &&
    (!Number.isFinite(temperatureCelsius) || Math.abs(temperatureCelsius) > TEMPERATURE_LIMIT);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.projectId || temperatureInvalid) return;

    save.mutate({
      id: editId,
      projectId: form.projectId,
      date: form.date,
      workDescription: form.workDescription,
      weather: form.weather,
      temperatureCelsius,
      // One material per line → JSONB objects
      materialsUsed: form.materials
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name })),
      notes: form.notes,
    });
  };

  const handleDelete = async (report: DailyReport) => {
    if (
      !(await confirm({
        title: t('prompts.confirmDelete'),
        description: t('common:confirm.irreversible'),
      }))
    ) {
      return;
    }
    remove.mutate(report.id);
  };

  /* --- Derived --- */

  const rows = reports.data ?? [];
  const projectList = projects.data ?? [];
  const filtered = Boolean(filterProject || filterDateFrom || filterDateTo);
  const editing = editId ? rows.find((report) => report.id === editId) : undefined;

  const resetFilters = () => {
    setFilterProject('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        kicker={t('common:navGroup.sites')}
        meta={<span>{t('subtitle')}</span>}
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus />
            {t('actions.new')}
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line-soft p-3">
          <Field
            label={t('filters.project')}
            htmlFor="report-filter-project"
            className="w-full sm:w-[240px]"
          >
            <Select
              id="report-filter-project"
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
            >
              <option value="">{t('filters.allProjects')}</option>
              {projectList.map((project) => (
                <option key={project.id} value={project.id}>
                  {projectOption(project)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('filters.from')} htmlFor="report-filter-from" className="w-[150px]">
            <Input
              id="report-filter-from"
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
            />
          </Field>
          <Field label={t('filters.to')} htmlFor="report-filter-to" className="w-[150px]">
            <Input
              id="report-filter-to"
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
            />
          </Field>
          {filtered ? (
            <Button variant="quiet" size="sm" className="ml-auto" onClick={resetFilters}>
              {t('filters.reset')}
            </Button>
          ) : null}
        </div>

        {/* A failed project load must not read as "no project to filter by". */}
        {projects.isError ? (
          <p role="alert" className="border-b border-line-soft px-3.5 py-2.5 text-[13px] text-bad">
            {errorMessage(projects.error, t('form.projectsLoadFailed'))}
          </p>
        ) : null}

        {actionAlert ? (
          <p role="alert" className="border-b border-line-soft px-3.5 py-2.5 text-[13px] text-bad">
            {actionAlert}
          </p>
        ) : null}

        <DataState
          isLoading={reports.isPending}
          error={
            reports.isError
              ? reports.error.status === 401
                ? t('loginRequired')
                : errorMessage(reports.error, t('messages.loadFailed'))
              : null
          }
          onRetry={() => reports.refetch()}
          isEmpty={rows.length === 0}
          loading={<TableSkeleton rows={6} cols={6} />}
          empty={
            filtered ? (
              <EmptyState
                icon={<ClipboardList className="size-5" />}
                title={t('noMatch')}
                description={t('noMatchHelp')}
                action={
                  <Button variant="ghost" size="sm" onClick={resetFilters}>
                    {t('filters.reset')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<ClipboardList className="size-5" />}
                title={t('empty')}
                description={t('emptyHelp')}
                action={
                  <Button variant="ghost" size="sm" onClick={openCreate}>
                    <Plus />
                    {t('actions.new')}
                  </Button>
                }
              />
            )
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('table.date')}</TH>
                  <TH>{t('table.reference')}</TH>
                  <TH>{t('table.project')}</TH>
                  <TH>{t('table.workDescription')}</TH>
                  <TH>{t('table.weather')}</TH>
                  <TH numeric>{t('table.materials')}</TH>
                  <TH className="w-11">
                    <span className="sr-only">{t('table.actions')}</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((report) => {
                  const materials = report.materialsUsed || [];
                  const weather = [
                    report.weather || null,
                    report.temperatureCelsius != null
                      ? t('table.temperature', { value: report.temperatureCelsius })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');

                  return (
                    <TR key={report.id} onActivate={() => openEdit(report)}>
                      <TD className="tnum whitespace-nowrap">{formatDate(report.date)}</TD>
                      <TD>
                        <Ref>{report.project?.reference || '—'}</Ref>
                      </TD>
                      <TD className={cn('font-medium', !report.project?.name && 'text-muted')}>
                        {report.project?.name || t('table.unknownProject')}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'block max-w-[280px] truncate',
                              !report.workDescription && 'text-muted',
                            )}
                            title={report.workDescription || undefined}
                          >
                            {report.workDescription || t('table.noDescription')}
                          </span>
                          {report.notes ? (
                            <span className="shrink-0 text-muted" title={t('table.hasNotes')}>
                              <StickyNote aria-hidden className="size-3.5" />
                              <span className="sr-only">{t('table.hasNotes')}</span>
                            </span>
                          ) : null}
                        </div>
                      </TD>
                      <TD>
                        {weather ? (
                          <Tag className="max-w-[180px]" title={weather}>
                            <span className="truncate">{weather}</span>
                          </Tag>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </TD>
                      <TD numeric className="text-muted">
                        {materials.length > 0 ? materials.length : '—'}
                      </TD>
                      <TD onClick={stopRowActivation} onKeyDown={stopRowActivation}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="quiet"
                              size="iconSm"
                              aria-label={t('actions.rowActions')}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onSelect={() => openEdit(report)}>
                              <Pencil />
                              {t('common:actions.edit')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-bad"
                              disabled={remove.isPending}
                              onSelect={() => {
                                void handleDelete(report);
                              }}
                            >
                              <Trash2 />
                              {t('common:actions.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('summary.count', { count: rows.length })}</span>
            <span>
              {rows.length >= PAGE_LIMIT
                ? t('summary.capped', { count: PAGE_LIMIT })
                : t('summary.sortedBy')}
            </span>
          </CardFooter>
        </DataState>
      </Card>

      {/* Create / edit a report */}
      <Dialog open={formOpen} onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editId ? t('form.editTitle') : t('form.newTitle')}</DialogTitle>
              <DialogDescription>
                {editId ? t('form.editHelp') : t('form.newHelp')}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <Field
                  label={t('form.project')}
                  htmlFor="report-project"
                  hint={editId ? t('form.locked') : undefined}
                  required
                >
                  <Select
                    id="report-project"
                    value={form.projectId}
                    onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                    disabled={!!editId}
                    required
                  >
                    <option value="">{t('form.selectProject')}</option>
                    {/* An existing report keeps its project visible even if the list failed. */}
                    {editing && !projectList.some((p) => p.id === editing.projectId) ? (
                      <option value={editing.projectId}>
                        {editing.project ? projectOption(editing.project) : editing.projectId}
                      </option>
                    ) : null}
                    {projectList.map((project) => (
                      <option key={project.id} value={project.id}>
                        {projectOption(project)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('form.date')}
                  htmlFor="report-date"
                  hint={editId ? t('form.locked') : undefined}
                  required
                >
                  <Input
                    id="report-date"
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    disabled={!!editId}
                    required
                  />
                </Field>
                <Field label={t('form.weather')} htmlFor="report-weather">
                  <Input
                    id="report-weather"
                    placeholder={t('form.weatherPlaceholder')}
                    value={form.weather}
                    onChange={(e) => setForm({ ...form, weather: e.target.value })}
                  />
                </Field>
                <Field
                  label={t('form.temperature')}
                  htmlFor="report-temperature"
                  error={temperatureInvalid ? t('messages.invalidTemperature') : undefined}
                >
                  <Input
                    id="report-temperature"
                    type="number"
                    step="0.5"
                    inputMode="decimal"
                    placeholder={t('form.temperaturePlaceholder')}
                    value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                  />
                </Field>
                <Field
                  label={t('form.workDescription')}
                  htmlFor="report-work"
                  className="sm:col-span-2"
                >
                  <Textarea
                    id="report-work"
                    placeholder={t('form.workDescriptionPlaceholder')}
                    value={form.workDescription}
                    onChange={(e) => setForm({ ...form, workDescription: e.target.value })}
                  />
                </Field>
                <Field
                  label={t('form.materials')}
                  htmlFor="report-materials"
                  hint={t('form.materialsHint')}
                  className="sm:col-span-2"
                >
                  <Textarea
                    id="report-materials"
                    className="min-h-16"
                    placeholder={t('form.materialsPlaceholder')}
                    value={form.materials}
                    onChange={(e) => setForm({ ...form, materials: e.target.value })}
                  />
                </Field>
                <Field label={t('form.notes')} htmlFor="report-notes" className="sm:col-span-2">
                  <Textarea
                    id="report-notes"
                    className="min-h-16"
                    placeholder={t('form.notesPlaceholder')}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </Field>
              </div>

              {editing ? (
                <p className="text-xs text-muted">
                  {t('form.created', { date: formatDate(editing.createdAt) })}
                </p>
              ) : null}

              {projects.isError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {errorMessage(projects.error, t('form.projectsLoadFailed'))}
                </p>
              ) : null}

              {save.isError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {errorMessage(save.error, t('messages.saveFailed'))}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={closeForm}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!form.projectId || temperatureInvalid || save.isPending}
              >
                {save.isPending
                  ? editId
                    ? t('common:actions.saving')
                    : t('actions.creating')
                  : editId
                    ? t('actions.update')
                    : t('actions.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}
