import React, { useCallback, useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import Offers from './pages/Offers';
import OfferDetail from './pages/OfferDetail';
import Contracts from './pages/Contracts';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Timekeeping from './pages/Timekeeping';
import Expenses from './pages/Expenses';
import DailyReports from './pages/DailyReports';
import HR from './pages/HR';
import Suppliers from './pages/Suppliers';
import PurchaseOrders from './pages/PurchaseOrders';
import Stock from './pages/Stock';
import Vehicles from './pages/Vehicles';
import Meetings from './pages/Meetings';
import Invoices from './pages/Invoices';
import Accounting from './pages/Accounting';
import Catalogue from './pages/Catalogue';
import Plans from './pages/Plans';
import Settings from './pages/Settings';
import Portal from './pages/Portal';
import PortalView from './pages/PortalView';
import Notifications from './pages/Notifications';
import DataExport from './pages/DataExport';
import Login from './pages/Login';
import { CurrentUser, CurrentUserContext, Role } from './lib/current-user';
import { apiGet, ApiError } from './lib/api';
import { getAccessToken, onSignedOut, signOut, UNAUTHORIZED_EVENT } from './lib/auth';

const SIDEBAR_WIDTH = 240;


const ALL: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER'];
const SITE_LEAD: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER'];
const OFFICE: Role[] = ['ADMIN', 'PROJECT_MANAGER'];
const ADMIN: Role[] = ['ADMIN'];

// Mirrors the API's @Roles policy (PRD §3.1–3.2); the API remains the source of truth.
const navItems: { to: string; label: string; roles: Role[]; element: React.ReactNode }[] = [
  { to: '/dashboard', label: 'Dashboard', roles: ALL, element: <Dashboard /> },
  { to: '/clients', label: 'Clients', roles: OFFICE, element: <Clients /> },
  { to: '/offers', label: 'Offers', roles: OFFICE, element: <Offers /> },
  { to: '/contracts', label: 'Contracts', roles: OFFICE, element: <Contracts /> },
  { to: '/projects', label: 'Projects', roles: ALL, element: <Projects /> },
  { to: '/timekeeping', label: 'Timekeeping', roles: ALL, element: <Timekeeping /> },
  { to: '/expenses', label: 'Expenses', roles: ALL, element: <Expenses /> },
  { to: '/daily-reports', label: 'Daily Reports', roles: ALL, element: <DailyReports /> },
  { to: '/hr', label: 'HR & Teams', roles: SITE_LEAD, element: <HR /> },
  { to: '/suppliers', label: 'Suppliers', roles: OFFICE, element: <Suppliers /> },
  { to: '/purchase-orders', label: 'Purchase Orders', roles: OFFICE, element: <PurchaseOrders /> },
  { to: '/stock', label: 'Stock', roles: SITE_LEAD, element: <Stock /> },
  { to: '/vehicles', label: 'Vehicles', roles: SITE_LEAD, element: <Vehicles /> },
  { to: '/meetings', label: 'Meetings', roles: SITE_LEAD, element: <Meetings /> },
  { to: '/invoices', label: 'Invoices', roles: OFFICE, element: <Invoices /> },
  { to: '/accounting', label: 'Accounting', roles: OFFICE, element: <Accounting /> },
  { to: '/catalogue', label: 'Catalogue', roles: ALL, element: <Catalogue /> },
  { to: '/plans', label: 'Plans', roles: ALL, element: <Plans /> },
  { to: '/settings', label: 'Settings', roles: OFFICE, element: <Settings /> },
  { to: '/portal', label: 'Portal', roles: OFFICE, element: <Portal /> },
  { to: '/notifications', label: 'Notifications', roles: ALL, element: <Notifications /> },
  { to: '/data-export', label: 'Data Export', roles: ADMIN, element: <DataExport /> },
];

const detailRoutes: { path: string; roles: Role[]; element: React.ReactNode }[] = [
  { path: '/offers/:id', roles: OFFICE, element: <OfferDetail /> },
  { path: '/projects/:id', roles: ALL, element: <ProjectDetail /> },
];

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  PROJECT_MANAGER: 'Project manager',
  TEAM_LEADER: 'Team leader',
  WORKER: 'Worker',
};

type Me = CurrentUser;

function NoAccess() {
  return <div style={{ color: '#6b7280', fontSize: 14 }}>You don't have access to this page.</div>;
}

type AuthState = { status: 'loading' } | { status: 'signed-out'; notice?: string } | { status: 'ready'; me: Me };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [unreadCount, setUnreadCount] = useState(0);
  const isPortalView = window.location.pathname.startsWith('/portal/view/');

  const loadProfile = useCallback(async () => {
    if (!(await getAccessToken())) {
      setAuth({ status: 'signed-out' });
      return;
    }
    try {
      setAuth({ status: 'ready', me: await apiGet<Me>('/auth/profile') });
    } catch (err) {
      await signOut();
      setAuth({
        status: 'signed-out',
        notice:
          err instanceof ApiError && err.status === 401
            ? 'Your account is not set up in OXACAN yet, or your session expired. Ask your administrator if this persists.'
            : 'Could not reach the server. Try again.',
      });
    }
  }, []);

  useEffect(() => {
    if (isPortalView) return;
    loadProfile();
    const expired = () => setAuth({ status: 'signed-out', notice: 'Your session expired. Please sign in again.' });
    window.addEventListener(UNAUTHORIZED_EVENT, expired);
    const unsubscribe = onSignedOut(() => setAuth({ status: 'signed-out' }));
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, expired);
      unsubscribe();
    };
  }, [isPortalView, loadProfile]);

  useEffect(() => {
    if (auth.status !== 'ready') return;
    apiGet<{ count: number }>('/notifications/unread-count')
      .then((res) => setUnreadCount(res?.count ?? 0))
      .catch(() => {});
  }, [auth.status]);

  if (isPortalView) {
    return (
      <Routes>
        <Route path="/portal/view/:token" element={<PortalView />} />
      </Routes>
    );
  }

  if (auth.status === 'loading') return null;
  if (auth.status === 'signed-out') return <Login notice={auth.notice} onSignedIn={loadProfile} />;

  const { me } = auth;
  const visibleNav = navItems.filter((item) => item.roles.includes(me.role));
  const guard = (roles: Role[], element: React.ReactNode) => (roles.includes(me.role) ? element : <NoAccess />);

  async function handleSignOut() {
    await signOut();
    setAuth({ status: 'signed-out' });
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <aside
        style={{
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          background: '#f8f9fa',
          borderRight: '1px solid #e5e7eb',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: -0.5 }}>OXACAN</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Swiss Construction ERP</div>
        </div>

        <nav style={{ padding: '12px 10px', flex: 1, overflowY: 'auto' }}>
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#2563eb' : '#4b5563',
                background: isActive ? '#eff6ff' : 'transparent',
                textDecoration: 'none',
                marginBottom: 2,
                transition: 'background 0.15s, color 0.15s',
              })}
            >
              <span>{item.label}</span>
              {item.to === '/notifications' && unreadCount > 0 && (
                <span
                  style={{
                    background: '#dc2626',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 9999,
                    minWidth: 18,
                    height: 18,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 5px',
                    lineHeight: 1,
                  }}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', fontSize: 12, color: '#6b7280' }}>
          <div style={{ fontWeight: 600, color: '#111827' }}>
            {[me.firstName, me.lastName].filter(Boolean).join(' ') || me.email}
          </div>
          <div style={{ marginBottom: 8 }}>{ROLE_LABELS[me.role] ?? me.role}</div>
          <button
            onClick={handleSignOut}
            style={{
              padding: '4px 10px',
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
          <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>v0.1.0</div>
        </div>
      </aside>

      <main style={{ flex: 1, background: '#fff', padding: '24px 32px', overflow: 'auto' }}>
        <CurrentUserContext.Provider value={me}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          {navItems.map((item) => (
            <Route key={item.to} path={item.to} element={guard(item.roles, item.element)} />
          ))}
          {detailRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={guard(r.roles, r.element)} />
          ))}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </CurrentUserContext.Provider>
      </main>
    </div>
  );
}
