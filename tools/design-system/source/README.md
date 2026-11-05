Bto is the in-house system of Бүтэн-Оргил ХХК: a wholesale ERP used all day by warehouse keepers, accountants, sales staff and cashiers, on 1366 px laptops and 1920 px monitors. Build every screen as a calm grey `canvas`, white `card`s, one blue for actions, large titles and dense lists. Work comes first: nothing decorates, and a screen that has to scroll to reach its main button is wrong.

## Content fundamentals

**Language.** All text on screen is Mongolian in Cyrillic; identifiers, enum values and error codes stay English and never reach the screen. Never write literal text in a component: it goes through a key in `packages/shared/i18n/mn.json`.

**The name.** The system is **Bto**, tagline «Дотоод систем», legal line «© 2026 Бүтэн-Оргил ХХК-ийн өмч». The customer app is **Bto300**. Code names stay `tugeel` and never show.

**Voice.** Plain, short, about the work. Name buttons with the verb in its dictionary form:

| Say | Where |
|---|---|
| «Хадгалах», «Болих», «Засах», «Устгах», «Нэмэх», «Хэвлэх», «Батлах» | actions |
| «Цааш үзэх», «Шүүлтүүр арилгах», «Дахин оролдох», «Сонголтыг цуцлах» | the kit's own buttons |
| «Хадгалагдлаа», «Үүсгэлээ», «Хуулагдлаа» | confirmations, in a toast |
| «Ачаалж байна…», «Хайж байна…», «Бодож байна…» | waiting, with a real ellipsis |
| «Илэрц алга», «Одоогоор анхаарах ажил алга.» | empty results, said calmly |
| «Заавал бөглөнө», «8 оронтой утасны дугаар оруулна уу» | validation, polite and exact |
| «Өнөөдөр таныг хүлээж буй ажил.» | addressing the person: the polite «та» forms |

**Casing and marks.** Sentence case everywhere. Upper case only by CSS on `section-title` and on Bto300's headings. Quote names in «guillemets». No emoji, no exclamation marks, no «Буцах» buttons: the breadcrumb and the browser go back.

**Numbers.** Money in lists, cards and panels reads «12,000₮»; journals and ledgers drop the sign; quantities read «12,000», «1.5». An empty value is «—». A negative figure takes a real minus (U+2212), never red. Dates read `2026-11-01`, a period «2026-10-01 – 2026-11-01» with an en dash, times 24-hour `08:30`.

**Accessible names.** An icon button carries its old text name as both `aria-label` and `title`. A control repeated on each line is named «{what}: {product} ({unit})». A select under a visible label starts with a plain «Агуулах сонгоно уу»; a lone filter pill names itself, «Бүх агуулах».

## Visual foundations

### Colour

There is one light theme; do not add a dark one. Use tokens only, never a colour literal.

- Set the page on `canvas`, cards on `card`, body text in `foreground`, second lines in `muted-foreground`.
- `primary` is for **fills only**: the one main button of a view, checked boxes, step circles, the active tab rule. Blue **text** is always `link`, because `primary` as text falls to 4.2:1 on `canvas`.
- Tint `secondary` under `secondary-foreground` for «Засах»-like buttons, active pills and highlighted menu items. Use `accent` for hover surfaces, `fill` for neutral pills.
- Keep hairlines in `border`; field boundaries in `input` (3.26:1 on white, so fields sit on white, not directly on `canvas`).
- A `Switch` that is on is `toggle` green, nothing else is.
- Chart series come from `chart-1` to `chart-5` as CSS variables through Recharts, never a literal. `chart-2`, `chart-3` and `chart-5` are under 3:1 on the card: always label the series.

**Status colour carries meaning, always beside a word:**

| Colour | Badge variant | Means | Examples |
|---|---|---|---|
| green `success` on `success-soft` | `success` | done or active | POSTED, RECEIVED, APPROVED, ACTIVE |
| blue `link` on `info-soft` | `default` | in progress | SUBMITTED, REQUESTED, SHIPPED, COUNTING |
| grey `foreground` on `fill` | `secondary` | draft or inactive | |
| orange `warning` on `warning-soft` | `warning` | needs attention | missing data, a pending TIN |
| red `destructive` on `danger-soft` | `destructive` | refused or broken | errors, credit hold |
| `muted-foreground`, `border` outline | `outline` | cancelled or a secondary fact | |

### Type

Inter Variable is the only face; it covers Mongolian Ө and Ү, ₮ and №. Set titles with `page-title`, `panel-title`, `dialog-title` and `card-title`, always semibold and tracking-tight; body with `body`; second lines with `secondary-text`; pills, tabs and small buttons with `pill-text`; hints with `caption`. Set `section-title` over groups of rows. Nothing on screen is smaller than 12 px; only the 80 mm paper and the print go below. `font-mono` does not mean a monospaced face: it is Inter with tabular figures (`tnum`), and it sets money, counts and codes (`figure`, `figure-strong`) so columns line up. Right-align them.

### Scale and density

The main app's root font is `root-app` 17 px, `root-app-1600` 18 px and `root-app-1900` 19 px; the till and paper stay at `root-base` 16 px. Size everything in rem (`text-[0.8125rem]`, never `text-[13px]`) so the whole screen grows with the window. Every size in this system is quoted at a 16 px root.

Fit 1366×633, 1536×730 and 1920×969 (what Chrome leaves on those screens). Table rows are `row-h` 36 px, heads `row-head-h` 32 px, a row's icon buttons `row-action` 28 px; fields, selects and buttons `control-h` 40 px; the filter bar's pills, search and small buttons `control-h-sm` 34 px. A button a cashier presses, and every phone target, is at least `touch-min` 44 px.

### Layout and spacing

Spacing follows Tailwind's quarter-rem steps (`space-*`). The page sits at the left, starts `space-5` below the bar and keeps `space-10` under it, with side padding `space-4`, `space-8` from `md`. `PageHeader` brings its own `space-4`: never make it the first child of a flex column with a gap. Every route says how wide it runs: `wide` (lists, books, documents), `full` (the home, the sales work page) or `reading` (settings, forms). Only sign-in pages and the reports' paper are centred. Dialogs take a named size (`dialog-sm` to `dialog-xl`), panels `sheet-record` or `sheet-panel`, a record's side column `side-column`.

### Corners, borders, shadows

**Every button, filter pill, segmented control, badge, switch and toast is a capsule** (`radius-full`). Cards, alerts, menus and tiles take `radius-xl` 14 px; fields `radius-lg` 12 px; dialogs and floating bars `radius-2xl` 18 px. A square-ish `PaymentLabel` on a board card stands out on purpose: it never reads as a status pill.

A card's edge is `shadow-card` plus a 1 px ring of `hairline-ring`, not a border. Shadows stay faint: `shadow-control` on anything pressable, `shadow-popover` on menus and floating bars, `shadow-dialog` on dialogs and sheets. Rows are split by `border` at 80%.

### Motion

Motion conveys a change of place or state, nothing else. One easing for things that open, move or lift: `ease-apple`, `cubic-bezier(.2,.8,.2,1)`.

| What | How |
|---|---|
| Buttons and pills | 200 ms colour and shadow, a press to scale 0.97 |
| Dialogs | 200 ms zoom-and-fade in, 150 ms out |
| Sheets | 300 ms `cubic-bezier(.32,.72,0,1)`, 200 ms out |
| A new page | `page-enter`: a 320 ms rise of 8 px, only when the module or the page changes |
| Home and module tiles | a lift under the pointer |

`prefers-reduced-motion` ends all of it at once.

### States and focus

Hover surfaces use `accent`, tinted controls `secondary-hover`, the main button `primary-hover`. Disabled means opacity 0.5 and no pointer; a disabled field also takes `muted` at 0.6. A running request sets `pending`: spinner before the label, disabled, `aria-busy`. Never leave a button that only dims.

Focus rings are solid and always visible, in `ring`:

- a field: its border turns `ring`, with a 1 px ring;
- a button, badge or switch: a 2 px ring, 2 px outside;
- tabs, segments, drawer buttons: a 2 px ring inside;
- a link: a 2 px outline with a 2 px offset and `radius-tiny`;
- a highlighted menu or palette item: tinted `secondary`.

Never the old faint halo. A field in error takes a `destructive` border with a 3 px ring at 20%.

### Imagery

Product photos are the only photographs, on white, 32 px in lists. The one illustration is the sign-in page's map of Mongolia's aimags, with Khövsgöl and Övörkhangai lit and Ulaanbaatar in gold. Empty states use a lucide icon on a `fill` disc. No stock art and no gradients.

## Iconography

- **System:** `lucide-react` 1.53.0, stroke 2, currentColor. `assets/Icons` holds a representative set copied from the package; take any other icon from the same package.
- **Size:** `icon-size` 16 px in a default button, row or menu item, `icon-size-sm` in a small button, `icon-size-xs` in an extra-small button or a badge; 18 px in a tile.
- **Colour:** icons follow the text. A module tile's icon is `link` on a `secondary` square.
- **No emoji or glyphs** as icons. Page and module icons are fixed in `app/nav-items.ts`; do not invent a second icon for the same place.
- **The mark:** on the web a `primary` rounded square with a white «B» from Inter, live text, not a file (`BrandMark`). The phone apps carry the drawn mark in `assets/Logos`: a geometric «B» for the staff app, «B300» for Bto300. Never redraw either.

## Page patterns

- **Shell.** A sticky white top bar (`topbar-h`): ⋮⋮ «Бүх цэс», the brand, the eight modules as menus from `lg`, then search (Ctrl/⌘+K), ☆, 🔔, ✨, ⚙ and the account. The open page's module is tinted `secondary`.
- **List page.** In this order: `PageHeader` with «Шинэ …» as the main button, `FilterBar`, `ProblemAlert`, `ListCard scroll` holding the table, `EmptyState` and `LoadMore`. Filters live in the URL. A row opens its record on a click anywhere and keeps a real link for the keyboard; rows edited by dialogs end in icon `RowActions`. Codes, dates, money and status pills have fixed column widths in rem; names share the rest by weight and cut with «…».
- **Forms.** `FormSection`s of `FormRow`s: label left in `form-label`, field right, hint and error under the field; stacked by container query where narrow. Dialogs use `FormField`s. «Болих» (ghost) then the main button, on the right. On/off is a `Switch`, never a lone checkbox. Never put a create form above a list.
- **Creating.** A short header form opens a dialog on `?new=1`; a long one has its own `/new` page; a form filled many times in a row stays on its page and says what it saved.
- **Record page.** `PageHeader` with `meta` (code, status, dates), then read-first `DetailCard`s. Reading and editing share rows, so the card does not jump on «Засах». Two columns from `xl` where a side column is natural.
- **Document page.** Status in the header's meta; the lines table across the full width; a draft's scan box and search above it; the step's buttons in `StickyActions`, after the card and never inside. Irreversible steps go through `ConfirmDialog`; Enter confirms. A toast after each step.
- **Record panel.** A `RecordSheet` from the right, opened from a URL parameter, with the number, a description line, badges and actions in its header, `FactChips`, then `TotalsGrid`.
- **Board.** One column per stage (`board-column`), cards as small bordered articles, each with a «Зөөх» menu so phones and keyboards can move it too.
- **Reports.** KPI tiles with the change against a month and a year earlier, Recharts in tokens, «Excel» and «Хэвлэх» in the header. A report's paper page is one centred column, sized to its table, that scrolls inside itself.
- **Printing.** A4 or 80 mm, chosen beside every print button. The roll is a 72 mm column, black only, no backgrounds: thermal printers fade them.
- **The till.** `pos.html` shares the tokens but not the shell: full-window, no scrolling on payment, every button at least 44 px with 8 px between neighbours.

## Do and don't

| Do | Don't |
|---|---|
| One blue main button per view; the rest `outline`, `secondary` or `ghost` | Two blue buttons side by side |
| Status and codes in the header's `meta` row | Loose text lines under the title |
| `toast.success` after a save that stays on the page; navigate after a create | Green "saved" text next to buttons |
| `ProblemAlert` next to what failed, with `onRetry` on a failed load | Errors as toasts; an error with no way out |
| `text-link` for blue text | `text-primary` on small text |
| `DateInput`, `MonthInput`, `TimeInput` for dates and times | `<input type="date">`: the browser's own language, AM/PM |
| `DialogContent size`, the footer last | A one-off dialog width; a page's `FormFooter` in a dialog |
| Tokens and the kit's classes | Colour literals; a new UI dependency without an ADR |

## Phone apps

The staff app and Bto300 (Expo, `apps/mobile/src/theme/tokens.ts`) copy the web's colours and add their own: the `app-*` tokens, the `Staff app` and `Bto300` type groups, 44 pt targets, and text capped at 1.15× the phone's setting (Bto300: no growth). Android has no blur, so bars are nearly opaque (`app-bar-fill`). Bto300 wears a blue header, upper-case section heads and a flat tab bar. Two values lag the web: the phone's `app-muted` and `app-input` kept their older, lighter values after ADR-0113 darkened `muted-foreground` and `input` on the web, and `app-input` misses 3:1 on white.

## Using the kit here

The cards are the code itself. `components/bundle.js` is built from `apps/web/src` as `window.Bto`: menus open, focus traps hold, keys work, and the Mongolian text comes from the app's own dictionary. `components/lib/` carries React and React DOM 19.2.3, the repository's version; React 18 would not do, because these components take `ref` as a plain prop. `components/bundle.css` is `apps/web/src/index.css` compiled by Tailwind.

```js
const { BtoProvider, Button, icons: { Plus } } = window.Bto;
const h = React.createElement;
ReactDOM.createRoot(document.getElementById('root')).render(
  h(BtoProvider, { route: '/inventory/receipts' }, h(Button, null, h(Plus), 'Шинэ орлого')),
);
```

- `BtoProvider` gives a screen what the app's providers give it: a router in memory, a signed-in test user holding every right, a query client. Anything that reads the router or the user needs it.
- `bundle.css` holds only the Tailwind classes the bundled components and the previews use. A class nothing here uses has no rule: lay out with the classes in the previews, or the tokens' CSS variables.
- Props are in `components/index.d.ts`. A dialog's portal and its overlay cover the frame it runs in.

## Not synced

- **How it was built:** `pnpm design:build` (`tools/design-system`), esbuild and the repository's Tailwind compiler on `{{REF}}`; not `pnpm build`. A later change in the code reaches this system only by building again and publishing.
- **Stand-ins in the bundle:** the top bar's bell (`features/notifications/inbox.tsx` reads the server) is empty; `lib/scan/camera.ts` reports no camera, so `ScanBox` hides its button and ZXing stays out; `BtoProvider` takes the place of the app's providers. `ModuleTile` is a thin wrapper with the tile's exact classes, because the code has no such component.
- **No card, read `apps/web/src/components`:** `OneTimeCodeDialog`, `PrintFrame`, `PrintFormatToggle`, `LeaveGuard`, `CameraScanner`, `RoleName`, `ComingSoon`, `DocumentHeader`; the features' `ProductSearch`, `SupplierPicker`, `PhotoPicker`, `ResultTable`, `BookTable`; the sign-in page's `MongoliaMap`; the till's screens; the phone apps' screens.
- **Fonts:** only the Latin, Latin Extended, Cyrillic and Cyrillic Extended subsets of Inter's upright variable face; Greek, Vietnamese and the italics are left out because the UI does not use them. The phone apps embed static Inter 400 to 700.
- **Icons:** 40 of lucide's icons, as a representative set.
- **Not tokens:** `calc()` radii are written as their results at a 16 px root; motion has no token family, so it is a table above. `index.css` keeps the animations of the sign-in map (`bto-*` keyframes).
