# ADR-0066: The web admin on desktop screens: denser lists, one page-width rule, lists that fit the window, the menu in the order of the day's work

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-16 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0042 (§2 type and spacing, the page widths, the list kit, the menu's order), ADR-0050 (a list's default hidden columns), ADR-0058 (one print frame for every printable page) |

## Context

The owner asked (2026-10-16) for professional UI/UX agents to check every menu and page of the web admin on desktop screens and fix them. One interview round set the frame: the office's screens are unknown, so every common desktop size must work (a 1366×768 laptop, a 1920×1080 monitor at Windows' 125% scaling, the same at 100%; in Chrome that leaves about 1366×633, 1536×730 and 1920×969 for the page); the Apple-like look of ADR-0042 stays, but denser; the menu follows the order of the day's work; what hurts today is tables that do not fit, empty space on large screens, and dialogs and panels that are awkward.

Three audit agents read all 78 routes against `docs/ui.md` and found 60 problems, seven of them blocking at a desktop size. Screenshots of every route at the three sizes, taken before any change, confirmed them:

- at 1366×633 the product list showed 5 of 50 rows and ran 1,059px wider than the screen (customers 1,237px, suppliers 732px); a 44px row with every cell on one line left about 10 rows visible on a plain list;
- the horizontal scrollbar of a wide list sat under its last row, and header rows never stuck, because the table's box scrolls sideways;
- some lists filled the screen and others sat in a centred 1152px column (finance and the supermarket wide, the warehouse narrow), so at 1920 the title jumped sideways between pages and a narrow page left wide empty margins;
- a dialog scrolled as a whole: at 633px the «Шинэ орлого» and «Шинэ хэрэглэгч» buttons were below the fold; the focus fell to the page body after every dialog; «⋯» menus were as narrow as their 32px button;
- a narrow side card (a receipt's delivery note) split its values a letter at a time, because the label column switched on the viewport's width, not the card's;
- the board's columns had no height limit, so its sideways scrollbar sat under the tallest column;
- the menu started with the catalogue and showed the warehouse group below the fold of a 633px window.

The in-app browser pane is 397×411 pixels, too small to judge a desktop layout, so the review needed real pictures at the three sizes.

## Decision

1. **Density.** Table body rows are 36px (`h-9 py-1.5`), heads 32px; the icon buttons at a row's end are 28px; the filter bar keeps 12px below it; the page starts 20px under the window's top and the title keeps 16px below it; the 26px title stays. A breadcrumb that names only the menu group shows on phones only, since the sidebar names it on a desktop. A product's thumbnail in a list is 32px.
2. **One page-width rule.** Every page route declares `handle: { width }` (`app/page-width.ts`; a test fails a page without one): `wide` (up to 1600px) for lists, books, logs, documents with lines, records with a side column, the home page and tools whose result is a table; `full` for the sales work page and its settings; `reading` (1152px) for settings, `/new` forms, small tools and single-card records. Every page sits at the left of the content area, so the title stays put from page to page.
3. **Lists that fit the window.** The main list card of a menu page is `ListCard scroll`: its height is what the window leaves below its top (20rem at least), it scrolls inside itself, its header row sticks and its sideways scrollbar stays visible; printing shows every row. Long names truncate with the whole text on hover (`TruncateCell`); the main text column of a short list takes the spare width. A list with many columns shows a default set that fits 1366px to a user who never chose (`useHiddenColumns(…, defaultHidden)`); every column stays in «Баганууд» and a stored choice wins (amends ADR-0050). Rows that open a panel keep a real link or button for the keyboard (`hrefWithParam`, `ButtonRow`).
4. **Dialogs, sheets, menus.** A dialog has one of four widths (`size` sm, md, lg, xl); `DialogFooter` and `SheetFooter` stick to the bottom of a dialog or sheet taller than the window; the focus returns to whatever opened the dialog or sheet; the close button is named «Хаах». Dropdown menus are as wide as their longest item (12rem to 22rem). `RecordSheet` has two sizes: `record` (64rem, finance and the supermarket) and `panel` (80rem, a record people work in, like a sales order).
5. **Forms and headers.** `FormRow` and `FieldList` put the label beside the value only where their own box is wide enough (container queries), so side columns and panels stack them. `PageHeader` gets a `description` line; explanations leave the meta row, which keeps codes, statuses and dates.
6. **The menu in the order of the day's work:** Борлуулалт → Агуулах → Бараа → Үнэ → Сегмент → Харилцагч → Санхүү → Супермаркет → AI → Систем; inside the warehouse group Үлдэгдэл, Орлого, Шилжүүлэг, Тооллого, Залруулга, Зөөлт, Бага үлдэгдэл, Хөдөлгөөний түүх, Тавиур; «Үнэ хүлээгдэж буй» opens the «Үнэ» group; «Системийн төлөв» closes «Систем». Only duplicated names change («Кассын борлуулалт», «Кассчид») and two repeated icons. Exactly one entry is lit (the page's own, or the list a deeper page belongs to) and it is scrolled into view; folded groups are remembered per user.
7. **Shared pieces.** One `PrintFrame` (`components/print-frame.tsx`: «A4 | 80 мм» first, «Хэвлэх» enabled when the document is in); `formatQty` and `formatTugrik` (money in lists, cards and panels carries «₮», journals and ledgers stay plain); `useSetParam` replaces the per-page copies; the page never shifts sideways when a scrollbar appears (`scrollbar-gutter: stable`).
8. **Pictures at desktop sizes.** `pnpm ui:shots` (`tools/ui-shots`) signs a dev user in through the api, hands the session to a headless Chrome or Edge over the DevTools protocol (Node's own WebSocket, no new dependency) and captures every route in `tools/ui-shots/routes.mjs`, create dialogs and record panels included, at 1366×633, 1536×730 and 1920×969, with measurements (page overflow, scrolling boxes, the first row's position, rows in view, a dialog's footer in view, console errors, failed api calls) and a gallery, into the gitignored `tmp/ui-shots/<name>/`. The password comes from a gitignored file and is never printed.

## Alternatives considered

- **A sidebar folded to icons, or hidden.** Rejected by the owner's answer; 45 entries with Mongolian names would need tooltips, and the denser lists and default columns already make the wide tables fit.
- **A new visual style.** Rejected by the owner; the problems were layout and density, not the look.
- **Narrowing short lists to the reading width.** Two auditors proposed it to keep numbers near names; rejected because the owner's complaint was empty space on large screens. The main text column takes the spare width instead.
- **Sticking the page header and the table head to the window.** Impossible while the table's box scrolls sideways (a sticky cell sticks to its nearest scroller); the card that scrolls itself gives both the header and the scrollbar.
- **Playwright or Puppeteer for pictures.** A new dependency and a downloaded browser; Chrome or Edge is on every Windows machine and Node speaks the protocol.

## Consequences

**Positive.** About 30% more rows at 1366×633 on a plain list; the wide registers fit a laptop by default; no dialog hides its buttons; similar pages have the same width and the title never jumps; the review is repeatable: before and after pictures of every route in minutes.

**Negative.** A list scrolls inside its card, which a mouse wheel over the page header does not move; a user who stored a column choice before keeps it and does not see the new default set; `pnpm ui:shots` needs the dev servers, a local Chrome or Edge and a dev login file.

**Follow-ups.** Sticky first columns if a list still scrolls sideways at 1366; a per-user density switch only if someone asks for the old spacing; the rep-app branch's web screens (ADR-0061, ADR-0062) take the same kit when it is rebased.

## Related

ADR-0042, ADR-0043, ADR-0047, ADR-0050, ADR-0053, ADR-0057, ADR-0058, ADR-0059, docs/ui.md
