import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  BookOpen,
  Building2,
  CalendarDays,
  Calculator,
  ClipboardList,
  Contact,
  FileSignature,
  FileText,
  HardHat,
  LayoutDashboard,
  ListChecks,
  Receipt,
  Ruler,
  Settings,
  ShoppingCart,
  Timer,
  Warehouse,
} from 'lucide-react';
import type { Role } from '@/lib/current-user';

export const ALL: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER'];
export const SITE_LEAD: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER'];
export const OFFICE: Role[] = ['ADMIN', 'PROJECT_MANAGER'];
export const ADMIN_ONLY: Role[] = ['ADMIN'];

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  roles: Role[];
}

export interface NavGroup {
  /** Stable key for the collapsed-state memory; absent on the ungrouped top item. */
  id: string;
  labelKey?: string;
  items: NavItem[];
}

/**
 * Six groups instead of one flat list of twenty-two links (approved mockup v3).
 * Roles mirror the API's @Roles policy — the API stays the source of truth, this only
 * decides what is worth showing. Anything stricter inside a page is gated again there.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    items: [{ to: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, roles: ALL }],
  },
  {
    id: 'sales',
    labelKey: 'navGroup.sales',
    items: [
      { to: '/clients', labelKey: 'nav.clients', icon: Building2, roles: OFFICE },
      { to: '/offers', labelKey: 'nav.offers', icon: FileText, roles: OFFICE },
      { to: '/contracts', labelKey: 'nav.contracts', icon: FileSignature, roles: OFFICE },
    ],
  },
  {
    id: 'sites',
    labelKey: 'navGroup.sites',
    items: [
      { to: '/projects', labelKey: 'nav.projects', icon: HardHat, roles: ALL },
      { to: '/tasks', labelKey: 'nav.tasks', icon: ListChecks, roles: ALL },
      { to: '/meetings', labelKey: 'nav.meetings', icon: CalendarDays, roles: SITE_LEAD },
      { to: '/daily-reports', labelKey: 'nav.dailyReports', icon: ClipboardList, roles: ALL },
    ],
  },
  {
    id: 'people',
    labelKey: 'navGroup.people',
    items: [
      { to: '/timekeeping', labelKey: 'nav.timekeeping', icon: Timer, roles: ALL },
      { to: '/expenses', labelKey: 'nav.expenses', icon: Receipt, roles: ALL },
      { to: '/hr', labelKey: 'nav.hr', icon: Contact, roles: SITE_LEAD },
    ],
  },
  {
    id: 'procurement',
    labelKey: 'navGroup.procurement',
    items: [
      { to: '/purchase-orders', labelKey: 'nav.purchaseOrders', icon: ShoppingCart, roles: OFFICE },
      { to: '/stock', labelKey: 'nav.stock', icon: Warehouse, roles: SITE_LEAD },
    ],
  },
  {
    id: 'finance',
    labelKey: 'navGroup.finance',
    items: [
      { to: '/invoices', labelKey: 'nav.invoices', icon: Banknote, roles: OFFICE },
      { to: '/accounting', labelKey: 'nav.accounting', icon: Calculator, roles: OFFICE },
    ],
  },
  {
    id: 'reference',
    labelKey: 'navGroup.reference',
    items: [
      // Catalogue carries unit prices: workers are excluded here and in the API.
      { to: '/catalogue', labelKey: 'nav.catalogue', icon: BookOpen, roles: SITE_LEAD },
      { to: '/plans', labelKey: 'nav.plans', icon: Ruler, roles: ALL },
    ],
  },
];

/** Pinned below the groups rather than sorted among them. */
export const ADMIN_ITEM: NavItem = {
  to: '/admin',
  labelKey: 'nav.admin',
  icon: Settings,
  roles: OFFICE,
};

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), ADMIN_ITEM];

/**
 * Pages that became tabs of another page keep working as links: an old bookmark, an email
 * or a notification deep-link lands on the right tab instead of a dead route.
 */
export const LEGACY_REDIRECTS: Record<string, string> = {
  '/suppliers': '/purchase-orders?tab=suppliers',
  '/vehicles': '/stock?tab=vehicles',
  '/settings': '/admin?tab=company',
  '/portal': '/admin?tab=portal',
  '/data-export': '/admin?tab=data',
};

export function canSee(item: { roles: Role[] }, role: Role): boolean {
  return item.roles.includes(role);
}
