import { useEffect, useMemo, useRef, useState, type FormEvent, type SyntheticEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Plus, Receipt, Trash2 } from 'lucide-react';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { enumLabel, formatDate, formatMoney, statusLabel } from '../lib/format';
import { useCurrentUser, type Role } from '../lib/current-user';
import { MetaDivider, PageBody, PageHeader } from '@/components/page-header';
import { Card, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Label, Select, Textarea } from '@/components/ui/input';
import { Tag } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
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
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

interface Project {
  id: string;
  name: string;
  reference?: string;
}

interface Expense {
  id: string;
  userId: string;
  projectId?: string;
  project?: { name: string; reference?: string };
  date: string;
  category: string;
  description: string;
  amountCents: number;
  receiptUrl?: string;
  isBillable: boolean;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  rejectionReason?: string | null;
  createdAt: string;
}

/** DB CHECK constraint on expense.category; the labels come from `enum.expenseCategory`. */
const CATEGORIES = [
  'material',
  'travel',
  'per_diem',
  'subcontractor',
  'equipment_rental',
  'other',
] as const;

const STATUS_TABS = ['all', 'draft', 'submitted', 'approved', 'rejected'] as const;

/** Mirrors the API's SITE_LEAD_ROLES on /expenses/approve and /expenses/reject. */
const APPROVER_ROLES: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER'];

/** Only an own expense in one of these states may be submitted for approval. */
const SUBMITTABLE = new Set(['draft', 'rejected']);

const today = () => new Date().toISOString().slice(0, 10);

/** Keeps a control inside a row from also toggling the row's selection. */
const stopRowActivation = (event: SyntheticEvent) => event.stopPropagation();

export default function Expenses() {
  const { t } = useTranslation('expenses');
  const me = useCurrentUser();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  // Filters and selection
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionAlert, setActionAlert] = useState<string | null>(null);

  // Create form
  const [formOpen, setFormOpen] = useState(false);
  const [formProjectId, setFormProjectId] = useState('');
  const [formDate, setFormDate] = useState<string>(today);
  const [formCategory, setFormCategory] = useState<string>('material');
  const [formDescription, setFormDescription] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formBillable, setFormBillable] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);

  // Rejection reason
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  // Approving is the API's call; the UI only hides what would answer 403.
  const canApprove = APPROVER_ROLES.includes(me.role);

  // The top bar's "Créer" menu links here with ?new=1.
  useEffect(() => {
    if (params.get('new') === '1') {
      setFormOpen(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const expenses = useQuery<Expense[], ApiError>({
    queryKey: ['expenses', statusFilter, categoryFilter],
    queryFn: () => {
      const query = new URLSearchParams({ limit: '100' });
      if (statusFilter && statusFilter !== 'all') query.set('status', statusFilter);
      if (categoryFilter) query.set('category', categoryFilter);
      return apiGet<Expense[]>(`/expenses?${query.toString()}`);
    },
    retry: false,
  });

  const projects = useQuery<Project[], ApiError>({
    queryKey: ['projects-list'],
    queryFn: () => apiGet<Project[]>('/projects'),
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['expenses'] });

  const resetForm = () => {
    setFormProjectId('');
    setFormDate(today());
    setFormCategory('material');
    setFormDescription('');
    setFormAmount('');
    setFormBillable(false);
    setAmountError(null);
  };

  const create = useMutation({
    /*
     * CreateExpenseDto. The API also accepts `vatRateBps` per expense — 0, 260, 380 or 810 basis
     * points (0 %, 2.6 %, 3.8 %, 8.1 %) — and derives `vatAmountCents` from it. This form has
     * never collected a rate, so it is left unset (VAT unknown) rather than guessed here.
     */
    mutationFn: (data: {
      projectId?: string;
      date: string;
      category: string;
      description: string;
      amountCents: number;
      isBillable: boolean;
    }) => apiPost('/expenses', data),
    onSuccess: () => {
      resetForm();
      setFormOpen(false);
      invalidate();
    },
  });

  const submit = useMutation({
    mutationFn: (expenseIds: string[]) => apiPost('/expenses/submit', { expenseIds }),
    onMutate: () => setActionAlert(null),
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
    },
    onError: (err) => setActionAlert(errorMessage(err, t('messages.submitFailed'))),
  });

  const approve = useMutation({
    mutationFn: (expenseIds: string[]) => apiPost('/expenses/approve', { expenseIds }),
    onMutate: () => setActionAlert(null),
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
    },
    onError: (err) =>
      setActionAlert(
        err instanceof ApiError && err.status === 403
          ? t('messages.approveForbidden')
          : errorMessage(err, t('messages.approveFailed')),
      ),
  });

  const reject = useMutation({
    mutationFn: (data: { expenseIds: string[]; reason: string }) =>
      apiPost('/expenses/reject', { expenseIds: data.expenseIds, reason: data.reason }),
    onSuccess: () => {
      setSelected(new Set());
      setRejectOpen(false);
      setRejectReason('');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/expenses/${id}`),
    onMutate: () => setActionAlert(null),
    onSuccess: () => invalidate(),
    onError: (err) => setActionAlert(errorMessage(err, t('messages.deleteFailed'))),
  });

  const rows = expenses.data ?? [];
  const total = rows.reduce((sum, expense) => sum + (expense.amountCents ?? 0), 0);
  const actionPending = submit.isPending || approve.isPending || reject.isPending;
  const filtered = statusFilter !== 'all' || categoryFilter !== '';

  const categorySummary = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        total: rows
          .filter((expense) => expense.category === category)
          .reduce((sum, expense) => sum + (expense.amountCents ?? 0), 0),
      })).filter((entry) => entry.total > 0),
    [rows],
  );

  // "Some but not all selected" is a visual state only a ref can set on a native checkbox.
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.size > 0 && selected.size < rows.length;
    }
  }, [selected, rows.length]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSelectAll = () =>
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((e) => e.id))));

  const changeStatus = (tab: string) => {
    setStatusFilter(tab);
    setSelected(new Set());
    setActionAlert(null);
  };

  const openForm = () => {
    create.reset();
    setAmountError(null);
    setFormOpen(true);
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!formDescription || !formAmount) return;
    // CHF → integer centimes (the API rejects negatives and non-integers).
    const amountCents = Math.round(parseFloat(formAmount) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 0) {
      setAmountError(t('messages.invalidAmount'));
      return;
    }
    setAmountError(null);
    create.mutate({
      projectId: formProjectId || undefined,
      date: formDate,
      category: formCategory,
      description: formDescription,
      amountCents,
      isBillable: formBillable,
    });
  };

  const handleSubmitSelected = () => {
    if (selected.size === 0) return;
    // Only the caller's own drafts (or expenses sent back) can be submitted.
    const expenseIds = rows
      .filter(
        (expense) =>
          selected.has(expense.id) && expense.userId === me.id && SUBMITTABLE.has(expense.status),
      )
      .map((expense) => expense.id);
    if (expenseIds.length === 0) {
      setActionAlert(t('messages.selectOwnDrafts'));
      return;
    }
    submit.mutate(expenseIds);
  };

  const openReject = () => {
    if (selected.size === 0) return;
    setRejectReason('');
    setReasonError(null);
    setActionAlert(null);
    reject.reset();
    setRejectOpen(true);
  };

  const confirmReject = () => {
    const reason = rejectReason.trim();
    if (!reason) {
      setReasonError(t('reject.reasonRequired'));
      return;
    }
    setReasonError(null);
    reject.mutate({ expenseIds: Array.from(selected), reason });
  };

  const handleDelete = async (expense: Expense) => {
    if (
      !(await confirm({
        title: t('prompts.confirmDelete'),
        description: t('common:confirm.irreversible'),
      }))
    ) {
      return;
    }
    remove.mutate(expense.id);
  };

  const rejectError = reject.isError
    ? reject.error instanceof ApiError && reject.error.status === 403
      ? t('messages.rejectForbidden')
      : errorMessage(reject.error, t('messages.rejectFailed'))
    : null;

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        kicker={t('common:navGroup.people')}
        meta={
          rows.length > 0 ? (
            <>
              <span>{t('summary.count', { count: rows.length })}</span>
              <MetaDivider />
              <span className="tnum">{t('summary.total', { amount: formatMoney(total) })}</span>
            </>
          ) : undefined
        }
        actions={
          <Button variant="primary" onClick={openForm}>
            <Plus />
            {t('actions.new')}
          </Button>
        }
      />

      {categorySummary.length > 0 ? (
        <section
          aria-label={t('summary.byCategory')}
          className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3"
        >
          {categorySummary.map((entry) => (
            <Card key={entry.category} className="px-3.5 py-3">
              <div className="text-xs text-muted">{enumLabel('expenseCategory', entry.category)}</div>
              <div className="tnum mt-0.5 text-[17px] font-semibold text-ink">
                {formatMoney(entry.total)}
              </div>
            </Card>
          ))}
        </section>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft p-3">
          <div className="flex flex-wrap gap-0.5" role="group" aria-label={t('filters.status')}>
            {STATUS_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={statusFilter === tab}
                onClick={() => changeStatus(tab)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:text-ink',
                  statusFilter === tab && 'bg-chalk font-medium text-ink',
                )}
              >
                {tab === 'all' ? t('tabs.all') : statusLabel('expense', tab)}
              </button>
            ))}
          </div>
          <Select
            className="w-auto min-w-[180px]"
            aria-label={t('filters.category')}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">{t('filters.allCategories')}</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {enumLabel('expenseCategory', category)}
              </option>
            ))}
          </Select>
        </div>

        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-paper-2 px-3.5 py-2.5">
            <span className="text-[13px] text-muted">
              {t('bulk.selected', { count: selected.size })}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleSubmitSelected} disabled={actionPending}>
                {t('actions.submit', { count: selected.size })}
              </Button>
              {canApprove ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => approve.mutate(Array.from(selected))}
                    disabled={actionPending}
                  >
                    {t('actions.approve', { count: selected.size })}
                  </Button>
                  <Button size="sm" onClick={openReject} disabled={actionPending}>
                    {t('actions.reject', { count: selected.size })}
                  </Button>
                </>
              ) : null}
              <Button size="sm" variant="quiet" onClick={() => setSelected(new Set())}>
                {t('bulk.clear')}
              </Button>
            </div>
          </div>
        ) : null}

        {actionAlert ? (
          <p role="alert" className="border-b border-line-soft px-3.5 py-2.5 text-[13px] text-bad">
            {actionAlert}
          </p>
        ) : null}

        <DataState
          isLoading={expenses.isPending}
          error={expenses.isError ? errorMessage(expenses.error, t('messages.loadFailed')) : null}
          onRetry={() => expenses.refetch()}
          isEmpty={rows.length === 0}
          loading={<TableSkeleton rows={6} cols={6} />}
          empty={
            filtered ? (
              <EmptyState
                icon={<Receipt className="size-5" />}
                title={t('noMatch')}
                description={t('noMatchHelp')}
              />
            ) : (
              <EmptyState
                icon={<Receipt className="size-5" />}
                title={t('empty')}
                description={t('emptyHelp')}
                action={
                  <Button variant="ghost" size="sm" onClick={openForm}>
                    <Plus />
                    {t('actions.new')}
                  </Button>
                }
              />
            )
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH className="w-9">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className="size-3.5 cursor-pointer accent-graphite"
                      aria-label={t('table.selectAll')}
                      checked={rows.length > 0 && selected.size === rows.length}
                      onChange={toggleSelectAll}
                    />
                  </TH>
                  <TH>{t('table.date')}</TH>
                  <TH>{t('table.category')}</TH>
                  <TH>{t('table.description')}</TH>
                  <TH>{t('table.project')}</TH>
                  <TH numeric>{t('table.amount')}</TH>
                  <TH>{t('table.billable')}</TH>
                  <TH>{t('table.status')}</TH>
                  <TH className="w-11">
                    <span className="sr-only">{t('table.actions')}</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((expense) => {
                  const isSelected = selected.has(expense.id);
                  return (
                    <TR
                      key={expense.id}
                      onActivate={() => toggleSelect(expense.id)}
                      aria-pressed={isSelected}
                      className={cn(isSelected && '[&>td]:bg-chalk')}
                    >
                      <TD onClick={stopRowActivation} onKeyDown={stopRowActivation}>
                        <input
                          type="checkbox"
                          className="size-3.5 cursor-pointer accent-graphite"
                          aria-label={t('table.selectRow', { description: expense.description })}
                          checked={isSelected}
                          onChange={() => toggleSelect(expense.id)}
                        />
                      </TD>
                      <TD className="tnum whitespace-nowrap">{formatDate(expense.date)}</TD>
                      <TD>
                        <Tag>{enumLabel('expenseCategory', expense.category)}</Tag>
                      </TD>
                      <TD>
                        <span className="block max-w-[260px] truncate" title={expense.description}>
                          {expense.description}
                        </span>
                      </TD>
                      <TD className="text-muted">{expense.project?.name || '—'}</TD>
                      <TD numeric className="font-medium">
                        {formatMoney(expense.amountCents)}
                      </TD>
                      <TD className={expense.isBillable ? 'font-medium text-ok' : 'text-muted'}>
                        {expense.isBillable ? t('common:actions.yes') : t('common:actions.no')}
                      </TD>
                      <TD>
                        <StatusBadge domain="expense" value={expense.status} />
                        {expense.status === 'rejected' && expense.rejectionReason ? (
                          <p className="mt-1 max-w-[260px] text-xs text-bad">
                            {t('table.reason', { reason: expense.rejectionReason })}
                          </p>
                        ) : null}
                      </TD>
                      <TD onClick={stopRowActivation} onKeyDown={stopRowActivation}>
                        {expense.status === 'draft' ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="quiet"
                                size="iconSm"
                                aria-label={t('actions.rowActions')}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem
                                className="text-bad"
                                disabled={remove.isPending}
                                onSelect={() => {
                                  void handleDelete(expense);
                                }}
                              >
                                <Trash2 />
                                {t('common:actions.delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('summary.count', { count: rows.length })}</span>
            <span>{t('summary.sortedBy')}</span>
          </CardFooter>
        </DataState>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>{t('form.title')}</DialogTitle>
              <DialogDescription>{t('form.help')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('form.project')} htmlFor="expense-project">
                  <Select
                    id="expense-project"
                    value={formProjectId}
                    onChange={(e) => setFormProjectId(e.target.value)}
                  >
                    <option value="">{t('form.noProject')}</option>
                    {(projects.data ?? []).map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.reference ? `${project.reference} — ` : ''}
                        {project.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('form.date')} htmlFor="expense-date" required>
                  <Input
                    id="expense-date"
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    required
                  />
                </Field>
                <Field label={t('form.category')} htmlFor="expense-category" required>
                  <Select
                    id="expense-category"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {enumLabel('expenseCategory', category)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('form.amount')}
                  htmlFor="expense-amount"
                  hint={t('form.amountHint')}
                  error={amountError ?? undefined}
                  required
                >
                  <Input
                    id="expense-amount"
                    type="number"
                    step="0.05"
                    min="0"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    required
                  />
                </Field>
                <Field
                  label={t('form.description')}
                  htmlFor="expense-description"
                  className="sm:col-span-2"
                  required
                >
                  <Input
                    id="expense-description"
                    placeholder={t('form.descriptionPlaceholder')}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    required
                  />
                </Field>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="expense-billable"
                  type="checkbox"
                  className="size-3.5 cursor-pointer accent-graphite"
                  checked={formBillable}
                  onChange={(e) => setFormBillable(e.target.checked)}
                />
                <Label htmlFor="expense-billable" className="cursor-pointer">
                  {t('form.billable')}
                </Label>
              </div>
              {create.isError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {errorMessage(create.error, t('messages.createFailed'))}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setFormOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={create.isPending}>
                {create.isPending ? t('actions.creating') : t('actions.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="w-[min(480px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>{t('reject.title', { count: selected.size })}</DialogTitle>
            <DialogDescription>{t('reject.help')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field
              label={t('reject.reason')}
              htmlFor="expense-reject-reason"
              error={reasonError ?? undefined}
              required
            >
              <Textarea
                id="expense-reject-reason"
                placeholder={t('reject.reasonPlaceholder')}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </Field>
            {rejectError ? (
              <p role="alert" className="text-[13px] text-bad">
                {rejectError}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="danger" onClick={confirmReject} disabled={reject.isPending}>
              {reject.isPending ? t('reject.rejecting') : t('reject.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}
