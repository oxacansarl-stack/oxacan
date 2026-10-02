import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Package, Plus, TriangleAlert, Warehouse } from 'lucide-react';
import { apiGet, apiList, apiPost, ApiError, type PageMeta } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { enumLabel, formatDate } from '../lib/format';
import type { PageProps } from '../lib/page-props';
import { PageBody, PageHeader } from '@/components/page-header';
import { Card, CardCount, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge, Tag } from '@/components/ui/badge';
import { DataState, EmptyState, Skeleton } from '@/components/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Ref, TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/cn';

/* ── Types ─────────────────────────────────────────────────────────── */

type LocationType = 'warehouse' | 'vehicle' | 'site';
type MovementType = 'in' | 'out' | 'transfer' | 'adjustment';

interface StockLocation {
  id: string;
  name: string;
  type: LocationType;
  address?: string;
  createdAt: string;
}

interface StockItem {
  id: string;
  canonicalArticleId?: string;
  canonicalArticle?: { description?: string; unit?: string };
  locationId: string;
  location?: { name: string; type: string };
  quantity: number;
  minThreshold: number | null;
  createdAt: string;
}

interface StockMovement {
  id: string;
  stockItemId: string;
  stockItem?: { canonicalArticle?: { description?: string }; location?: { name: string } };
  type: MovementType;
  quantity: number;
  projectId?: string;
  project?: { name: string };
  reference?: string;
  performedBy?: string;
  createdAt: string;
}

type StockTab = 'locations' | 'items' | 'movements';

/** DB CHECK constraints; the labels come from the `enum.*` tables in common.json. */
const LOCATION_TYPES: LocationType[] = ['warehouse', 'vehicle', 'site'];
const MOVEMENT_TYPES: MovementType[] = ['in', 'out', 'transfer', 'adjustment'];

/* ── Helpers ────────────────────────────────────────────────────────── */

/** An item is low when it has fallen to its threshold (no threshold means "never low"). */
const isBelowThreshold = (item: StockItem) => item.quantity <= (item.minThreshold ?? 0);

/** Signed quantity: a sortie removes, an entrée adds, an ajustement keeps its own sign. */
function movementQuantity(movement: StockMovement): string {
  if (movement.type === 'out') return `- ${movement.quantity}`;
  if (movement.type === 'in') return `+ ${movement.quantity}`;
  if (movement.type === 'adjustment') {
    return movement.quantity >= 0 ? `+ ${movement.quantity}` : `${movement.quantity}`;
  }
  return String(movement.quantity);
}

/** The emplacement list, as the article and mouvement forms need it (unpaginated shape). */
function useLocationOptions() {
  return useQuery<StockLocation[], ApiError>({
    queryKey: ['stock', 'locations', 'options'],
    queryFn: () => apiGet<StockLocation[]>('/stock/locations?page=1&limit=100'),
    retry: false,
  });
}

/** Skeleton shaped like the card grid the emplacements tab loads into. */
function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-3.5 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-[88px]" />
      ))}
    </div>
  );
}

/* ── Emplacements ──────────────────────────────────────────────────── */

function LocationsTab() {
  const { t } = useTranslation('stock');
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<LocationType>('warehouse');
  const [address, setAddress] = useState('');

  const locations = useQuery<{ items: StockLocation[]; meta?: PageMeta }, ApiError>({
    queryKey: ['stock', 'locations', 'page'],
    queryFn: () => apiList<StockLocation>('/stock/locations?page=1&limit=100'),
    retry: false,
  });

  const create = useMutation<unknown, ApiError, void>({
    mutationFn: () =>
      apiPost('/stock/locations', {
        name: name.trim(),
        type,
        address: address.trim() || undefined,
      }),
    onSuccess: () => {
      setName('');
      setAddress('');
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ['stock', 'locations'] });
    },
  });

  const rows = locations.data?.items ?? [];
  const total = locations.data?.meta?.total ?? rows.length;
  const nameValid = name.trim().length > 0;

  const openForm = () => {
    create.reset();
    setFormOpen(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameValid || create.isPending) return;
    create.mutate();
  };

  const newButton = (
    <Button variant="primary" size="sm" onClick={openForm}>
      <Plus />
      {t('locations.new')}
    </Button>
  );

  // The card header already carries the screen's primary action; the empty state only echoes it.
  const emptyAction = (
    <Button variant="ghost" size="sm" onClick={openForm}>
      <Plus />
      {t('locations.new')}
    </Button>
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Warehouse aria-hidden className="size-4 text-muted" />
            {t('locations.title')}
            {locations.isSuccess ? <CardCount>({total})</CardCount> : null}
          </CardTitle>
          {newButton}
        </CardHeader>

        <DataState
          isLoading={locations.isPending}
          error={
            locations.isError
              ? errorMessage(locations.error, t('messages.loadLocationsFailed'))
              : null
          }
          onRetry={() => locations.refetch()}
          isEmpty={rows.length === 0}
          loading={<CardGridSkeleton />}
          empty={
            <EmptyState
              icon={<Warehouse className="size-5" />}
              title={t('locations.empty')}
              description={t('locations.emptyHelp')}
              action={emptyAction}
            />
          }
        >
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 p-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((location) => (
              <li
                key={location.id}
                className="grid grid-cols-[minmax(0,1fr)] content-start gap-1.5 rounded-md border border-line bg-paper-2 p-3.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-medium text-ink">{location.name}</span>
                  <Tag>{enumLabel('stockLocationType', location.type)}</Tag>
                </div>
                {location.address ? (
                  <p className="text-[13px] text-muted">{location.address}</p>
                ) : null}
                <p className="text-xs text-muted">
                  {t('locations.created', { date: formatDate(location.createdAt) })}
                </p>
              </li>
            ))}
          </ul>
        </DataState>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{t('locations.formTitle')}</DialogTitle>
              <DialogDescription>{t('locations.formHelp')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label={t('locations.name')} htmlFor="stock-location-name" required>
                <Input
                  id="stock-location-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('locations.namePlaceholder')}
                />
              </Field>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <Field label={t('locations.type')} htmlFor="stock-location-type" required>
                  <Select
                    id="stock-location-type"
                    value={type}
                    onChange={(e) => setType(e.target.value as LocationType)}
                  >
                    {LOCATION_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {enumLabel('stockLocationType', value)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('locations.address')} htmlFor="stock-location-address">
                  <Input
                    id="stock-location-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={t('locations.optional')}
                  />
                </Field>
              </div>
              {create.isError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {errorMessage(create.error, t('messages.createLocationFailed'))}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setFormOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={create.isPending}
                blockedReason={nameValid ? undefined : t('locations.nameRequired')}
              >
                {create.isPending ? t('locations.creating') : t('locations.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Articles ──────────────────────────────────────────────────────── */

function ItemsTab() {
  const { t } = useTranslation('stock');
  const queryClient = useQueryClient();

  const [filterLocation, setFilterLocation] = useState('');
  const [belowOnly, setBelowOnly] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [articleId, setArticleId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [threshold, setThreshold] = useState('');

  // Paginated: the footer and the header count report the server's total, not the loaded page.
  const items = useQuery<{ items: StockItem[]; meta?: PageMeta }, ApiError>({
    queryKey: ['stock', 'items', { locationId: filterLocation, belowThreshold: belowOnly }],
    queryFn: () => {
      const params = new URLSearchParams({ page: '1' });
      if (filterLocation) params.set('locationId', filterLocation);
      if (belowOnly) params.set('belowThreshold', 'true');
      return apiList<StockItem>(`/stock/items?${params}`);
    },
    retry: false,
  });

  const locations = useLocationOptions();

  const create = useMutation<unknown, ApiError, void>({
    mutationFn: () =>
      apiPost('/stock/items', {
        canonicalArticleId: articleId.trim(),
        locationId,
        quantity: quantity ? Number(quantity) : undefined,
        minThreshold: threshold ? Number(threshold) : undefined,
      }),
    onSuccess: () => {
      setArticleId('');
      setLocationId('');
      setQuantity('');
      setThreshold('');
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ['stock', 'items'] });
    },
  });

  const rows = items.data?.items ?? [];
  const total = items.data?.meta?.total ?? rows.length;
  const locationRows = locations.data ?? [];
  const filtersActive = Boolean(filterLocation) || belowOnly;
  const formValid = articleId.trim().length > 0 && locationId.length > 0;

  // The two requests were loaded together before, so either failure is the view's failure:
  // a broken emplacement list must not leave the article list looking merely empty.
  const loadError = items.isError
    ? errorMessage(items.error, t('messages.loadItemsFailed'))
    : locations.isError
      ? errorMessage(locations.error, t('messages.loadLocationsFailed'))
      : null;

  const reload = () => {
    items.refetch();
    locations.refetch();
  };

  const openForm = () => {
    create.reset();
    setFormOpen(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!formValid || create.isPending) return;
    create.mutate();
  };

  const newButton = (
    <Button variant="primary" size="sm" onClick={openForm}>
      <Plus />
      {t('items.new')}
    </Button>
  );

  const emptyAction = (
    <Button variant="ghost" size="sm" onClick={openForm}>
      <Plus />
      {t('items.new')}
    </Button>
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Package aria-hidden className="size-4 text-muted" />
            {t('items.title')}
            {items.isSuccess ? <CardCount>({total})</CardCount> : null}
          </CardTitle>
          {newButton}
        </CardHeader>

        <div className="flex flex-wrap items-center gap-2.5 border-b border-line-soft p-3">
          <Select
            className="w-auto min-w-[200px] max-w-full"
            aria-label={t('items.filterLocation')}
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value)}
          >
            <option value="">{t('items.allLocations')}</option>
            {locationRows.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
          <Button
            variant="ghost"
            aria-pressed={belowOnly}
            onClick={() => setBelowOnly((value) => !value)}
            className={cn(
              belowOnly && 'border-warn bg-warn-bg text-warn hover:border-warn hover:bg-warn-bg',
            )}
          >
            <TriangleAlert />
            {t('items.belowThresholdOnly')}
          </Button>
        </div>

        <DataState
          isLoading={items.isPending || locations.isPending}
          error={loadError}
          onRetry={reload}
          isEmpty={rows.length === 0}
          empty={
            filtersActive ? (
              <EmptyState title={t('items.noMatch')} description={t('items.noMatchHelp')} />
            ) : (
              <EmptyState
                icon={<Package className="size-5" />}
                title={t('items.empty')}
                description={t('items.emptyHelp')}
                action={emptyAction}
              />
            )
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('items.table.article')}</TH>
                  <TH>{t('items.table.location')}</TH>
                  <TH numeric>{t('items.table.quantity')}</TH>
                  <TH numeric>{t('items.table.minThreshold')}</TH>
                  <TH>{t('items.table.status')}</TH>
                  <TH>{t('items.table.created')}</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((item) => {
                  const low = isBelowThreshold(item);
                  return (
                    <TR key={item.id} className={cn(low && '[&>td]:bg-warn-bg/40')}>
                      <TD>
                        <div className="font-medium">
                          {item.canonicalArticle?.description ?? item.canonicalArticleId ?? '—'}
                        </div>
                        {item.canonicalArticle?.unit ? (
                          <div className="text-xs text-muted">{item.canonicalArticle.unit}</div>
                        ) : null}
                      </TD>
                      <TD>{item.location?.name ?? '—'}</TD>
                      <TD numeric className={cn(low && 'font-medium text-warn')}>
                        {item.quantity}
                      </TD>
                      <TD numeric className="text-muted">
                        {item.minThreshold ?? 0}
                      </TD>
                      <TD>
                        {low ? (
                          <Badge tone="bad">{t('items.lowStock')}</Badge>
                        ) : (
                          <Badge tone="ok">{t('items.ok')}</Badge>
                        )}
                      </TD>
                      <TD className="tnum whitespace-nowrap text-muted">
                        {formatDate(item.createdAt)}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('items.count', { count: rows.length, total })}</span>
          </CardFooter>
        </DataState>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{t('items.formTitle')}</DialogTitle>
              <DialogDescription>{t('items.formHelp')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field
                label={t('items.articleId')}
                htmlFor="stock-item-article"
                hint={t('items.articleIdHint')}
                required
              >
                <Input
                  id="stock-item-article"
                  value={articleId}
                  onChange={(e) => setArticleId(e.target.value)}
                  placeholder={t('items.articleIdPlaceholder')}
                />
              </Field>
              <Field label={t('items.location')} htmlFor="stock-item-location" required>
                <Select
                  id="stock-item-location"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value="">{t('items.selectLocation')}</option>
                  {locationRows.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <Field label={t('items.quantity')} htmlFor="stock-item-quantity">
                  <Input
                    id="stock-item-quantity"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field label={t('items.minThreshold')} htmlFor="stock-item-threshold">
                  <Input
                    id="stock-item-threshold"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>
              {create.isError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {errorMessage(create.error, t('messages.addItemFailed'))}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setFormOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={create.isPending}
                blockedReason={formValid ? undefined : t('items.requiredFields')}
              >
                {create.isPending ? t('items.adding') : t('items.add')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Mouvements ────────────────────────────────────────────────────── */

function MovementsTab() {
  const { t } = useTranslation('stock');
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [stockItemId, setStockItemId] = useState('');
  const [type, setType] = useState<MovementType>('in');
  const [quantity, setQuantity] = useState('');
  const [reference, setReference] = useState('');
  const [projectId, setProjectId] = useState('');
  const [toLocationId, setToLocationId] = useState('');

  const movements = useQuery<{ items: StockMovement[]; meta?: PageMeta }, ApiError>({
    queryKey: ['stock', 'movements', 'page'],
    queryFn: () => apiList<StockMovement>('/stock/movements?page=1'),
    retry: false,
  });

  const items = useQuery<StockItem[], ApiError>({
    queryKey: ['stock', 'items', 'options'],
    queryFn: () => apiGet<StockItem[]>('/stock/items?page=1&limit=100'),
    retry: false,
  });

  const locations = useLocationOptions();

  const itemRows = items.data ?? [];
  const locationRows = locations.data ?? [];
  const rows = movements.data?.items ?? [];
  const total = movements.data?.meta?.total ?? rows.length;

  const isTransfer = type === 'transfer';
  const sourceLocationId = itemRows.find((item) => item.id === stockItemId)?.locationId;
  const formValid = Boolean(stockItemId) && Boolean(quantity) && (!isTransfer || Boolean(toLocationId));

  const create = useMutation<unknown, ApiError, void>({
    // A transfert moves the line out of the article's own emplacement into the chosen one.
    mutationFn: () =>
      apiPost('/stock/movements', {
        stockItemId,
        type,
        quantity: Number(quantity),
        fromLocationId: isTransfer ? sourceLocationId : undefined,
        toLocationId: isTransfer ? toLocationId : undefined,
        reference: reference.trim() || undefined,
        projectId: projectId.trim() || undefined,
      }),
    onSuccess: () => {
      setStockItemId('');
      setQuantity('');
      setReference('');
      setProjectId('');
      setToLocationId('');
      setFormOpen(false);
      // A mouvement changes the quantities the articles tab shows, so the whole tree reloads.
      queryClient.invalidateQueries({ queryKey: ['stock'] });
    },
  });

  // The three requests were loaded together before: any failure is the view's failure.
  const loadError = movements.isError
    ? errorMessage(movements.error, t('messages.loadMovementsFailed'))
    : items.isError
      ? errorMessage(items.error, t('messages.loadItemsFailed'))
      : locations.isError
        ? errorMessage(locations.error, t('messages.loadLocationsFailed'))
        : null;

  const reload = () => {
    movements.refetch();
    items.refetch();
    locations.refetch();
  };

  const openForm = () => {
    create.reset();
    setFormOpen(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!formValid || create.isPending) return;
    create.mutate();
  };

  const blockedReason = !stockItemId || !quantity
    ? t('movements.requiredFields')
    : isTransfer && !toLocationId
      ? t('movements.requiredToLocation')
      : undefined;

  const newButton = (
    <Button variant="primary" size="sm" onClick={openForm}>
      <Plus />
      {t('movements.new')}
    </Button>
  );

  const emptyAction = (
    <Button variant="ghost" size="sm" onClick={openForm}>
      <Plus />
      {t('movements.new')}
    </Button>
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <ArrowLeftRight aria-hidden className="size-4 text-muted" />
            {t('movements.title')}
            {movements.isSuccess ? <CardCount>({total})</CardCount> : null}
          </CardTitle>
          {newButton}
        </CardHeader>

        <DataState
          isLoading={movements.isPending || items.isPending || locations.isPending}
          error={loadError}
          onRetry={reload}
          isEmpty={rows.length === 0}
          empty={
            <EmptyState
              icon={<ArrowLeftRight className="size-5" />}
              title={t('movements.empty')}
              description={t('movements.emptyHelp')}
              action={emptyAction}
            />
          }
        >
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('movements.table.date')}</TH>
                  <TH>{t('movements.table.article')}</TH>
                  <TH>{t('movements.table.location')}</TH>
                  <TH>{t('movements.table.type')}</TH>
                  <TH numeric>{t('movements.table.quantity')}</TH>
                  <TH>{t('movements.table.project')}</TH>
                  <TH>{t('movements.table.reference')}</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((movement) => (
                  <TR key={movement.id}>
                    <TD className="tnum whitespace-nowrap text-muted">
                      {formatDate(movement.createdAt)}
                    </TD>
                    <TD className="font-medium">
                      {movement.stockItem?.canonicalArticle?.description ?? '—'}
                    </TD>
                    <TD>{movement.stockItem?.location?.name ?? '—'}</TD>
                    <TD>
                      <Tag>{enumLabel('stockMovementType', movement.type)}</Tag>
                    </TD>
                    <TD
                      numeric
                      className={cn(
                        'font-medium',
                        movement.type === 'out' ? 'text-bad' : 'text-ok',
                      )}
                    >
                      {movementQuantity(movement)}
                    </TD>
                    <TD className="text-muted">
                      {movement.project?.name ?? movement.projectId ?? '—'}
                    </TD>
                    <TD>
                      {movement.reference ? (
                        <Ref>{movement.reference}</Ref>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <CardFooter>
            <span>{t('movements.count', { count: rows.length, total })}</span>
          </CardFooter>
        </DataState>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{t('movements.formTitle')}</DialogTitle>
              <DialogDescription>{t('movements.formHelp')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label={t('movements.stockItem')} htmlFor="stock-movement-item" required>
                <Select
                  id="stock-movement-item"
                  value={stockItemId}
                  onChange={(e) => setStockItemId(e.target.value)}
                >
                  <option value="">{t('movements.selectItem')}</option>
                  {itemRows.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.canonicalArticle?.description ?? item.canonicalArticleId ?? item.id}
                      {item.location?.name ? ` (${item.location.name})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <Field label={t('movements.type')} htmlFor="stock-movement-type" required>
                  <Select
                    id="stock-movement-type"
                    value={type}
                    onChange={(e) => setType(e.target.value as MovementType)}
                  >
                    {MOVEMENT_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {enumLabel('stockMovementType', value)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('movements.quantity')} htmlFor="stock-movement-quantity" required>
                  <Input
                    id="stock-movement-quantity"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>
              {isTransfer ? (
                <Field
                  label={t('movements.toLocation')}
                  htmlFor="stock-movement-to-location"
                  required
                >
                  <Select
                    id="stock-movement-to-location"
                    value={toLocationId}
                    onChange={(e) => setToLocationId(e.target.value)}
                  >
                    <option value="">{t('movements.selectLocation')}</option>
                    {locationRows
                      .filter((location) => location.id !== sourceLocationId)
                      .map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              ) : null}
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <Field label={t('movements.reference')} htmlFor="stock-movement-reference">
                  <Input
                    id="stock-movement-reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={t('movements.referencePlaceholder')}
                  />
                </Field>
                <Field label={t('movements.projectId')} htmlFor="stock-movement-project">
                  <Input
                    id="stock-movement-project"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder={t('movements.optional')}
                  />
                </Field>
              </div>
              {create.isError ? (
                <p role="alert" className="text-[13px] text-bad">
                  {errorMessage(create.error, t('messages.recordMovementFailed'))}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setFormOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={create.isPending}
                blockedReason={blockedReason}
              >
                {create.isPending ? t('movements.recording') : t('movements.record')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Page ──────────────────────────────────────────────────────────── */

/**
 * Stock: emplacements, articles and mouvements. Rendered as the first tab of
 * Stock & matériel (`StockMaterial`), so it draws no header of its own when embedded.
 * The sub-tab stays in local state: the host page owns `?tab=`.
 */
export default function Stock({ embedded = false }: PageProps) {
  const { t } = useTranslation('stock');
  const [tab, setTab] = useState<StockTab>('locations');

  return (
    <PageBody>
      {embedded ? null : (
        <PageHeader
          title={t('title')}
          kicker={t('common:navGroup.procurement')}
          meta={t('subtitle')}
        />
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as StockTab)} className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <TabsList aria-label={t('tabs.label')}>
          <TabsTrigger value="locations">
            <Warehouse />
            {t('tabs.locations')}
          </TabsTrigger>
          <TabsTrigger value="items">
            <Package />
            {t('tabs.items')}
          </TabsTrigger>
          <TabsTrigger value="movements">
            <ArrowLeftRight />
            {t('tabs.movements')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="locations">
          <LocationsTab />
        </TabsContent>
        <TabsContent value="items">
          <ItemsTab />
        </TabsContent>
        <TabsContent value="movements">
          <MovementsTab />
        </TabsContent>
      </Tabs>
    </PageBody>
  );
}
