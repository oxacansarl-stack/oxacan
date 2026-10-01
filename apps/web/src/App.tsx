import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CurrentUser, CurrentUserContext, Role } from './lib/current-user';
import { apiGet, ApiError } from './lib/api';
import {
  authLinkError,
  getAccessToken,
  needsPasswordSetup,
  onSignedOut,
  signOut,
  UNAUTHORIZED_EVENT,
} from './lib/auth';
import { ALL, LEGACY_REDIRECTS, OFFICE, SITE_LEAD } from './app/nav';
import { AppShell } from './components/shell/app-shell';
import { ConfirmProvider } from './components/confirm-dialog';
import { EmptyState, LoadingState } from './components/states';
import Login from './pages/Login';
import SetPassword from './pages/SetPassword';

// Routes load on demand: the dashboard no longer pays for the accounting or catalogue bundles.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Clients = lazy(() => import('./pages/Clients'));
const Offers = lazy(() => import('./pages/Offers'));
const OfferDetail = lazy(() => import('./pages/OfferDetail'));
const Contracts = lazy(() => import('./pages/Contracts'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const MyTasks = lazy(() => import('./pages/MyTasks'));
const Meetings = lazy(() => import('./pages/Meetings'));
const DailyReports = lazy(() => import('./pages/DailyReports'));
const Timekeeping = lazy(() => import('./pages/Timekeeping'));
const Expenses = lazy(() => import('./pages/Expenses'));
const HR = lazy(() => import('./pages/HR'));
const Procurement = lazy(() => import('./pages/Procurement'));
const StockMaterial = lazy(() => import('./pages/StockMaterial'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Accounting = lazy(() => import('./pages/Accounting'));
const Catalogue = lazy(() => import('./pages/Catalogue'));
const Plans = lazy(() => import('./pages/Plans'));
const Administration = lazy(() => import('./pages/Administration'));
const Notifications = lazy(() => import('./pages/Notifications'));
const PortalView = lazy(() => import('./pages/PortalView'));

interface AppRoute {
  path: string;
  roles: Role[];
  element: React.ReactNode;
}

/** Mirrors the API's @Roles policy (PRD §3.1–3.2); the API remains the source of truth. */
const ROUTES: AppRoute[] = [
  { path: '/dashboard', roles: ALL, element: <Dashboard /> },
  { path: '/clients', roles: OFFICE, element: <Clients /> },
  { path: '/offers', roles: OFFICE, element: <Offers /> },
  { path: '/offers/:id', roles: OFFICE, element: <OfferDetail /> },
  { path: '/contracts', roles: OFFICE, element: <Contracts /> },
  { path: '/projects', roles: ALL, element: <Projects /> },
  { path: '/projects/:id', roles: ALL, element: <ProjectDetail /> },
  { path: '/tasks', roles: ALL, element: <MyTasks /> },
  { path: '/meetings', roles: SITE_LEAD, element: <Meetings /> },
  { path: '/daily-reports', roles: ALL, element: <DailyReports /> },
  { path: '/timekeeping', roles: ALL, element: <Timekeeping /> },
  { path: '/expenses', roles: ALL, element: <Expenses /> },
  { path: '/hr', roles: SITE_LEAD, element: <HR /> },
  { path: '/purchase-orders', roles: OFFICE, element: <Procurement /> },
  { path: '/stock', roles: SITE_LEAD, element: <StockMaterial /> },
  { path: '/invoices', roles: OFFICE, element: <Invoices /> },
  { path: '/accounting', roles: OFFICE, element: <Accounting /> },
  { path: '/catalogue', roles: SITE_LEAD, element: <Catalogue /> },
  { path: '/plans', roles: ALL, element: <Plans /> },
  { path: '/admin', roles: OFFICE, element: <Administration /> },
  { path: '/notifications', roles: ALL, element: <Notifications /> },
];

function NoAccess() {
  const { t } = useTranslation();
  return <EmptyState title={t('auth.noAccess')} />;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out'; notice?: string }
  | { status: 'set-password' }
  | { status: 'ready'; me: CurrentUser };

export default function App() {
  const { t } = useTranslation();
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const isPortalView = window.location.pathname.startsWith('/portal/view/');

  const loadProfile = useCallback(async () => {
    if (!(await getAccessToken())) {
      setAuth({ status: 'signed-out' });
      return;
    }
    try {
      setAuth({ status: 'ready', me: await apiGet<CurrentUser>('/auth/profile') });
    } catch (err) {
      await signOut();
      setAuth({
        status: 'signed-out',
        notice:
          err instanceof ApiError && err.status === 401
            ? t('auth.accountNotSetUp')
            : t('auth.serverUnreachable'),
      });
    }
  }, [t]);

  useEffect(() => {
    if (isPortalView) return;
    if (authLinkError) setAuth({ status: 'signed-out', notice: t('auth.linkInvalid') });
    else if (needsPasswordSetup()) setAuth({ status: 'set-password' });
    else loadProfile();
    const expired = () => setAuth({ status: 'signed-out', notice: t('auth.sessionExpired') });
    window.addEventListener(UNAUTHORIZED_EVENT, expired);
    const unsubscribe = onSignedOut(() => setAuth({ status: 'signed-out' }));
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, expired);
      unsubscribe();
    };
  }, [isPortalView, loadProfile, t]);

  // The client portal is public and token-scoped: no shell, no profile, no navigation.
  if (isPortalView) {
    return (
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route path="/portal/view/:token" element={<PortalView />} />
        </Routes>
      </Suspense>
    );
  }

  if (auth.status === 'loading') return null;
  if (auth.status === 'signed-out') return <Login notice={auth.notice} onSignedIn={loadProfile} />;
  if (auth.status === 'set-password') return <SetPassword onDone={loadProfile} />;

  const { me } = auth;
  const guard = (roles: Role[], element: React.ReactNode) =>
    roles.includes(me.role) ? element : <NoAccess />;

  async function handleSignOut() {
    await signOut();
    setAuth({ status: 'signed-out' });
  }

  return (
    <CurrentUserContext.Provider value={me}>
      <ConfirmProvider>
        <AppShell me={me} onSignOut={handleSignOut}>
          <Suspense fallback={<LoadingState />}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              {ROUTES.map((route) => (
                <Route key={route.path} path={route.path} element={guard(route.roles, route.element)} />
              ))}
              {/* Pages that became tabs keep their old links working. */}
              {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
                <Route key={from} path={from} element={<Navigate to={to} replace />} />
              ))}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </AppShell>
      </ConfirmProvider>
    </CurrentUserContext.Provider>
  );
}
