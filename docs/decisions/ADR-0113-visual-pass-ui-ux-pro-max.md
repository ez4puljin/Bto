# ADR-0113: A visual pass with the ui-ux-pro-max checks: stronger contrast and focus, busy and retry states, compact document windows, a clearer till

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-28 |
| Deciders | Owner (two interview rounds, 2026-10-28), Claude (Claude Code worker session «ui-ux-pro-max», started by «Bto удирдлага») |
| Amends | ADR-0042 #1 (four colour tokens), `docs/ui.md` §1, §2, §4, §8, §9 |

## Context

The owner asked (2026-10-28): «Bto системийн харагдац ui-ux-pro-max-аар сайжруул». `ui-ux-pro-max` is a skill with searchable UX guidelines (accessibility, interaction, forms, tables, charts, stack notes for shadcn and React). It was used as a checklist against Bto's own design system (ADR-0042, ADR-0043, ADR-0066, ADR-0108), not as a source of a new brand: its generated "design system" for an ERP admin (a dark slate palette, Fira Sans / Fira Code, green accents) was rejected at once, since the owner chose the Apple-like light look on 2026-10-13 and it works.

The audit had three parts:
- pictures of every route at 1366×633, 1536×730 and 1920×969 (`pnpm ui:shots`), and of the till kiosk at 1366×768 (paired on the dev edge with the owner's permission);
- the colour tokens measured against WCAG 2.2 AA;
- two code reviews (the shared kit and the shell; the till kiosk) against the skill's rules.

The findings:
- **Contrast below AA.** The field border `#C7C7CC` is 1.68:1 on white, and a field's boundary needs 3:1 (WCAG 1.4.11). The secondary text `#6E6E73` is 4.15:1 on a neutral pill and 4.46:1 on a hovered row. The focus halo `ring-ring/30` is about 1.5:1, and tabs, segmented controls, switches and sidebar buttons show nothing else when focused. A highlighted menu item is `#F0F0F5` on white, 1.14:1. The switch's green `#34C759` is 2.2:1 against its white thumb.
- **States.** A pending save, confirm or «Цааш үзэх» only dims its button. Lists that load are not marked busy. Only 5 of 246 `ProblemAlert`s offer a retry. Motion ignores the reduced-motion setting outside the login map. Buttons keep the arrow cursor. Every table row tints on hover, clickable or not. Field hints and errors are not tied to their fields (`aria-describedby`).
- **The document windows.** At 1366×633 a receipt's header card and its «Бараа нэмэх» panel fill the screen, so no line is in view, and the panel's blue «Нэмэх» competes with «Батлах».
- **The till.** The change due is a small figure. The sale screen's right column can push «Төлбөр (F12)» below a 768px window. The cart's −/+/delete buttons are 40px and 6px apart. The selected line is a 1.1:1 tint. A lost store server shows only as a 13px pill.

The owner answered:
1. **Priority areas:** sales and orders, the warehouse documents (receipts, issues), finance and the reports. The till was not a priority, but its pictures were allowed.
2. **Boldness:** polish within the current look. Same palette, same font (Inter), same patterns.
3. **Dark mode:** not now.
4. **Tokens:**
   - the focus ring and the menu highlight made clearly visible;
   - the field border darker;
   - the secondary text darker;
   - the switch's green darker.
5. **The document windows:** compacted, so that the lines show at 1366.
6. **The till:** no sounds; feedback on the screen only.
7. **Sales:** `bto_main` has no sales board yet. The owner will first rebuild the sales pipeline after Erxes; the sales screens get their pass after that, not in this one.

## Decision

1. **Tokens** (`apps/web/src/index.css`; the staff app's `tokens.ts` is out of scope, ADR-0061):
   - `--input` `#C7C7CC` → `#8E8E93` (3.3:1 on white);
   - `--muted-foreground` `#6E6E73` → `#636366` (4.9:1 on `fill`, 5.3:1 on `accent`, 6.0:1 on white);
   - `--toggle` `#34C759` → `#248A3D` (4.4:1 against the white thumb).
2. **Focus.** Every control shows a solid 2px `ring` with a 2px offset when focused from the keyboard (`focus-visible`). The faint 30 % halo is gone. Highlighted menu, select and palette items use the tinted `secondary` / `secondary-foreground` pair, the colours of an active pill.
3. **States in the kit:**
   - `Button pending`: a spinner before the label, disabled and `aria-busy`; the dialog footers, `ConfirmDialog` and «Цааш үзэх» use it;
   - `ProblemAlert` takes `onRetry` («Дахин оролдох»), and every page whose load failed passes its query's `refetch` (79 places);
   - one base rule shortens animations and transitions for `prefers-reduced-motion`;
   - buttons, tabs, menu items, summaries and labels of fields have the pointer cursor;
   - `FormRow` and `FormField` give their hint and error ids (`<id>-hint`, `<id>-error`), and the field with the row's `htmlFor` points to them (`aria-describedby`, `aria-invalid` while an error shows);
   - the floating selection bar has the sticky actions' elevation.
4. **Type floor.** Section titles and shortcut hints move from 11px to 12px (`text-xs`). Below 12px stays only on the 80 mm paper.
5. **Document windows** (receipts, issues; ADR-0078, ADR-0081, ADR-0099): the header's fields share rows more tightly. The line panel's switch moves into its card header, and its «Нэмэх» button stands at the end of the field row as an `outline` button. At 1366×633 the first lines are in view, and the window's only blue button is the step's («Батлах»).
6. **Reports** (ADR-0108): the trend chart has a legend (solid this year, dashed last year). The links that charts give screen readers become visible while they have the focus.
7. **The till** (ADR-0067; `docs/ui.md` §9):
   - the change due is the largest figure of the payment step and stands above the receipt;
   - the sale screen's middle part scrolls, so «Төлбөр (F12)» stays in view;
   - every button a cashier presses is at least 44px high, with 8px between neighbours;
   - the selected line has a blue bar on its left;
   - a lost store server is a full-width alert under the header;
   - a line's unit is a pill beside its quantity;
   - long names wrap to two lines;
   - the test-receipt banner is 14px;
   - a citizen receipt in progress shows a spinner.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| The skill's generated design system (dark slate, Fira, green CTA) | The owner keeps the Apple-like look (ADR-0042); the skill's palette is generic for "dashboards" and would change every screen |
| A refreshed palette or a new font | The owner chose polish within the current look |
| Dark mode | Not now (the owner); doubles the visual checking, as ADR-0042 noted |
| Radix tooltips instead of native `title` | A new pattern on every icon button; deferred until someone misses a tooltip on focus |
| Scan sounds at the till | The owner: feedback on the screen only; scanners beep themselves |
| Collapsing the receipt header to one line | Adds a click to every receipt; compacting the grid already brings the lines into view |
| Row hover only on clickable rows | The hover tint also helps the eye follow a row across a wide table; kept on every row |
| `aria-busy` on every loading list | 112 lists would each pass their state; the skeleton rows already show the wait |

## Consequences

**Positive.** Every text, field border and focus ring meets WCAG 2.2 AA on Bto's surfaces. Waits and failures say so and offer a way out. A receipt or an issue shows its lines on a 1366 laptop. The till's figures read at arm's length, and its pay button never leaves the screen.

**Negative.** Secondary text and field borders are a little darker than Apple's own values. Keyboard users see a stronger ring than before, which some may find heavy. The sales screens wait for the pipeline rework.

**Verification.** `pnpm ui:shots` before and after at 1366×633 on every route: no page overflow, no console error, no failed api call; a draft receipt's first line moved from 657px to 515px from the top. The till was paired on the dev edge and checked to the PIN pad; the owner chose not to go past it, so its screens are proved by the kiosk tests.

**Follow-ups.**
- The sales screens' pass, after the Erxes-like pipeline is built.
- The staff app's `tokens.ts` follows the same four values when its chat next touches the theme.
- Radix tooltips, if wanted.

## Related

ADR-0042, ADR-0043, ADR-0046, ADR-0066, ADR-0067, ADR-0078, ADR-0081, ADR-0099, ADR-0108, `docs/ui.md`
