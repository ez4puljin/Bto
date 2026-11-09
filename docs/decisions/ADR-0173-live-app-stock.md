# ADR-0173: Live stock in both apps, counted from chosen locations, and no stall between stock writers

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-09 |
| Deciders | Owner («Посоос ирсэн борлуулалт, агуулахын борлуулалт, Орлого, Хөдөлгөөний гүйлгээ зэрэг хийгдэж байхад үлдэгдэл тооцоолол асуудалгүй гацалтгүй байх ёстой. Апп дээр шууд realtime үлдэгдэл харагддаг байх. Ямар ч хоцрогдолгүй. … Зөвхөн барааны харьяалагдах агуулахын үлдэгдэл харагддаг байна.», and four answers the same day), Claude (the direct-mode session on main) |
| Related | ADR-0068 (the rep app shows the home warehouse's available), ADR-0079 #4 (superseded in part: «Bto300» may show the number), ADR-0127 (the «Апп» module), ADR-0164 #1 (amended: one row of `app_settings` carries a staff setting again), ADR-0063 #5 (the POS shortfall), architecture §5.3 (lock order), §10.2 (connections) |
| Migrations | `0091_app_stock` |

## Context

Both apps already showed one number per product: the home warehouse's available (sellable on hand less reserved, ADR-0068), as words in «Bto300» (ADR-0079 #4). The phones kept every list for 30 seconds and nothing told them when stock moved, so a rep or a store saw what was true when the screen was last read. The server's balances are current at every commit (the posting writes `warehouse_stock` in the same transaction), and reading them is fast: 10 locations × 10,000 products answered in 6–25 ms per page with 40 sales a second being written (measured 2026-11-09 on a copy).

Reading the write path found one stall: a till sale arriving from the store edge (`PosAcceptService.fillShortfalls`) locked the shelf's `bin_stock` rows before the posting locked `warehouse_stock`, the inverse of the order every other posting uses. A transfer received or a bin move onto the same shelf at that moment deadlocked with it (PostgreSQL ended one side with 40P01). A product the store had never held had a second form of it: the sale inserted its missing balance rows after holding locks, while the transfer had inserted them first and waited.

The owner's answers (2026-11-09): live stock in both apps; «Bto300» shows words or the number as a setting decides; a product whose home warehouse is not among the chosen locations shows as out of stock and cannot be ordered; the number stays the available.

## Decision

1. **Which locations count, per app.** «Апп → Аппын бараа» has, on each tab («Bto300», «Ажилтны апп»), a list of locations (`app_stock_warehouses`: app `CUSTOMER` or `STAFF`, warehouse; no foreign key, re-read through the org directory, an archived warehouse drops out). An app shows each product's home-warehouse available only when that warehouse is ticked for it; otherwise the product reads 0 / «Дууссан» and carries `stockBlocked` (staff). **No location ticked = every location counts**, today's behaviour (Claude's default, the owner may change it by ticking). Never a sum of locations and never a list per location.
2. **«Bto300»'s display.** `app_settings.customer_stock_display`: `WORDS` (default, ADR-0079 #4's three words) or `NUMBER` (the available with the base unit). The number reaches a customer token only under `NUMBER`, in lists, cards, the product page and the live stream alike. This supersedes ADR-0079 #4 where it said "never the number".
3. **One rule everywhere.** `ShopScope.countedWarehouseIds` is filled by `customerScope()` and `staffScope()` and applied by `SalesRepShopService` to every list, card, in-stock filter, home section, quote and live value; `productIdsAvailableAtHome` takes the list. A blocked product is refused by both apps' order routes with 409 `PRODUCT_OUT_OF_APP_STOCK`; office orders on the web are untouched.
4. **Live, without a new dependency.** Every stock write notifies at commit: `notifyStockChanged(tx, productIds)` (`pg_notify('bto_stock', …)`, chunks under 7,000 bytes) from `StockPostingService.post()`, `ReservationService`, the home and minimum changes of `ProductLocationsService`; `notifyStockResync(tx)` from a balance rebuild and from a settings save that changes what an app counts or shows. A rolled-back write notifies nothing. The api's `LiveStockHub` holds one `LISTEN` connection (opened with the first stream; keepalive and a `SELECT 1` every 30 s, a missed answer reconnecting), gathers a burst for 150 ms, computes each app's values once through the shop's read model and sends them as server-sent events on `GET /sales-rep/stock/live` (`sales.orders.rep`) and `GET /customer-app/stock/live` (`@CustomerRoute()`): `ready` on connect, `stock` with `{ items }`, `resync` (more than 500 products in a burst, a lost listener, a settings change), `ping` every 20 s; a stream ends at its token's expiry and the phone reconnects. The phones read the stream over `XMLHttpRequest` while signed in and in the foreground, patch every cached product in place, refetch on `ready` and `resync`. A till's sales reach the centre when the store edge sends them (about 2 s while it is online); while the edge is offline the apps cannot see them, which is the edge's design (ADR-0067).
5. **Lock order, without exception.** Missing balance rows are inserted first (sorted, `ON CONFLICT DO NOTHING`), then `warehouse_stock` rows are locked, then `bin_stock` rows, in key order. The POS shortfall now does the same: `StockPostingService.ensureBalanceRows`, then `StockQueryService.lockWarehouseBalances`, then `lockOnHandInBin`. `test/integrity/stock-mixed-races.spec.ts` forces both deadlocks (they fail with 40P01 without the fix and pass with it) and runs every writer — till replays, transfer ship and receive, bin moves, order reserve, pick and sale, goods receipts — on the same products at once.
6. **Connections and proxy.** One more connection per api process for the listener: api 6 + 1 (architecture §10.2, `CLAUDE.md`); it must reach PostgreSQL directly, never through PgBouncer. The Caddyfile does not compress the `*/stock/live` paths.

## Consequences

- Phones show what the books show within about a second of a commit, without polling; a stock write costs one `pg_notify` and PostgreSQL's short commit-time lock for notifying transactions.
- Every list a phone holds can still be in the old order until it is next read («Дууссан» products move last only on a refetch); the values in it are current.
- Installed apps older than staff 0.14.0 / «Bto300» 0.5.0 keep working without live updates; a staff app before 0.14.0 shows a blocked product as «Дууссан» and learns the refusal only from the server's 409.
- A third process sending stock writes (the worker, a CLI) needs nothing: PostgreSQL delivers the notices to the api's listener.

## Related

docs/modules/sales.md, docs/modules/inventory.md, docs/modules/mobile.md, docs/architecture.md §5.3 and §10.2.
