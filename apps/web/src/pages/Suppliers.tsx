import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Search, Trash2, Truck } from 'lucide-react';
import { apiDelete, apiList, apiPost, apiPut, ApiError, type PageMeta } from '../lib/api';
import { errorMessage } from '../lib/errors';
import type { PageProps } from '../lib/page-props';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, SearchInput, Textarea } from '@/components/ui/input';
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

interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  paymentTermsDays: number;
  createdAt: string;
}

interface SupplierForm {
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  paymentTermsDays: number;
}

const EMPTY_FORM: SupplierForm = {
  name: '',
  contactPerson: '',
  email: '',
  phone: '',
  address: '',
  paymentTermsDays: 30,
};

/**
 * Create drops the optional fields left empty: the API validates `email` and rejects "".
 * `paymentTermsDays` is always sent, so the server default never overrides what was typed.
 */
function toCreateBody(form: SupplierForm): Record<string, unknown> {
  const body: Record<string, unknown> = { name: form.name.trim() };
  if (form.contactPerson.trim()) body.contactPerson = form.contactPerson.trim();
  if (form.email.trim()) body.email = form.email.trim();
  if (form.phone.trim()) body.phone = form.phone.trim();
  if (form.address.trim()) body.address = form.address.trim();
  body.paymentTermsDays = form.paymentTermsDays;
  return body;
}

/** Update sends `null` for a cleared field, which is how the API erases it. */
function toUpdateBody(form: SupplierForm): Record<string, unknown> {
  return {
    name: form.name.trim(),
    contactPerson: form.contactPerson.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    address: form.address.trim() || null,
    paymentTermsDays: form.paymentTermsDays,
  };
}

const DASH = <span className="text-muted">—</span>;

/** Keeps a control inside a clickable row from also opening the row's edit dialog. */
const stopRowActivation = (event: SyntheticEvent) => event.stopPropagation();

export default function Suppliers({ embedded = false }: PageProps) {
  const { t } = useTranslation('suppliers');
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const [actionAlert, setActionAlert] = useState<string | null>(null);

  // `search` is a server-side filter (name and contact person), so it belongs in the query key.
  const suppliers = useQuery<{ items: Supplier[]; meta: PageMeta }, ApiError>({
    queryKey: ['suppliers', search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const qs = params.toString();
      return apiList<Supplier>(`/suppliers${qs ? `?${qs}` : ''}`);
    },
    retry: false,
  });

  const save = useMutation<Supplier, ApiError, { id: string | null; values: SupplierForm }>({
    mutationFn: ({ id, values }) =>
      id
        ? apiPut<Supplier>(`/suppliers/${id}`, toUpdateBody(values))
        : apiPost<Supplier>('/suppliers', toCreateBody(values)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeForm();
    },
  });

  const remove = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => apiDelete(`/suppliers/${id}`),
    onSuccess: () => {
      setActionAlert(null);
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (err) => setActionAlert(errorMessage(err, t('messages.deleteFailed'))),
  });

  const rows = suppliers.data?.items ?? [];
  const total = suppliers.data?.meta?.total ?? rows.length;
  const searching = search.trim().length > 0;
  const formValid = form.name.trim().length > 0;

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  const openCreate = () => {
    save.reset();
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (supplier: Supplier) => {
    save.reset();
    setEditingId(supplier.id);
    setForm({
      name: supplier.name,
      contactPerson: supplier.contactPerson ?? '',
      email: supplier.email ?? '',
      phone: supplier.phone ?? '',
      address: supplier.address ?? '',
      paymentTermsDays: supplier.paymentTermsDays,
    });
    setFormOpen(true);
  };

  const handleDelete = async (supplier: Supplier) => {
    if (
      !(await confirm({
        title: t('delete.title', { name: supplier.name }),
        description: t('delete.description'),
      }))
    ) {
      return;
    }
    remove.mutate(supplier.id);
  };

  const newButton = (
    <Button variant="primary" onClick={openCreate}>
      <Plus />
      {t('actions.new')}
    </Button>
  );

  return (
    <PageBody>
      {embedded ? null : (
        <PageHeader
          title={t('title')}
          kicker={t('common:navGroup.procurement')}
          meta={suppliers.isSuccess ? <span>{t('count', { count: total })}</span> : undefined}
          actions={newButton}
        />
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-soft p-3">
          <SearchInput
            icon={<Search className="size-4" />}
            placeholder={t('filters.search')}
            aria-label={t('filters.searchLabel')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {/* Embedded as a tab of Achats, the host header carries no actions — so this one does. */}
          {embedded ? newButton : null}
        </div>

        {actionAlert ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-3.5 py-2.5">
            <p role="alert" className="text-[13px] text-bad">
              {actionAlert}
            </p>
            <Button variant="quiet" size="sm" onClick={() => setActionAlert(null)}>
              {t('actions.dismiss')}
            </Button>
          </div>
        ) : null}

        <DataState
          isLoading={suppliers.isPending}
          error={
            suppliers.isError
              ? suppliers.error.status === 401
                ? t('common:auth.sessionExpired')
                : errorMessage(suppliers.error, t('messages.loadFailed'))
              : null
          }
          onRetry={() => suppliers.refetch()}
          isEmpty={rows.length === 0}
          loading={<TableSkeleton rows={6} cols={6} />}
          empty={
            searching ? (
              <EmptyState
                icon={<Truck className="size-5" />}
                title={t('empty.search', { search })}
                description={t('empty.searchHelp')}
              />
            ) : (
              <EmptyState
                icon={<Truck className="size-5" />}
                title={t('empty.none')}
                description={t('empty.noneHelp')}
                action={
                  <Button variant="ghost" size="sm" onClick={openCreate}>
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
                  <TH>{t('table.name')}</TH>
                  <TH>{t('table.contactPerson')}</TH>
                  <TH>{t('table.email')}</TH>
                  <TH>{t('table.phone')}</TH>
                  <TH>{t('table.paymentTerms')}</TH>
                  <TH className="w-11">
                    <span className="sr-only">{t('table.actions')}</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((supplier) => (
                  <TR key={supplier.id} onActivate={() => openEdit(supplier)}>
                    <TD className="font-medium">{supplier.name}</TD>
                    <TD>{supplier.contactPerson || DASH}</TD>
                    <TD onClick={stopRowActivation} onKeyDown={stopRowActivation}>
                      {supplier.email ? (
                        <a href={`mailto:${supplier.email}`} className="text-copper hover:underline">
                          {supplier.email}
                        </a>
                      ) : (
                        DASH
                      )}
                    </TD>
                    <TD className="tnum">{supplier.phone || DASH}</TD>
                    <TD className="tnum text-muted">
                      {t('table.days', { count: supplier.paymentTermsDays })}
                    </TD>
                    <TD onClick={stopRowActivation} onKeyDown={stopRowActivation}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="quiet" size="iconSm" aria-label={t('actions.rowActions')}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => openEdit(supplier)}>
                            <Pencil />
                            {t('common:actions.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-bad"
                            disabled={remove.isPending}
                            onSelect={() => {
                              void handleDelete(supplier);
                            }}
                          >
                            <Trash2 />
                            {t('common:actions.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('summary.count', { count: rows.length, total })}</span>
            <span>{t('summary.sortedBy')}</span>
          </CardFooter>
        </DataState>
      </Card>

      <Dialog open={formOpen} onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? t('form.editTitle') : t('form.title')}</DialogTitle>
            <DialogDescription>{editingId ? t('form.editHelp') : t('form.help')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('form.name')} htmlFor="supplier-name" required>
              <Input
                id="supplier-name"
                value={form.name}
                placeholder={t('form.namePlaceholder')}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('form.contactPerson')} htmlFor="supplier-contact">
                <Input
                  id="supplier-contact"
                  value={form.contactPerson}
                  placeholder={t('form.contactPersonPlaceholder')}
                  onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                />
              </Field>
              <Field label={t('form.email')} htmlFor="supplier-email">
                <Input
                  id="supplier-email"
                  type="email"
                  inputMode="email"
                  value={form.email}
                  placeholder={t('form.emailPlaceholder')}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label={t('form.phone')} htmlFor="supplier-phone">
                <Input
                  id="supplier-phone"
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  placeholder={t('form.phonePlaceholder')}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field
                label={t('form.paymentTermsDays')}
                htmlFor="supplier-terms"
                hint={t('form.paymentTermsHint')}
              >
                <Input
                  id="supplier-terms"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={form.paymentTermsDays}
                  onChange={(e) =>
                    setForm({ ...form, paymentTermsDays: parseInt(e.target.value, 10) || 0 })
                  }
                />
              </Field>
            </div>
            <Field label={t('form.address')} htmlFor="supplier-address">
              <Textarea
                id="supplier-address"
                value={form.address}
                placeholder={t('form.addressPlaceholder')}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            {save.isError ? (
              <p role="alert" className="text-[13px] text-bad">
                {errorMessage(
                  save.error,
                  t(editingId ? 'messages.updateFailed' : 'messages.createFailed'),
                )}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={closeForm}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!formValid || save.isPending}
              onClick={() => save.mutate({ id: editingId, values: form })}
            >
              {editingId
                ? save.isPending
                  ? t('common:actions.saving')
                  : t('common:actions.save')
                : save.isPending
                  ? t('actions.creating')
                  : t('actions.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}
