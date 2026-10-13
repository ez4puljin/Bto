# ADR-0042: An Apple-like design system for the web; records read first, rows open their record

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-13 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0037 #4 (rows of lists with a record page lose their «Засах» / «Харах» button); ADR-0011 (the web font is Inter; PDFs keep Noto Sans) |

## Context

After the pricing module the owner asked when the UI should be reworked and chose to do it now, before `sales`, so that every later module is built on the new design (interview of 2026-10-13). Answers: variant "C" of three mockups (grey canvas, white cards that hold the tables, filter pills, large titles), Apple blue, 14px text, "like a modern Apple app"; no reference app. Pain points: the look, density and text, finding pages in the menu, searching and filtering, creating and editing documents, moving between pages.

The web app had 50 routes on shadcn's neutral black-and-white theme: a text-only menu of 30 entries, a technical «Системийн төлөв» as the home page, a sticky «Засах» button on every list row (ADR-0037 #4), create forms placed above three lists, product / customer / supplier pages that opened as editable forms, «Буцах» buttons in 15 files, a different success message on every screen, and an error boundary that replaced the whole shell. Three code surveys (routes, tests, document flows) and a design review sized the change; the 130 web tests mostly query by role and name, which shaped the rules below.

## Decision

1. **Type and tokens** (`apps/web/src/index.css`, light only).
   - Inter Variable (`@fontsource-variable/inter` 5.3.0; Mongolian Ө/Ү, ₮ and № checked) replaces Noto Sans on the web; PDFs keep Noto Sans (ADR-0011).
   - Text is 14px on a 16px root (rem spacing keeps its size); page titles 26px. `font-mono` means "numbers and codes": Inter with tabular figures (`--font-mono--font-feature-settings: 'tnum'`), so the 182 existing uses line up without edits.
   - Colours: canvas `#F2F2F7`, white cards, sidebar `#F9F9FB`, text `#1D1D1F` / `#6E6E73`. `--primary` `#0071E3` fills buttons, focus rings and icons (white text on it 4.7:1; hover `#0066CC`). Blue text uses `--link` `#0066CC` (5.6:1 on white). Tinted pills: success, warning, destructive, info, neutral.
   - Radius 12px for cards, 10px for controls, 16px for dialogs; pills and badges are round; shadows are faint.
   - Dark mode is not built; the tokens allow it later. No runtime dependency is added besides the font (Collapsible, Checkbox and Dialog come from `radix-ui` 1.7.0). `components/ui` keeps shadcn's formatting (prettier ignores it; run prettier from the repo root).
2. **Shell.**
   - Desktop: a sidebar with the brand, «Хайх…» (Ctrl/⌘+K), «Нүүр» and the permitted groups, each page with an icon. Groups fold, remembered in `tugeel.nav.collapsed.v1`, and unfold when a page inside opens. The account menu sits at the foot.
   - Phones: a 52px top bar (menu, title, search) and the same sidebar sliding in as a drawer, the page behind it `inert`. There is exactly one menu landmark.
   - The browser tab reads «Page · Түгээл». A page that throws renders its error inside the shell, so the menu stays.
3. **Search (Ctrl/⌘+K).**
   - One box finds pages and quick actions by their Mongolian names, typed in either script (the shared search keys, ADR-0028).
   - It also finds products (6) by name, SKU or barcode, suppliers (4) and, with `partners.customers.read`, customers (4), after a 200ms pause from 2 characters.
   - Empty, it offers the recently opened menu pages (`tugeel.recent.v1`: paths only, never record names, ADR-0037 #3).
   - Enter waits while a search is pending (a fast scan followed by Enter must not open a stale row).
   - The shortcut matches the physical key (`KeyK`), because with the Mongolian layout `key` is Cyrillic. Nothing in the shell is focused by default, so wedge scanners keep working.
4. **Page header.** The breadcrumb comes from the menu (group › list page; deeper pages pass `crumbs`). Below it: the large title, a meta row (code, status, dates) and the actions. «Буцах» buttons are gone. The current page is never a crumb, and a crumb that repeats the next one or the title is dropped, so the title text appears once.
5. **Home («/»).**
   - A greeting by the given name with today's date (Asia/Ulaanbaatar).
   - Quick actions by permission: new receipt, new transfer, start a stocktake, new product, look up a barcode, price a cart. Their names never equal a menu entry.
   - The recently opened pages.
   - «Системийн төлөв» stays under «Систем».
6. **Lists.**
   - Above the table, a filter bar: a search pill; filter pills that are still native `<select>`s (tinted while they narrow the list); yes/no pills that are still checkboxes; the column chooser at the end.
   - The table sits in a white card with an empty state, «Цааш үзэх» and skeleton rows while loading.
   - Rows of lists whose records have their own page are **link rows**: a click anywhere opens the record. Exceptions: the row's own controls, a modifier key, or selected text. The record's name or number stays a link (the keyboard and screen-reader path) and a chevron ends the row.
   - The per-row «Засах» / «Харах» button of ADR-0037 #4 is removed. Lists edited in dialogs (categories, brands, units, roles, branches, warehouses, shelves) keep their row buttons (icon buttons since #12).
7. **Records are read first.** A detail card shows its fields (in #12's rows); «Засах» (named «Засах: {card}») turns that card into its form; «Болих» or a save turns it back, with a toast. Applied this session to the product's data, the customer's data and credit terms, and the supplier's data. The product page has two columns on wide screens and links to its stock and movements.
8. **Creating.** Create cards placed above a list become dialogs opened from the page header (transfers, adjustments, stocktakes). The open state is `?new=1`, so the home page and the search can open it and the browser's back button closes it. After creating, the new document replaces the dialog in the history.
9. **Feedback.** Short confirmations are toasts (`lib/toast`): a `status` message at the bottom (at the top on phones) for 4 s, the same message never stacked, at most three. Errors stay in ProblemAlert next to what failed.
10. **Status colours.** Done or posted: green. In progress: blue. Draft or inactive: grey. Needs attention: orange. Refused or broken: red.
11. **Name and sign-in** (owner, the same day).
    - On screen the system is called **Bto**, «Дотоод систем», the property of Бүтэн-Оргил ХХК («© 2026 Бүтэн-Оргил ХХК-ийн өмч»). The mark is a blue rounded square with a white «B».
    - Code, packages (`@tugeel/*`), the database and the repository keep their names.
    - The sign-in and password-setup pages split the screen:
      - left, on deep blue, the mark and an animated map of Mongolia with every aimag's border: Khövsgöl lit for the main branch «Оргил Бөөний төв» in Mörön, Övörkhangai for the branch «Боломж бөөний төв» in Kharkhorin, Ulaanbaatar in gold as the capital, and light travelling from Mörön to Kharkhorin, with a text legend below;
      - right, the form.
    - The borders come from Natural Earth 1:10m admin-1 (public domain, downloaded with the owner's permission), simplified by `tools/maps/ne-aimags.cjs` into `features/auth/mongolia-aimags.ts` (22 shapes, about 1,400 points); `features/auth/mongolia.ts` holds the shared projection and the three places.
    - Phones show only the form under the mark; motion stops for reduced-motion users.
12. **Forms and row actions** (the catalog screens, the same day; `docs/ui.md` §4).
    - Forms read like settings (`components/form.tsx`). `FormSection` groups rows in a hairline box under a small uppercase title. `FormRow` puts the label in an 11rem column on the left and the field on the right; phones stack them, but a switch stays at the end of its label's line. `FormFooter` ends the form with «Болих» (ghost), then the main button, on the right. `FieldList` reads in the same rows, so a card keeps its shape when «Засах» opens its form.
    - On/off values are switches (`components/ui/switch.tsx`, Radix Switch, green when on): product status, default units, fractional units, «include subcategories». Checkboxes stay for choices in a list.
    - Dialogs stack their fields and end with «Болих», then the main button (`DialogFooter`'s own close button now comes first).
    - Rows of lists edited in dialogs (categories, brands, units of measure) carry quiet icon buttons instead of text buttons (`RowActions`, `RowAction`; named for screen readers and shown as tooltips; `RowActionSpacer` keeps each action in its column).
    - Sub-items with several actions (a product's units) show the frequent action as an icon button and the rest in a «⋯» menu named «{item}: үйлдэл». A dialog opened from either gives the focus back to the button that opened it.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Rework the UI after the last delivery | Several times more screens to redo, every accepted delivery checked again, and a risky change right before the go-live |
| `cmdk` for the search box | Another dependency (with its own Radix copies); the combobox and listbox pattern is ~250 lines |
| Radix Toast | Its announcer repeats the toast text for a second, which breaks text queries; a store plus one `status` element is enough |
| Keep the row «Засах» button | Visual noise on every row. A row that opens anywhere, the chevron, and a read-first card whose first button is «Засах» replace it; the owner confirms in the walkthrough |
| Dark mode now | Doubles the visual checking of every screen; the tokens allow it later |
| Custom pop-up selects for filters | Native selects keep forms, tests, phones and screen readers simple |
| Sticky columns in wide lists | Not needed once the whole row opens; a column registry class can add it later |
| Text buttons on the rows of master lists and units (#12) | Three or four buttons per row were the clutter the owner named; icons with names and tooltips, and a «⋯» menu for the rarer actions, keep everything one or two clicks away |
| Checkboxes for single on/off values (#12) | A switch reads as a setting, is a larger target on phones and keeps its label |

## Consequences

**Positive.**
- The look is consistent and modern; pages are found by search or the folded menu, and lists, records and creation behave the same everywhere.
- Every later module follows `docs/ui.md`.
- Errors no longer hide the menu.

**Negative.**
- Changing a record takes one more click («Засах»).
- The row button the owner asked for in ADR-0037 is gone; it comes back if the walkthrough shows it is missed.
- The document flows (receipts, transfers, adjustments, stocktakes, moves, imports, discount form) look new but are not simplified yet (next session).
- Light theme only.

## Related

ADR-0011, ADR-0028, ADR-0037, `docs/ui.md`, architecture §2 and §12, SPEC §7.
