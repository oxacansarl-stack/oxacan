import { useState, type FormEvent, type SyntheticEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { apiDelete, apiGet, apiList, apiPost, apiPut, ApiError, type PageMeta } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatNumber } from '../lib/format';
import type { PageProps } from '../lib/page-props';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardCount, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/input';
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

interface Vehicle {
  id: string;
  registration: string;
  make?: string;
  model?: string;
  assignedTeamId?: string;
  assignedTeam?: { name: string } | null;
  assignedProjectId?: string;
  assignedProject?: { name: string } | null;
  odometerKm?: number;
  nextServiceDate?: string;
  insuranceExpiry?: string;
  createdAt: string;
}

interface Team {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  reference?: string;
}

interface VehicleForm {
  registration: string;
  make: string;
  model: string;
  assignedTeamId: string;
  assignedProjectId: string;
  odometerKm: string;
  nextServiceDate: string;
  insuranceExpiry: string;
}

const EMPTY_FORM: VehicleForm = {
  registration: '',
  make: '',
  model: '',
  assignedTeamId: '',
  assignedProjectId: '',
  odometerKm: '',
  nextServiceDate: '',
  insuranceExpiry: '',
};

/** A service or insurance date within 30 days is a warning, a past one a failure. */
const SOON_DAYS = 30;

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * The API's DTO: optional fields are omitted when blank rather than sent empty, and the three
 * maintenance fields are accepted on update only — a new vehicle carries its identity alone.
 */
function toPayload(form: VehicleForm, editing: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { registration: form.registration.trim() };
  if (form.make.trim()) body.make = form.make.trim();
  if (form.model.trim()) body.model = form.model.trim();
  if (form.assignedTeamId) body.assignedTeamId = form.assignedTeamId;
  if (form.assignedProjectId) body.assignedProjectId = form.assignedProjectId;
  if (editing) {
    if (form.odometerKm.trim()) body.odometerKm = Math.round(Number(form.odometerKm));
    if (form.nextServiceDate) body.nextServiceDate = form.nextServiceDate;
    if (form.insuranceExpiry) body.insuranceExpiry = form.insuranceExpiry;
  }
  return body;
}

/** The row opens the vehicle; the overflow menu must not re-trigger it. */
const stopRowActivation = (event: SyntheticEvent) => event.stopPropagation();

const DASH = <span className="text-muted">—</span>;

export default function Vehicles({ embedded = false }: PageProps) {
  const { t } = useTranslation('vehicles');
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);

  const vehicles = useQuery<{ items: Vehicle[]; meta: PageMeta }, ApiError>({
    queryKey: ['vehicles', page],
    queryFn: () => apiList<Vehicle>(`/vehicles?page=${page}`),
    retry: false,
  });

  // The two dropdowns are non-critical: a failure leaves the lists empty instead of blocking.
  const teams = useQuery<Team[], ApiError>({
    queryKey: ['teams-list'],
    queryFn: () => apiGet<Team[]>('/hr/teams'),
    retry: false,
  });

  const projects = useQuery<Project[], ApiError>({
    queryKey: ['projects-list'],
    queryFn: () => apiGet<Project[]>('/projects'),
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['vehicles'] });

  const save = useMutation<unknown, ApiError, { id: string | null; form: VehicleForm }>({
    mutationFn: ({ id, form: values }) =>
      id ? apiPut(`/vehicles/${id}`, toPayload(values, true)) : apiPost('/vehicles', toPayload(values, false)),
    onSuccess: () => {
      invalidate();
      closeForm();
    },
  });

  const remove = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => apiDelete(`/vehicles/${id}`),
    onSuccess: () => invalidate(),
  });

  const rows = vehicles.data?.items ?? [];
  const meta = vehicles.data?.meta;
  const total = meta?.total ?? rows.length;
  const totalPages = Math.max(1, meta?.totalPages ?? 1);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    save.reset();
    setFormOpen(true);
  };

  const openEdit = (vehicle: Vehicle) => {
    setEditingId(vehicle.id);
    setForm({
      registration: vehicle.registration,
      make: vehicle.make ?? '',
      model: vehicle.model ?? '',
      assignedTeamId: vehicle.assignedTeamId ?? '',
      assignedProjectId: vehicle.assignedProjectId ?? '',
      odometerKm: vehicle.odometerKm != null ? String(vehicle.odometerKm) : '',
      nextServiceDate: vehicle.nextServiceDate ? vehicle.nextServiceDate.slice(0, 10) : '',
      insuranceExpiry: vehicle.insuranceExpiry ? vehicle.insuranceExpiry.slice(0, 10) : '',
    });
    save.reset();
    setFormOpen(true);
  };

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  const formValid = form.registration.trim().length > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!formValid || save.isPending) return;
    save.mutate({ id: editingId, form });
  };

  const handleDelete = async (vehicle: Vehicle) => {
    if (
      !(await confirm({
        title: t('prompts.deleteTitle', { registration: vehicle.registration }),
        description: t('common:confirm.irreversible'),
      }))
    ) {
      return;
    }
    remove.mutate(vehicle.id);
  };

  /** Due-date pill: overdue, due within a month, or in order. */
  const dueBadge = (date: string | undefined, labels: { overdue: string; soon: string; ok: string }) => {
    const days = daysUntil(date);
    if (days === null) return DASH;
    if (days < 0) return <Badge tone="bad">{t(labels.overdue)}</Badge>;
    if (days <= SOON_DAYS) return <Badge tone="warn">{t(labels.soon)}</Badge>;
    return <Badge tone="ok">{t(labels.ok)}</Badge>;
  };

  const newButton = (
    <Button variant="primary" onClick={openCreate}>
      <Plus />
      {t('actions.new')}
    </Button>
  );

  return (
    <PageBody>
      {embedded ? null : (
        <PageHeader
          title={t('title')}
          kicker={t('common:navGroup.procurement')}
          meta={total > 0 ? <span>{t('count', { count: total })}</span> : undefined}
          actions={newButton}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {t('card.title')}
            {vehicles.isPending ? null : <CardCount>{total}</CardCount>}
          </CardTitle>
          {embedded ? newButton : null}
        </CardHeader>

        {remove.isError ? (
          <p role="alert" className="border-b border-line-soft px-3.5 py-2.5 text-[13px] text-bad">
            {errorMessage(remove.error, t('messages.deleteFailed'))}
          </p>
        ) : null}

        <DataState
          isLoading={vehicles.isPending}
          error={vehicles.isError ? errorMessage(vehicles.error, t('messages.loadFailed')) : null}
          onRetry={() => vehicles.refetch()}
          isEmpty={rows.length === 0}
          loading={<TableSkeleton rows={5} cols={7} />}
          empty={
            <EmptyState
              icon={<Truck className="size-5" />}
              title={t('empty.title')}
              description={t('empty.text')}
              action={
                <Button variant="ghost" size="sm" onClick={openCreate}>
                  <Plus />
                  {t('actions.new')}
                </Button>
              }
            />
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('table.registration')}</TH>
                  <TH>{t('table.vehicle')}</TH>
                  <TH>{t('table.team')}</TH>
                  <TH>{t('table.project')}</TH>
                  <TH numeric>{t('table.odometer')}</TH>
                  <TH>{t('table.service')}</TH>
                  <TH>{t('table.insurance')}</TH>
                  <TH>{t('table.createdAt')}</TH>
                  <TH className="w-11">
                    <span className="sr-only">{t('table.actions')}</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((vehicle) => {
                  const name = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
                  return (
                    <TR key={vehicle.id} onActivate={() => openEdit(vehicle)}>
                      <TD>
                        <Ref className="text-[13px] text-ink">{vehicle.registration}</Ref>
                      </TD>
                      <TD className="font-medium">{name || DASH}</TD>
                      <TD>
                        {vehicle.assignedTeam?.name ?? (
                          <span className="text-muted">{t('table.unassigned')}</span>
                        )}
                      </TD>
                      <TD>
                        {vehicle.assignedProject?.name ?? (
                          <span className="text-muted">{t('table.noProject')}</span>
                        )}
                      </TD>
                      <TD numeric>
                        {vehicle.odometerKm != null
                          ? t('table.odometerValue', { value: formatNumber(vehicle.odometerKm) })
                          : '—'}
                      </TD>
                      <TD>
                        {dueBadge(vehicle.nextServiceDate, {
                          overdue: 'badges.serviceOverdue',
                          soon: 'badges.serviceSoon',
                          ok: 'badges.serviceOk',
                        })}
                      </TD>
                      <TD>
                        {dueBadge(vehicle.insuranceExpiry, {
                          overdue: 'badges.insuranceExpired',
                          soon: 'badges.insuranceExpiring',
                          ok: 'badges.insured',
                        })}
                      </TD>
                      <TD className="tnum text-muted">{formatDate(vehicle.createdAt)}</TD>
                      <TD onClick={stopRowActivation} onKeyDown={stopRowActivation}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="quiet" size="iconSm" aria-label={t('actions.rowActions')}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onSelect={() => openEdit(vehicle)}>
                              <Pencil />
                              {t('common:actions.edit')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-bad"
                              disabled={remove.isPending}
                              onSelect={() => {
                                void handleDelete(vehicle);
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
            <span>{t('summary.count', { count: rows.length, total })}</span>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('common:actions.previous')}
                </Button>
                <span className="tnum">{t('common:state.page', { page, total: totalPages })}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t('common:actions.next')}
                </Button>
              </div>
            ) : (
              <span>{t('summary.sortedBy')}</span>
            )}
          </CardFooter>
        </DataState>
      </Card>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editingId ? t('form.editTitle') : t('form.newTitle')}</DialogTitle>
              <DialogDescription>{editingId ? t('form.editHelp') : t('form.newHelp')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label={t('form.registration')} htmlFor="vehicle-registration" required>
                <Input
                  id="vehicle-registration"
                  value={form.registration}
                  placeholder={t('form.registrationPlaceholder')}
                  onChange={(e) => setForm({ ...form, registration: e.target.value })}
                  required
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('form.make')} htmlFor="vehicle-make">
                  <Input
                    id="vehicle-make"
                    value={form.make}
                    placeholder={t('form.makePlaceholder')}
                    onChange={(e) => setForm({ ...form, make: e.target.value })}
                  />
                </Field>
                <Field label={t('form.model')} htmlFor="vehicle-model">
                  <Input
                    id="vehicle-model"
                    value={form.model}
                    placeholder={t('form.modelPlaceholder')}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                  />
                </Field>
                <Field label={t('form.assignedTeam')} htmlFor="vehicle-team">
                  <Select
                    id="vehicle-team"
                    value={form.assignedTeamId}
                    onChange={(e) => setForm({ ...form, assignedTeamId: e.target.value })}
                  >
                    <option value="">{t('form.noTeam')}</option>
                    {(teams.data ?? []).map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('form.assignedProject')} htmlFor="vehicle-project">
                  <Select
                    id="vehicle-project"
                    value={form.assignedProjectId}
                    onChange={(e) => setForm({ ...form, assignedProjectId: e.target.value })}
                  >
                    <option value="">{t('form.noProject')}</option>
                    {(projects.data ?? []).map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.reference ? `${project.reference} — ` : ''}
                        {project.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {/* The API accepts the maintenance fields on update only. */}
              {editingId ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('form.odometer')} htmlFor="vehicle-odometer">
                    <Input
                      id="vehicle-odometer"
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={form.odometerKm}
                      placeholder={t('form.odometerPlaceholder')}
                      onChange={(e) => setForm({ ...form, odometerKm: e.target.value })}
                    />
                  </Field>
                  <Field label={t('form.nextServiceDate')} htmlFor="vehicle-service">
                    <Input
                      id="vehicle-service"
                      type="date"
                      value={form.nextServiceDate}
                      onChange={(e) => setForm({ ...form, nextServiceDate: e.target.value })}
                    />
                  </Field>
                  <Field label={t('form.insuranceExpiry')} htmlFor="vehicle-insurance">
                    <Input
                      id="vehicle-insurance"
                      type="date"
                      value={form.insuranceExpiry}
                      onChange={(e) => setForm({ ...form, insuranceExpiry: e.target.value })}
                    />
                  </Field>
                </div>
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
              <Button type="submit" variant="primary" disabled={!formValid || save.isPending}>
                {save.isPending
                  ? editingId
                    ? t('actions.updating')
                    : t('actions.creating')
                  : editingId
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
