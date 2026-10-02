import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CurrentUser } from '@/lib/current-user';
import { cn } from '@/lib/cn';
import { Sidebar } from './sidebar';
import { TopBar } from './topbar';
import { CommandPalette } from './command-palette';
import { DetailCrumbProvider } from './breadcrumbs';

const RAIL_KEY = 'oxacan.nav.rail';

export function AppShell({
  me,
  onSignOut,
  children,
}: {
  me: CurrentUser;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [railed, setRailed] = React.useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [navOpen, setNavOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);

  const toggleRail = () => {
    setRailed((prev) => {
      try {
        localStorage.setItem(RAIL_KEY, prev ? '0' : '1');
      } catch {
        /* a private window simply forgets the preference */
      }
      return !prev;
    });
  };

  // The drawer must not stay open behind a new page on a phone.
  React.useEffect(() => setNavOpen(false), [pathname]);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') setNavOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <DetailCrumbProvider>
      {(detailCrumb) => (
        <div
          className={cn(
            // The column is pinned to minmax(0,1fr) so a wide table scrolls inside its own
            // container instead of stretching the whole page sideways on a phone.
            'grid min-h-dvh grid-cols-[minmax(0,1fr)]',
            railed ? 'md:grid-cols-[var(--spacing-rail)_minmax(0,1fr)]' : 'md:grid-cols-[var(--spacing-sidebar)_minmax(0,1fr)]',
          )}
        >
          <a
            href="#contenu"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-paper focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
          >
            {t('shell.skipToContent')}
          </a>

          <Sidebar role={me.role} rail={railed} mobileOpen={navOpen} onNavigate={() => setNavOpen(false)} />

          {navOpen ? (
            <button
              type="button"
              aria-label={t('shell.closeMenu')}
              onClick={() => setNavOpen(false)}
              className="fixed inset-0 z-[35] bg-graphite/45 md:hidden"
            />
          ) : null}

          <div className="flex min-w-0 flex-col">
            <TopBar
              me={me}
              detailCrumb={detailCrumb}
              onOpenNav={() => setNavOpen(true)}
              onToggleRail={toggleRail}
              railed={railed}
              onOpenSearch={() => setSearchOpen(true)}
              onSignOut={onSignOut}
            />
            <main
              id="contenu"
              tabIndex={-1}
              className="w-full max-w-[1440px] px-4 pb-28 pt-5 focus:outline-none md:px-7 md:pb-24 md:pt-6"
            >
              {children}
            </main>
          </div>

          <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} role={me.role} />
        </div>
      )}
    </DetailCrumbProvider>
  );
}
