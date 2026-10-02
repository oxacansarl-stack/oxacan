import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Ruler, Search } from 'lucide-react';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { enumLabel } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useCurrentUser } from '../lib/current-user';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/badge';
import { Field, Input, SearchInput, Select } from '@/components/ui/input';
import { DataState, EmptyState, TableSkeleton } from '@/components/states';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

interface Plan {
  id: string;
  name: string;
  fileUrl: string;
  fileType: string;
  floor: string;
  scale: string;
  version: number;
  annotations?: Annotation[];
}

interface Annotation {
  id: string;
  type: string;
  label: string | null;
  color: string;
  geometry: Record<string, unknown>;
}

type PlanForm = {
  name: string;
  fileUrl: string;
  fileType: string;
  floor: string;
  scale: string;
};

const EMPTY_FORM: PlanForm = { name: '', fileUrl: '', fileType: 'pdf', floor: '', scale: '1:50' };

/** Drop empty optional fields so the payload matches CreatePlanDto. */
function toCreatePayload(form: PlanForm): Record<string, string> {
  const payload: Record<string, string> = {
    name: form.name.trim(),
    fileUrl: form.fileUrl.trim(),
    fileType: form.fileType,
  };
  if (form.floor.trim()) payload.floor = form.floor.trim();
  if (form.scale.trim()) payload.scale = form.scale.trim();
  return payload;
}

// Values must match the plan.file_type CHECK constraint (lower-case).
const FILE_TYPES = ['pdf', 'dwg', 'dxf', 'png', 'jpg'] as const;

const DASH = <span className="text-muted">—</span>;

export default function Plans() {
  const { t } = useTranslation('plans');
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();

  const [showForm, setShowForm] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);

  /**
   * Reading plans is open to every role (site staff work from them), but POST /plans answers 403
   * for anyone outside the office roles — so the field roles never see the create control.
   */
  const canCreate = role === 'ADMIN' || role === 'PROJECT_MANAGER';

  const plans = useQuery<Plan[], ApiError>({
    queryKey: ['plans'],
    queryFn: () => apiGet<Plan[]>('/plans'),
    retry: false,
  });

  const detail = useQuery<Plan, ApiError>({
    queryKey: ['plan', selectedPlanId],
    queryFn: () => apiGet<Plan>(`/plans/${selectedPlanId}`),
    enabled: !!selectedPlanId,
    retry: false,
  });

  const create = useMutation<Plan, ApiError, PlanForm>({
    mutationFn: (data) => apiPost<Plan>('/plans', toCreatePayload(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
  });

  const rows = plans.data ?? [];

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((plan) => {
      if (typeFilter && plan.fileType !== typeFilter) return false;
      if (!term) return true;
      return (
        plan.name.toLowerCase().includes(term) ||
        (plan.floor ?? '').toLowerCase().includes(term) ||
        (plan.scale ?? '').toLowerCase().includes(term)
      );
    });
  }, [rows, search, typeFilter]);

  // The annotations panel renders inside DataState, whose children are built before it decides
  // what to show — so this must stay safe while the record is still loading.
  const annotations = detail.data?.annotations ?? [];

  const formValid = form.name.trim().length > 0 && form.fileUrl.trim().length > 0;
  const filtering = typeFilter.length > 0 || search.trim().length > 0;

  return (
    <PageBody>
      <PageHeader
        title={t('title')}
        kicker={t('common:navGroup.reference')}
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => setShowForm(true)}>
              <Plus />
              {t('actions.new')}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft p-3">
          <div className="flex flex-wrap gap-0.5" role="group" aria-label={t('filters.fileType')}>
            {['', ...FILE_TYPES].map((value) => (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={typeFilter === value}
                onClick={() => setTypeFilter(value)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:text-ink',
                  typeFilter === value && 'bg-chalk font-medium text-ink',
                )}
              >
                {value ? enumLabel('fileType', value) : t('filters.all')}
              </button>
            ))}
          </div>
          <SearchInput
            icon={<Search className="size-4" />}
            placeholder={t('filters.search')}
            aria-label={t('filters.searchLabel')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <DataState
          isLoading={plans.isPending}
          error={
            plans.isError
              ? plans.error.status === 401
                ? t('common:auth.sessionExpired')
                : errorMessage(plans.error, t('messages.loadFailed'))
              : null
          }
          onRetry={() => plans.refetch()}
          isEmpty={visible.length === 0}
          loading={<TableSkeleton rows={6} cols={5} />}
          empty={
            filtering ? (
              <EmptyState title={t('empty.noMatch')} description={t('empty.noMatchHelp')} />
            ) : (
              <EmptyState
                icon={<Ruler className="size-5" />}
                title={t('empty.plans')}
                description={t('empty.plansHelp')}
                action={
                  canCreate ? (
                    <Button variant="ghost" size="sm" onClick={() => setShowForm(true)}>
                      <Plus />
                      {t('actions.new')}
                    </Button>
                  ) : undefined
                }
              />
            )
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('table.name')}</TH>
                  <TH>{t('table.type')}</TH>
                  <TH>{t('table.floor')}</TH>
                  <TH>{t('table.scale')}</TH>
                  <TH>{t('table.version')}</TH>
                </tr>
              </THead>
              <TBody>
                {visible.map((plan) => {
                  const open = selectedPlanId === plan.id;
                  const Chevron = open ? ChevronDown : ChevronRight;
                  return (
                    <Fragment key={plan.id}>
                      <TR
                        onActivate={() => setSelectedPlanId(open ? null : plan.id)}
                        aria-expanded={open}
                        aria-controls={open ? `plan-annotations-${plan.id}` : undefined}
                        className={cn(open && '[&>td]:bg-chalk hover:[&>td]:bg-chalk')}
                      >
                        <TD className="font-medium">
                          <span className="flex items-center gap-1.5">
                            <Chevron aria-hidden className="size-3.5 shrink-0 text-muted" />
                            {plan.name}
                          </span>
                        </TD>
                        <TD>
                          <Tag>{enumLabel('fileType', plan.fileType)}</Tag>
                        </TD>
                        <TD>{plan.floor || DASH}</TD>
                        <TD className="tnum">{plan.scale || DASH}</TD>
                        <TD className="tnum text-muted">
                          {t('table.versionValue', { version: plan.version ?? 1 })}
                        </TD>
                      </TR>

                      {open ? (
                        <tr id={`plan-annotations-${plan.id}`}>
                          <TD colSpan={5} className="h-auto bg-chalk p-0 align-top">
                            <DataState
                              isLoading={detail.isPending}
                              error={
                                detail.isError
                                  ? errorMessage(detail.error, t('messages.detailFailed'))
                                  : null
                              }
                              onRetry={() => detail.refetch()}
                              loading={<TableSkeleton rows={2} cols={2} />}
                            >
                              <section className="grid grid-cols-[minmax(0,1fr)] content-start gap-2 px-3.5 py-4">
                                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                                  {t('annotations.title')}
                                  <span className="tnum font-normal text-muted">{annotations.length}</span>
                                </h3>
                                {annotations.length > 0 ? (
                                  <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
                                    {annotations.map((annotation) => (
                                      <li
                                        key={annotation.id}
                                        className="flex flex-wrap items-center gap-2 text-[13px]"
                                      >
                                        <Tag>{enumLabel('annotationType', annotation.type)}</Tag>
                                        <span className={cn(annotation.label ? 'text-ink-2' : 'text-muted')}>
                                          {annotation.label || t('annotations.untitled')}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-[13px] text-muted">{t('annotations.empty')}</p>
                                )}
                              </section>
                            </DataState>
                          </TD>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('summary.count', { count: visible.length, total: rows.length })}</span>
            <span>{t('summary.sortedBy')}</span>
          </CardFooter>
        </DataState>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('form.title')}</DialogTitle>
            <DialogDescription>{t('form.help')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('form.name')} htmlFor="plan-name" required>
              <Input
                id="plan-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label={t('form.fileUrl')} htmlFor="plan-file-url" hint={t('form.fileUrlHint')} required>
              <Input
                id="plan-file-url"
                type="url"
                inputMode="url"
                value={form.fileUrl}
                onChange={(e) => setForm({ ...form, fileUrl: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
              <Field label={t('form.fileType')} htmlFor="plan-file-type">
                <Select
                  id="plan-file-type"
                  value={form.fileType}
                  onChange={(e) => setForm({ ...form, fileType: e.target.value })}
                >
                  {FILE_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {enumLabel('fileType', value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('form.floor')} htmlFor="plan-floor" hint={t('form.floorHint')}>
                <Input
                  id="plan-floor"
                  value={form.floor}
                  onChange={(e) => setForm({ ...form, floor: e.target.value })}
                />
              </Field>
              <Field label={t('form.scale')} htmlFor="plan-scale" hint={t('form.scaleHint')}>
                <Input
                  id="plan-scale"
                  value={form.scale}
                  onChange={(e) => setForm({ ...form, scale: e.target.value })}
                />
              </Field>
            </div>
            {create.isError ? (
              <p role="alert" className="text-[13px] text-bad">
                {errorMessage(create.error, t('messages.createFailed'))}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!formValid || create.isPending}
              onClick={() => create.mutate(form)}
            >
              {create.isPending ? t('actions.creating') : t('actions.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}
