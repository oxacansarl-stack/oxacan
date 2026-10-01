import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { ADMIN_ITEM, NAV_GROUPS } from '@/app/nav';

type Trail = { label: string; to?: string }[];

const DetailCrumbContext = React.createContext<(label: string | null) => void>(() => {});

/**
 * A detail page names itself in the breadcrumb — "Ventes › Offres › OFF-2026-0001" — so the
 * page body never has to repeat where it sits.
 */
export function useDetailCrumb(label: string | null | undefined) {
  const set = React.useContext(DetailCrumbContext);
  React.useEffect(() => {
    set(label ?? null);
    return () => set(null);
  }, [label, set]);
}

export function DetailCrumbProvider({
  children,
}: {
  children: (detail: string | null) => React.ReactNode;
}) {
  const [detail, setDetail] = React.useState<string | null>(null);
  // Identity-stable so useDetailCrumb's effect only reruns when the label changes.
  const set = React.useCallback((label: string | null) => setDetail(label), []);
  return <DetailCrumbContext.Provider value={set}>{children(detail)}</DetailCrumbContext.Provider>;
}

function useTrail(detail: string | null): Trail {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  return React.useMemo(() => {
    const base = '/' + (pathname.split('/')[1] ?? '');
    if (base === ADMIN_ITEM.to) return [{ label: t(ADMIN_ITEM.labelKey) }];

    for (const group of NAV_GROUPS) {
      const item = group.items.find((i) => i.to === base);
      if (!item) continue;
      const trail: Trail = [];
      if (group.labelKey) trail.push({ label: t(group.labelKey) });
      // On a detail page the list stays clickable; on the list itself it is the current page.
      trail.push(detail ? { label: t(item.labelKey), to: item.to } : { label: t(item.labelKey) });
      if (detail) trail.push({ label: detail });
      return trail;
    }
    return [];
  }, [pathname, detail, t]);
}

export function Breadcrumbs({ detail }: { detail: string | null }) {
  const { t } = useTranslation();
  const trail = useTrail(detail);
  if (trail.length === 0) return <div className="min-w-0 flex-1" />;

  return (
    <nav
      aria-label={t('shell.breadcrumb')}
      className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[13.5px] text-muted sm:flex"
    >
      {trail.map((crumb, i) => (
        <React.Fragment key={`${crumb.label}-${i}`}>
          {i > 0 ? <ChevronRight aria-hidden className="size-3.5 shrink-0 text-[#b0aea6]" /> : null}
          {crumb.to ? (
            <Link to={crumb.to} className="shrink-0 hover:text-ink">
              {crumb.label}
            </Link>
          ) : i === trail.length - 1 ? (
            <span aria-current="page" className="truncate font-medium text-ink">
              {crumb.label}
            </span>
          ) : (
            <span className="shrink-0">{crumb.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
