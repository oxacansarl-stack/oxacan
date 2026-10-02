import * as React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Info } from 'lucide-react';
import { ADMIN_ITEM, NAV_GROUPS, canSee, type NavGroup } from '@/app/nav';
import type { Role } from '@/lib/current-user';
import { cn } from '@/lib/cn';

const COLLAPSED_KEY = 'oxacan.nav.collapsed';

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function NavRow({
  to,
  label,
  icon: Icon,
  rail,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  rail: boolean;
  onNavigate: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      title={rail ? label : undefined}
      className={({ isActive }) =>
        cn(
          'focus-on-dark relative flex h-[34px] items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 text-side-fg',
          'hover:bg-graphite-2 hover:text-[#f1f0ec]',
          rail && 'justify-center px-0',
          isActive && 'bg-graphite-2 font-medium text-white',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span
              aria-hidden
              className={cn(
                'absolute -left-2 bottom-2 top-2 w-[3px] rounded-r-[3px] bg-volt',
                rail && 'left-0',
              )}
            />
          ) : null}
          <Icon className={cn('size-[17px] shrink-0', isActive ? 'text-volt' : 'text-side-dim')} />
          {rail ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );
}

function Group({
  group,
  role,
  rail,
  collapsed,
  onToggle,
  onNavigate,
}: {
  group: NavGroup;
  role: Role;
  rail: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const items = group.items.filter((item) => canSee(item, role));
  if (items.length === 0) return null;

  const rows = items.map((item) => (
    <NavRow
      key={item.to}
      to={item.to}
      label={t(item.labelKey)}
      icon={item.icon}
      rail={rail}
      onNavigate={onNavigate}
    />
  ));

  if (!group.labelKey) return <div className="grid grid-cols-[minmax(0,1fr)] gap-px">{rows}</div>;

  // In the rail the heading becomes a divider: the icons still read as groups.
  if (rail) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-px">
        <span aria-hidden className="mx-3 my-2 h-px bg-graphite-3" />
        {rows}
      </div>
    );
  }

  return (
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-px">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="focus-on-dark flex items-center justify-between rounded px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-side-dim hover:text-[#e6e5e0]"
      >
        <span>{t(group.labelKey)}</span>
        <ChevronDown className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')} />
      </button>
      {collapsed ? null : <div className="grid grid-cols-[minmax(0,1fr)] gap-px">{rows}</div>}
    </div>
  );
}

export function Sidebar({
  role,
  rail,
  mobileOpen,
  onNavigate,
}: {
  role: Role;
  rail: boolean;
  mobileOpen: boolean;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>(readCollapsed);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        /* a private window simply forgets the preference */
      }
      return next;
    });
  };

  return (
    <aside
      aria-label={t('shell.mainNav')}
      className={cn(
        'z-40 flex flex-col overflow-hidden bg-graphite text-side-fg',
        // Desktop: a sticky full-height column that can shrink to an icon rail.
        'md:sticky md:top-0 md:h-dvh md:translate-x-0',
        rail ? 'md:w-rail' : 'md:w-sidebar',
        // Phone: a drawer over the page.
        'fixed inset-y-0 left-0 w-[272px] pt-[env(safe-area-inset-top,0px)] transition-transform duration-200 md:pt-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div
        className={cn(
          'flex h-topbar flex-none items-center gap-2.5 border-b border-graphite-3 px-4',
          rail && 'md:justify-center md:px-0',
        )}
      >
        <span
          aria-hidden
          className="grid size-7 flex-none place-items-center rounded-md bg-volt font-display text-xs font-bold text-graphite"
        >
          OX
        </span>
        <span className={cn('grid min-w-0 leading-tight', rail && 'md:hidden')}>
          <span className="font-display text-sm font-bold tracking-[0.14em] text-[#f1f0ec]">OXACAN</span>
          <span className="truncate text-[11.5px] text-side-dim">{t('app.tagline')}</span>
        </span>
      </div>

      <nav className="flex-1 content-start overflow-y-auto px-2 pb-3 pt-2.5">
        {NAV_GROUPS.map((group) => (
          <Group
            key={group.id}
            group={group}
            role={role}
            rail={rail}
            collapsed={Boolean(collapsed[group.id])}
            onToggle={() => toggle(group.id)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="flex-none border-t border-graphite-3 p-2">
        {canSee(ADMIN_ITEM, role) ? (
          <NavRow
            to={ADMIN_ITEM.to}
            label={t(ADMIN_ITEM.labelKey)}
            icon={ADMIN_ITEM.icon}
            rail={rail}
            onNavigate={onNavigate}
          />
        ) : null}
        <div
          className={cn(
            'flex items-center gap-2.5 px-2.5 py-2 text-xs text-side-dim',
            rail && 'md:justify-center md:px-0',
          )}
        >
          <Info className="size-[15px] flex-none" />
          <span className={cn(rail && 'md:hidden')}>OXACAN v0.1.0</span>
        </div>
      </div>
    </aside>
  );
}
