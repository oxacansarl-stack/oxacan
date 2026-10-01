import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Banknote,
  Building2,
  ClipboardList,
  FileText,
  LogOut,
  Menu,
  PanelLeft,
  Plus,
  Receipt,
  Search,
  Settings,
  User,
} from 'lucide-react';
import { OFFICE } from '@/app/nav';
import type { CurrentUser } from '@/lib/current-user';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Breadcrumbs } from './breadcrumbs';
import { NotificationsMenu } from './notifications-menu';

/** Each page opens its own create form when it sees ?new=1. */
const CREATE_OFFICE = [
  { to: '/offers?new=1', icon: FileText, labelKey: 'nav.offers' },
  { to: '/clients?new=1', icon: Building2, labelKey: 'nav.clients' },
  { to: '/invoices?new=1', icon: Banknote, labelKey: 'nav.invoices' },
  { to: '/daily-reports?new=1', icon: ClipboardList, labelKey: 'nav.dailyReports' },
  { to: '/expenses?new=1', icon: Receipt, labelKey: 'nav.expenses' },
];

const CREATE_FIELD = [
  { to: '/daily-reports?new=1', icon: ClipboardList, labelKey: 'nav.dailyReports' },
  { to: '/expenses?new=1', icon: Receipt, labelKey: 'nav.expenses' },
];

function initials(me: CurrentUser): string {
  const letters = [me.firstName?.[0], me.lastName?.[0]].filter(Boolean).join('');
  return (letters || me.email.slice(0, 2)).toUpperCase();
}

export function TopBar({
  me,
  detailCrumb,
  onOpenNav,
  onToggleRail,
  railed,
  onOpenSearch,
  onSignOut,
}: {
  me: CurrentUser;
  detailCrumb: string | null;
  onOpenNav: () => void;
  onToggleRail: () => void;
  railed: boolean;
  onOpenSearch: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const office = OFFICE.includes(me.role);
  const createItems = office ? CREATE_OFFICE : CREATE_FIELD;
  const fullName = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.email;

  return (
    <header className="sticky top-0 z-30 flex h-topbar items-center gap-3 border-b border-line bg-paper pl-4 pr-3 pt-[env(safe-area-inset-top,0px)] md:pr-6">
      <Button variant="quiet" size="icon" className="md:hidden" onClick={onOpenNav} aria-label={t('shell.openMenu')}>
        <Menu />
      </Button>
      <Button
        variant="quiet"
        size="icon"
        className="hidden md:inline-flex"
        onClick={onToggleRail}
        aria-label={railed ? t('shell.expandMenu') : t('shell.collapseMenu')}
      >
        <PanelLeft />
      </Button>

      <span className="font-display text-sm font-bold tracking-[0.14em] sm:hidden">OXACAN</span>

      <Breadcrumbs detail={detailCrumb} />

      <button
        type="button"
        onClick={onOpenSearch}
        aria-label={t('shell.searchShort')}
        className="ml-auto flex h-[34px] items-center gap-2 rounded-md border border-line bg-paper-2 px-2.5 text-[13.5px] text-muted hover:border-[#c9c5ba] sm:w-[min(360px,34vw)]"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="hidden flex-1 truncate text-left sm:block">{t('shell.search')}</span>
        <kbd className="hidden rounded border border-line bg-paper px-1.5 text-[11px] sm:block">⌘K</kbd>
      </button>

      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="quiet" size="icon" aria-label={t('shell.create')}>
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>{t('shell.create')}</DropdownMenuLabel>
            {createItems.map((item) => (
              <DropdownMenuItem key={item.to} onSelect={() => navigate(item.to)}>
                <item.icon />
                {t(item.labelKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <NotificationsMenu />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('shell.userMenu')}
              className="ml-1.5 grid size-8 place-items-center rounded-full bg-graphite text-[11.5px] font-semibold text-[#f1f0ec]"
            >
              {initials(me)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <div className="mb-1 grid border-b border-line-soft p-2.5">
              <span className="font-semibold">{fullName}</span>
              <span className="text-xs text-muted">{t(`role.${me.role}`)}</span>
            </div>
            <DropdownMenuItem onSelect={() => navigate('/notifications')}>
              <User />
              {t('shell.myProfile')}
            </DropdownMenuItem>
            {office ? (
              <DropdownMenuItem onSelect={() => navigate('/admin')}>
                <Settings />
                {t('nav.admin')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onSignOut}>
              <LogOut />
              {t('auth.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
