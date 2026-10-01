import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import i18n from '../i18n';
import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatMoney } from '../lib/format';
import { useCurrentUser } from '../lib/current-user';
import { OFFICE } from '@/app/nav';
import { TabbedPage } from '@/components/tab-page';
import { Card, CardCount, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Field, Input, SearchInput, Select } from '@/components/ui/input';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PublicUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

interface Team {
  id: string;
  name: string;
  leaderId?: string | null;
  leader?: PublicUser | null;
  memberCount?: number;
  createdAt: string;
}

interface TeamMember {
  userId: string;
  user: PublicUser;
}

interface TeamDetail extends Team {
  members: TeamMember[];
}

interface Employee {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  hourlyRateCents: number | null;
  cctCode?: string | null;
  supabaseAuthId?: string | null;
  isActive: boolean;
  createdAt: string;
}

interface SeatAvailability {
  used: number;
  total: number;
  available: number;
}

interface NewEmployeeForm {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  licenceTier: string;
  hourlyRate: string;
  phone: string;
  cctCode: string;
  hireDate: string;
  teamId: string;
}

const EMPTY_EMPLOYEE: NewEmployeeForm = {
  firstName: '',
  lastName: '',
  email: '',
  role: 'WORKER',
  licenceTier: '',
  hourlyRate: '',
  phone: '',
  cctCode: '',
  hireDate: '',
  teamId: '',
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** app_user.role CHECK values */
const ROLES = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER'] as const;
const LICENCE_TIERS = ['saas', 'application'] as const;

const ROLE_TONES: Record<string, BadgeTone> = {
  ADMIN: 'copper',
  PROJECT_MANAGER: 'info',
  TEAM_LEADER: 'ok',
  WORKER: 'neutral',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function roleLabel(role: string): string {
  return i18n.t(`role.${role}`, { ns: 'common', defaultValue: role });
}

/** HR-specific messages for account rules (seats, invitations), else the shared translation. */
function hrErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const details = err.details ?? {};
    let rule = typeof details.rule === 'string' ? details.rule : undefined;
    if (rule === 'SEAT_LIMIT_REACHED' && details.total === 0) rule = 'NO_SEATS';
    if (rule && i18n.exists(`errors.${rule}`, { ns: 'hr' })) {
      return i18n.t(`errors.${rule}`, { ns: 'hr', used: details.used, total: details.total });
    }
    if (err.code && i18n.exists(`errors.${err.code}`, { ns: 'hr' })) return i18n.t(`errors.${err.code}`, { ns: 'hr' });
  }
  return errorMessage(err, fallback);
}

function displayName(u: { firstName?: string; lastName?: string; email: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
}

function RoleBadge({ role }: { role: string }) {
  return <Badge tone={ROLE_TONES[role] ?? 'neutral'}>{roleLabel(role)}</Badge>;
}

function AccountBadge({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation('hr');
  return <Badge tone={isActive ? 'ok' : 'bad'}>{t(isActive ? 'active' : 'inactive')}</Badge>;
}

/** Keeps a control inside a row from also activating the row. */
const stopRowActivation = (event: SyntheticEvent) => event.stopPropagation();

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

/**
 * RH & équipes. Role gating mirrors the API's @Roles policy (PRD §18.2):
 * — Équipes is readable by a team leader, but creating, renaming, deleting a team and its
 *   membership are office-only;
 * — Collaborateurs lists hourly rates and is office-only, so the tab is not rendered for a
 *   team leader at all — every request it makes would answer 403;
 * — creating, inviting and (de)activating an account, and setting a role or a licence, are
 *   the administrator's job.
 */
export default function HR() {
  const { t } = useTranslation('hr');

  return (
    <TabbedPage
      title={t('title')}
      kicker={t('common:navGroup.people')}
      tabs={[
        { value: 'teams', label: t('tabs.teams'), render: () => <TeamsPanel /> },
        {
          value: 'employees',
          label: t('tabs.employees'),
          roles: OFFICE,
          render: () => <EmployeesPanel />,
        },
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Équipes                                                            */
/* ------------------------------------------------------------------ */

function TeamsPanel() {
  const { t } = useTranslation('hr');
  const confirm = useConfirm();
  const { role } = useCurrentUser();
  // Reading teams is allowed for a team leader; every write is office-only in the API.
  const canManage = role === 'ADMIN' || role === 'PROJECT_MANAGER';

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  /** Failure of a row or membership action, shown above the list instead of window.alert. */
  const [actionError, setActionError] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', leaderId: '' });
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editTeam, setEditTeam] = useState<Team | null>(null);
  const [editForm, setEditForm] = useState({ name: '', leaderId: '' });
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState('');

  const [addMemberUserId, setAddMemberUserId] = useState('');
  const [addMemberPending, setAddMemberPending] = useState(false);

  /** Candidates for the leader and member pickers. */
  const [pickerEmployees, setPickerEmployees] = useState<Employee[]>([]);

  /* ---------- data ---------- */

  const fetchTeams = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: '100' });
    if (search) params.set('search', search);
    apiGet<Team[]>(`/hr/teams?${params.toString()}`)
      .then((list) => setTeams(list ?? []))
      .catch((err) => setError(errorMessage(err, t('messages.loadTeamsFailed'))))
      .finally(() => setLoading(false));
  }, [search, t]);

  const fetchPickerEmployees = useCallback(() => {
    // Office roles only; a team leader gets 403 and the pickers stay empty.
    apiGet<Employee[]>('/hr/employees?isActive=true&limit=200')
      .then((list) => setPickerEmployees(list ?? []))
      .catch(() => {});
  }, []);

  const fetchDetail = useCallback(
    (teamId: string) => {
      setDetailLoading(true);
      setDetailError('');
      apiGet<TeamDetail>(`/hr/teams/${teamId}`)
        .then((loaded) => setDetail(loaded))
        .catch((err) => {
          setDetail(null);
          setDetailError(errorMessage(err, t('teams.detailFailed')));
        })
        .finally(() => setDetailLoading(false));
    },
    [t],
  );

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  useEffect(() => {
    if (canManage) fetchPickerEmployees();
  }, [canManage, fetchPickerEmployees]);

  /* ---------- actions ---------- */

  const toggleTeam = (teamId: string) => {
    if (selectedId === teamId) {
      setSelectedId(null);
      setDetail(null);
      setDetailError('');
    } else {
      setSelectedId(teamId);
      setAddMemberUserId('');
      fetchDetail(teamId);
    }
  };

  const openCreate = () => {
    setCreateForm({ name: '', leaderId: '' });
    setCreateError('');
    setCreateOpen(true);
  };

  const submitCreate = () => {
    if (!createForm.name.trim()) return;
    setCreatePending(true);
    setCreateError('');
    const body: { name: string; leaderId?: string } = { name: createForm.name.trim() };
    if (createForm.leaderId) body.leaderId = createForm.leaderId;
    apiPost('/hr/teams', body)
      .then(() => {
        setCreateForm({ name: '', leaderId: '' });
        setCreateOpen(false);
        fetchTeams();
      })
      .catch((err) => setCreateError(errorMessage(err, t('messages.createTeamFailed'))))
      .finally(() => setCreatePending(false));
  };

  const openEdit = (team: Team) => {
    setEditTeam(team);
    setEditForm({ name: team.name, leaderId: team.leaderId ?? '' });
    setEditError('');
  };

  const submitEdit = (teamId: string) => {
    setEditPending(true);
    setEditError('');
    // null removes the leader
    const body: { name?: string; leaderId: string | null } = { leaderId: editForm.leaderId || null };
    if (editForm.name.trim()) body.name = editForm.name.trim();
    apiPut(`/hr/teams/${teamId}`, body)
      .then(() => {
        setEditTeam(null);
        fetchTeams();
        if (selectedId === teamId) fetchDetail(teamId);
      })
      .catch((err) => setEditError(errorMessage(err, t('messages.updateTeamFailed'))))
      .finally(() => setEditPending(false));
  };

  const removeTeam = async (team: Team) => {
    const ok = await confirm({
      title: t('teams.confirmDeleteTitle'),
      description: t('teams.confirmDelete'),
      confirmLabel: t('teams.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    setActionError('');
    apiDelete(`/hr/teams/${team.id}`)
      .then(() => {
        if (selectedId === team.id) {
          setSelectedId(null);
          setDetail(null);
        }
        fetchTeams();
      })
      .catch((err) => setActionError(errorMessage(err, t('messages.deleteTeamFailed'))));
  };

  const addMember = (teamId: string) => {
    if (!addMemberUserId) return;
    setAddMemberPending(true);
    setActionError('');
    apiPost(`/hr/teams/${teamId}/members`, { userId: addMemberUserId })
      .then(() => {
        setAddMemberUserId('');
        fetchDetail(teamId);
        fetchTeams();
      })
      .catch((err) => setActionError(errorMessage(err, t('messages.addMemberFailed'))))
      .finally(() => setAddMemberPending(false));
  };

  const removeMember = (teamId: string, userId: string) => {
    setActionError('');
    apiDelete(`/hr/teams/${teamId}/members/${userId}`)
      .then(() => {
        fetchDetail(teamId);
        fetchTeams();
      })
      .catch((err) => setActionError(errorMessage(err, t('messages.removeMemberFailed'))));
  };

  /* ---------- render ---------- */

  const selectedTeam = teams.find((team) => team.id === selectedId) ?? null;
  const memberRows = detail?.members ?? [];
  const available = useMemo(
    () => pickerEmployees.filter((emp) => !memberRows.some((m) => m.userId === emp.id)),
    [pickerEmployees, memberRows],
  );

  return (
    <div className="grid gap-5">
      {actionError ? (
        <p
          role="alert"
          className="rounded-card border border-line bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad"
        >
          {actionError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {t('teams.title')}
            {teams.length > 0 ? <CardCount>({teams.length})</CardCount> : null}
          </CardTitle>
          {canManage ? (
            <Button variant="primary" onClick={openCreate}>
              <Plus />
              {t('teams.new')}
            </Button>
          ) : null}
        </CardHeader>

        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft p-3">
          <SearchInput
            icon={<Search className="size-4" />}
            placeholder={t('teams.searchPlaceholder')}
            aria-label={t('teams.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <DataState
          isLoading={loading}
          error={error || null}
          onRetry={fetchTeams}
          isEmpty={teams.length === 0}
          loading={<TableSkeleton rows={4} cols={4} />}
          empty={
            search.trim() ? (
              <EmptyState
                icon={<Users className="size-5" />}
                title={t('teams.noMatch')}
                description={t('teams.noMatchHelp')}
              />
            ) : (
              <EmptyState
                icon={<Users className="size-5" />}
                title={t('teams.empty')}
                description={t('teams.emptyHelp')}
                action={
                  canManage ? (
                    <Button variant="ghost" size="sm" onClick={openCreate}>
                      <Plus />
                      {t('teams.new')}
                    </Button>
                  ) : undefined
                }
              />
            )
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('teams.table.name')}</TH>
                  <TH>{t('teams.table.leader')}</TH>
                  <TH numeric>{t('teams.table.members')}</TH>
                  <TH>{t('teams.table.createdAt')}</TH>
                  {canManage ? (
                    <TH className="w-11">
                      <span className="sr-only">{t('teams.table.actions')}</span>
                    </TH>
                  ) : null}
                </tr>
              </THead>
              <TBody>
                {teams.map((team) => {
                  const isSelected = selectedId === team.id;
                  return (
                    <TR
                      key={team.id}
                      onActivate={() => toggleTeam(team.id)}
                      aria-pressed={isSelected}
                      className={cn(isSelected && '[&>td]:bg-chalk')}
                    >
                      <TD className="font-medium">{team.name}</TD>
                      <TD>
                        {team.leader ? (
                          displayName(team.leader)
                        ) : (
                          <span className="text-muted">{t('teams.noLeader')}</span>
                        )}
                      </TD>
                      <TD numeric>{team.memberCount ?? 0}</TD>
                      <TD className="tnum whitespace-nowrap text-muted">{formatDate(team.createdAt)}</TD>
                      {canManage ? (
                        <TD onClick={stopRowActivation} onKeyDown={stopRowActivation}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="quiet"
                                size="iconSm"
                                aria-label={t('teams.rowActions', { name: team.name })}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onSelect={() => openEdit(team)}>
                                <Pencil />
                                {t('teams.edit')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-bad [&_svg]:text-bad"
                                onSelect={() => {
                                  void removeTeam(team);
                                }}
                              >
                                <Trash2 />
                                {t('teams.delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('teams.count', { count: teams.length })}</span>
            <span>{t('teams.openHint')}</span>
          </CardFooter>
        </DataState>
      </Card>

      {selectedId ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {t('teams.membersOf', { name: detail?.name ?? selectedTeam?.name ?? '' })}
              <CardCount>({memberRows.length})</CardCount>
            </CardTitle>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setSelectedId(null);
                setDetail(null);
                setDetailError('');
              }}
            >
              <X />
              {t('common:actions.close')}
            </Button>
          </CardHeader>

          <DataState
            isLoading={detailLoading}
            error={detailError || null}
            onRetry={() => fetchDetail(selectedId)}
            isEmpty={memberRows.length === 0}
            loading={<TableSkeleton rows={3} cols={3} />}
            empty={
              <EmptyState
                icon={<Users className="size-5" />}
                title={t('teams.noMembers')}
                description={canManage ? t('teams.noMembersHelp') : undefined}
              />
            }
          >
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>{t('employees.table.name')}</TH>
                    <TH>{t('employees.table.email')}</TH>
                    <TH>{t('employees.table.role')}</TH>
                    {canManage ? (
                      <TH className="w-11">
                        <span className="sr-only">{t('teams.removeMember')}</span>
                      </TH>
                    ) : null}
                  </tr>
                </THead>
                <TBody>
                  {memberRows.map((member) => (
                    <TR key={member.userId}>
                      <TD className="font-medium">{displayName(member.user)}</TD>
                      <TD className="text-muted">{member.user.email}</TD>
                      <TD>{member.user.role ? <RoleBadge role={member.user.role} /> : '—'}</TD>
                      {canManage ? (
                        <TD>
                          <Button
                            variant="quiet"
                            size="iconSm"
                            className="text-bad hover:bg-bad-bg"
                            title={t('teams.removeMember')}
                            aria-label={t('teams.removeMember')}
                            onClick={() => removeMember(selectedId, member.userId)}
                          >
                            <UserMinus />
                          </Button>
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </DataState>

          {canManage ? (
            <div className="flex flex-wrap items-end gap-2.5 border-t border-line-soft p-3.5">
              <Field className="min-w-[220px] flex-1" label={t('teams.addMember')} htmlFor="hr-add-member">
                <Select
                  id="hr-add-member"
                  value={addMemberUserId}
                  onChange={(e) => setAddMemberUserId(e.target.value)}
                >
                  <option value="">{t('teams.selectEmployee')}</option>
                  {available.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {displayName(emp)} ({roleLabel(emp.role)})
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                onClick={() => addMember(selectedId)}
                disabled={!addMemberUserId || addMemberPending}
              >
                <UserPlus />
                {addMemberPending ? t('teams.adding') : t('common:actions.add')}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Create a team */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('teams.createTitle')}</DialogTitle>
            <DialogDescription>{t('teams.createHelp')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('teams.name')} htmlFor="hr-team-name" required>
              <Input
                id="hr-team-name"
                placeholder={t('teams.namePlaceholder')}
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              />
            </Field>
            <Field label={t('teams.leader')} htmlFor="hr-team-leader">
              <Select
                id="hr-team-leader"
                value={createForm.leaderId}
                onChange={(e) => setCreateForm({ ...createForm, leaderId: e.target.value })}
              >
                <option value="">{t('teams.noLeader')}</option>
                {pickerEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {displayName(emp)} ({roleLabel(emp.role)})
                  </option>
                ))}
              </Select>
            </Field>
            {createError ? (
              <p role="alert" className="text-[13px] text-bad">
                {createError}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={createPending || !createForm.name.trim()}
              onClick={submitCreate}
            >
              {createPending ? t('teams.creating') : t('teams.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename a team / change its leader */}
      <Dialog
        open={editTeam !== null}
        onOpenChange={(open) => {
          if (!open) setEditTeam(null);
        }}
      >
        <DialogContent>
          {editTeam ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('teams.edit')}</DialogTitle>
                <DialogDescription>{t('teams.editHelp')}</DialogDescription>
              </DialogHeader>
              <DialogBody>
                <Field label={t('teams.name')} htmlFor="hr-team-edit-name">
                  <Input
                    id="hr-team-edit-name"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </Field>
                <Field label={t('teams.leader')} htmlFor="hr-team-edit-leader">
                  <Select
                    id="hr-team-edit-leader"
                    value={editForm.leaderId}
                    onChange={(e) => setEditForm({ ...editForm, leaderId: e.target.value })}
                  >
                    <option value="">{t('teams.noLeader')}</option>
                    {pickerEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {displayName(emp)} ({roleLabel(emp.role)})
                      </option>
                    ))}
                  </Select>
                </Field>
                {editError ? (
                  <p role="alert" className="text-[13px] text-bad">
                    {editError}
                  </p>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setEditTeam(null)}>
                  {t('common:actions.cancel')}
                </Button>
                <Button
                  variant="primary"
                  disabled={editPending}
                  onClick={() => submitEdit(editTeam.id)}
                >
                  {editPending ? t('common:actions.saving') : t('common:actions.save')}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Collaborateurs (office-only tab)                                   */
/* ------------------------------------------------------------------ */

const ACTIVE_FILTERS = ['', 'true', 'false'] as const;
type ActiveFilter = (typeof ACTIVE_FILTERS)[number];

function EmployeesPanel() {
  const { t } = useTranslation('hr');
  const confirm = useConfirm();
  const { role, id: currentUserId } = useCurrentUser();
  // Creating, inviting, (de)activating an account and setting a role or a licence are
  // the administrator's job (PRD §18.2); a project manager reads the directory.
  const isAdmin = role === 'ADMIN';

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('');

  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const [editing, setEditing] = useState<Employee | null>(null);
  const [editForm, setEditForm] = useState({ role: '', hourlyRate: '', isActive: true });
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [newEmp, setNewEmp] = useState<NewEmployeeForm>(EMPTY_EMPLOYEE);
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState('');
  const [seats, setSeats] = useState<SeatAvailability | null>(null);
  const [teamOptions, setTeamOptions] = useState<Team[]>([]);

  /* ---------- data ---------- */

  const fetchEmployees = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: '100' });
    if (search) params.set('search', search);
    if (roleFilter) params.set('role', roleFilter);
    if (activeFilter) params.set('isActive', activeFilter);
    apiGet<Employee[]>(`/hr/employees?${params.toString()}`)
      .then((list) => setEmployees(list ?? []))
      .catch((err) => setError(errorMessage(err, t('messages.loadEmployeesFailed'))))
      .finally(() => setLoading(false));
  }, [search, roleFilter, activeFilter, t]);

  const fetchSeats = useCallback(() => {
    apiGet<SeatAvailability>('/subscription/seats')
      .then(setSeats)
      .catch(() => setSeats(null));
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  /* ---------- actions ---------- */

  const openAdd = () => {
    setAddOpen(true);
    setNewEmp(EMPTY_EMPLOYEE);
    setAddError('');
    fetchSeats();
    apiGet<Team[]>('/hr/teams?limit=100')
      .then((list) => setTeamOptions(list ?? []))
      .catch(() => setTeamOptions([]));
  };

  const setNewEmpField = (field: keyof NewEmployeeForm, value: string) =>
    setNewEmp((prev) => ({ ...prev, [field]: value }));

  const submitAdd = () => {
    if (!newEmp.firstName.trim() || !newEmp.lastName.trim() || !newEmp.email.trim()) {
      setAddError(t('messages.requiredFields'));
      return;
    }
    // CHF → integer centimes
    const hourlyRateCents =
      newEmp.hourlyRate.trim() === '' ? undefined : Math.round(parseFloat(newEmp.hourlyRate) * 100);
    if (hourlyRateCents !== undefined && (!Number.isFinite(hourlyRateCents) || hourlyRateCents < 0)) {
      setAddError(t('messages.invalidHourlyRate'));
      return;
    }
    const email = newEmp.email.trim().toLowerCase();
    const body: Record<string, unknown> = {
      firstName: newEmp.firstName.trim(),
      lastName: newEmp.lastName.trim(),
      email,
      role: newEmp.role,
    };
    if (newEmp.licenceTier) body.licenceTier = newEmp.licenceTier;
    if (hourlyRateCents !== undefined) body.hourlyRateCents = hourlyRateCents;
    if (newEmp.phone.trim()) body.phone = newEmp.phone.trim();
    if (newEmp.cctCode.trim()) body.cctCode = newEmp.cctCode.trim();
    if (newEmp.hireDate) body.hireDate = newEmp.hireDate;
    if (newEmp.teamId) body.teamId = newEmp.teamId;

    setAddPending(true);
    setAddError('');
    apiPost<Employee>('/hr/employees', body)
      .then(() => {
        setAddOpen(false);
        setNewEmp(EMPTY_EMPLOYEE);
        setNotice({ kind: 'success', text: t('messages.inviteSent', { email }) });
        fetchEmployees();
      })
      .catch((err) => {
        setAddError(hrErrorMessage(err, t('messages.createEmployeeFailed')));
        fetchSeats();
      })
      .finally(() => setAddPending(false));
  };

  const runRowAction = async (emp: Employee, action: 'invite' | 'deactivate' | 'reactivate') => {
    if (action === 'deactivate') {
      const ok = await confirm({
        title: t('employees.confirmDeactivateTitle'),
        description: t('employees.confirmDeactivate', { name: displayName(emp) }),
        confirmLabel: t('employees.deactivate'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    setRowBusyId(emp.id);
    setNotice(null);
    apiPost<Employee>(`/hr/employees/${emp.id}/${action}`)
      .then(() => {
        const key = { invite: 'inviteSent', deactivate: 'deactivated', reactivate: 'reactivated' }[action];
        setNotice({
          kind: 'success',
          text: t(`messages.${key}`, { email: emp.email, name: displayName(emp) }),
        });
        if (action !== 'invite') fetchEmployees();
      })
      .catch((err) =>
        setNotice({ kind: 'error', text: hrErrorMessage(err, t(`messages.${action}Failed`)) }),
      )
      .finally(() => setRowBusyId(null));
  };

  const openEdit = (emp: Employee) => {
    setEditing(emp);
    // Edited in CHF, stored in centimes
    setEditForm({
      role: emp.role,
      hourlyRate: emp.hourlyRateCents != null ? (emp.hourlyRateCents / 100).toFixed(2) : '',
      isActive: emp.isActive,
    });
    setEditError('');
  };

  const submitEdit = (userId: string) => {
    // CHF → integer centimes; empty clears the rate
    const hourlyRateCents =
      editForm.hourlyRate.trim() === '' ? null : Math.round(parseFloat(editForm.hourlyRate) * 100);
    if (hourlyRateCents != null && (!Number.isFinite(hourlyRateCents) || hourlyRateCents < 0)) {
      setEditError(t('messages.invalidHourlyRate'));
      return;
    }
    setEditPending(true);
    setEditError('');
    const body: { hourlyRateCents: number | null; role: string; isActive: boolean } = {
      hourlyRateCents,
      role: editForm.role,
      isActive: editForm.isActive,
    };
    apiPut(`/hr/employees/${userId}`, body)
      .then(() => {
        setEditing(null);
        fetchEmployees();
      })
      .catch((err) =>
        setEditError(
          err instanceof ApiError && err.status === 403
            ? t('messages.adminOnly')
            : hrErrorMessage(err, t('messages.updateEmployeeFailed')),
        ),
      )
      .finally(() => setEditPending(false));
  };

  /* ---------- render ---------- */

  const filtered = Boolean(search.trim() || roleFilter || activeFilter);

  return (
    <div className="grid gap-5">
      {notice ? (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'flex flex-wrap items-center justify-between gap-2.5 rounded-card border border-line px-3.5 py-2.5 text-[13px]',
            notice.kind === 'error' ? 'bg-bad-bg text-bad' : 'bg-ok-bg text-ok',
          )}
        >
          <span>{notice.text}</span>
          <Button
            variant="quiet"
            size="iconSm"
            className="text-current"
            aria-label={t('common:actions.close')}
            onClick={() => setNotice(null)}
          >
            <X />
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {t('employees.title')}
            {employees.length > 0 ? <CardCount>({employees.length})</CardCount> : null}
          </CardTitle>
          {isAdmin ? (
            <Button variant="primary" onClick={openAdd}>
              <Plus />
              {t('employees.add')}
            </Button>
          ) : null}
        </CardHeader>

        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft p-3">
          <div className="flex flex-wrap gap-0.5" role="group" aria-label={t('employees.statusFilter')}>
            {ACTIVE_FILTERS.map((value) => (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={activeFilter === value}
                onClick={() => setActiveFilter(value)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:text-ink',
                  activeFilter === value && 'bg-chalk font-medium text-ink',
                )}
              >
                {value === '' ? t('common:actions.all') : t(value === 'true' ? 'active' : 'inactive')}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Select
              className="w-auto min-w-[160px]"
              aria-label={t('employees.roleFilter')}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">{t('employees.allRoles')}</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </Select>
            <SearchInput
              icon={<Search className="size-4" />}
              placeholder={t('employees.searchPlaceholder')}
              aria-label={t('employees.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <DataState
          isLoading={loading}
          error={error || null}
          onRetry={fetchEmployees}
          isEmpty={employees.length === 0}
          loading={<TableSkeleton rows={6} cols={6} />}
          empty={
            filtered ? (
              <EmptyState
                icon={<Users className="size-5" />}
                title={t('employees.noMatch')}
                description={t('employees.noMatchHelp')}
              />
            ) : (
              <EmptyState
                icon={<Users className="size-5" />}
                title={t('employees.empty')}
                description={t('employees.emptyHelp')}
                action={
                  isAdmin ? (
                    <Button variant="ghost" size="sm" onClick={openAdd}>
                      <Plus />
                      {t('employees.add')}
                    </Button>
                  ) : undefined
                }
              />
            )
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('employees.table.name')}</TH>
                  <TH>{t('employees.table.email')}</TH>
                  <TH>{t('employees.table.role')}</TH>
                  <TH numeric>{t('employees.table.hourlyRate')}</TH>
                  <TH>{t('employees.table.cctCode')}</TH>
                  <TH>{t('employees.table.status')}</TH>
                  {isAdmin ? (
                    <TH className="w-11">
                      <span className="sr-only">{t('employees.table.actions')}</span>
                    </TH>
                  ) : null}
                </tr>
              </THead>
              <TBody>
                {employees.map((emp) => (
                  <TR
                    key={emp.id}
                    onActivate={isAdmin ? () => openEdit(emp) : undefined}
                    className={cn(editing?.id === emp.id && '[&>td]:bg-chalk')}
                  >
                    <TD className="font-medium">
                      {[emp.firstName, emp.lastName].filter(Boolean).join(' ') || '—'}
                    </TD>
                    <TD className="text-muted">{emp.email}</TD>
                    <TD>
                      <RoleBadge role={emp.role} />
                    </TD>
                    <TD numeric>
                      {emp.hourlyRateCents != null ? (
                        formatMoney(emp.hourlyRateCents)
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </TD>
                    <TD className="text-muted">{emp.cctCode ?? '—'}</TD>
                    <TD>
                      <AccountBadge isActive={emp.isActive} />
                    </TD>
                    {isAdmin ? (
                      <TD onClick={stopRowActivation} onKeyDown={stopRowActivation}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="quiet"
                              size="iconSm"
                              aria-label={t('employees.rowActions', { name: displayName(emp) })}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              disabled={rowBusyId === emp.id}
                              onSelect={() => openEdit(emp)}
                            >
                              <Pencil />
                              {t('common:actions.edit')}
                            </DropdownMenuItem>
                            {emp.isActive ? (
                              <DropdownMenuItem
                                disabled={rowBusyId === emp.id}
                                onSelect={() => {
                                  void runRowAction(emp, 'invite');
                                }}
                              >
                                <Send />
                                {t('employees.resendInvite')}
                              </DropdownMenuItem>
                            ) : null}
                            {emp.isActive && emp.id !== currentUserId ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-bad [&_svg]:text-bad"
                                  disabled={rowBusyId === emp.id}
                                  onSelect={() => {
                                    void runRowAction(emp, 'deactivate');
                                  }}
                                >
                                  <UserMinus />
                                  {t('employees.deactivate')}
                                </DropdownMenuItem>
                              </>
                            ) : null}
                            {!emp.isActive ? (
                              <DropdownMenuItem
                                disabled={rowBusyId === emp.id}
                                onSelect={() => {
                                  void runRowAction(emp, 'reactivate');
                                }}
                              >
                                <UserCheck />
                                {t('employees.reactivate')}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('employees.count', { count: employees.length })}</span>
            <span>{t('employees.footerHint')}</span>
          </CardFooter>
        </DataState>
      </Card>

      {/* Role, hourly rate and account status — admin only in the API */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent>
          {editing ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('employees.edit.title')}</DialogTitle>
                <DialogDescription>
                  {t('employees.edit.help', { name: displayName(editing) })}
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <Field label={t('employees.table.role')} htmlFor="hr-edit-role">
                  <Select
                    id="hr-edit-role"
                    value={editForm.role}
                    onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('employees.edit.hourlyRate')}
                  htmlFor="hr-edit-rate"
                  hint={t('employees.edit.hourlyRateHint')}
                >
                  <Input
                    id="hr-edit-rate"
                    type="number"
                    min="0"
                    step="0.05"
                    inputMode="decimal"
                    value={editForm.hourlyRate}
                    onChange={(e) => setEditForm({ ...editForm, hourlyRate: e.target.value })}
                  />
                </Field>
                <Field
                  label={t('employees.edit.status')}
                  htmlFor="hr-edit-active"
                  hint={t('employees.edit.statusHint')}
                >
                  <Select
                    id="hr-edit-active"
                    value={editForm.isActive ? 'true' : 'false'}
                    onChange={(e) => setEditForm({ ...editForm, isActive: e.target.value === 'true' })}
                  >
                    <option value="true">{t('active')}</option>
                    <option value="false">{t('inactive')}</option>
                  </Select>
                </Field>
                {editError ? (
                  <p role="alert" className="text-[13px] text-bad">
                    {editError}
                  </p>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  {t('common:actions.cancel')}
                </Button>
                <Button
                  variant="primary"
                  disabled={editPending}
                  onClick={() => submitEdit(editing.id)}
                >
                  {editPending ? t('common:actions.saving') : t('common:actions.save')}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Create an account and send its invitation — admin only in the API */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('employees.form.title')}</DialogTitle>
            <DialogDescription>{t('employees.form.inviteHint')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {seats ? (
              <p className={cn('text-[13px]', seats.available > 0 ? 'text-muted' : 'text-bad')}>
                {t('employees.form.seats', { used: seats.used, total: seats.total })}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('employees.form.firstName')} htmlFor="hr-new-first" required>
                <Input
                  id="hr-new-first"
                  autoComplete="off"
                  value={newEmp.firstName}
                  onChange={(e) => setNewEmpField('firstName', e.target.value)}
                />
              </Field>
              <Field label={t('employees.form.lastName')} htmlFor="hr-new-last" required>
                <Input
                  id="hr-new-last"
                  autoComplete="off"
                  value={newEmp.lastName}
                  onChange={(e) => setNewEmpField('lastName', e.target.value)}
                />
              </Field>
              <Field
                className="sm:col-span-2"
                label={t('employees.form.email')}
                htmlFor="hr-new-email"
                required
              >
                <Input
                  id="hr-new-email"
                  type="email"
                  autoComplete="off"
                  placeholder={t('employees.form.emailPlaceholder')}
                  value={newEmp.email}
                  onChange={(e) => setNewEmpField('email', e.target.value)}
                />
              </Field>
              <Field label={t('employees.form.role')} htmlFor="hr-new-role" required>
                <Select
                  id="hr-new-role"
                  value={newEmp.role}
                  onChange={(e) => setNewEmpField('role', e.target.value)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('employees.form.licence')} htmlFor="hr-new-licence">
                <Select
                  id="hr-new-licence"
                  value={newEmp.licenceTier}
                  onChange={(e) => setNewEmpField('licenceTier', e.target.value)}
                >
                  <option value="">{t('employees.form.licenceAuto')}</option>
                  {LICENCE_TIERS.map((tier) => (
                    <option key={tier} value={tier}>
                      {t(`common:licence.${tier}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('employees.form.hourlyRate')} htmlFor="hr-new-rate">
                <Input
                  id="hr-new-rate"
                  type="number"
                  min="0"
                  step="0.05"
                  inputMode="decimal"
                  value={newEmp.hourlyRate}
                  onChange={(e) => setNewEmpField('hourlyRate', e.target.value)}
                />
              </Field>
              <Field label={t('employees.form.phone')} htmlFor="hr-new-phone">
                <Input
                  id="hr-new-phone"
                  type="tel"
                  value={newEmp.phone}
                  onChange={(e) => setNewEmpField('phone', e.target.value)}
                />
              </Field>
              <Field label={t('employees.form.cctCode')} htmlFor="hr-new-cct">
                <Input
                  id="hr-new-cct"
                  value={newEmp.cctCode}
                  onChange={(e) => setNewEmpField('cctCode', e.target.value)}
                />
              </Field>
              <Field label={t('employees.form.hireDate')} htmlFor="hr-new-hire">
                <Input
                  id="hr-new-hire"
                  type="date"
                  value={newEmp.hireDate}
                  onChange={(e) => setNewEmpField('hireDate', e.target.value)}
                />
              </Field>
              <Field label={t('employees.form.team')} htmlFor="hr-new-team">
                <Select
                  id="hr-new-team"
                  value={newEmp.teamId}
                  onChange={(e) => setNewEmpField('teamId', e.target.value)}
                >
                  <option value="">{t('employees.form.noTeam')}</option>
                  {teamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {addError ? (
              <p role="alert" className="text-[13px] text-bad">
                {addError}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="primary" disabled={addPending} onClick={submitAdd}>
              {addPending ? t('employees.form.submitting') : t('employees.form.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
