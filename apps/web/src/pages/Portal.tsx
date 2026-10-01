import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Ban, Check, Copy, KeyRound, Link2, MoreHorizontal, Plus, X } from 'lucide-react';
import { apiDelete, apiGet, apiList, apiPost, ApiError, type PageMeta } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { errorMessage } from '../lib/errors';
import type { PageProps } from '../lib/page-props';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardCount, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/input';
import { DataState, EmptyState, TableSkeleton } from '@/components/states';
import { useConfirm } from '@/components/confirm-dialog';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Ref, TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Project {
  id: string;
  name: string;
}

interface PortalToken {
  id: string;
  token: string;
  projectId: string;
  project?: { name: string };
  expiresAt?: string;
  isActive: boolean;
  createdAt: string;
}

interface TokenForm {
  projectId: string;
  expiresAt: string;
}

const EMPTY_FORM: TokenForm = { projectId: '', expiresAt: '' };

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** The jeton is a secret: the list shows only its ends, the copy action carries the whole value. */
function maskToken(token: string): string {
  if (token.length <= 8) return token;
  return token.slice(0, 4) + '...' + token.slice(-4);
}

function timeAgo(dateStr: string, t: TFunction): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 30) return t('timeAgo.months', { count: Math.floor(days / 30) });
  if (days > 0) return t('timeAgo.days', { count: days });
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return t('timeAgo.hours', { count: hours });
  const mins = Math.floor(diff / 60000);
  return mins > 0 ? t('timeAgo.minutes', { count: mins }) : t('timeAgo.justNow');
}

/**
 * Clipboard write, with the textarea fallback for the browsers that refuse the async API.
 * Returns false when neither route worked, so the page can say so instead of pretending.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Portal({ embedded = false }: PageProps) {
  const { t } = useTranslation('portal');
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<TokenForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionAlert, setActionAlert] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // "Copié !" is transient feedback on the button itself; the timer must not outlive the page.
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const tokens = useQuery<{ items: PortalToken[]; meta: PageMeta }, ApiError>({
    queryKey: ['portal-tokens', page],
    queryFn: () => apiList<PortalToken>(`/portal/tokens?page=${page}`),
    retry: false,
  });

  // The project list only fills the create dropdown: a failure is reported in the dialog,
  // it does not keep the page from showing the links that already exist.
  const projects = useQuery<Project[], ApiError>({
    queryKey: ['projects-list'],
    queryFn: () => apiGet<Project[]>('/projects?limit=100'),
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['portal-tokens'] });

  const create = useMutation<unknown, ApiError, TokenForm>({
    mutationFn: (values) => {
      const body: { projectId: string; expiresAt?: string } = { projectId: values.projectId };
      // expiresAt is a timestamp: the link stays valid until the end of the chosen (local) day.
      if (values.expiresAt) {
        body.expiresAt = new Date(`${values.expiresAt}T23:59:59`).toISOString();
      }
      return apiPost('/portal/tokens', body);
    },
    onSuccess: () => {
      closeForm();
      setActionAlert(null);
      setNotice(t('messages.created'));
      invalidate();
    },
  });

  const revoke = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => apiDelete(`/portal/tokens/${id}`),
    onSuccess: () => {
      setActionAlert(null);
      setNotice(t('messages.revoked'));
      invalidate();
    },
    onError: (err) => {
      setNotice(null);
      setActionAlert(errorMessage(err, t('messages.revokeFailed')));
    },
  });

  const rows = tokens.data?.items ?? [];
  const meta = tokens.data?.meta;
  const total = meta?.total ?? rows.length;
  const totalPages = Math.max(1, meta?.totalPages ?? 1);

  function closeForm() {
    setFormOpen(false);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  const openCreate = () => {
    create.reset();
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    if (!form.projectId) {
      setFormError(t('messages.projectRequired'));
      return;
    }
    setFormError(null);
    create.mutate(form);
  };

  const handleRevoke = async (token: PortalToken) => {
    if (
      !(await confirm({
        title: t('revoke.title'),
        description: t('revoke.description'),
        confirmLabel: t('actions.revoke'),
      }))
    ) {
      return;
    }
    revoke.mutate(token.id);
  };

  const flashCopied = (key: string) => {
    setCopied(key);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 2000);
  };

  const handleCopy = async (key: string, text: string, message: string) => {
    if (await copyToClipboard(text)) {
      setActionAlert(null);
      setNotice(message);
      flashCopied(key);
    } else {
      setNotice(null);
      setActionAlert(t('messages.copyFailed'));
    }
  };

  /** The client view is a public, token-scoped route: the link is the whole credential. */
  const portalUrl = (token: string) => `${window.location.origin}/portal/view/${token}`;

  const newButton = (
    <Button variant="primary" onClick={openCreate}>
      <Plus />
      {t('actions.new')}
    </Button>
  );

  return (
    <PageBody>
      {embedded ? null : (
        <PageHeader title={t('title')} kicker={t('common:nav.admin')} actions={newButton} />
      )}

      {/* Outside the embedded guard: Portal only ever renders as a tab, and the explanation
          of what a portal link is must survive that. */}
      <p className="max-w-[86ch] text-[13.5px] text-muted">{t('subtitle')}</p>

      {notice ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2.5 rounded-card border border-line bg-ok-bg px-3.5 py-2 text-[13px] text-ok"
        >
          <span>{notice}</span>
          <Button
            variant="quiet"
            size="iconSm"
            className="text-current"
            aria-label={t('common:actions.close')}
            onClick={() => setNotice(null)}
          >
            <X />
          </Button>
        </div>
      ) : null}

      {actionAlert ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2.5 rounded-card border border-line bg-bad-bg px-3.5 py-2 text-[13px] text-bad"
        >
          <span>{actionAlert}</span>
          <Button
            variant="quiet"
            size="iconSm"
            className="text-current"
            aria-label={t('actions.dismiss')}
            onClick={() => setActionAlert(null)}
          >
            <X />
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {t('card.title')}
            {tokens.isPending ? null : <CardCount>{total}</CardCount>}
          </CardTitle>
          {/* Embedded as a tab of Administration, the host header carries no actions. */}
          {embedded ? newButton : null}
        </CardHeader>

        <DataState
          isLoading={tokens.isPending}
          error={tokens.isError ? errorMessage(tokens.error, t('messages.loadFailed')) : null}
          onRetry={() => tokens.refetch()}
          isEmpty={rows.length === 0}
          loading={<TableSkeleton rows={4} cols={6} />}
          empty={
            <EmptyState
              icon={<Link2 className="size-5" />}
              title={t('empty.title')}
              description={t('empty.text')}
              action={
                <Button variant="ghost" size="sm" onClick={openCreate}>
                  <Plus />
                  {t('actions.new')}
                </Button>
              }
            />
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('table.project')}</TH>
                  <TH>{t('table.token')}</TH>
                  <TH>{t('table.created')}</TH>
                  <TH>{t('table.expires')}</TH>
                  <TH>{t('table.status')}</TH>
                  <TH className="w-[180px]">
                    <span className="sr-only">{t('table.actions')}</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((link) => (
                  <TR key={link.id}>
                    <TD className="font-medium">{link.project?.name || link.projectId}</TD>
                    <TD>
                      <Ref>{maskToken(link.token)}</Ref>
                    </TD>
                    <TD className="tnum text-muted" title={formatDateTime(link.createdAt)}>
                      {timeAgo(link.createdAt, t)}
                    </TD>
                    <TD className="tnum text-muted">
                      {link.expiresAt ? formatDate(link.expiresAt) : t('state.never')}
                    </TD>
                    <TD>
                      <Badge tone={link.isActive ? 'ok' : 'bad'}>
                        {link.isActive ? t('state.active') : t('state.revoked')}
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            void handleCopy(
                              `${link.id}:url`,
                              portalUrl(link.token),
                              t('messages.urlCopied'),
                            );
                          }}
                        >
                          {copied === `${link.id}:url` ? <Check /> : <Copy />}
                          {copied === `${link.id}:url` ? t('actions.copied') : t('actions.copyUrl')}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="quiet" size="iconSm" aria-label={t('actions.rowActions')}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onSelect={() => {
                                void handleCopy(
                                  `${link.id}:token`,
                                  link.token,
                                  t('messages.tokenCopied'),
                                );
                              }}
                            >
                              <KeyRound />
                              {t('actions.copyToken')}
                            </DropdownMenuItem>
                            {link.isActive ? (
                              <DropdownMenuItem
                                className="text-bad"
                                disabled={revoke.isPending}
                                onSelect={() => {
                                  void handleRevoke(link);
                                }}
                              >
                                <Ban />
                                {t('actions.revoke')}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('summary.count', { count: rows.length, total })}</span>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('common:actions.previous')}
                </Button>
                <span className="tnum">{t('common:state.page', { page, total: totalPages })}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t('common:actions.next')}
                </Button>
              </div>
            ) : (
              <span>{t('summary.sortedBy')}</span>
            )}
          </CardFooter>
        </DataState>
      </Card>

      <Dialog open={formOpen} onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{t('form.title')}</DialogTitle>
              <DialogDescription>{t('form.help')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field
                label={t('form.project')}
                htmlFor="portal-project"
                required
                error={formError ?? (projects.isError ? t('form.projectsFailed') : undefined)}
              >
                <Select
                  id="portal-project"
                  value={form.projectId}
                  onChange={(e) => {
                    setForm({ ...form, projectId: e.target.value });
                    setFormError(null);
                  }}
                >
                  <option value="">{t('form.selectProject')}</option>
                  {(projects.data ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('form.expiresAt')}
                htmlFor="portal-expires"
                hint={t('form.expiresAtHint')}
              >
                <Input
                  id="portal-expires"
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                />
              </Field>
              {create.isError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {errorMessage(create.error, t('messages.createFailed'))}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={closeForm}>
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={create.isPending}>
                {create.isPending ? t('actions.creating') : t('actions.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}
