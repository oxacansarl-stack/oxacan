import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, api, formatCHF } from '../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Team {
  id: string;
  name: string;
  leaderId?: string;
  leader?: { id: string; email: string; name?: string };
  _count?: { members: number };
  createdAt: string;
}

interface TeamMember {
  userId: string;
  user: { id: string; email: string; name?: string; role?: string };
}

interface TeamDetail extends Team {
  members: TeamMember[];
}

interface Employee {
  id: string;
  email: string;
  name?: string;
  role: string;
  hourlyRateCents: number;
  cctCode?: string;
  isActive: boolean;
  createdAt: string;
}

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
  admin: { bg: '#ede9fe', fg: '#7c3aed' },
  manager: { bg: '#dbeafe', fg: '#2563eb' },
  engineer: { bg: '#d1fae5', fg: '#059669' },
  worker: { bg: '#fef3c7', fg: '#d97706' },
};

const ROLES = ['admin', 'manager', 'engineer', 'worker'] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
      {statusLabel(role)}
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
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function HR() {
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

  /* Employees list is also used in team dropdowns */
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);

  /* ============ DATA FETCHING ============ */

  const fetchTeams = useCallback(() => {
    setTeamsLoading(true);
    setTeamsError('');
    const params = new URLSearchParams();
    if (teamsSearch) params.set('search', teamsSearch);
    const qs = params.toString() ? `?${params.toString()}` : '';
    apiGet<{ data: Team[] }>(`/hr/teams${qs}`)
      .then((res) => {
        const list = Array.isArray(res) ? res : (res as { data: Team[] }).data ?? [];
        setTeams(list);
      })
      .catch((err) => setTeamsError(err.message ?? 'Failed to load teams'))
      .finally(() => setTeamsLoading(false));
  }, [teamsSearch]);

  const fetchEmployees = useCallback(() => {
    setEmployeesLoading(true);
    setEmployeesError('');
    const params = new URLSearchParams();
    if (empSearch) params.set('search', empSearch);
    if (roleFilter) params.set('role', roleFilter);
    if (activeFilter) params.set('isActive', activeFilter);
    const qs = params.toString() ? `?${params.toString()}` : '';
    apiGet<{ data: Employee[] }>(`/hr/employees${qs}`)
      .then((res) => {
        const list = Array.isArray(res) ? res : (res as { data: Employee[] }).data ?? [];
        setEmployees(list);
      })
      .catch((err) => setEmployeesError(err.message ?? 'Failed to load employees'))
      .finally(() => setEmployeesLoading(false));
  }, [empSearch, roleFilter, activeFilter]);

  const fetchAllEmployees = useCallback(() => {
    apiGet<{ data: Employee[] }>('/hr/employees?isActive=true')
      .then((res) => {
        const list = Array.isArray(res) ? res : (res as { data: Employee[] }).data ?? [];
        setAllEmployees(list);
      })
      .catch(() => {});
  }, []);

  const fetchTeamDetail = useCallback((teamId: string) => {
    setTeamDetailLoading(true);
    apiGet<{ data: TeamDetail }>(`/hr/teams/${teamId}`)
      .then((res) => {
        const detail = (res as { data: TeamDetail }).data ?? (res as unknown as TeamDetail);
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
      fetchAllEmployees();
    }
  }, [activeTab, fetchTeams, fetchAllEmployees]);

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
      .catch((err) => setCreateError(err.message ?? 'Failed to create team'))
      .finally(() => setCreateLoading(false));
  };

  const handleUpdateTeam = (teamId: string) => {
    setEditTeamLoading(true);
    const body: { name?: string; leaderId?: string } = {};
    if (editTeamName.trim()) body.name = editTeamName.trim();
    body.leaderId = editTeamLeaderId || undefined;
    apiPut(`/hr/teams/${teamId}`, body)
      .then(() => {
        fetchTeams();
        fetchTeamDetail(teamId);
      })
      .finally(() => setEditTeamLoading(false));
  };

  const handleDeleteTeam = (teamId: string) => {
    if (!window.confirm('Are you sure you want to delete this team? This cannot be undone.')) return;
    apiDelete(`/hr/teams/${teamId}`)
      .then(() => {
        setExpandedTeamId(null);
        setTeamDetail(null);
        fetchTeams();
      })
      .catch((err) => alert(err.message ?? 'Failed to delete team'));
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
      .catch((err) => alert(err.message ?? 'Failed to add member'))
      .finally(() => setAddMemberLoading(false));
  };

  const handleRemoveMember = (teamId: string, userId: string) => {
    apiDelete(`/hr/teams/${teamId}/members/${userId}`)
      .then(() => {
        fetchTeamDetail(teamId);
        fetchTeams();
      })
      .catch((err) => alert(err.message ?? 'Failed to remove member'));
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

  const startEditing = (emp: Employee) => {
    setEditingId(emp.id);
    setEditRole(emp.role);
    setEditHourlyRate(String(emp.hourlyRateCents));
    setEditIsActive(emp.isActive);
    setEditError('');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditError('');
  };

  const handleSaveEmployee = (userId: string) => {
    setEditLoading(true);
    setEditError('');
    const body: { hourlyRateCents?: number; role?: string; isActive?: boolean } = {
      hourlyRateCents: Number(editHourlyRate),
      role: editRole,
      isActive: editIsActive,
    };
    apiPut(`/hr/employees/${userId}`, body)
      .then(() => {
        setEditingId(null);
        fetchEmployees();
        fetchAllEmployees();
      })
      .catch((err) => setEditError(err.message ?? 'Failed to update employee'))
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
        Human Resources
      </h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: 24 }}>
        <button style={tabStyle('teams')} onClick={() => setActiveTab('teams')}>
          Teams
        </button>
        <button style={tabStyle('employees')} onClick={() => setActiveTab('employees')}>
          Employees
        </button>
      </div>

      {/* ================= TEAMS TAB ================= */}
      {activeTab === 'teams' && (
        <div>
          {/* Teams header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: 0 }}>Teams</h2>
              <input
                style={{ ...inputStyle, maxWidth: 260 }}
                placeholder="Search teams..."
                value={teamsSearch}
                onChange={(e) => setTeamsSearch(e.target.value)}
              />
            </div>
            <button style={btnPrimary} onClick={() => setShowCreateForm(!showCreateForm)}>
              {showCreateForm ? 'Cancel' : '+ New Team'}
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
                    Team Name *
                  </label>
                  <input
                    style={inputStyle}
                    placeholder="e.g. Gros Oeuvre Equipe A"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                    Team Leader
                  </label>
                  <select
                    style={inputStyle}
                    value={createLeaderId}
                    onChange={(e) => setCreateLeaderId(e.target.value)}
                  >
                    <option value="">No leader</option>
                    {allEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name ?? emp.email} ({statusLabel(emp.role)})
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
                  {createLoading ? 'Creating...' : 'Create Team'}
                </button>
                {createError && (
                  <span style={{ color: '#ef4444', fontSize: 13 }}>{createError}</span>
                )}
              </div>
            </div>
          )}

          {/* Teams list */}
          {teamsLoading ? (
            <div style={{ color: '#6b7280', padding: 20 }}>Loading teams...</div>
          ) : teamsError ? (
            <div style={{ color: '#ef4444', padding: 20 }}>{teamsError}</div>
          ) : teams.length === 0 ? (
            <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>
              No teams found. Create your first team above.
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
                        ? `Leader: ${team.leader.name ?? team.leader.email}`
                        : 'No leader'}
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
                      {team._count?.members ?? 0} member{(team._count?.members ?? 0) !== 1 ? 's' : ''}
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
                        <div style={{ color: '#6b7280' }}>Loading team details...</div>
                      ) : teamDetail ? (
                        <div>
                          {/* Edit team name & leader */}
                          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20 }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                                Team Name
                              </label>
                              <input
                                style={inputStyle}
                                value={editTeamName}
                                onChange={(e) => setEditTeamName(e.target.value)}
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                                Team Leader
                              </label>
                              <select
                                style={inputStyle}
                                value={editTeamLeaderId}
                                onChange={(e) => setEditTeamLeaderId(e.target.value)}
                              >
                                <option value="">No leader</option>
                                {allEmployees.map((emp) => (
                                  <option key={emp.id} value={emp.id}>
                                    {emp.name ?? emp.email}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              style={btnPrimary}
                              onClick={() => handleUpdateTeam(team.id)}
                              disabled={editTeamLoading}
                            >
                              {editTeamLoading ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              style={btnDanger}
                              onClick={() => handleDeleteTeam(team.id)}
                            >
                              Delete Team
                            </button>
                          </div>

                          {/* Members list */}
                          <h4 style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 12 }}>
                            Members ({teamDetail.members?.length ?? 0})
                          </h4>

                          {(!teamDetail.members || teamDetail.members.length === 0) ? (
                            <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 16 }}>
                              No members yet. Add one below.
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
                                      {m.user.name ?? m.user.email}
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
                                    title="Remove member"
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
                              <option value="">Select employee to add...</option>
                              {allEmployees
                                .filter(
                                  (emp) =>
                                    !teamDetail.members?.some((m) => m.userId === emp.id),
                                )
                                .map((emp) => (
                                  <option key={emp.id} value={emp.id}>
                                    {emp.name ?? emp.email} ({statusLabel(emp.role)})
                                  </option>
                                ))}
                            </select>
                            <button
                              style={btnOutline}
                              onClick={() => handleAddMember(team.id)}
                              disabled={!addMemberUserId || addMemberLoading}
                            >
                              {addMemberLoading ? 'Adding...' : 'Add'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#ef4444' }}>Failed to load team details.</div>
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
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: 0, marginBottom: 16 }}>
            Employees
          </h2>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              style={{ ...inputStyle, maxWidth: 280 }}
              placeholder="Search by name or email..."
              value={empSearch}
              onChange={(e) => setEmpSearch(e.target.value)}
            />
            <select
              style={{ ...inputStyle, maxWidth: 180 }}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">All Roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {statusLabel(r)}
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
                All
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
                Active
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
                Inactive
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
            <div style={{ color: '#6b7280', padding: 20 }}>Loading employees...</div>
          ) : employeesError ? (
            <div style={{ color: '#ef4444', padding: 20 }}>{employeesError}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Email', 'Role', 'Hourly Rate (CHF)', 'CCT Code', 'Status', 'Actions'].map(
                    (h) => (
                      <th key={h} style={thStyle}>
                        {h}
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
                      No employees found
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
                        {emp.name ?? '-'}
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
                                {statusLabel(r)}
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
                              value={editHourlyRate}
                              onChange={(e) => setEditHourlyRate(e.target.value)}
                            />
                            <span style={{ fontSize: 11, color: '#9ca3af' }}>(cts)</span>
                          </div>
                        ) : (
                          `CHF ${formatCHF(emp.hourlyRateCents)}`
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
                            {editIsActive ? 'Active' : 'Inactive'}
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
                              {editLoading ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              style={{ ...btnOutline, padding: '6px 12px', fontSize: 13 }}
                              onClick={cancelEditing}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            style={{ ...btnOutline, padding: '6px 12px', fontSize: 13 }}
                            onClick={() => startEditing(emp)}
                          >
                            Edit
                          </button>
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
