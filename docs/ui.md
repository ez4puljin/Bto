# Web UI guide

How screens are built in `apps/web` (ADR-0042). Read it before building or changing a screen; it is short on purpose. The owner chose an Apple-like look on 2026-10-13: a calm grey canvas, white cards, one blue for actions, large titles, 14px text.

## 1. Tokens (`apps/web/src/index.css`, light theme only)

| Token (Tailwind class) | Value | Use |
|---|---|---|
| `canvas` (`bg-canvas`) | `#F2F2F7` | the page behind the cards (body, main) |
| `background`, `card`, `popover` | white | cards, inputs, outline buttons, menus |
| `sidebar` | `#F9F9FB` | the menu |
| `foreground` / `muted-foreground` | `#1D1D1F` / `#6E6E73` | text / secondary text (keeps 4.5:1 on white and the canvas) |
| `primary`, `primary-hover` | `#0071E3`, `#0066CC` | **fills only**: the main button, checked boxes, focus rings, icons |
| `link` (`text-link`) | `#0066CC` | **blue text**: links, the active menu entry, active filter pills, info badges |
| `secondary` / `secondary-foreground` | `#E8F0FB` / `#0066CC` | tinted buttons («Засах»), active pills |
| `accent` | `#F0F0F5` | hover surfaces (rows, ghost buttons) |
| `fill` | `#E8E8ED` | neutral pills |
| `success`/`success-soft`, `warning`/`warning-soft`, `destructive`/`danger-soft`, `info-soft` | green, orange, red, blue tints | status pills and alerts |
| `border` / `input` | `#E5E5EA` / `#C7C7CC` | hairlines / field borders |
| `shadow-card`, `shadow-control`, `shadow-popover`, `shadow-dialog` | faint | cards, buttons and fields, menus, dialogs |

Radius: cards `rounded-xl` (12px), buttons and fields `rounded-lg` (10px), dialogs `rounded-2xl` (16px), pills `rounded-full`. Never write a colour literal in a page; use the tokens.

**Status colours.**

| Colour | Meaning | Examples |
|---|---|---|
| green (`success`) | done or active | POSTED, RECEIVED, APPROVED, ACTIVE |
| blue (`default`) | in progress | SUBMITTED, REQUESTED, SHIPPED, COUNTING, REVIEW, SCHEDULED |
| grey (`secondary`) | draft or inactive | |
| orange (`warning`) | needs attention | missing data, a pending TIN |
| red (`destructive`) | refused or broken | errors, credit hold |
| `outline` | cancelled or secondary facts | |

## 2. Type

- 14px body (`text-sm`, set on `body`); 13px for secondary lines, labels and pills (`text-[13px]`); 12px for table heads and captions (`text-xs`).
- Card titles 15px semibold; dialog titles 17px; page titles 26px (from `PageHeader`).
- `font-mono` means numbers and codes: it is Inter with tabular figures, so columns line up. Table cells are `tabular-nums` already.
- All text goes through `t('key')` (ESLint G4/G5); keys live in `packages/shared/i18n/mn.json`.

## 3. Building blocks

| Where | What |
|---|---|
| `components/ui/*` | shadcn primitives, restyled. They keep shadcn's formatting: prettier ignores the folder, so run prettier **from the repo root** only. `Button`: `default` is the one main action of a view; `secondary` (tinted) for «Засах»-like actions; `outline`, `ghost`, `destructive`, `link`. `Badge`: `default` (blue), `secondary`, `success`, `warning`, `destructive`, `outline` |
| `components/page-header.tsx` | `PageHeader({ title, meta?, actions?, media?, crumbs? })`: the breadcrumb comes from the menu (`navTrail`). Pages two levels deep pass `crumbs`; `media` is a picture beside the title (the product's photo). Also names the browser tab |
| `components/list.tsx` | `FilterBar` (filters, `end` for the column chooser), `SearchField`, `FilterToggle` (yes/no pill, still a checkbox), `ListCard`, `LinkRow` + `ChevronHead`, `EmptyState`, `LoadMore`, `SkeletonRows`, `RowActions` + `RowAction` + `RowActionSpacer` (icon buttons at the end of a row) |
| `components/native-select.tsx` | `NativeSelect variant="filter"` is a filter pill (tinted while it narrows, `active` overrides); `WarehouseSelect` passes `variant` |
| `components/detail.tsx` | `DetailCard({ title, canEdit, view, edit: (close) => form, actions? })` (an «Засаж байна» pill while editing) and `FieldList({ items, title?, description? })`, the read view in `FormRow`'s rows |
| `components/form.tsx` | `FormSection({ title?, description?, action?, children })`, `FormRow({ label, htmlFor, hint?, error?, align? })`, `FormField` (label over field, for dialogs and narrow places) and `FormFooter` |
| `components/ui/switch.tsx` | `Switch` (Radix): on/off values, green when on; tie a `Label htmlFor` or a `FormRow` to its `id` |
| `lib/toast.ts` | `toast.success(text)` / `toast.info(text)`; rendered by `Toaster` (mounted in `AppProviders`) |
| `lib/use-create-param.ts` | `const [creating, setCreating] = useCreateParam()`: a create dialog's open state in the URL (`?new=1`) |
| `app/nav-items.ts` | the menu (`NAV_GROUPS`: path, label key, lucide icon, permission) and the home page's `QUICK_ACTIONS`; the search reads both |

Also: `ConfirmDialog` for irreversible steps, `ProblemAlert` for API errors, `ColumnChooser` for wide lists (ADR-0037), `ScanBox` for scanning.

## 4. Page patterns

- **List page.** The pieces go in this order:
  1. `PageHeader` (title; actions = the main «Шинэ …» button);
  2. `FilterBar` (search, filter pills, toggles);
  3. `ProblemAlert`;
  4. `ListCard` holding the `Table`, the `EmptyState` and `LoadMore`.

  When the record has its own page, each row is a `LinkRow` that keeps its name or number `Link`, with `ChevronHead` as the last header cell. Lists edited in dialogs end each row with `RowActions` (icon buttons named like the old text buttons; a `RowActionSpacer` where a row lacks one, so the icons stay in columns). Filters live in the URL.
- **Forms** (ADR-0043). Settings-style:
  - `FormSection`s (a small uppercase title, an optional hint and a header `action`) hold `FormRow`s: label left in 11rem, field right, hint and error under the field. Phones stack them; `align="center"` keeps a switch or a short control on its label's line.
  - Short fields get a width (`sm:w-44` for codes, `sm:w-28` for 3-digit codes); names and selects take the row.
  - On/off values are `Switch`es, never a lone checkbox.
  - `FormFooter`: «Болих» (ghost) then the main button, on the right. Dialogs use `FormField`s and `DialogFooter` in the same order.
  - The read view of the same card is a `FieldList` with the same section titles.
- **Sub-items with several actions** (a product's units): one row per item, the frequent action as an icon button, the rest in a «⋯» `DropdownMenu` (`modal={false}`) named «{item}: үйлдэл», destructive items last after a separator. A dialog opened from the menu gives the focus back to the menu button.
- **Creating.**
  - A short header form (warehouse, kind, note) opens a dialog from the page header (`useCreateParam`). It has one column, «Болих» (ghost) and the submit button. Afterwards, `navigate(newRecordUrl, { replace: true })`.
  - A long form (product, customer, supplier, receipt) has its own `/new` page.
  - Never put a create form above a list.
- **Record page.** `PageHeader` with the title (name or number), `meta` (code, status badges, dates) and `actions` (links to related pages, print). Below it, `DetailCard`s that are read first, then the related cards. Use two columns on `lg` when there is a natural side column (photos, suppliers, locations).
- **Document page** (draft → posted). The status sits in the header meta. While the document is a draft, an editor card (scan box, product search, quantities). After posting, a read-only lines card. Irreversible steps go through `ConfirmDialog`. (The flows are simplified in the next UI session.)
- **Tool page** (barcode lookup, price calculator): a `PageHeader`, then cards: the input card with an icon and a hint, the result card with its next step («Бараа нээх»), earlier results in a `ListCard`. Counts on a report page are tiles (green with «Бүрэн» at zero, amber while something is missing).
- **A new menu page:** add it to `NAV_GROUPS` with an icon and its permission. It then appears in the menu, the breadcrumb and the search.

## 5. Do and don't

| Do | Don't |
|---|---|
| One blue main button per view; secondary actions `outline`, `secondary` or `ghost` | «Буцах» buttons: the breadcrumb and the browser do that |
| Status and codes in the header's `meta` row | Loose text lines under the title (`-mt-2`) |
| `toast.success` after a save that stays on the page; navigate after a create | Green "saved" text next to buttons |
| `ProblemAlert` next to what failed | Errors as toasts |
| Keep accessible names unique: quick actions never repeat a menu entry, the search button reads «Хайх…» | A second `<main>` or a second menu landmark |
| Blue text with `text-link` | `text-primary` for small text (3.9:1 on the canvas) |
| Tokens and Tailwind classes | Colour literals; new UI dependencies without an ADR |
| Icon-only buttons with `aria-label` and `title` (the same text) | An icon button without a name, or a row of text buttons |

## 6. Tests (Vitest, `apps/web/src/test/render-app.tsx`)

- The menu: `findSidebar()` / `getSidebar()`. Deeper pages also have a breadcrumb `navigation`.
- Dialogs: click the header button (or render `path + '?new=1'`), then `within(await screen.findByRole('dialog'))`.
- Read-first cards: the card is a `region` named by its title. Edit with the button `` `${mn.common.edit}: ${title}` ``.
- Switches: `getByRole('switch', { name })`, `toBeChecked()`. «⋯» menus: click the button named «{item}: үйлдэл», then `findByRole('menuitem', { name })`. Icon buttons keep their text names, so `getByRole('button', { name })` finds them.
- Toasts: a single `role="status"` element holding the text; `clearToasts()` runs after each test.
- Nothing in the shell calls the API; the home page reads nothing either.

## 7. Name and sign-in

- On screen the system is **Bto** (`app.name`), «Дотоод систем», «© 2026 Бүтэн-Оргил ХХК-ийн өмч» (`brand.*`). The code keeps `tugeel`.
- The mark is a blue rounded square with a white «B» (first letter of `app.name`), in the sidebar and on the sign-in pages.
- `features/auth/auth-layout.tsx` splits the sign-in and password-setup pages: on the left `MongoliaMap` (every aimag's border from `mongolia-aimags.ts`, generated by `tools/maps/ne-aimags.cjs` from Natural Earth; Khövsgöl lit for «Оргил Бөөний төв» in Mörön, Övörkhangai for «Боломж бөөний төв» in Kharkhorin, Ulaanbaatar in gold; keyframes `bto-*` in `index.css`), on the right the form; on phones only the form.

## 8. Accessibility

- Focus rings are visible everywhere (`ring-ring/30`, links outlined).
- Link rows keep a real link for the keyboard.
- Dialogs trap the focus. The phone drawer makes the page behind it `inert` and gives the focus back to the menu button.
- Pills that filter are still `<select>`s and checkboxes, so screen readers and phones handle them natively.
