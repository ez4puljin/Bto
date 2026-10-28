# ADR-0114: A top menu bar with seven modules, and an erxes-like home page

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-28 |
| Deciders | Owner (a screenshot of `bto.erxes.io` and two interview rounds, 2026-10-28), Claude (Claude Code worker session, after ADR-0113) |
| Amends | ADR-0042 (the left sidebar becomes a drawer; the menu moves to a top bar), ADR-0047 #7 and ADR-0053 (the home page's quick actions and recent pages move to the Ctrl/⌘+K search and the module pages), `docs/ui.md` §3, §4, §6 |

## Context

The owner sent a screenshot of an erxes home page and asked (2026-10-28): «Bto систем рүү нэвтрэхэд ингэж харагддаг болго. Цэснүүдийг эмх цэгцтэй… орчин үеийн загварлаг гоёмсог». The erxes screen has:
- a white bar along the top: a grid button, the plugins as menus, then search, favourites, inbox, settings and the account;
- a centred column under it: the date, «Good evening, …», «What's new for you» and «Your favorites» side by side, then «Your plugins» and «Core modules» as icon tiles.

Before this change, Bto had a 248px left sidebar with 11 groups and 64 pages. Its home page showed «Анхаарах», «Түргэн үйлдэл» and the recent pages.

The owner answered:
1. **The menu:** a top bar on every page, and the sidebar goes.
2. **Grouping:** 11 groups do not fit one line at 1366px, so they become seven modules:
   - Борлуулалт;
   - Агуулах;
   - Бараа (the catalogue, prices and segments);
   - Харилцагч;
   - Санхүү (the books and the reports);
   - Супермаркет;
   - Систем.
3. **The bar's right side:** search (Ctrl K), ☆ favourites, 🔔 notifications, the assistant ✨ and «Систем» ⚙ as icons.
4. **Favourites:** kept in this browser only, so no migration.
5. **The home page:** «Анхаарах» with the notifications, and the module tiles. A tile opens a module page listing all of its pages.
6. **Colour:** Bto's blue stays (ADR-0113); only the structure follows erxes.
7. **Width:** a centred column, about 1000px.

## Decision

1. **Modules.** `NAV_MODULES` (`apps/web/src/app/nav-items.ts`) maps the existing `NAV_GROUPS` onto modules:
   - sales;
   - inventory;
   - catalog (catalog, pricing, segments);
   - partners;
   - finance (finance, reports);
   - pos;
   - system (a tool);
   - ai (a tool).

   Each group belongs to exactly one module, and a test proves it. A module with no permitted page is hidden. `navTrail` also returns the page's module.
2. **The top bar** (`app/top-bar.tsx`) is sticky, white and 52px high. It holds, in order:
   - ⋮⋮ «Бүх цэс», which opens the drawer (its name stays «Цэс»);
   - the brand;
   - from `lg`, the business modules as `DropdownMenu`s. A menu shows one column per group (with a heading when the module has several groups) and «Бүх хуудас» at its foot, which opens the module page. The module of the open page is tinted `secondary`.

   At the right:
   - search, a pill with its shortcut from `xl` and an icon below;
   - ☆;
   - 🔔;
   - ✨ (a link to the assistant, with `ai.ask`);
   - ⚙ (the «Систем» menu);
   - the account avatar (profile, logout).

   The bar fits one line at 1366px.
3. **The drawer.** The old sidebar becomes «Бүх цэс», an overlay drawer at every width. While closed it is `inert` and invisible, so its links are never in the keyboard order. It keeps the folding groups and the lit entry.
4. **Favourites** (`lib/favorite-pages.ts`):
   - storage `tugeel.favorites.v1:<userId>`, at most 12, menu paths only (ADR-0037 #3);
   - other tabs follow through the `storage` event;
   - a ☆ button beside a menu page's title (`PageHeader`) stars or unstars it (`aria-pressed`);
   - the bar's ☆ lists the starred pages the user may still open, each with its module.
5. **The bell** reuses the rep app's inbox (`GET /me/notifications/summary`, `GET /me/notifications`, `POST /me/notifications/read`, ADR-0062 #3), so the API does not change.
   - It shows the unread count (read every minute and on return to the window).
   - Opened, it lists the newest notices and own notifications and marks them read.
   - A sold order opens its order.
6. **The home page** (route width `full`, a centred `max-w-[61rem]` column) has:
   - the date, the greeting and one line;
   - the customer-app warning (ADR-0079 #5);
   - «Анхаарах» and «Мэдэгдэл» as two cards of the same height from `md`. «Анхаарах» shows one row per waiting count, a calm line once every count says nothing waits, and nothing while loading or after an error;
   - «Модулиуд»: the business modules as icon tiles;
   - «Хэрэгсэл»: Систем and the assistant.

   The quick actions and the recent pages leave the home page; the Ctrl/⌘+K search keeps both.
7. **Module pages** (`/m/:module`, width `wide`) show:
   - the module's attention tiles;
   - its quick actions;
   - one section per group, with tiles of its pages.

   A module the user cannot open, or an unknown key, is not found.
8. **The breadcrumb** now shows on the desktop too. It reads module (linked to its page) › group (when the module has several) › list.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep the sidebar and restyle only the home page | The owner chose the top bar on every page |
| 11 groups on the bar with an overflow «Бусад» | Hides the later groups; the owner chose seven modules |
| Favourites on the server, per user | Needs a migration and an API; the owner chose this browser only |
| Erxes's indigo accent | The owner keeps Bto's blue (ADR-0113) |
| Module tiles opening the module's first page | The owner chose a module page listing all its pages |
| Radix `NavigationMenu` for the bar | `DropdownMenu` already carries the kit's keyboard and focus rules and the tests know it |

## Consequences

**Positive.**
- Every page gains the sidebar's 248px of width.
- The menu reads as seven areas instead of 64 entries.
- The home page shows what is waiting and where to go, as the owner's example does.
- Starred pages and the bell are one click from anywhere.

**Negative.**
- A page is two clicks away from the bar (module, then page) instead of one in the sidebar. The drawer, ☆ and Ctrl/⌘+K remain one-click ways.
- Favourites do not follow a user to another computer.
- The breadcrumb takes one more line on list pages.

**Verification.**
- Web Vitest covers:
  - the module of every group;
  - the bar's menus;
  - the module page and an unknown module;
  - the inert closed drawer;
  - starring and the ☆ list;
  - the bell's count and marking read;
  - the home page's modules, attention and empty states.
- `pnpm ui:shots` of every route at 1366×633 and 1920×969: the bar on one line, no page overflow, no console errors, no failed api calls.

## Related

ADR-0037, ADR-0042, ADR-0047, ADR-0053, ADR-0062, ADR-0066, ADR-0113, `docs/ui.md`
