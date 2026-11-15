# ADR-0201: The web is built for tablets, till PCs, laptops and monitors, not for phones

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-15 |
| Deciders | Owner (2026-11-15: «Орлого зарлага шилжүүлэгийн цонхийг responsive сайжруул … Надаас зөвшөөрөл авах хэрэггүй», then «Web системийг гар утасны responsive хийх шаардлагагүй зөвхөн laptop, касс pc, tablet зэрэг дээр responsive ui/ux сайжруул, дүрмийг шинэчил»), Claude (the direct-mode session) |
| Amends | ADR-0066 (the sizes a screen is fitted to and checked at), ADR-0114 (the top bar), ADR-0113 (what a finger presses, outside the till kiosk), ADR-0042 (`docs/ui.md`) |

## Context

`docs/ui.md` fitted the web to two screens, a 1366×768 laptop and a 1920×1080 monitor (ADR-0066), and its building blocks carried a third layout nobody asked for and nobody checked: the phone (`sm:` stacks, «on phones…» in a dozen patterns). The screens between were nobody's: a till PC of 1024×768 and a tablet, upright or on its side, worked by a finger. The owner opened «Шинэ гүйлгээ» there and found it badly fitted.

Pictures of all 180 routes at 768×1024, 1024×640 and 1366×633 (2026-11-15) showed why, and the causes were shared ones:

- **The root font grows the rem widths past the window.** The app's root is 17px (ADR-0066's scale), so a dialog `xl` of 56rem is 952px: between 640px and 984px of window it met both sides, corners and all. Eight dialogs did at 768px.
- **The top bar assumed 1220px.** Nine modules, the brand and the icons need about that much; from `lg` (1024px) they were all shown, and at 1024px «Супермаркет» and «Апп» lay under the search and the bell on every one of the 169 pages of the shell.
- **Labels broke instead of the control scrolling.** The journal tabs of «Гүйлгээ» (seven segments) were squeezed at 768px until each label broke over two lines and was cut.
- **A form grew while it was filled.** «Шинэ гүйлгээ» was 522px high when opened and 600px once an account was chosen (its balance under the field) and the amount typed (the entry's two sides above the buttons): a laptop leaves 633px and a till PC 640px, so the form scrolled exactly when it was being used. Its fields were also of three heights in one row (42, 36 and 51px).
- **A list fell out of its layout at once.** A `ListTable` narrower than its columns' minimum gave its whole spec up and scrolled sideways in the browser's own layout: 44 of the audit's findings, most lists at 1024px and nearly all at 768px, with the columns that happened to stand at the right (often the amount and the status) out of sight.
- **A page's description took the buttons' place.** A header with a one-line description lost its buttons to a row of their own at 768px and often at 1024px, so the main button changed place from page to page.
- **A finger had 28px.** Row actions are 28px, small buttons 26px to 34px (ADR-0066's density, right for a mouse). Only the kiosk had a rule for fingers (ADR-0113: 44px).
- **Nothing could look.** `pnpm ui:shots` needed Chrome; the development PC (ADR-0187) has only Firefox, and the tool knew three sizes, none under 1366px.

## Decision

1. **The screens the web is built for.** Phones are out: a phone uses the staff app or «Bto300». No new code lays the web out for a window under 768px, and nothing is checked there; what the old `sm:` stacks still do below it is left alone, neither promised nor removed.

   | Screen | Window the page gets | Worked by |
   |---|---|---|
   | Tablet, upright | 768×1024 | a finger |
   | Tablet on its side, till PC (1024×768) | 1024×640 in Chrome, 1024×768 full screen | a finger, or a mouse and a keyboard |
   | Laptop 1366×768 | 1366×633 | a mouse |
   | Laptop 1536×864 (a 1920 panel at 125 %) | 1536×730 | a mouse |
   | Monitor 1920×1080 | 1920×969 | a mouse |

   The floor is **768px of width and 600px of height**. Between the floor and the monitor nothing scrolls the page sideways, nothing lies over anything, and every action can be reached.

2. **Width.**
   - A dialog is its size *or the window less a margin*, whichever is smaller: `DialogContent size` is `min(28 | 32 | 42 | 56 | 80rem, 100% − 2rem)`. No dialog sets a width of its own.
   - The top bar shows the modules that fit and folds the rest into «Бусад», a menu of their module pages; «Бусад» is lit when the open page's module is folded. From 768px.
   - A label never breaks over two lines in a button, a tab or a pill. A `SegmentedControl` wider than its place scrolls sideways inside itself and keeps the chosen segment in sight; only the control scrolls, never the page.
   - **A list lets its least needed columns go before it scrolls.** A `ColumnSpec` may say `drop`: the order in which the column leaves a `ListTable` too narrow for all of them (the 1s first and together, then the 2s). What leaves is what the record's own page shows anyway — who entered it, when, a note — never what a row is read for (its name, amount, status), a checkbox, the actions or the chevron. The rest keep the sized layout; only when they still do not fit does the table scroll sideways in its card. A table with a cell spanning columns drops nothing (a column leaves by its place in the row).
   - A page header's buttons stay on the title's line: the description stands under that row at the page's width, so only the title decides, and the buttons move under it only when it would be left less than 18rem.
   - **A box that can stand in more than one place asks its own width, not the window's**: a form in a dialog, a card in a side column, a sheet's section lay their columns out with container queries (`@container`, `@xl:grid-cols-2`), as `FormRow` and `FieldList` already do. A page's own frame keeps the window's breakpoints, which now mean: `md` 768 the tablet upright, `lg` 1024 the till PC and the tablet on its side, `xl` 1280 the laptops, `2xl` 1536 and the root's steps at 1600 and 1900 the wide laptop and the monitor. `sm` (640) is always true on a supported screen: it is not a breakpoint to design for.

3. **Height.**
   - A dialog fits 600px of height in the fullest state its work usually reaches; one that cannot keeps its footer in view (`DialogFooter` sticks) and scrolls its body.
   - **A form keeps one height while it is filled.** A fact that comes and goes sits where nothing moves: on the label's line (`FormField hintBeside`), under its own field, or in the footer's free start (`DialogFormFooter start`).
   - A list that opens from a field (`SearchSelect`, `Combobox`) is never taller than the room the window leaves it.
   - Fields that share a row share a height: a choice between two or three in a form is `SegmentedControl size="field"` (the inputs' 2.5rem, its segments sharing the width).

4. **A finger** (`pointer: coarse`, the Tailwind variant `touch:`; `touch-static:` leaves out what a class already places).
   - Every shared `Button`, whatever its drawn size, answers within at least 2.75rem (44px at a 16px root) around its centre: an unseen `::after` carries the area, so nothing moves on screen and a mouse sees no change. So do the `Switch`, a date field's calendar button and a picker's ✕. What is not a button grows instead, to 2.75rem: the top bar's own buttons, the segments of a `SegmentedControl`, the filter bar's pills (search, selects, toggles, chips, dates), the days and arrows of the calendar, the rows of a filter rail and of a checkbox group. A row's icon buttons stand 2px apart, so their reach goes up and down only; a name cut with «…» takes a second line, since a finger has no hover to read it whole.
   - Nothing is reachable only by hovering: an action that appears on hover is always shown to a finger (`pointer-fine:` for the hover-only look), and a tooltip never carries what is needed to act.
   - The till kiosk keeps its own, stricter rule (ADR-0113: 44px drawn, 8px apart).

5. **The worked example: «Шинэ гүйлгээ» and «Шилжүүлэг»** (`features/finance/transaction-dialog.tsx`). Size `lg` (two columns of fields, as `docs/ui.md` always said; it was `xl`), two columns from 36rem of its own width; the account's balance on its label's line; the tax ticks under the amount; the entry's two sides («Дт … / Кт …») in the footer beside the buttons that write it; every control of a row 2.5rem high; a transfer's date alone on its row so that «Хаанаас | Хаашаа» and «Дүн | Тайлбар» stay pairs. 500px high whatever is typed: it fits 1024×640 and 1366×633 without scrolling and a tablet 768px wide with a margin.

6. **Looking is part of the work.** `pnpm ui:shots` takes its pictures at the five windows of #1 by default (`768x1024t,1024x640,1366x633,1536x730,1920x969`; a `t` means worked by a finger) and drives Firefox as well as Chrome or Edge (WebDriver BiDi; the development PC has only Firefox). Its report now also says, per picture: a dialog without a side margin, items of the top bar lying over one another, labels broken over two lines, boxes that cut their content without «…», things to press under 32px, and which pointer the browser had. A screen is checked at 768×1024 and 1024×640 as well as at the laptop's size before it is called done.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Make the web work on phones too | The owner ruled it out: a phone has the two apps, built for it. A third layout of 180 screens that nobody uses costs every change a check. |
| Show the modules in the top bar only from 1280px | Simple, but a till PC and a tablet on its side would lose the module menus they have room for five of. |
| Shrink the root font under 1280px so that the laptop's layout fits | The owner raised it to 17px because 16px read small (2026-10-30); a tablet is read from further away than a laptop, not closer. |
| Draw every button 44px for everyone | A laptop's 633px of height would lose a third of its rows; the density of ADR-0066 is right for a mouse. |
| Window breakpoints inside dialogs and cards | A dialog 714px wide in a window of 1920px is still 714px: `lg:grid-cols-3` in it asks the wrong thing. |
| A script that rewrites every `sm:` class | The stacks below 768px do no harm, and removing 273 of them touches every screen for nothing a supported window shows. |

## Consequences

**Positive.** One rule says which screens count, so «does it fit» has an answer that can be photographed. The shared causes are fixed where they are shared: every dialog, every page's top bar, every segmented control and every button at once. A tablet and a touch till become real places to work in the office web.

**Negative.** A tablet and a till PC show fewer columns of a list than a laptop, without saying so: the record's page has them all. A list whose essential columns alone need more than the window still scrolls sideways inside its card: the card scrolls, the page does not. A date-time column is 0.75rem wider everywhere (10.75rem cut the seconds; a list short of room prints the minute in 10rem instead). A side sheet leaves 3rem of the page in view, so a sheet of 48rem no longer covers a tablet. On a touch screen a filter bar is a third taller and a long name makes its row two lines high. The unseen press areas of neighbouring small buttons overlap by a few pixels; the later one wins the shared strip. The pictures of a touch screen come from a desktop browser told that its pointer is coarse, not from a tablet: the on-screen keyboard and the browser's own bars are not in them.

**Follow-ups.**
- The till kiosk (`pos.html`) at 1024×768: judged from its code this round, not from pictures (it needs a paired till).
- A look on a real tablet and a real touch till, with the on-screen keyboard open over a dialog.

## Related

ADR-0042, ADR-0066, ADR-0113, ADR-0114, ADR-0119, ADR-0187, `docs/ui.md` §0, `apps/web/src/components/ui/dialog.tsx`, `components/ui/button.tsx`, `components/list.tsx` (`SegmentedControl`), `components/form.tsx`, `app/top-bar.tsx`, `index.css`, `features/finance/transaction-dialog.tsx`, `tools/ui-shots/`.
