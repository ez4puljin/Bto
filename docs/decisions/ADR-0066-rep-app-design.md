# ADR-0066: The sales-rep app drawn to the owner's design — the boards' look, shop filters and sorts, a checkout page, orders by days

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-16 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0061 (#1: «Дэлгүүр» becomes «Бараа» and the app gains a checkout page, the user's details and a password change; #5: the facade's product filters and sorts, a supplier list, the context's warehouses and branches, orders by days and search instead of by month; #8: one cart line per product, with a contact), ADR-0062 (#3: the popup and the list as the Launch and Notifications boards draw them, with a toast after the popup) |

## Context

After installing the rep app the owner said: «Апп Install хийхэд яг Bto Бараа Дэлгэц шиг харагдахгүй байна.» — the installed app does not look like the design «Bto Бараа дэлгэц» (a design artifact of 15 boards: the shop, a product, its keypad, the filter, the suppliers, the cart, the customer's details and its note, the profile and its details, the order settings, the orders, the date range, the notifications and the launch popup).

ADR-0061 built the app with a plain kit of cards and lists: 28 px titles, upper-case section names, one card per row, a Material tab bar, one product per line. The boards speak another language: inset grouped white lists (18 px corners, 50 px rows, 17 px text) under 34 px titles, a floating round tab bar, a two-column product grid, sheets from the bottom and a keypad of their own. The boards also show what the API did not have: sorting by newness and by price; filters by category, home warehouse, main supplier and stock; a «Шинэ» badge; a product's pictures; the orders of any range of days with a customer search; a separate page for the customer's details with a contact person and phone; the user's details and a password change.

The owner's answers (2026-10-16):
- «Шинэ» — a product that became sale-ready within the last **14 days**.
- «Нүүр» (no board) — keeps its content, in the boards' look.

## Decision

1. **The boards are the look.** Every boarded screen follows its board: the shop and a product on white, the rest on `#F2F2F7`; 34/41 bold page titles; 13 px semibold grey section headers; white groups with 18 px corners and 0.5 px separators from 16 px (58 px past a 30 px icon tile); a grey 40 px search field; segmented controls with a raised white part; the iOS switch; 54 px pill buttons; bottom bars of near-opaque white. The colours, sizes and shadows are tokens (`apps/mobile/src/theme/tokens.ts`), the parts a kit (`apps/mobile/src/ui/*`). No blur: React Native has none without a new native module, and Android's is experimental; the bars are near-opaque instead. Screens without a board (Нүүр, the order page, the customer picker, the scanner, sign-in, the server, offline, not a rep, the password) are drawn in the same language.
2. **A floating tab bar** (expo-router's own `tabBar`): 16 px from the sides and above the system navigation, 64 px high, round; «Нүүр», «Бараа», «Сагс» (the red count of lines), «Захиалга», «Профайл» (the red count of the bell, ADR-0062 #3); the open tab on a grey pill in the accent colour; hidden while the keyboard is open. Every tab leaves room for it at its end.
3. **The shop is a grid.** Two columns; a square picture on `#F5F5F7` with «Шинэ» and either «+» or the cart's quantity («1 хайрцаг»); the name, the code, the base price («29,100₮ / ш») and the stock («Үлдэгдэл 73 · хайрцагт 6», red «Үлдэгдэл дууссан» with the picture dimmed). A card opens the product; «+» adds one of the product's default unit — the default sales unit, else the largest pack, else the base unit — or opens the product when it cannot be ordered so. A product without stock can still be added; it is backordered (ADR-0055).
4. **The card's price is one base unit in whole packs** — the warehouse price of ADR-0048, given by the server as `basePrice` — and the price sorts order by exactly that. A product page shows the chosen unit's own price (`unit.wholesale`, a loose piece may carry the loose markup) with «1 хайрцагт 6 ширхэг · ширхэг нь 29,100₮» or «Хайрцаг нь 6 ширхэг: 174,600₮». The app still never computes a price (ADR-0061 #5): the product page's and the keypad's «Нийт» come from `POST /pricing/quote` of that one line, the cart's from the whole cart.
5. **Filters and sorts** (`GET /sales-rep/products`): `sort` NEW (the default: the latest to become sale-ready first, then the higher id), PRICE_ASC, PRICE_DESC (unpriced last either way); `categoryIds` (each with its subcategories), `warehouseId` (the products' home), `supplierIds` (main suppliers) as one product-list condition tree of ADR-0049 #4, and `inStock` (stock free in the home warehouse, the quantity the shop shows) as an explicit set of products; the first page answers `total`. A price sort orders every product the filters keep and refuses more than 100,000 with `SELECTION_TOO_LARGE` and the count, never cutting them short; it keeps its first page's day, so a page after midnight continues the same order. A cursor names its sort; another sort's cursor is refused. The filters are kept on the phone per server and user; a rep starts in the one wholesale warehouse they write for, else in every warehouse. `GET /sales-rep/suppliers` lists the main suppliers of the shop's products with how many each has.
6. **One cart line per product**, in the unit the rep chose on the product page (another unit replaces it in place); the cart also keeps a contact name and phone, taken from the customer's first contact when the rep typed none.
7. **Sending goes through «Захиалагчийн мэдээлэл»**: the customer, the contact, delivery or pickup with the address and the day from sheets (the day up to 60 days ahead), the payment, a note lifted above the keyboard with «Болсон» to put the keyboard away, and where the order lands; «Баталгаажуулж илгээх» sends without a further question, and a sent order shows its number over the page with «Захиалга харах» and «Шинэ захиалга». A send without an answer keeps the cart locked as before (ADR-0061 #8).
8. **Orders by days** (`GET /sales-rep/orders?from=&to=&q=` instead of `month`): any range of up to 366 days that exist, and an order number or customer to search; the summary covers the range and the search. The tab offers today, a week, this month and the calendar's presets and range; the orders are grouped by day.
9. **The notices** (ADR-0062 #3 unchanged in substance): the popup as the Launch board draws it — a picture by kind (the admin's picture; a price drop's product with how much cheaper it got; a promotion's percentage; a new product's pictures), the kind and days, a price drop's old and new prices (`basePriceBefore`, the base price on the day before the notice starts), the dots, the kind's «… харах» and «Дараагийнх / Хаах». After the last one a toast says the notices are kept under the bell and offers them again. The board's «Өнөөдөр дахин харуулахгүй» tick stays out (ADR-0062 #3: showing counts as reading). The list's note says what the app really notifies: a sold order.
10. **Who is signed in.** `GET /auth/me` gains `sessionStartedAt`; the user's details show the name, the login, the role, the branches of the rep's write scope (the context's `branchNames`), when the session signed in and when it ends, and the server; «Нууц үг солих» uses `POST /auth/password` (the server checks the rules; the phone has no `normalize()` for the shared check). The profile no longer changes the server; sign-in and offline still do.

### After the owner's first look (2026-10-17)

The owner installed 0.2 and asked for:

- the server and sign-in pages in «маш сайн UI»;
- the home and the tab bar reviewed again by agents and made «илүү гоёмсог, орчин үеийн»;
- smaller text: «Text жоохон том»;
- the products' pictures shown, kept small on the phone, never downloaded again at each start, and swiped on the cards and on the product page;
- delivery or pickup chosen simply: «Хүргэлтээр бол default нь өнөөдөр».

Two design-review agents read the code against the boards. The owner then chose:

- the home and the tab bar as the «main menu»;
- swiping on cards and pages;
- keeping every thumbnail once;
- today for pickup too.

The pictures had not shown at all in the walk's copy only: its api read another storage folder.

11. **Smaller text, capped scaling** (amends #1). The boards' iPhone sizes are about 12–15% smaller for Inter on Android: rows 15, page titles 28, notes and section headers 12. Android's extra font padding is off and every size is a token. The phone's font size setting enlarges the app's text at most 1.15× (`src/ui/text.tsx`; ESLint forbids react-native's Text and TextInput elsewhere). Rows are 48 px, pill buttons 50 px, segmented controls 40 px.
12. **The home** (amends #1's «Нүүр»). It has no page title. Top to bottom:
    - a greeting by given name, with the date and the bell;
    - a search bar into the shop, with the scanner;
    - the month on a blue card: the confirmed total large, then the orders and drafts;
    - the cart's banner while the cart has lines;
    - where new orders land, with a warning when unset;
    - «Шинэ бараа» as a strip of tiles with pictures;
    - the latest three orders.

    The tab bar (amends #2) is 60 px high, with finer icons and the open tab on a light-blue pill in the accent colour.
13. **Server and sign-in.**
    - The logo with «Bto» and the company name.
    - Labelled fields with icons, and an eye to show the password.
    - A server's errors tell "no answer" apart from "an answer that is not Bto".
    - The last five servers that answered are kept on the phone (`bto.servers.recent.v1`), to pick again after the PC's address changes.
14. **«Хүлээн авах»** (amends #7, and ADR-0061's «tomorrow by default» for the app).
    - Two cards: «Хүргэлтээр», with the address under it (tapping again changes it), and «Өөрөө авна», with the home warehouse.
    - Four day tiles: today, tomorrow, the day after, and another day from the calendar.
    - A new order starts on **today** for both delivery and pickup. The office's create dialog keeps tomorrow (`defaultDeliveryDate`).
15. **Pictures kept on the phone.**
    - `GET /sales-rep/thumbs` lists the primary thumbnail of every shop product (256 px JPEG, about 3 KB).
    - After sign-in, and whenever the app comes back to the foreground at least 6 hours after the last run, the app downloads the ones it lacks into expo-image's disk cache.
    - File URLs never change: a new picture is a new file. So a kept picture is never downloaded again, at a restart or otherwise.
    - A card swipes through the product's thumbnails; only the first loads until the rep swipes.
    - The product page opens at once from the list's data, and shows each thumbnail until its full picture arrives.
16. **Every request gives up after 10 s** (0.2.1). React Native's fetch never gives up by itself, and a stored server gone from the Wi-Fi held the start logo for minutes.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep the generic kit and only rename and reorder | The owner asked for the boards' look; the generic kit was the complaint. |
| Blur under the bars (`expo-blur`) | A new native module for an effect Android draws poorly; near-opaque white reads the same. |
| `react-native-reanimated` and gesture-handler for sheets | New native dependencies at mismatched versions; React Native's Modal with Animated slides is enough. |
| Sort by price in the app | The app would need every product of the filter; the server orders them. |
| The base unit's own wholesale price on the card | With a loose markup it is higher than what a piece costs in boxes, and it would not match the price sort. |
| Keep `month` beside the range | One phone and one server, built from one commit, before production; two forms of the same filter for nothing. |
| A «don't show again today» tick | Already rejected by ADR-0062: showing counts as reading. |
| Keep the boards' 17 px text (2026-10-17) | The owner found it too large on Android: Inter is wider than the boards' font, and the phone's font scaling had no cap. |
| Prefetch the full pictures too | About 25 KB each and up to ten per product. The thumbnails make the grid instant; a page's full picture is kept once it has been opened. |
| Keep the list of fetched thumbnails on the phone | expo-image (Glide) finds a kept file without the network, and a picture the phone dropped comes back on its own; the list could only go stale. |
| Default the office's dialog to today as well | Not asked; the office keeps ADR-0055's tomorrow. |

## Consequences

- The phone app's screens, kit and tests change; its version is 0.2.0, then 0.3.0 after the owner's first look (0.2.1 only added the request time limit). A phone with the 0.1.0 APK gets 422 on «Захиалга» against the new server until the new APK is installed (before production only).
- The facade asks catalog, pricing, partners, inventory and identity for small read-only answers (`docs/modules/*.md`): the NEW sort and `onlyIds` in catalog's product list, with batch reads of pictures and unit flags that stay out of `/products`; pricing's shop prices and its order by base price; partners' main-supplier counts; inventory's products free at home; the session's start in identity.
- A price sort reads up to 100,000 product ids twice per page (catalog, then pricing); about 20,000 today.
- The design's board files stay the reference for later changes to the app. Text sizes are the documented exception (#11): smaller than the boards.
- `GET /sales-rep/thumbs` reads every shop product's id, like the suppliers' list, and one file row per primary picture. The phone checks it at most every 6 hours.
- Capping the font scaling at 1.15 trades some of a large phone setting for layouts that do not break.

## Related

ADR-0048 (one warehouse price), ADR-0049 (product-list condition trees), ADR-0055 (backorders), ADR-0061 (the rep app), ADR-0062 (app notices), `docs/modules/mobile.md`, `docs/modules/sales.md` (the facade), `docs/SPEC.md` §5 (the rep app's stories).
