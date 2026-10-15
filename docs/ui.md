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
| `components/list.tsx` | `FilterBar` (filters, `end` for the column chooser), `SearchField`, `FilterToggle` (yes/no pill, still a checkbox), `FilterChip` (a chosen filter with its clear button), `ListCard`, `LinkRow` (`selected` tints a ticked row) + `ChevronHead`, `EmptyState`, `LoadMore`, `SkeletonRows`, `RowActions` + `RowAction` + `RowActionSpacer` (icon buttons at the end of a row) |
| `components/native-select.tsx` | `NativeSelect variant="filter"` is a filter pill (tinted while it narrows, `active` overrides); `WarehouseSelect` passes `variant` |
| `components/detail.tsx` | `DetailCard({ title, canEdit, view, edit: (close) => form, actions? })` (an «Засаж байна» pill while editing) and `FieldList({ items, title?, description? })`, the read view in `FormRow`'s rows |
| `components/form.tsx` | `FormSection({ title?, description?, action?, children })`, `FormRow({ label, htmlFor, hint?, error?, align? })`, `FormField` (label over field, for dialogs and narrow places), `FormFooter` and `DialogFormFooter({ pending, onCancel, submitLabel?, disabled? })` («Болих», then the submit button of a dialog's form) |
| `components/sticky-actions.tsx` | `StickyActions({ summary?, children })`: a step's buttons at the foot of a long editor, sticking to the bottom of the window. Place it after the card, never inside (cards clip their content); toasts rise above it |
| `components/leave-guard.tsx` | `LeaveGuard({ when, title, description, leaveLabel })`: asks before leaving a page with work not yet sent (a link or the back button inside the app opens the question; a reload or a closed tab gets the browser's own). Only a change of page asks. One per page |
| `lib/use-delete-confirm.ts` | `useDeleteConfirm(remove)`: `ask(row)`, then a `ConfirmDialog` while `target` is set; refusals show in the dialog |
| `components/ui/switch.tsx` | `Switch` (Radix): on/off values, green when on; tie a `Label htmlFor` or a `FormRow` to its `id` |
| `lib/toast.ts` | `toast.success(text)` / `toast.info(text)`; rendered by `Toaster` (mounted in `AppProviders`) |
| `lib/use-create-param.ts` | `const [creating, setCreating] = useCreateParam()`: a create dialog's open state in the URL (`?new=1`) |
| `app/nav-items.ts` | the menu (`NAV_GROUPS`: path, label key, lucide icon, permission), the home page's `QUICK_ACTIONS` and `ATTENTION_TILES` (count, label, icon, permission, filtered list); the search reads the first two |

Also: `ConfirmDialog` for irreversible steps (a `default` one gives its main button the focus, so Enter confirms; a destructive one keeps «Болих» first; `initialFocus="first"` when the dialog holds a field to type), `ProblemAlert` for API errors, `ColumnChooser` for wide lists (ADR-0037), `ScanBox` for scanning (it reads nothing while a dialog that does not hold it is open, and a scan's Enter never presses a button, ADR-0047 #4).

Feature pieces other screens reuse (ADR-0044, ADR-0047):

- `features/inventory/last-warehouse.ts` — `useDefaultWarehouse(options, doc)`: the warehouse a create dialog starts with (the only one, else the one this user chose last for that kind of document, else the first); `remember(id)` after a create. `WarehouseSelect` and `ProductSearch` take an `id` for a `FormField`.
- `features/inventory/scan-qty.ts` + `shared.tsx` — `useScanQty()` and `ScanQtyField({ id, qty, onScan })`: «Тоо», the quantity the next scan adds, read from a ref (`qty.read()`) because a scan that lands in the field restores it in the same event; back to 1 after each product.
- `features/inventory/step-counts.ts` — `useStepCounts(detail, step, defaults)`: a transfer's ship or receive counts kept in this browser until sent (per user, transfer and step, checked line by line, a week at most), with `restored`, `dropped`, `reset`, `clear` and `dirty` for `LeaveGuard`.
- `features/inventory/helpers.ts` — `wantsScanFocus(location.state)`: a create dialog navigates to its new document with `state: { focusScan: true }`, and the editor passes the answer to `ScanBox autoFocus` (receipts, transfers, adjustments).

- `features/partners/supplier-picker.tsx` — `SupplierPicker({ id, value, onChange })`: a search box over the first active suppliers, then the chosen one read-only with «Солих». Only the control; the caller labels it (`FormRow htmlFor`). Receipts and the product registration use it.
- `features/catalog/photo-uploads.ts` + `photo-picker.tsx` — `usePhotoUploads()` and `PhotoPicker({ id, uploads, error })`: photos of a record that does not exist yet. Each file is scaled and uploaded as soon as it is chosen; the grid shows uploading and failed states, the first photo is primary, a tile adds more (10 at most). `photosMessage(photos)` is the form's check (at least one uploaded, none still uploading). Object URLs are released on remove, reset and unmount.
- `features/ai/result-table.tsx` — `ResultTable({ result, label })`: the rows of a query (ADR-0045) under the column names the query gave them; numbers right-aligned with grouped thousands and their database decimals (`result-format.ts`, never through a float; all-zero decimals dropped), t / f as «Тийм» / «Үгүй», a line «N мөр» or «Эхний N мөрийг харуулав»; scrolls inside its own frame with the header in view. `answer-step.tsx` exports `HowComputed({ sql, repaired? })`, the SQL folded under «Яаж тооцсон».

## 4. Page patterns

- **List page.** The pieces go in this order:
  1. `PageHeader` (title; actions = the main «Шинэ …» button);
  2. `FilterBar` (search, filter pills, toggles);
  3. `ProblemAlert`;
  4. `ListCard` holding the `Table`, the `EmptyState` and `LoadMore`.

  When the record has its own page, each row is a `LinkRow` that keeps its name or number `Link`, with `ChevronHead` as the last header cell; editing starts from the record's read-first card, never a row button (the owner confirmed this on 2026-10-15). Lists edited in dialogs end each row with `RowActions` (icon buttons named like the old text buttons; a `RowActionSpacer` where a row lacks one, so the icons stay in columns). Filters live in the URL.
- **Forms** (ADR-0043). Settings-style:
  - `FormSection`s (a small uppercase title, an optional hint and a header `action`) hold `FormRow`s: label left in 11rem, field right, hint and error under the field. Phones stack them; `align="center"` keeps a switch or a short control on its label's line.
  - Short fields get a width (`sm:w-44` for codes, `sm:w-28` for 3-digit codes); names and selects take the row.
  - On/off values are `Switch`es, never a lone checkbox.
  - `FormFooter`: «Болих» (ghost) then the main button, on the right. Dialogs use `FormField`s and `DialogFooter` in the same order.
  - The read view of the same card is a `FieldList` with the same section titles.
- **Sub-items with several actions** (a product's units): one row per item, the frequent action as an icon button, the rest in a «⋯» `DropdownMenu` (`modal={false}`) named «{item}: үйлдэл», destructive items last after a separator. A dialog opened from the menu gives the focus back to the menu button.
- **Creating.**
  - A short header form (warehouse, kind, note; a receipt's supplier and delivery note) opens a dialog from the page header (`useCreateParam`). It is a `<form>` of `FormField`s in one column, the user's warehouse chosen already (`useDefaultWarehouse`), «Болих» (ghost, `type="button"`) and the submit button. Afterwards, `navigate(newRecordUrl, { replace: true })`; a scan editor opens with its scan box focused.
  - A long form (product, customer, supplier) has its own `/new` page.
  - A form people fill many times in a row (product registration, ADR-0044) stays on its page after a save: a green line on top names the record with «Харах», the fields that repeat (category, supplier, warehouse) are kept, the rest is cleared, and a new `Idempotency-Key` is drawn. Server refusals that belong to a field (a code taken meanwhile, an unknown shelf) show on that field; the others in a `ProblemAlert` above the footer.
  - Items added one after another in a list edited by dialogs (shelves) keep the dialog open after each save: a polite live line names what was added, the field is cleared and has the focus again (also when the dialog opens: `onOpenAutoFocus`). A whole range is a second mode of the same dialog (`SegmentedControl`).
  - Never put a create form above a list.
- **Effective-dated values** (settings, ADR-0027): one card per key with the value in force and its history; «Шинэ утга оруулах» opens a dialog (value — a `Switch` for yes/no — and the date it takes effect); only an upcoming value can be deleted, after a question.
  - A dated record with several values (a price profile, ADR-0048): its page shows the values in force worked out on an example (1,000₮) and a «Утгын түүх» table, latest first, each row with its period («2026-11-01-с», «2026-10-01 – 2026-10-31») and a status badge (Төлөвлөсөн / Хүчинтэй / Өмнөх). «Шинэ утга оруулах» opens a dialog filled with the latest values, starting today; the same day again replaces the planned values (nothing is deleted). The example in the dialog follows the typed values, computed by the shared functions.
  - A product's price terms (warehouse price, profile, whole pack) follow the same rule: the card shows today's terms and each unit's prices, planned terms as a line, the history folded; the dialog previews every unit's prices before saving.
- **Lists with many filters** (`/catalog/products`, ADR-0049): beside the pills, an outline «Шүүлтүүр» `DropdownMenu` lists every field (a tick on the active ones); each opens a small dialog filled with the field's value (checkbox lists with a search for long ones, ranges, a `SegmentedControl` for a few choices), «Шүүх» applies and choosing nothing removes the filter. Active filters show after the menu as `FilterChip`s «Нийлүүлэгч: МСМ ХХК» whose text reopens the dialog and whose button removes them; «Бүгдийг арилгах» from two on. The count the filters keep sits in the header's `meta` («1,751 бараа»). The URL keeps every filter in short form; the focus goes back to «Шүүлтүүр» when a dialog closes.
- **Ticking rows for several actions** (the product list, ADR-0049, ADR-0051): a first column of checkboxes, each inside a `<label>` filling its cell so a click beside the box ticks it instead of opening the record; «Бүгдийг сонгох» over the loaded rows (indeterminate in between); the ticks stay while the search and the filters change, kept in the tab's `sessionStorage` per user, so ticks from several searches go together (ADR-0052); when every loaded row is ticked and more match, the bar offers «Таарсан бүгдийг сонгох (N)», and the header then unticks every match; only users holding one of the actions see the column. `SelectionBar` (`components/selection-bar.tsx`) floats at the list's foot while rows are ticked: «N сонгосон», the actions (outline, small; a «Засах» `DropdownMenu` for the edits, each shown with its right), then «Сонголтыг цуцлах». Each action opens a dialog that names the count and its rule; a change that may surprise (a home move with stock elsewhere) runs a dry run and names the records before the main button; a toast says what changed, what already was so and what was skipped, and the ticks clear.
- **Saved conditions** (`/segments`, ADR-0049): a list per entity (a `SegmentedControl`) with each segment's count read in one request per page; the record page shows the conditions in words, group by group with «ба» / «эсвэл»; the editor is a form with a section of groups (each «Бүгд биелэх» / «Аль нэг нь биелэх» once it has two conditions), condition rows of field → operator → value, and a live status line under the form (the shared rules' issue, else «Таарах: N» a moment after typing stops).
- **Lists with a bulk action** (`/catalog/pending`): a checkbox column with «Бүгдийг сонгох» in the header (indeterminate while some rows are ticked), each row's checkbox named after its code, ticked rows tinted (`data-state="selected"`); the bulk action is the page's main button in the header, disabled until something is ticked and counting the rows («Сонгосон 2 барааг бүрэн болгох»). Rows keep their name link and `RowActions`.
- **Record page.** `PageHeader` with the title (name or number), `meta` (code, status badges, dates) and `actions` (links to related pages, print). Below it, `DetailCard`s that are read first, then the related cards. Use two columns on `lg` when there is a natural side column (photos, suppliers, locations).
- **Document page** (draft → posted, ADR-0047). The status sits in the header meta; a document's own header (a receipt's delivery note) is a read-first `DetailCard`, beside the lines on wide screens.
  - While the document is a draft, an editor card: scan box with «Тоо», product search, quantities guarded against scans, row actions as icons. Scans run one after another against the latest copy of the document.
  - The step's buttons sit in `StickyActions` after the card, with a short summary (lines, differences, total).
  - Irreversible steps go through `ConfirmDialog`; Enter confirms. A step that can be taken back asks nothing (a transfer request), and a shipment or a receipt asks only when its counts differ from the plan, listing the differences. A refusal with a reason is one dialog with the field.
  - Counts typed and not yet sent stay on the device (`useStepCounts`), restored with a note; `LeaveGuard` asks before leaving them.
  - A toast after each step (posted, sent, received, approved).
  - After posting, a read-only lines card; costs, for those who may see them, on the same page (a receipt's costing card with «Хадгалаад дараагийнх»).
- **Work page with a side panel** (`/sales/boards`, ADR-0057): a folding left panel (`w-60`, `aria-label`) lists groups that fold out into their items (boards → pipelines, the current one with `aria-current`); on phones the panel gives way to a select in the header. The header holds the item's name, its group in `meta`, «Самбарын тохиргоо» (named apart from the menu's «Тохиргоо») and the main «Шинэ …» button; under it a bar: `SearchField`, the «Шүүлтүүр» menu with its chips, the count and a «Харуулах» menu (`DropdownMenuRadioGroup`: Самбараар / Жагсаалтаар). The URL keeps the item and the view; the last item, the view and the panel are remembered per user in the browser (ADR-0050 style). The list view is a list page inside the work page whose rows open the same side `Sheet` as the cards (a button row, not a link).
- **Settings with groups** (`/sales/boards/settings`, ADR-0057): groups on the left (a `ListCard` of buttons with «+» and a «⋯» per group), the chosen group's items as a table on the right (a «⋯» per row: edit, copy, archive / restore, open); a long item form is a side `Sheet` (`sm:max-w-3xl`) with `Tabs` (`components/ui/tabs.tsx`) and one footer for every tab, so one «Хадгалах» saves all.
- **Board page** (`/sales/boards`, ADR-0056, inside the work page since ADR-0057): one `section` per stage as a column (`w-72`, name, count, total ₮; its header carries «+» for a new record in that column and a «⋯» `DropdownMenu`: sort as radio items, print, archive the finished cards, archive the column), cards as small bordered articles (number with the order's label — `PaymentLabel`, a square badge so it never reads as the round status pill, ADR-0058 —, customer, total, date, status badge, «Оруулсан: name · channel» with the name in body colour) that are `draggable` onto a column the user may move into (the column shows a ring while hovered) and carry a «Зөөх» icon menu listing the allowed stages, so phones and keyboards move cards too. A stage that asks something (a reason) opens a `ConfirmDialog` first; documents a stage prints are offered in a dialog of buttons after the move (never an automatic popup). A card opens a right-side `Sheet` (`components/ui/sheet.tsx`, `role="dialog"`; the sheet scrolls as a whole and its children never shrink, so a long record keeps every card at full height) with the record read-only, the step forms that belong to the warehouse (the pick form) and the print buttons; the shell stays visible behind it.
- **Printable page** (`/sales/orders/:id/print/:kind`, and `/sales/print/:kind?ids=` for up to 100 documents, one per sheet with `break-after-page`): a route outside the shell that renders documents for paper (`max-w-3xl`, plain tables, `print:hidden` buttons «Хэвлэх» / «Хаах») and calls `window.print()` once its documents and the warehouse names arrived (a later render never cancels the pending print); opened in a new tab from the app, never generated on the server. **Two papers** (ADR-0058): «A4 | 80 мм» (`PrintFormatToggle`, a `SegmentedControl` with `name` «Цаасны хэмжээ») stands before every print button and on the page; the computer keeps the choice for all its users (`tugeel.printFormat.v1`), the URL's `?format=a4|80mm` wins. A4 sets `@page { size: A4; margin: 12mm }`; the roll sets `@page { margin: 0 }` without a size (the printer's driver gives the paper), a 72 mm column at 12 px, black only (no grey text, no backgrounds: thermal printers fade them and browsers skip them), rows instead of table columns, solid and dashed rules between the parts.
- **Tool page** (barcode lookup, price calculator): a `PageHeader`, then cards: the input card with an icon and a hint, the result card with its next step («Бараа нээх»), earlier results in a `ListCard`. Counts on a report page are tiles (green with «Бүрэн» at zero, amber while something is missing).
- **Conversation page** (`/ai`, ADR-0045). The open conversation is in the URL (`?c=`). Its steps form an ordered list: the question as a tinted bubble on the right, the answer as a card (summary as plain text, never markdown; the table; «Excel татах», «Тайлан болгох»; the folded SQL). The question box sits under the list: Enter sends, Shift+Enter starts a new line, «Бодож байна…» while waiting, one `Idempotency-Key` per question kept for a retry, and `IDEMPOTENCY_KEY_IN_PROGRESS` reads as «still working», not as an error. The history is a side column on `lg` and follows the conversation on phones. Rows are never stored: older steps fetch theirs again with «Хүснэгтийг харуулах». An empty page shows example questions (they fill the box) and what can be asked.
- **Home page.** The greeting, then «Анхаарах»: one tile per count above zero of the work waiting for this person (`ATTENTION_TILES`, read from `GET /inventory/attention` and `GET /pricing/attention` only when the user holds a tile's permission; «99+» at the cap; nothing while loading, after an error or when nothing waits), each opening its list already filtered. Then the quick actions and the recent pages: this user's own in this browser (`tugeel.recent.v1:<userId>`, ADR-0053), only those the user may open; the Ctrl/⌘+K search lists the same ones.
- **Spacing under the title.** `PageHeader` brings its own 20px. Never make it the first child of a flex column with a gap (the two add up to 36px): wrap the page in `space-y-4` or a plain `div` (a source test, `components/page-layout.test.ts`, guards it).
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
- Toasts: a single `role="status"` element holding the text; `clearToasts()` runs after each test. While a modal dialog is open the page behind it, the toaster included, is hidden from roles: a dialog that stays open says what happened inside itself (`within(dialog)`).
- Nothing in the shell calls the API; the home page reads only the attention counts the user may act on.
- Confirmations: a `default` dialog's main button has the focus (`toHaveFocus()`), so `user.keyboard('{Enter}')` confirms.
- Scans: `userEvent.setup({ delay: null }).keyboard('4006381333931{Enter}')` is a scanner burst; a person's typing needs a pause of 80 ms or more before it.
- Kept counts: `localStorage` is cleared after each test; `cleanup()` then `renderApp` again is a reload.

## 7. Name and sign-in

- On screen the system is **Bto** (`app.name`), «Дотоод систем», «© 2026 Бүтэн-Оргил ХХК-ийн өмч» (`brand.*`). The code keeps `tugeel`.
- The mark is a blue rounded square with a white «B» (first letter of `app.name`), in the sidebar and on the sign-in pages.
- `features/auth/auth-layout.tsx` splits the sign-in and password-setup pages: on the left `MongoliaMap` (every aimag's border from `mongolia-aimags.ts`, generated by `tools/maps/ne-aimags.cjs` from Natural Earth; Khövsgöl lit for «Оргил Бөөний төв» in Mörön, Övörkhangai for «Боломж бөөний төв» in Kharkhorin, Ulaanbaatar in gold; keyframes `bto-*` in `index.css`), on the right the form; on phones only the form.

## 8. Accessibility

- Focus rings are visible everywhere (`ring-ring/30`, links outlined).
- Link rows keep a real link for the keyboard.
- Dialogs trap the focus. The phone drawer makes the page behind it `inert` and gives the focus back to the menu button.
- Pills that filter are still `<select>`s and checkboxes, so screen readers and phones handle them natively.
- A field or button repeated on each line of a document is named «{what}: {product} ({unit})» (`inventory.productUnit`), so the box line and the piece line of one product stay apart.
- A select under a visible label starts with a plain «Агуулах сонгоно уу», never the label again («Хаанаас: …»); a lone filter pill names itself instead («Бүх агуулах», «Бүх зүйл»).
- Steps the scans fill but nobody types (the shelves of a move) are a `<dl>` of term and value, not labels without a field.
