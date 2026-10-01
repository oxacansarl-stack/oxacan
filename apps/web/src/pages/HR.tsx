import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatMoney } from '../lib/format';
import { useCurrentUser } from '../lib/current-user';

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
/*  Style constants                                                    */
/* ------------------------------------------------------------------ */

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  ...btnPrimary,
  background: '#dc2626',
};

const btnOutline: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '2px solid #e5e7eb',
  fontSize: 13,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #f3f4f6',
  fontSize: 14,
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ROLE_COLORS: Record<string, { bg: string; fg: string }> = {
  ADMIN: { bg: '#ede9fe', fg: '#7c3aed' },
  PROJECT_MANAGER: { bg: '#dbeafe', fg: '#2563eb' },
  TEAM_LEADER: { bg: '#d1fae5', fg: '#059669' },
  WORKER: { bg: '#fef3c7', fg: '#d97706' },
};

/** app_user.role CHECK values */
const ROLES = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER'] as const;
const LICENCE_TIERS = ['saas', 'application'] as const;

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

function roleBadge(role: string): React.ReactNode {
  const colors = ROLE_COLORS[role] ?? { bg: '#f3f4f6', fg: '#374151' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        background: colors.bg,
        color: colors.fg,
      }}
    >
      {roleLabel(role)}
    </span>
  );
}

function activeBadge(isActive: boolean): React.ReactNode {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        background: isActive ? '#dcfce7' : '#fee2e2',
        color: isActive ? '#166534' : '#991b1b',
      }}
    >
      {isActive ? i18n.t('active', { ns: 'hr' }) : i18n.t('inactive', { ns: 'hr' })}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function HR() {
  const { t } = useTranslation('hr');
  // The employee directory (with pay rates) is office-only; team leaders see their teams.
  const { role, id: currentUserId } = useCurrentUser();
  const isOffice = role === 'ADMIN' || role === 'PROJECT_MANAGER';
  // Creating, inviting and (de)activating accounts is the administrator's job (PRD §18.2).
  const isAdmin = role === 'ADMIN';
  const [activeTab, setActiveTab] = useState<'teams' | 'employees'>('teams');

  /* ============ TEAMS STATE ============ */
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState('');
  const [teamsSearch, setTeamsSearch] = useState('');

  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [teamDetail, setTeamDetail] = useState<TeamDetail | null>(null);
  const [teamDetailLoading, setTeamDetailLoading] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createLeaderId, setCreateLeaderId] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editTeamName, setEditTeamName] = useState('');
  const [editTeamLeaderId, setEditTeamLeaderId] = useState('');
  const [editTeamLoading, setEditTeamLoading] = useState(false);

  const [addMemberUserId, setAddMemberUserId] = useState('');
  const [addMemberLoading, setAddMemberLoading] = useState(false);

  /* ============ EMPLOYEES STATE ============ */
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeesError, setEmployeesError] = useState('');
  const [empSearch, setEmpSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'' | 'true' | 'false'>('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editHourlyRate, setEditHourlyRate] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  /* Add employee (admin) */
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmp, setNewEmp] = useState<NewEmployeeForm>(EMPTY_EMPLOYEE);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [seats, setSeats] = useState<SeatAvailability | null>(null);
  const [teamOptions, setTeamOptions] = useState<Team[]>([]);

  /* Row actions: resend invitation, deactivate, reactivate */
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  /* Employees list is also used in team dropdowns */
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);

  /* ============ DATA FETCHING ============ */

  const fetchTeams = useCallback(() => {
    setTeamsLoading(true);
    setTeamsError('');
    const params = new URLSearchParams({ limit: '100' });
    if (teamsSearch) params.set('search', teamsSearch);
    apiGet<Team[]>(`/hr/teams?${params.toString()}`)
      .then((list) => setTeams(list ?? []))
      .catch((err) => setTeamsError(errorMessage(err, t('messages.loadTeamsFailed'))))
      .finally(() => setTeamsLoading(false));
  }, [teamsSearch]);

  const fetchEmployees = useCallback(() => {
    setEmployeesLoading(true);
    setEmployeesError('');
    const params = new URLSearchParams({ limit: '100' });
    if (empSearch) params.set('search', empSearch);
    if (roleFilter) params.set('role', roleFilter);
    if (activeFilter) params.set('isActive', activeFilter);
    apiGet<Employee[]>(`/hr/employees?${params.toString()}`)
      .then((list) => setEmployees(list ?? []))
      .catch((err) => setEmployeesError(errorMessage(err, t('messages.loadEmployeesFailed'))))
      .finally(() => setEmployeesLoading(false));
  }, [empSearch, roleFilter, activeFilter]);

  const fetchAllEmployees = useCallback(() => {
    // Office roles only; a team leader gets 403 and the pickers stay empty.
    apiGet<Employee[]>('/hr/employees?isActive=true&limit=200')
      .then((list) => setAllEmployees(list ?? []))
      .catch(() => {});
  }, []);

  const fetchTeamDetail = useCallback((teamId: string) => {
    setTeamDetailLoading(true);
    apiGet<TeamDetail>(`/hr/teams/${teamId}`)
      .then((detail) => {
        setTeamDetail(detail);
        setEditTeamName(detail.name);
        setEditTeamLeaderId(detail.leaderId ?? '');
      })
      .catch(() => setTeamDetail(null))
      .finally(() => setTeamDetailLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === 'teams') {
      fetchTeams();
      if (isOffice) fetchAllEmployees();
    }
  }, [activeTab, fetchTeams, fetchAllEmployees, isOffice]);

  useEffect(() => {
    if (activeTab === 'employees') {
      fetchEmployees();
    }
  }, [activeTab, fetchEmployees]);

  /* ============ TEAM ACTIONS ============ */

  const handleCreateTeam = () => {
    if (!createName.trim()) return;
    setCreateLoading(true);
    setCreateError('');
    const body: { name: string; leaderId?: string } = { name: createName.trim() };
    if (createLeaderId) body.leaderId = createLeaderId;
    apiPost('/hr/teams', body)
      .then(() => {
        setCreateName('');
        setCreateLeaderId('');
        setShowCreateForm(false);
        fetchTeams();
      })
      .catch((err) => setCreateError(errorMessage(err, t('messages.createTeamFailed'))))
      .finally(() => setCreateLoading(false));
  };

  const handleUpdateTeam = (teamId: string) => {
    setEditTeamLoading(true);
    // null removes the leader
    const body: { name?: string; leaderId: string | null } = { leaderId: editTeamLeaderId || null };
    if (editTeamName.trim()) body.name = editTeamName.trim();
    apiPut(`/hr/teams/${teamId}`, body)
      .then(() => {
        fetchTeams();
        fetchTeamDetail(teamId);
      })
      .catch((err) => alert(errorMessage(err, t('messages.updateTeamFailed'))))
      .finally(() => setEditTeamLoading(false));
  };

  const handleDeleteTeam = (teamId: string) => {
    if (!window.confirm(t('teams.confirmDelete'))) return;
    apiDelete(`/hr/teams/${teamId}`)
      .then(() => {
        setExpandedTeamId(null);
        setTeamDetail(null);
        fetchTeams();
      })
      .catch((err) => alert(errorMessage(err, t('messages.deleteTeamFailed'))));
  };

  const handleAddMember = (teamId: string) => {
    if (!addMemberUserId) return;
    setAddMemberLoading(true);
    apiPost(`/hr/teams/${teamId}/members`, { userId: addMemberUserId })
      .then(() => {
        setAddMemberUserId('');
        fetchTeamDetail(teamId);
        fetchTeams();
      })
      .catch((err) => alert(errorMessage(err, t('messages.addMemberFailed'))))
      .finally(() => setAddMemberLoading(false));
  };

  const handleRemoveMember = (teamId: string, userId: string) => {
    apiDelete(`/hr/teams/${teamId}/members/${userId}`)
      .then(() => {
        fetchTeamDetail(teamId);
        fetchTeams();
      })
      .catch((err) => alert(errorMessage(err, t('messages.removeMemberFailed'))));
  };

  const handleExpandTeam = (teamId: string) => {
    if (expandedTeamId === teamId) {
      setExpandedTeamId(null);
      setTeamDetail(null);
    } else {
      setExpandedTeamId(teamId);
      fetchTeamDetail(teamId);
    }
  };

  /* ============ EMPLOYEE ACTIONS ============ */

  const fetchSeats = useCallback(() => {
    apiGet<SeatAvailability>('/subscription/seats')
      .then(setSeats)
      .catch(() => setSeats(null));
  }, []);

  const openAddEmployee = () => {
    setShowAddEmployee(true);
    setNewEmp(EMPTY_EMPLOYEE);
    setAddError('');
    fetchSeats();
    apiGet<Team[]>('/hr/teams?limit=100')
      .then((list) => setTeamOptions(list ?? []))
      .catch(() => setTeamOptions([]));
  };

  const setNewEmpField = (field: keyof NewEmployeeForm, value: string) =>
    setNewEmp((prev) => ({ ...prev, [field]: value }));

  const handleCreateEmployee = () => {
    if (!newEmp.firstName.trim() || !newEmp.lastName.trim() || !newEmp.email.trim()) {
      setAddError(t('messages.requiredFields'));
      return;
    }
    // CHF → integer centimes
    const hourlyRateCents = newEmp.hourlyRate.trim() === '' ? undefined : Math.round(parseFloat(newEmp.hourlyRate) * 100);
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

    setAddLoading(true);
    setAddError('');
    apiPost<Employee>('/hr/employees', body)
      .then(() => {
        setShowAddEmployee(false);
        setNewEmp(EMPTY_EMPLOYEE);
        setNotice({ kind: 'success', text: t('messages.inviteSent', { email }) });
        fetchEmployees();
        fetchAllEmployees();
      })
      .catch((err) => {
        setAddError(hrErrorMessage(err, t('messages.createEmployeeFailed')));
        fetchSeats();
      })
      .finally(() => setAddLoading(false));
  };

  const runRowAction = (emp: Employee, action: 'invite' | 'deactivate' | 'reactivate') => {
    if (action === 'deactivate' && !window.confirm(t('employees.confirmDeactivate', { name: displayName(emp) }))) return;
    setRowBusyId(emp.id);
    setNotice(null);
    apiPost<Employee>(`/hr/employees/${emp.id}/${action}`)
      .then(() => {
        const key = { invite: 'inviteSent', deactivate: 'deactivated', reactivate: 'reactivated' }[action];
        setNotice({ kind: 'success', text: t(`messages.${key}`, { email: emp.email, name: displayName(emp) }) });
        if (action !== 'invite') {
          fetchEmployees();
          fetchAllEmployees();
        }
      })
      .catch((err) => setNotice({ kind: 'error', text: hrErrorMessage(err, t(`messages.${action}Failed`)) }))
      .finally(() => setRowBusyId(null));
  };

  const startEditing = (emp: Employee) => {
    setEditingId(emp.id);
    setEditRole(emp.role);
    // Edited in CHF, stored in centimes
    setEditHourlyRate(emp.hourlyRateCents != null ? (emp.hourlyRateCents / 100).toFixed(2) : '');
    setEditIsActive(emp.isActive);
    setEditError('');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditError('');
  };

  const handleSaveEmployee = (userId: string) => {
    // CHF → integer centimes; empty clears the rate
    const hourlyRateCents = editHourlyRate.trim() === '' ? null : Math.round(parseFloat(editHourlyRate) * 100);
    if (hourlyRateCents != null && (!Number.isFinite(hourlyRateCents) || hourlyRateCents < 0)) {
      setEditError(t('messages.invalidHourlyRate'));
      return;
    }
    setEditLoading(true);
    setEditError('');
    const body: { hourlyRateCents: number | null; role: string; isActive: boolean } = {
      hourlyRateCents,
      role: editRole,
      isActive: editIsActive,
    };
    apiPut(`/hr/employees/${userId}`, body)
      .then(() => {
        setEditingId(null);
        fetchEmployees();
        fetchAllEmployees();
      })
      .catch((err) =>
        setEditError(
          err instanceof ApiError && err.status === 403
            ? t('messages.adminOnly')
            : hrErrorMessage(err, t('messages.updateEmployeeFailed')),
        ),
      )
      .finally(() => setEditLoading(false));
  };

  /* ============ RENDER ============ */

  const tabStyle = (tab: 'teams' | 'employees'): React.CSSProperties => ({
    padding: '10px 24px',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    borderBottom: activeTab === tab ? '3px solid #2563eb' : '3px solid transparent',
    background: 'none',
    color: activeTab === tab ? '#2563eb' : '#6b7280',
    transition: 'color 0.15s, border-color 0.15s',
  });

  return (
    <div>
      {/* Page header */}
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0, marginBottom: 16 }}>
        {t('title')}
      </h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: 24 }}>
        <button style={tabStyle('teams')} onClick={() => setActiveTab('teams')}>
          {t('tabs.teams')}
        </button>
        {isOffice && (
          <button style={tabStyle('employees')} onClick={() => setActiveTab('employees')}>
            {t('tabs.employees')}
          </button>
        )}
      </div>

      {/* ================= TEAMS TAB ================= */}
      {activeTab === 'teams' && (
        <div>
          {/* Teams header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: 0 }}>{t('teams.title')}</h2>
              <input
                style={{ ...inputStyle, maxWidth: 260 }}
                placeholder={t('teams.searchPlaceholder')}
                value={teamsSearch}
                onChange={(e) => setTeamsSearch(e.target.value)}
              />
            </div>
            <button style={btnPrimary} onClick={() => setShowCreateForm(!showCreateForm)}>
              {showCreateForm ? t('common:actions.cancel') : t('teams.new')}
            </button>
          </div>

          {/* Create team form */}
          {showCreateForm && (
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 20,
                marginBottom: 20,
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                    {t('teams.nameRequired')}
                  </label>
                  <input
                    style={inputStyle}
                    placeholder={t('teams.namePlaceholder')}
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                    {t('teams.leader')}
                  </label>
                  <select
                    style={inputStyle}
                    value={createLeaderId}
                    onChange={(e) => setCreateLeaderId(e.target.value)}
                  >
                    <option value="">{t('teams.noLeader')}</option>
                    {allEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {displayName(emp)} ({roleLabel(emp.role)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  style={btnPrimary}
                  onClick={handleCreateTeam}
                  disabled={createLoading || !createName.trim()}
                >
                  {createLoading ? t('teams.creating') : t('teams.create')}
                </button>
                {createError && (
                  <span style={{ color: '#ef4444', fontSize: 13 }}>{createError}</span>
                )}
              </div>
            </div>
          )}

          {/* Teams list */}
          {teamsLoading ? (
            <div style={{ color: '#6b7280', padding: 20 }}>{t('teams.loading')}</div>
          ) : teamsError ? (
            <div style={{ color: '#ef4444', padding: 20 }}>{teamsError}</div>
          ) : teams.length === 0 ? (
            <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>
              {t('teams.empty')}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {teams.map((team) => (
                <React.Fragment key={team.id}>
                  {/* Team card */}
                  <div
                    onClick={() => handleExpandTeam(team.id)}
                    style={{
                      background: expandedTeamId === team.id ? '#eff6ff' : '#fff',
                      border: expandedTeamId === team.id ? '2px solid #2563eb' : '1px solid #e5e7eb',
                      borderRadius: 8,
                      padding: 16,
                      cursor: 'pointer',
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                    onMouseOver={(e) => {
                      if (expandedTeamId !== team.id) {
                        (e.currentTarget as HTMLElement).style.borderColor = '#93c5fd';
                      }
                    }}
                    onMouseOut={(e) => {
                      if (expandedTeamId !== team.id) {
                        (e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb';
                      }
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#111827', marginBottom: 6 }}>
                      {team.name}
                    </div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
                      {team.leader
                        ? t('teams.leaderLabel', { name: displayName(team.leader) })
                        : t('teams.noLeader')}
                    </div>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                        background: '#dbeafe',
                        color: '#1e40af',
                      }}
                    >
                      {t('teams.memberCount', { count: team.memberCount ?? 0 })}
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {expandedTeamId === team.id && (
                    <div
                      style={{
                        gridColumn: '1 / -1',
                        background: '#f9fafb',
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                        padding: 20,
                      }}
                    >
                      {teamDetailLoading ? (
                        <div style={{ color: '#6b7280' }}>{t('teams.loadingDetail')}</div>
                      ) : teamDetail ? (
                        <div>
                          {/* Edit team name & leader */}
                          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20 }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                                {t('teams.name')}
                              </label>
                              <input
                                style={inputStyle}
                                value={editTeamName}
                                onChange={(e) => setEditTeamName(e.target.value)}
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                                {t('teams.leader')}
                              </label>
                              <select
                                style={inputStyle}
                                value={editTeamLeaderId}
                                onChange={(e) => setEditTeamLeaderId(e.target.value)}
                              >
                                <option value="">{t('teams.noLeader')}</option>
                                {allEmployees.map((emp) => (
                                  <option key={emp.id} value={emp.id}>
                                    {displayName(emp)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              style={btnPrimary}
                              onClick={() => handleUpdateTeam(team.id)}
                              disabled={editTeamLoading}
                            >
                              {editTeamLoading ? t('common:actions.saving') : t('common:actions.save')}
                            </button>
                            <button
                              style={btnDanger}
                              onClick={() => handleDeleteTeam(team.id)}
                            >
                              {t('teams.delete')}
                            </button>
                          </div>

                          {/* Members list */}
                          <h4 style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 12 }}>
                            {t('teams.members', { count: teamDetail.members?.length ?? 0 })}
                          </h4>

                          {(!teamDetail.members || teamDetail.members.length === 0) ? (
                            <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 16 }}>
                              {t('teams.noMembers')}
                            </div>
                          ) : (
                            <div style={{ marginBottom: 16 }}>
                              {teamDetail.members.map((m) => (
                                <div
                                  key={m.userId}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '8px 12px',
                                    borderBottom: '1px solid #f3f4f6',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <span style={{ fontWeight: 500, fontSize: 14, color: '#111827' }}>
                                      {displayName(m.user)}
                                    </span>
                                    <span style={{ fontSize: 13, color: '#6b7280' }}>
                                      {m.user.email}
                                    </span>
                                    {m.user.role && roleBadge(m.user.role)}
                                  </div>
                                  <button
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: '#ef4444',
                                      cursor: 'pointer',
                                      fontSize: 16,
                                      fontWeight: 700,
                                      padding: '4px 8px',
                                      borderRadius: 4,
                                    }}
                                    title={t('teams.removeMember')}
                                    aria-label={t('teams.removeMember')}
                                    onClick={() => handleRemoveMember(team.id, m.userId)}
                                  >
                                    X
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add member row */}
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            <select
                              style={{ ...inputStyle, maxWidth: 300 }}
                              value={addMemberUserId}
                              onChange={(e) => setAddMemberUserId(e.target.value)}
                            >
                              <option value="">{t('teams.selectEmployee')}</option>
                              {allEmployees
                                .filter(
                                  (emp) =>
                                    !teamDetail.members?.some((m) => m.userId === emp.id),
                                )
                                .map((emp) => (
                                  <option key={emp.id} value={emp.id}>
                                    {displayName(emp)} ({roleLabel(emp.role)})
                                  </option>
                                ))}
                            </select>
                            <button
                              style={btnOutline}
                              onClick={() => handleAddMember(team.id)}
                              disabled={!addMemberUserId || addMemberLoading}
                            >
                              {addMemberLoading ? t('teams.adding') : t('common:actions.add')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#ef4444' }}>{t('teams.detailFailed')}</div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= EMPLOYEES TAB ================= */}
      {activeTab === 'employees' && (
        <div>
          {/* Employees header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: 0 }}>
              {t('employees.title')}
            </h2>
            {isAdmin && (
              <button
                style={showAddEmployee ? btnOutline : btnPrimary}
                onClick={() => (showAddEmployee ? setShowAddEmployee(false) : openAddEmployee())}
              >
                {showAddEmployee ? t('common:actions.cancel') : t('employees.add')}
              </button>
            )}
          </div>

          {/* Add employee form (admin) */}
          {isAdmin && showAddEmployee && (
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 20,
                marginBottom: 20,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: 0 }}>{t('employees.form.title')}</h3>
                {seats && (
                  <span style={{ fontSize: 13, color: seats.available > 0 ? '#6b7280' : '#b91c1c' }}>
                    {t('employees.form.seats', { used: seats.used, total: seats.total })}
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                <div>
                  <label htmlFor="new-emp-first" style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{t('employees.form.firstName')}</label>
                  <input id="new-emp-first" style={inputStyle} autoComplete="off" value={newEmp.firstName} onChange={(e) => setNewEmpField('firstName', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="new-emp-last" style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{t('employees.form.lastName')}</label>
                  <input id="new-emp-last" style={inputStyle} autoComplete="off" value={newEmp.lastName} onChange={(e) => setNewEmpField('lastName', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="new-emp-email" style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{t('employees.form.email')}</label>
                  <input id="new-emp-email" style={inputStyle} type="email" autoComplete="off" placeholder={t('employees.form.emailPlaceholder')} value={newEmp.email} onChange={(e) => setNewEmpField('email', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="new-emp-role" style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{t('employees.form.role')}</label>
                  <select id="new-emp-role" style={inputStyle} value={newEmp.role} onChange={(e) => setNewEmpField('role', e.target.value)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="new-emp-licence" style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{t('employees.form.licence')}</label>
                  <select id="new-emp-licence" style={inputStyle} value={newEmp.licenceTier} onChange={(e) => setNewEmpField('licenceTier', e.target.value)}>
                    <option value="">{t('employees.form.licenceAuto')}</option>
                    {LICENCE_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {t(`common:licence.${tier}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="new-emp-rate" style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{t('employees.form.hourlyRate')}</label>
                  <input id="new-emp-rate" style={inputStyle} type="number" min="0" step="0.05" value={newEmp.hourlyRate} onChange={(e) => setNewEmpField('hourlyRate', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="new-emp-phone" style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{t('employees.form.phone')}</label>
                  <input id="new-emp-phone" style={inputStyle} type="tel" value={newEmp.phone} onChange={(e) => setNewEmpField('phone', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="new-emp-cct" style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{t('employees.form.cctCode')}</label>
                  <input id="new-emp-cct" style={inputStyle} value={newEmp.cctCode} onChange={(e) => setNewEmpField('cctCode', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="new-emp-hire" style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{t('employees.form.hireDate')}</label>
                  <input id="new-emp-hire" style={inputStyle} type="date" value={newEmp.hireDate} onChange={(e) => setNewEmpField('hireDate', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="new-emp-team" style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{t('employees.form.team')}</label>
                  <select id="new-emp-team" style={inputStyle} value={newEmp.teamId} onChange={(e) => setNewEmpField('teamId', e.target.value)}>
                    <option value="">{t('employees.form.noTeam')}</option>
                    {teamOptions.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 12px' }}>{t('employees.form.inviteHint')}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button style={btnPrimary} onClick={handleCreateEmployee} disabled={addLoading}>
                  {addLoading ? t('employees.form.submitting') : t('employees.form.submit')}
                </button>
                {addError && <span role="alert" style={{ color: '#ef4444', fontSize: 13 }}>{addError}</span>}
              </div>
            </div>
          )}

          {/* Result of the last account action */}
          {notice && (
            <div
              role={notice.kind === 'error' ? 'alert' : 'status'}
              style={{
                background: notice.kind === 'error' ? '#fee2e2' : '#dcfce7',
                color: notice.kind === 'error' ? '#991b1b' : '#166534',
                padding: '8px 16px',
                borderRadius: 6,
                marginBottom: 12,
                fontSize: 13,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span>{notice.text}</span>
              <button
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13 }}
                onClick={() => setNotice(null)}
              >
                {t('common:actions.close')}
              </button>
            </div>
          )}

          {/* Filters */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              style={{ ...inputStyle, maxWidth: 280 }}
              placeholder={t('employees.searchPlaceholder')}
              value={empSearch}
              onChange={(e) => setEmpSearch(e.target.value)}
            />
            <select
              style={{ ...inputStyle, maxWidth: 180 }}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">{t('employees.allRoles')}</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid #d1d5db' }}>
              <button
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  background: activeFilter === '' ? '#2563eb' : '#fff',
                  color: activeFilter === '' ? '#fff' : '#374151',
                }}
                onClick={() => setActiveFilter('')}
              >
                {t('common:actions.all')}
              </button>
              <button
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  border: 'none',
                  borderLeft: '1px solid #d1d5db',
                  cursor: 'pointer',
                  background: activeFilter === 'true' ? '#16a34a' : '#fff',
                  color: activeFilter === 'true' ? '#fff' : '#374151',
                }}
                onClick={() => setActiveFilter('true')}
              >
                {t('active')}
              </button>
              <button
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  border: 'none',
                  borderLeft: '1px solid #d1d5db',
                  cursor: 'pointer',
                  background: activeFilter === 'false' ? '#dc2626' : '#fff',
                  color: activeFilter === 'false' ? '#fff' : '#374151',
                }}
                onClick={() => setActiveFilter('false')}
              >
                {t('inactive')}
              </button>
            </div>
          </div>

          {/* Edit error banner */}
          {editError && (
            <div
              style={{
                background: '#fee2e2',
                color: '#991b1b',
                padding: '8px 16px',
                borderRadius: 6,
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              {editError}
            </div>
          )}

          {/* Table */}
          {employeesLoading ? (
            <div style={{ color: '#6b7280', padding: 20 }}>{t('employees.loading')}</div>
          ) : employeesError ? (
            <div style={{ color: '#ef4444', padding: 20 }}>{employeesError}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['name', 'email', 'role', 'hourlyRate', 'cctCode', 'status', 'actions'].map(
                    (h) => (
                      <th key={h} style={thStyle}>
                        {t(`employees.table.${h}`)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {employees.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}
                    >
                      {t('employees.empty')}
                    </td>
                  </tr>
                )}
                {employees.map((emp) => {
                  const isEditing = editingId === emp.id;

                  return (
                    <tr
                      key={emp.id}
                      style={{ background: isEditing ? '#fffbeb' : undefined }}
                      onMouseOver={(e) => {
                        if (!isEditing) (e.currentTarget as HTMLElement).style.background = '#f9fafb';
                      }}
                      onMouseOut={(e) => {
                        if (!isEditing) (e.currentTarget as HTMLElement).style.background = '';
                      }}
                    >
                      {/* Name */}
                      <td style={{ ...tdStyle, fontWeight: 500 }}>
                        {[emp.firstName, emp.lastName].filter(Boolean).join(' ') || '-'}
                      </td>

                      {/* Email */}
                      <td style={{ ...tdStyle, color: '#6b7280' }}>
                        {emp.email}
                      </td>

                      {/* Role */}
                      <td style={tdStyle}>
                        {isEditing ? (
                          <select
                            style={{ ...inputStyle, width: 'auto' }}
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value)}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {roleLabel(r)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          roleBadge(emp.role)
                        )}
                      </td>

                      {/* Hourly Rate */}
                      <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 13, color: '#6b7280' }}>CHF</span>
                            <input
                              style={{ ...inputStyle, width: 100 }}
                              type="number"
                              min="0"
                              step="0.05"
                              value={editHourlyRate}
                              onChange={(e) => setEditHourlyRate(e.target.value)}
                            />
                            <span style={{ fontSize: 11, color: '#9ca3af' }}>{t('employees.perHour')}</span>
                          </div>
                        ) : (
                          emp.hourlyRateCents != null ? formatMoney(emp.hourlyRateCents) : '-'
                        )}
                      </td>

                      {/* CCT Code */}
                      <td style={{ ...tdStyle, color: '#6b7280' }}>
                        {emp.cctCode ?? '-'}
                      </td>

                      {/* Status */}
                      <td style={tdStyle}>
                        {isEditing ? (
                          <button
                            style={{
                              ...btnOutline,
                              padding: '4px 12px',
                              fontSize: 12,
                              background: editIsActive ? '#dcfce7' : '#fee2e2',
                              color: editIsActive ? '#166534' : '#991b1b',
                              borderColor: editIsActive ? '#86efac' : '#fca5a5',
                            }}
                            onClick={() => setEditIsActive(!editIsActive)}
                          >
                            {editIsActive ? t('active') : t('inactive')}
                          </button>
                        ) : (
                          activeBadge(emp.isActive)
                        )}
                      </td>

                      {/* Actions */}
                      <td style={tdStyle}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              style={{ ...btnPrimary, padding: '6px 12px', fontSize: 13 }}
                              onClick={() => handleSaveEmployee(emp.id)}
                              disabled={editLoading}
                            >
                              {editLoading ? t('common:actions.saving') : t('common:actions.save')}
                            </button>
                            <button
                              style={{ ...btnOutline, padding: '6px 12px', fontSize: 13 }}
                              onClick={cancelEditing}
                            >
                              {t('common:actions.cancel')}
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              style={{ ...btnOutline, padding: '6px 12px', fontSize: 13 }}
                              onClick={() => startEditing(emp)}
                            >
                              {t('common:actions.edit')}
                            </button>
                            {isAdmin && emp.isActive && (
                              <button
                                style={{ ...btnOutline, padding: '6px 12px', fontSize: 13 }}
                                onClick={() => runRowAction(emp, 'invite')}
                                disabled={rowBusyId === emp.id}
                              >
                                {t('employees.resendInvite')}
                              </button>
                            )}
                            {isAdmin && emp.isActive && emp.id !== currentUserId && (
                              <button
                                style={{ ...btnOutline, padding: '6px 12px', fontSize: 13, color: '#b91c1c' }}
                                onClick={() => runRowAction(emp, 'deactivate')}
                                disabled={rowBusyId === emp.id}
                              >
                                {t('employees.deactivate')}
                              </button>
                            )}
                            {isAdmin && !emp.isActive && (
                              <button
                                style={{ ...btnOutline, padding: '6px 12px', fontSize: 13, color: '#166534' }}
                                onClick={() => runRowAction(emp, 'reactivate')}
                                disabled={rowBusyId === emp.id}
                              >
                                {t('employees.reactivate')}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
