import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Building2, FileText, Search } from 'lucide-react';
import { apiList } from '@/lib/api';
import { ALL_NAV_ITEMS, OFFICE, canSee } from '@/app/nav';
import type { Role } from '@/lib/current-user';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface OfferRow {
  id: string;
  reference: string | null;
  projectName: string;
}
interface ClientRow {
  id: string;
  name: string;
}

function useDebounced(value: string, delay = 220): string {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * ⌘K jumps anywhere: every page the role may open, plus live lookups of offers and clients.
 * There is no cross-entity search endpoint, so this queries each list's own ?search= — the
 * same filter those pages use.
 */
export function CommandPalette({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const term = useDebounced(query.trim());
  const canSearchRecords = OFFICE.includes(role);
  const enabled = open && canSearchRecords && term.length >= 2;

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const offers = useQuery({
    queryKey: ['palette', 'offers', term],
    queryFn: () => apiList<OfferRow>(`/offers?search=${encodeURIComponent(term)}&limit=5`),
    enabled,
    retry: false,
  });

  const clients = useQuery({
    queryKey: ['palette', 'clients', term],
    queryFn: () => apiList<ClientRow>(`/clients?search=${encodeURIComponent(term)}&limit=5`),
    enabled,
    retry: false,
  });

  const pages = ALL_NAV_ITEMS.filter((item) => canSee(item, role));

  function go(to: string) {
    onOpenChange(false);
    navigate(to);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12vh] w-[min(580px,calc(100vw-32px))] translate-y-0 p-0" hideClose>
        <DialogTitle className="sr-only">{t('shell.searchDialog')}</DialogTitle>
        {/* cmdk filters the page list itself; remote rows are already filtered by the server. */}
        <Command shouldFilter={false} loop className="overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
            <Search aria-hidden className="size-4 shrink-0 text-muted" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={t('shell.searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            />
            <kbd className="rounded border border-line px-1.5 text-[11px] text-muted">Échap</kbd>
          </div>

          <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
            <Command.Empty className="px-2.5 py-5 text-[13.5px] text-muted">
              {t('shell.noResults', { query })}
            </Command.Empty>

            <Command.Group
              heading={t('shell.goTo')}
              className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted"
            >
              {pages
                .filter((item) => {
                  const label = t(item.labelKey).toLowerCase();
                  const needle = query.trim().toLowerCase();
                  return !needle || label.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(
                    needle.normalize('NFD').replace(/[̀-ͯ]/g, ''),
                  );
                })
                .map((item) => (
                  <Command.Item
                    key={item.to}
                    value={`page:${item.to}`}
                    onSelect={() => go(item.to)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] data-[selected=true]:bg-chalk"
                  >
                    <item.icon className="size-4 text-muted" />
                    {t(item.labelKey)}
                  </Command.Item>
                ))}
            </Command.Group>

            {(offers.data?.items.length ?? 0) > 0 ? (
              <Command.Group
                heading={t('nav.offers')}
                className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted"
              >
                {offers.data!.items.map((offer) => (
                  <Command.Item
                    key={offer.id}
                    value={`offer:${offer.id}`}
                    onSelect={() => go(`/offers/${offer.id}`)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] data-[selected=true]:bg-chalk"
                  >
                    <FileText className="size-4 text-muted" />
                    <span className="truncate">{offer.projectName}</span>
                    {offer.reference ? (
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{offer.reference}</span>
                    ) : null}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            {(clients.data?.items.length ?? 0) > 0 ? (
              <Command.Group
                heading={t('nav.clients')}
                className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted"
              >
                {clients.data!.items.map((client) => (
                  <Command.Item
                    key={client.id}
                    value={`client:${client.id}`}
                    onSelect={() => go('/clients')}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] data-[selected=true]:bg-chalk"
                  >
                    <Building2 className="size-4 text-muted" />
                    <span className="truncate">{client.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
          </Command.List>

          <div className="flex flex-wrap gap-3.5 border-t border-line-soft px-4 py-2 text-[11px] text-muted">
            <span>↑ ↓ {t('shell.navigate')}</span>
            <span>↵ {t('shell.open')}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
