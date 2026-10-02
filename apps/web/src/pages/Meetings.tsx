import { useCallback, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  Check,
  CircleCheck,
  Download,
  FileText,
  ListChecks,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Save,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { ApiError, apiDelete, apiDownload, apiGet, apiPost, apiPut } from '../lib/api';
import { formatDate, statusLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { MetaDivider, PageBody, PageHeader } from '@/components/page-header';
import { Card, CardContent, CardCount, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { DataState, EmptyState, Skeleton, TableSkeleton } from '@/components/states';
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
  DropdownMenuLabel,
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

interface Attendee {
  id: string;
  name: string;
  role?: string;
  organization?: string;
}

type ActionStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

interface ActionItem {
  id: string;
  description: string;
  responsible: string;
  dueDate?: string;
  status: ActionStatus;
}

interface Meeting {
  id: string;
  meetingNumber?: number;
  projectId: string;
  project?: { name: string; reference?: string };
  meetingDate: string;
  location?: string;
  agenda?: string;
  minutes?: string;
  status: 'scheduled' | 'in_progress' | 'completed';
  attendees?: Attendee[];
  actions?: ActionItem[];
  createdAt: string;
}

interface CreateForm {
  projectId: string;
  meetingDate: string;
  location: string;
  agenda: string;
}

interface AttendeeForm {
  name: string;
  role: string;
  organization: string;
}

interface ActionForm {
  description: string;
  responsible: string;
  dueDate: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** The statuses the list can be filtered by; '' is "all". `in_progress` is transient. */
const STATUS_FILTERS = ['', 'scheduled', 'completed'] as const;

/** The statuses an action item can be moved to from this page. */
const ACTION_STATUSES = ['open', 'in_progress', 'done'] as const;

/** An action still waiting on someone. */
const OPEN_ACTION_STATUSES = new Set<ActionStatus>(['open', 'in_progress']);

const emptyCreateForm = (): CreateForm => ({
  projectId: '',
  meetingDate: '',
  location: '',
  agenda: '',
});

const emptyAttendeeForm = (): AttendeeForm => ({ name: '', role: '', organization: '' });

const emptyActionForm = (): ActionForm => ({ description: '', responsible: '', dueDate: '' });

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isPastDue(iso?: string): boolean {
  if (!iso) return false;
  const due = new Date(iso);
  due.setHours(23, 59, 59, 999);
  return due < new Date();
}

/** "2026-004 — Villa Dubois"; plain data, so it needs no translation. */
function projectOption(project: Project | { name: string; reference?: string }): string {
  return project.reference ? `${project.reference} — ${project.name}` : project.name;
}

function openActions(actions: ActionItem[] | undefined): number {
  return (actions ?? []).filter((action) => OPEN_ACTION_STATUSES.has(action.status)).length;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Meetings() {
  const { t } = useTranslation('meetings');
  const confirm = useConfirm();

  /* ----- list state ----- */
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsError, setProjectsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  /* ----- create dialog state ----- */
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreateForm);
  const [creating, setCreating] = useState(false);
  const [createAlert, setCreateAlert] = useState('');

  /* ----- detail state ----- */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Meeting | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  /* ----- attendee form ----- */
  const [attendeeForm, setAttendeeForm] = useState<AttendeeForm>(emptyAttendeeForm);
  const [addingAttendee, setAddingAttendee] = useState(false);
  const [attendeeAlert, setAttendeeAlert] = useState('');

  /* ----- action form ----- */
  const [actionForm, setActionForm] = useState<ActionForm>(emptyActionForm);
  const [addingAction, setAddingAction] = useState(false);
  const [actionAlert, setActionAlert] = useState('');

  /* ----- minutes ----- */
  const [minutesDraft, setMinutesDraft] = useState('');
  const [savingMinutes, setSavingMinutes] = useState(false);
  const [minutesAlert, setMinutesAlert] = useState('');

  /* ----- meeting-level actions (PV, clôture) ----- */
  const [completing, setCompleting] = useState(false);
  const [meetingAlert, setMeetingAlert] = useState('');

  /* ---------------------------------------------------------------- */
  /*  Data fetching                                                    */
  /* ---------------------------------------------------------------- */

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (projectFilter) params.set('projectId', projectFilter);
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString() ? `?${params.toString()}` : '';
      setMeetings(await apiGet<Meeting[]>(`/meetings${qs}`));
    } catch (err: unknown) {
      setLoadError(
        err instanceof ApiError && err.status === 401
          ? t('loginRequired')
          : errorMessage(err, t('messages.loadFailed')),
      );
    } finally {
      setLoading(false);
    }
  }, [projectFilter, statusFilter, t]);

  const fetchProjects = useCallback(async () => {
    setProjectsError('');
    try {
      setProjects(await apiGet<Project[]>('/projects?limit=100'));
    } catch (err: unknown) {
      // The dropdown is best-effort, but a failed load must not read as "no project".
      setProjectsError(errorMessage(err, t('messages.projectsLoadFailed')));
    }
  }, [t]);

  const fetchDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setDetailError('');
      try {
        const res = await apiGet<Meeting>(`/meetings/${id}`);
        setDetail(res);
        setMinutesDraft(res.minutes ?? '');
      } catch (err: unknown) {
        setDetailError(errorMessage(err, t('messages.detailFailed')));
      } finally {
        setDetailLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    void fetchMeetings();
  }, [fetchMeetings]);

  useEffect(() => {
    if (selectedId) {
      void fetchDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, fetchDetail]);

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                         */
  /* ---------------------------------------------------------------- */

  /** A row opens its meeting below the list, and closes it when clicked again. */
  const handleSelect = (id: string) => {
    setDetail(null);
    setDetailError('');
    setAttendeeAlert('');
    setActionAlert('');
    setMinutesAlert('');
    setMeetingAlert('');
    setSelectedId((current) => (current === id ? null : id));
  };

  const closeCreate = () => {
    setShowCreate(false);
    setCreateAlert('');
    setCreateForm(emptyCreateForm());
  };

  const handleCreate = async () => {
    if (creating) return;
    if (!createForm.projectId || !createForm.meetingDate) return;
    setCreating(true);
    setCreateAlert('');
    try {
      const body: Record<string, string> = {
        projectId: createForm.projectId,
        meetingDate: createForm.meetingDate,
      };
      if (createForm.location.trim()) body.location = createForm.location.trim();
      if (createForm.agenda.trim()) body.agenda = createForm.agenda;
      await apiPost('/meetings', body);
      setCreateForm(emptyCreateForm());
      setShowCreate(false);
      await fetchMeetings();
    } catch (err: unknown) {
      setCreateAlert(errorMessage(err, t('messages.createFailed')));
    } finally {
      setCreating(false);
    }
  };

  const handleAddAttendee = async () => {
    if (!detail || !attendeeForm.name) return;
    setAddingAttendee(true);
    setAttendeeAlert('');
    try {
      const body: Record<string, string> = { name: attendeeForm.name };
      if (attendeeForm.role) body.role = attendeeForm.role;
      if (attendeeForm.organization) body.organization = attendeeForm.organization;
      await apiPost(`/meetings/${detail.id}/attendees`, body);
      setAttendeeForm(emptyAttendeeForm());
      await fetchDetail(detail.id);
    } catch (err: unknown) {
      setAttendeeAlert(errorMessage(err, t('messages.addAttendeeFailed')));
    } finally {
      setAddingAttendee(false);
    }
  };

  const handleRemoveAttendee = async (attendeeId: string) => {
    if (!detail) return;
    setAttendeeAlert('');
    try {
      await apiDelete(`/meetings/${detail.id}/attendees/${attendeeId}`);
      await fetchDetail(detail.id);
    } catch (err: unknown) {
      setAttendeeAlert(errorMessage(err, t('messages.removeAttendeeFailed')));
    }
  };

  const handleAddAction = async () => {
    if (!detail || !actionForm.description || !actionForm.responsible) return;
    setAddingAction(true);
    setActionAlert('');
    try {
      const body: Record<string, string> = {
        description: actionForm.description,
        responsible: actionForm.responsible,
      };
      if (actionForm.dueDate) body.dueDate = actionForm.dueDate;
      await apiPost(`/meetings/${detail.id}/actions`, body);
      setActionForm(emptyActionForm());
      await fetchDetail(detail.id);
    } catch (err: unknown) {
      setActionAlert(errorMessage(err, t('messages.addActionFailed')));
    } finally {
      setAddingAction(false);
    }
  };

  const handleUpdateActionStatus = async (actionId: string, status: string) => {
    if (!detail) return;
    setActionAlert('');
    try {
      await apiPut(`/meetings/${detail.id}/actions/${actionId}`, { status });
      await fetchDetail(detail.id);
    } catch (err: unknown) {
      setActionAlert(errorMessage(err, t('messages.updateActionFailed')));
    }
  };

  const handleSaveMinutes = async () => {
    if (!detail) return;
    setSavingMinutes(true);
    setMinutesAlert('');
    try {
      await apiPut(`/meetings/${detail.id}`, { minutes: minutesDraft });
      await fetchDetail(detail.id);
    } catch (err: unknown) {
      setMinutesAlert(errorMessage(err, t('messages.saveMinutesFailed')));
    } finally {
      setSavingMinutes(false);
    }
  };

  const handleComplete = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: t('messages.confirmComplete'),
      description: t('messages.confirmCompleteHelp'),
      confirmLabel: t('detail.complete'),
      tone: 'default',
    });
    if (!ok) return;
    setCompleting(true);
    setMeetingAlert('');
    try {
      await apiPost(`/meetings/${detail.id}/complete`);
      await fetchDetail(detail.id);
      await fetchMeetings();
    } catch (err: unknown) {
      setMeetingAlert(errorMessage(err, t('messages.completeFailed')));
    } finally {
      setCompleting(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!detail) return;
    setMeetingAlert('');
    void apiDownload(`/meetings/${detail.id}/pdf`).catch((err: unknown) =>
      setMeetingAlert(errorMessage(err, t('messages.pdfFailed'))),
    );
  };

  /* ---------------------------------------------------------------- */
  /*  Derived                                                          */
  /* ---------------------------------------------------------------- */

  const filtersActive = Boolean(projectFilter || statusFilter);
  const createValid = Boolean(createForm.projectId && createForm.meetingDate);

  // Only meaningful on the unfiltered view, where every status is present.
  const scheduled = statusFilter ? null : meetings.filter((m) => m.status === 'scheduled').length;
  const openActionTotal = meetings.reduce((sum, m) => sum + openActions(m.actions), 0);

  const resetFilters = () => {
    setProjectFilter('');
    setStatusFilter('');
  };

  const detailPanel = detail ? (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 content-start gap-5">
        {detail.agenda ? <AgendaCard agenda={detail.agenda} /> : null}

        <AttendeesCard
          attendees={detail.attendees ?? []}
          form={attendeeForm}
          setForm={setAttendeeForm}
          adding={addingAttendee}
          alert={attendeeAlert}
          onAdd={() => void handleAddAttendee()}
          onRemove={(id) => void handleRemoveAttendee(id)}
        />

        <ActionsCard
          actions={detail.actions ?? []}
          form={actionForm}
          setForm={setActionForm}
          adding={addingAction}
          alert={actionAlert}
          onAdd={() => void handleAddAction()}
          onChangeStatus={(actionId, status) => void handleUpdateActionStatus(actionId, status)}
        />

        <MinutesCard
          value={minutesDraft}
          onChange={setMinutesDraft}
          dirty={minutesDraft !== (detail.minutes ?? '')}
          saving={savingMinutes}
          alert={minutesAlert}
          onSave={() => void handleSaveMinutes()}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-5 lg:sticky lg:top-5 lg:self-start">
        <MeetingSummaryCard
          meeting={detail}
          alert={meetingAlert}
          completing={completing}
          onComplete={() => void handleComplete()}
          onDownloadPdf={handleDownloadPdf}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </div>
  ) : null;

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        kicker={t('common:navGroup.sites')}
        meta={
          <>
            <span>{t('subtitle')}</span>
            {scheduled ? (
              <>
                <MetaDivider />
                <span>{t('meta.scheduled', { count: scheduled })}</span>
              </>
            ) : null}
            {openActionTotal > 0 ? (
              <>
                <MetaDivider />
                <span>{t('meta.openActions', { count: openActionTotal })}</span>
              </>
            ) : null}
          </>
        }
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setCreateAlert('');
              setShowCreate(true);
            }}
          >
            <Plus />
            {t('actions.new')}
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line-soft p-3">
          <Field
            label={t('filters.project')}
            htmlFor="meeting-filter-project"
            className="w-full sm:w-[260px]"
          >
            <Select
              id="meeting-filter-project"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="">{t('filters.allProjects')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {projectOption(project)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">{t('filters.status')}</span>
            <div className="flex flex-wrap gap-0.5" role="group" aria-label={t('filters.status')}>
              {STATUS_FILTERS.map((value) => (
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
                  {value ? statusLabel('meeting', value) : t('filters.allStatuses')}
                </button>
              ))}
            </div>
          </div>

          {filtersActive ? (
            <Button variant="quiet" size="sm" className="ml-auto" onClick={resetFilters}>
              {t('filters.reset')}
            </Button>
          ) : null}
        </div>

        {projectsError ? (
          <p role="alert" className="border-b border-line-soft px-3.5 py-2.5 text-[13px] text-bad">
            {projectsError}
          </p>
        ) : null}

        <DataState
          isLoading={loading}
          error={loadError || null}
          onRetry={() => void fetchMeetings()}
          isEmpty={meetings.length === 0}
          loading={<TableSkeleton rows={6} cols={7} />}
          empty={
            filtersActive ? (
              <EmptyState
                icon={<CalendarDays className="size-5" />}
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
                icon={<CalendarDays className="size-5" />}
                title={t('empty')}
                description={t('emptyHelp')}
                action={
                  <Button variant="ghost" size="sm" onClick={() => setShowCreate(true)}>
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
                  <TH>{t('table.number')}</TH>
                  <TH>{t('table.date')}</TH>
                  <TH>{t('table.project')}</TH>
                  <TH>{t('table.location')}</TH>
                  <TH>{t('table.status')}</TH>
                  <TH numeric>{t('table.actions')}</TH>
                  <TH>{t('table.created')}</TH>
                </tr>
              </THead>
              <TBody>
                {meetings.map((meeting) => {
                  const isSelected = selectedId === meeting.id;
                  const actionCount = meeting.actions?.length ?? 0;
                  return (
                    <TR
                      key={meeting.id}
                      onActivate={() => handleSelect(meeting.id)}
                      aria-expanded={isSelected}
                      aria-controls={isSelected ? 'meeting-detail' : undefined}
                      className={cn(isSelected && '[&>td]:bg-chalk')}
                    >
                      <TD>
                        <Ref>{meeting.meetingNumber ?? meeting.id.slice(0, 8)}</Ref>
                      </TD>
                      <TD className="tnum whitespace-nowrap">{formatDate(meeting.meetingDate)}</TD>
                      <TD className={cn('font-medium', !meeting.project?.name && 'text-muted')}>
                        {meeting.project?.name || '—'}
                      </TD>
                      <TD className={cn(!meeting.location && 'text-muted')}>
                        {meeting.location || '—'}
                      </TD>
                      <TD>
                        <StatusBadge domain="meeting" value={meeting.status} />
                      </TD>
                      <TD numeric className={cn(actionCount === 0 && 'text-muted')}>
                        {actionCount}
                      </TD>
                      <TD className="tnum whitespace-nowrap text-muted">
                        {formatDate(meeting.createdAt)}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('summary.count', { count: meetings.length })}</span>
            <span>{t('summary.sortedBy')}</span>
          </CardFooter>
        </DataState>
      </Card>

      {/* The selected meeting: participants, actions, PV. */}
      {selectedId ? (
        <section
          id="meeting-detail"
          aria-label={t('detail.region')}
          aria-busy={detailLoading || undefined}
          className="grid grid-cols-[minmax(0,1fr)] gap-5"
        >
          <DataState
            isLoading={!detail && !detailError}
            error={detailError || null}
            onRetry={() => void fetchDetail(selectedId)}
            isEmpty={!detail}
            loading={
              <Card>
                <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-3" role="status" aria-live="polite" aria-busy="true">
                  <span className="sr-only">{t('detail.loading')}</span>
                  <Skeleton className="h-3 w-44" />
                  <Skeleton className="h-3 w-64" />
                  <Skeleton className="h-24 w-full" />
                </CardContent>
              </Card>
            }
            empty={
              <Card>
                <EmptyState
                  icon={<CalendarDays className="size-5" />}
                  title={t('detail.unavailable')}
                  description={t('detail.unavailableHelp')}
                />
              </Card>
            }
          >
            {detailPanel}
          </DataState>
        </section>
      ) : null}

      {/* Create a meeting */}
      <Dialog open={showCreate} onOpenChange={(open) => (open ? setShowCreate(true) : closeCreate())}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('form.title')}</DialogTitle>
              <DialogDescription>{t('form.help')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label={t('form.project')} htmlFor="meeting-project" required>
                <Select
                  id="meeting-project"
                  value={createForm.projectId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, projectId: e.target.value }))}
                >
                  <option value="">{t('form.selectProject')}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {projectOption(project)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <Field label={t('form.date')} htmlFor="meeting-date" required>
                  <Input
                    id="meeting-date"
                    type="date"
                    value={createForm.meetingDate}
                    onChange={(e) => setCreateForm((f) => ({ ...f, meetingDate: e.target.value }))}
                  />
                </Field>
                <Field label={t('form.location')} htmlFor="meeting-location">
                  <Input
                    id="meeting-location"
                    placeholder={t('form.locationPlaceholder')}
                    value={createForm.location}
                    onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))}
                  />
                </Field>
              </div>
              <Field label={t('form.agenda')} htmlFor="meeting-agenda">
                <Textarea
                  id="meeting-agenda"
                  placeholder={t('form.agendaPlaceholder')}
                  value={createForm.agenda}
                  onChange={(e) => setCreateForm((f) => ({ ...f, agenda: e.target.value }))}
                />
              </Field>
              {projectsError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {projectsError}
                </p>
              ) : null}
              {createAlert ? (
                <p role="alert" className="text-[13px] text-bad">
                  {createAlert}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={closeCreate}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={creating}
                blockedReason={createValid ? undefined : t('form.incomplete')}
              >
                {creating ? t('form.creating') : t('form.submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

/* ------------------------------------------------------------------ */
/*  Detail cards                                                       */
/* ------------------------------------------------------------------ */

function AgendaCard({ agenda }: { agenda: string }) {
  const { t } = useTranslation('meetings');
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <FileText aria-hidden className="size-4 text-muted" />
          {t('detail.agenda')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap break-words text-[13.5px] text-ink-2">{agenda}</p>
      </CardContent>
    </Card>
  );
}

function AttendeesCard({
  attendees,
  form,
  setForm,
  adding,
  alert,
  onAdd,
  onRemove,
}: {
  attendees: Attendee[];
  form: AttendeeForm;
  setForm: Dispatch<SetStateAction<AttendeeForm>>;
  adding: boolean;
  alert: string;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation('meetings');
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Users aria-hidden className="size-4 text-muted" />
          {t('detail.attendees.title')}
          <CardCount>({attendees.length})</CardCount>
        </CardTitle>
      </CardHeader>

      {attendees.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title={t('detail.attendees.empty')}
          description={t('detail.attendees.emptyHelp')}
        />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>{t('detail.attendees.name')}</TH>
                <TH>{t('detail.attendees.role')}</TH>
                <TH>{t('detail.attendees.organization')}</TH>
                <TH className="w-11">
                  <span className="sr-only">{t('detail.attendees.remove')}</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {attendees.map((attendee) => (
                <TR key={attendee.id}>
                  <TD className="font-medium">{attendee.name}</TD>
                  <TD className={cn(!attendee.role && 'text-muted')}>{attendee.role || '—'}</TD>
                  <TD className={cn(!attendee.organization && 'text-muted')}>
                    {attendee.organization || '—'}
                  </TD>
                  <TD className="w-11">
                    <Button
                      variant="quiet"
                      size="iconSm"
                      aria-label={t('detail.attendees.removeNamed', { name: attendee.name })}
                      title={t('detail.attendees.remove')}
                      onClick={() => onRemove(attendee.id)}
                    >
                      <Trash2 />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}

      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t border-line-soft">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
          <Field label={t('detail.attendees.nameLabel')} htmlFor="meeting-attendee-name" required>
            <Input
              id="meeting-attendee-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label={t('detail.attendees.roleLabel')} htmlFor="meeting-attendee-role">
            <Input
              id="meeting-attendee-role"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            />
          </Field>
          <Field
            label={t('detail.attendees.organizationLabel')}
            htmlFor="meeting-attendee-organization"
          >
            <Input
              id="meeting-attendee-organization"
              value={form.organization}
              onChange={(e) => setForm((f) => ({ ...f, organization: e.target.value }))}
            />
          </Field>
        </div>
        {alert ? (
          <p role="alert" className="text-[13px] text-bad">
            {alert}
          </p>
        ) : null}
        <div className="flex flex-wrap">
          <Button
            variant="ghost"
            onClick={onAdd}
            disabled={adding}
            blockedReason={form.name ? undefined : t('detail.attendees.nameRequired')}
          >
            <UserPlus />
            {adding ? t('detail.attendees.adding') : t('detail.attendees.add')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionsCard({
  actions,
  form,
  setForm,
  adding,
  alert,
  onAdd,
  onChangeStatus,
}: {
  actions: ActionItem[];
  form: ActionForm;
  setForm: Dispatch<SetStateAction<ActionForm>>;
  adding: boolean;
  alert: string;
  onAdd: () => void;
  onChangeStatus: (actionId: string, status: string) => void;
}) {
  const { t } = useTranslation('meetings');
  const open = openActions(actions);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <ListChecks aria-hidden className="size-4 text-muted" />
          {t('detail.actions.title')}
          <CardCount>({actions.length})</CardCount>
        </CardTitle>
        {open > 0 ? (
          <span className="text-[13px] text-muted">{t('detail.actions.open', { count: open })}</span>
        ) : null}
      </CardHeader>

      {actions.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="size-5" />}
          title={t('detail.actions.empty')}
          description={t('detail.actions.emptyHelp')}
        />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>{t('detail.actions.description')}</TH>
                <TH>{t('detail.actions.responsible')}</TH>
                <TH>{t('detail.actions.dueDate')}</TH>
                <TH>{t('detail.actions.status')}</TH>
                <TH className="w-11">
                  <span className="sr-only">{t('detail.actions.rowActions')}</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {actions.map((action) => {
                const overdue = action.status !== 'done' && isPastDue(action.dueDate);
                return (
                  <TR key={action.id}>
                    <TD className="font-medium">{action.description}</TD>
                    <TD>{action.responsible}</TD>
                    <TD className={cn('tnum whitespace-nowrap', overdue && 'font-medium text-bad')}>
                      {action.dueDate ? formatDate(action.dueDate) : '—'}
                      {overdue ? (
                        <span className="ml-1.5 text-xs font-medium text-bad">
                          {t('detail.actions.overdue')}
                        </span>
                      ) : null}
                    </TD>
                    <TD>
                      <StatusBadge domain="meetingAction" value={action.status} />
                    </TD>
                    <TD className="w-11">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="quiet"
                            size="iconSm"
                            aria-label={t('detail.actions.rowActions')}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuLabel>{t('detail.actions.changeStatus')}</DropdownMenuLabel>
                          {ACTION_STATUSES.map((status) => (
                            <DropdownMenuItem
                              key={status}
                              disabled={action.status === status}
                              onSelect={() => onChangeStatus(action.id, status)}
                            >
                              {action.status === status ? (
                                <Check />
                              ) : (
                                <span aria-hidden className="size-4" />
                              )}
                              {statusLabel('meetingAction', status)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}

      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t border-line-soft">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,180px)_150px]">
          <Field
            label={t('detail.actions.descriptionLabel')}
            htmlFor="meeting-action-description"
            required
          >
            <Input
              id="meeting-action-description"
              placeholder={t('detail.actions.descriptionPlaceholder')}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <Field
            label={t('detail.actions.responsibleLabel')}
            htmlFor="meeting-action-responsible"
            required
          >
            <Input
              id="meeting-action-responsible"
              value={form.responsible}
              onChange={(e) => setForm((f) => ({ ...f, responsible: e.target.value }))}
            />
          </Field>
          <Field label={t('detail.actions.dueDateLabel')} htmlFor="meeting-action-due">
            <Input
              id="meeting-action-due"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            />
          </Field>
        </div>
        {alert ? (
          <p role="alert" className="text-[13px] text-bad">
            {alert}
          </p>
        ) : null}
        <div className="flex flex-wrap">
          <Button
            variant="ghost"
            onClick={onAdd}
            disabled={adding}
            blockedReason={
              form.description && form.responsible ? undefined : t('detail.actions.required')
            }
          >
            <Plus />
            {adding ? t('detail.actions.adding') : t('detail.actions.add')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MinutesCard({
  value,
  onChange,
  dirty,
  saving,
  alert,
  onSave,
}: {
  value: string;
  onChange: (value: string) => void;
  dirty: boolean;
  saving: boolean;
  alert: string;
  onSave: () => void;
}) {
  const { t } = useTranslation('meetings');
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <NotebookPen aria-hidden className="size-4 text-muted" />
          {t('detail.minutes.title')}
        </CardTitle>
        {dirty ? (
          <span className="text-[13px] text-muted">{t('detail.minutes.unsaved')}</span>
        ) : null}
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <Field label={t('detail.minutes.label')} htmlFor="meeting-minutes">
          <Textarea
            id="meeting-minutes"
            className="min-h-[140px]"
            placeholder={t('detail.minutes.placeholder')}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
        {alert ? (
          <p role="alert" className="text-[13px] text-bad">
            {alert}
          </p>
        ) : null}
        <div className="flex flex-wrap">
          <Button variant="ghost" onClick={onSave} disabled={saving}>
            <Save />
            {saving ? t('common:actions.saving') : t('detail.minutes.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-[13.5px] text-ink">{children}</dd>
    </div>
  );
}

function MeetingSummaryCard({
  meeting,
  alert,
  completing,
  onComplete,
  onDownloadPdf,
  onClose,
}: {
  meeting: Meeting;
  alert: string;
  completing: boolean;
  onComplete: () => void;
  onDownloadPdf: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('meetings');
  const attendees = meeting.attendees ?? [];
  const actions = meeting.actions ?? [];
  const open = openActions(actions);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CalendarDays aria-hidden className="size-4 text-muted" />
          {meeting.meetingNumber != null
            ? t('detail.headingNumbered', { number: meeting.meetingNumber })
            : t('detail.heading')}
        </CardTitle>
        <div className="flex items-center gap-2">
          <StatusBadge domain="meeting" value={meeting.status} />
          <Button variant="quiet" size="iconSm" aria-label={t('detail.close')} onClick={onClose}>
            <X />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <dl className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <SummaryRow label={t('detail.project')}>
            <span className="font-medium">{meeting.project?.name ?? '—'}</span>
            {meeting.project?.reference ? (
              <>
                {' '}
                <Ref>{meeting.project.reference}</Ref>
              </>
            ) : null}
          </SummaryRow>
          <SummaryRow label={t('detail.date')}>
            <span className="tnum">{formatDate(meeting.meetingDate)}</span>
          </SummaryRow>
          <SummaryRow label={t('detail.location')}>
            {meeting.location || <span className="text-muted">—</span>}
          </SummaryRow>
          <SummaryRow label={t('detail.created')}>
            <span className="tnum">{formatDate(meeting.createdAt)}</span>
          </SummaryRow>
          <SummaryRow label={t('detail.attendees.title')}>
            <span className="tnum">{attendees.length}</span>
          </SummaryRow>
          <SummaryRow label={t('detail.actions.title')}>
            <span className="tnum">{actions.length}</span>
            {open > 0 ? (
              <span className="text-muted"> · {t('detail.actions.open', { count: open })}</span>
            ) : null}
          </SummaryRow>
        </dl>
      </CardContent>

      {alert ? (
        <p role="alert" className="border-t border-line-soft px-4 py-2.5 text-[13px] text-bad">
          {alert}
        </p>
      ) : null}

      <CardContent className="flex flex-wrap gap-2 border-t border-line-soft">
        <Button variant="ghost" onClick={onDownloadPdf}>
          <Download />
          {t('detail.downloadPdf')}
        </Button>
        {meeting.status === 'scheduled' ? (
          <Button variant="ghost" onClick={onComplete} disabled={completing}>
            <CircleCheck />
            {completing ? t('detail.completing') : t('detail.complete')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
