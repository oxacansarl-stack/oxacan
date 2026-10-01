# OXACAN web UI conventions

How every page in `apps/web` is built. The worked example is
[`src/pages/Offers.tsx`](../apps/web/src/pages/Offers.tsx) for a list and
[`src/pages/MyTasks.tsx`](../apps/web/src/pages/MyTasks.tsx) for a simple view — read one of
them before writing a new page.

## Non-negotiables

1. **No inline `style={{…}}`.** Use Tailwind classes and the shared components. The only
   exception is a value computed at runtime, such as a progress bar's width.
2. **No raw hex colours.** Use the tokens: `bg-paper`, `text-muted`, `border-line`,
   `text-copper`, `bg-ok-bg`… They are defined in `src/styles/index.css`.
3. **No `window.confirm`, `window.alert` or `window.prompt`.** Use `useConfirm()` from
   `@/components/confirm-dialog` for a confirmation and an inline `role="alert"` message for a
   failure.
4. **Never remove a focus outline.** Interactive elements must stay keyboard-reachable; a
   clickable table row uses `<TR onActivate={…}>`, which handles Enter and Space.
5. **Money, dates and durations** go through `formatMoney`, `formatAmount`, `formatDate`,
   `formatDateTime` and `formatMinutes` from `@/lib/format`. Amounts are stored in centimes.
6. **Labels come from i18n.** No hard-coded French in JSX. Add keys to the page's own namespace
   file under `src/i18n/fr/`; never edit `common.json` (it is shared and would conflict).
7. **A failed load is not an empty list.** Use `<DataState>`, which shows the error and a retry
   before it considers the result empty.

## Page skeleton

```tsx
export default function Clients({ embedded = false }: PageProps) {
  const { t } = useTranslation('clients');
  const query = useQuery({ queryKey: ['clients'], queryFn: () => apiList<Client>('/clients'), retry: false });

  return (
    <PageBody>
      {embedded ? null : (
        <PageHeader
          title={t('title')}
          kicker={t('common:navGroup.sales')}
          actions={<Button variant="primary" onClick={…}><Plus />{t('actions.new')}</Button>}
        />
      )}

      <Card>
        <DataState
          isLoading={query.isPending}
          error={query.isError ? errorMessage(query.error, t('loadFailed')) : null}
          onRetry={() => query.refetch()}
          isEmpty={rows.length === 0}
          empty={<EmptyState title={t('empty')} description={t('emptyHelp')} />}
        >
          …table…
        </DataState>
      </Card>
    </PageBody>
  );
}
```

`embedded` matters for the pages that became tabs of another page — Fournisseurs inside Achats,
Véhicules inside Stock & matériel, and the Administration tabs. When `embedded` is true the page
must not render its own `PageHeader`: the host already did.

## The components

| Need | Use |
| --- | --- |
| Page wrapper, title, actions | `PageBody`, `PageHeader`, `MetaDivider` from `@/components/page-header` |
| Panel | `Card`, `CardHeader`, `CardTitle`, `CardCount`, `CardContent`, `CardFooter` |
| Button | `Button` — `variant`: `primary` (one per screen), `ghost`, `quiet`, `danger` |
| Blocked action | `<Button blockedReason="…">` — stays focusable and explains itself, unlike `disabled` |
| Status pill | `<StatusBadge domain="invoice" value={row.status} />` |
| Type/category chip | `<Tag>` |
| Table | `TableWrap`, `Table`, `THead`, `TBody`, `TR`, `TH`, `TD`, `Ref` |
| Numbers in a column | `<TD numeric>` / `<TH numeric>`, or the `tnum` class |
| Form field | `Field` + `Input` / `Select` / `Textarea` |
| Search box | `SearchInput` with a lucide `Search` icon |
| Tabs inside a page | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `TabCount` |
| Whole page of tabs | `TabbedPage` from `@/components/tab-page` (keeps the open tab in `?tab=`) |
| Dialog | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogBody`, `DialogFooter` |
| Row overflow actions | `DropdownMenu` with a `MoreHorizontal` trigger |
| Confirmation | `const confirm = useConfirm()` → `if (!(await confirm({ title, description }))) return;` |
| Loading / empty / error | `DataState`, `TableSkeleton`, `EmptyState`, `ErrorState`, `Skeleton` |

Icons come from `lucide-react`, sized by the component (`size-4` inside buttons).

## Layout rules

- One `PageBody` per page; it already spaces its children.
- Cards hold the content. Filters sit in a bordered strip at the top of the card, the table
  below, and a `CardFooter` carries the row count.
- A detail page puts the work on the left and a sticky summary on the right:
  `grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]`, collapsing to one column below `lg`.
- Everything must work at 390px: tables live in `TableWrap`, button rows wrap, and nothing has
  a `min-width` wider than the screen.
- Secondary actions go in a `⋯` dropdown rather than a row of equal-weight buttons.

## Forms

- Create and edit go in a `Dialog`, not an inline panel that pushes the page down.
- Every control has a `Field` with a real label and a stable `id`.
- The submit button is disabled only while the request is in flight; validation errors are shown
  per field via `Field`'s `error`.
- Where the top bar's **Créer** menu links to the page (`?new=1`), open the create dialog on
  mount and strip the parameter — see `Offers.tsx`.
- Failures render as `<p role="alert" className="text-[13px] text-bad">{errorMessage(err, t('…Failed'))}</p>`.

## Role gating

The API is the source of truth; the UI only avoids showing what would answer 403. Read the role
with `useCurrentUser()` and hide the controls a role cannot use. Known cases:

- **Comptabilité**: everything except the fiduciary export is admin-only. A project manager sees
  only the export, scoped to their own projects.
- **RH**: the Collaborateurs list and hourly rates are office-only; creating, inviting,
  deactivating a user and changing a role or licence are admin-only. A team leader sees Équipes.
- **Catalogue**: prices are stripped by the API for every non-office role, so a team leader's
  view must not render price columns or price history at all.
- **Administration**: the audit log, the subscription and the data export are admin-only. The
  subscription is read-only plus cancel — the company can no longer edit it.

## Offer engine specifics (§7.8, §7.9)

Six line types with different meaning — `BASE`, `HYPOTHESE_A_VALIDER`, `VARIANTE`, `OPTION`,
`INFORMATION_MANQUANTE`, `EXCLU`:

- Only **Base** and **Hypothèse à valider** count in the HT/TVA/TTC totals.
- Only those two must carry a price; show "Prix à compléter" **only** for them, and `—` elsewhere.
- Open **Hypothèse à valider** and **Information manquante**, as lines or as assumptions, block
  submission. The other types never do.
- Offer line prices are **cost** prices; the totals are selling prices (cost × margin). Label the
  columns so this is not mistaken for a discount.

Invoice statuses are `draft`, `sent`, `partially_paid`, `paid`, `overdue`, `cancelled`. A credit
note keeps `draft` forever, so label it by type instead of status.

## What not to touch

- `src/components/ui/*`, `src/components/*.tsx`, `src/components/shell/*` — the shared contract.
- `src/i18n/fr/common.json` — shared; add keys to your page's own namespace file.
- `src/App.tsx`, `src/app/nav.ts` — routing and navigation.
- Any API call's shape. If a screen needs data the API does not return, leave the screen without
  it and say so rather than inventing an endpoint.
