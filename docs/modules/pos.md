# Module `pos` — contract

| | |
|---|---|
| Status | S1 built 2026-10-16 (the centre: tables, accept path, shifts and their money, admin pages, the test till); S2 built 2026-10-17 (the store edge, the snapshot, the kiosk, the Docker stack, test receipts); S3 printing + e-Barimt, S4 returns at the till and the rest, S5 store deployment |
| ADRs | ADR-0063 (the store edge and the centre's `pos` module), ADR-0064 (POS money), ADR-0067 (the edge, the snapshot, the kiosk); later ADR-0065 (e-Barimt and printing on the edge) |
| Owner's answers | `docs/decisions/ADR-0063-pos-store-edge.md` «Context» (2026-10-16, three interview rounds) |
| Depends on | identity, catalog, pricing, inventory, finance (`MODULE_DEPS.pos`) |
| Imported by | nobody (the edge calls the REST surface) |

The supermarket's eight tills talk to a **store edge server** on the store's LAN (S2); the edge replays every document to the centre, which is the system of record for stock and money. Sections 1–8 are the centre's half of the contract; §9 is the edge's.

## 1. Owned tables (migration `0027_pos`)

| Table | Holds | Guards |
|---|---|---|
| `pos_settings` | one row: the STORE warehouse, the cash box the shifts' cash is booked into, `return_window_days` (14), `snapshot_interval_sec` (60), `supervisor_required` (true) | `id = 1`; ranges; `REVOKE DELETE, TRUNCATE` |
| `pos_edge_nodes` | a store's edge server: `code`, `name`, its STORE `warehouse_id`, `token_hash` (sha-256 of `tgs_<id>_<secret>`) + `token_prefix` + `token_issued_at`, what the edge last reported (`app_version`, `last_seen_at`, `last_pull_at`, `last_push_at`, `backlog`, `clock_skew_ms`, `snapshot_version`), `status` | code unique; `REVOKE DELETE, TRUNCATE` |
| `pos_tills` | a till (касс): `code` as the receipts print it, `name`, `printer_host`/`printer_port`, `drawer_kick`, the one-time `pairing_code_hash` for binding a browser (S2), `status`, `last_sale_at` | `(edge_node_id, code)` unique; `REVOKE DELETE, TRUNCATE` |
| `pos_till_devices` | a browser the edge bound to a till (S2): `device_token_hash`, `user_agent`, who bound it, `last_seen_at`, `revoked_at` | token hash unique; `REVOKE DELETE, TRUNCATE` |
| `pos_cashiers` | who may work a till: `user_id`, `pin_hash` (argon2id keyed with `POS_PIN_PEPPER`), who set it and when, `status`, `failed_count`, `locked_until` | `REVOKE DELETE, TRUNCATE` |
| `pos_shifts` | a shift: `client_id`, edge, till, cashier, `number` (`К3-261016-Э1`), `status` OPEN / CLOSED / HANDED_OVER, `opened_at`, `opening_float`; at the close `closed_at`, `counted_cash`, `float_kept`, `expected_cash`, `variance`, `note`, the totals (counts, cash and card sales and refunds, sales and returns and their VAT), `journal_entry_id` + `journal_number`; at the hand-over `handover_payment_id` + `handover_number`, `handed_over_at`, `handed_over_by` | `(edge, client_id)` and `(edge, number)` unique; one OPEN shift per till (partial unique index); the close fields together; `REVOKE DELETE, TRUNCATE` |
| `pos_sales` | a SALE or a RETURN: `client_id`, edge, till, shift, cashier, `approved_by`, `number` (`К3-261016-0045`), `refunds_sale_id`, `sold_at` + `sold_day`, `subtotal`, `discount_total`, `total`, `vat_total`, `receipt_type` B2C / B2B, `customer_tin`, `customer_name`, `consumer_no`, the receipt facts the edge reports (`ebarimt_status`, `ddtd`, `posapi_date`, `bill_id_suffix`, `inactive_id` — never a lottery or a QR), `snapshot_version`, `note` | `(edge, client_id)` and `(edge, number)` unique; `total = subtotal − discount_total`; a RETURN names its sale; a B2B carries a TIN; `REVOKE DELETE, TRUNCATE` (the receipt facts may change) |
| `pos_sale_lines` | product and unit snapshots, `qty`, `factor_snapshot`, `qty_base`, `basis` RETAIL / RETAIL_BULK, `list_price`, `unit_price`, `discount_amount`, `subtotal`, `total`, `vat_type`, `vat_rate_pct`, `vat_amount`, `applied` (the programs), `refunds_line_id`, `damaged`, `returned_base` | money and quantity signs; `returned_base ≤ qty_base`; `REVOKE DELETE, TRUNCATE` |
| `pos_tenders` | how a sale was paid: `kind` CASH / CARD, `amount` (what it settles), `tendered` (cash handed, ≥ amount; the change is the difference), `terminal_id`, `rrn`, `masked_pan` | append-only (`REVOKE UPDATE, DELETE, TRUNCATE` + triggers) |
| `pos_shortfalls` | what the shelf lacked when a till sold it: sale, line, product, warehouse, `qty_base`, the automatic adjustment (`adjustment_id` + `adjustment_number`), `resolved_at` / `resolved_by` / `note` | `qty_base > 0`; `REVOKE DELETE, TRUNCATE` |
| `pos_sync_rejections` | a replayed document the centre refused for good: edge, `client_id`, `kind`, the document as JSON, the error `code` + `params`, `replayed_at` / `replayed_by` | `REVOKE DELETE, TRUNCATE` |

Outside the module, the same migration: `POS_SHORTFALL` joins the adjustment reasons; `AUTO_POS_SHIFT` the journal sources and `POS_SHIFT` the journal's source documents; the four accounts `100102` / `120301` / `510102` / `740101` and the roles `POS_CASH` / `CARD_CLEARING` / `POS_SALES` / `CASH_VARIANCE` join the chart (seeded at boot like the others); `ai.stock_movements` shows the `POS-` numbers.

**Since F1's ledger (2026-10-20, ADR-0089, migration `0033_fin_ledger`)** the chart, the money accounts and the journal are the Finance Core's: `pos_settings.handover_money_account_id` (→ `fin.money_accounts`) and `pos_shifts.journal_entry_id` (→ `fin.journal_entries`) are plain ids without a foreign key, `journal_number` keeps the entry's number; the close posts by role (`shiftCloseLines`, the same six roles) through finance's `JournalService` as source BTO, never through the core's façade itself (ESLint G2). `PosShiftsService.repostCloseInTx` books a closed shift whose entry went with the old journal again from its stored totals (`pnpm finance:repost-journal`, development only); the hand-over stays a finance voucher. `handover_payment_id` → `payments` keeps its FK until F2.

## 2. Public API (`modules/pos/index.ts`)

| Export | Use |
|---|---|
| `PosModule` / `PosHttpModule` | the services; the controllers (api) |
| `PosAcceptService.applyEvent(node, actor, event)` / `acceptSale(tx, actor, node, doc)` | one replayed document → APPLIED / DUPLICATE / REJECTED (logged); a sale or return inside the caller's transaction |
| `PosShiftsService.acceptOpen` / `acceptClose(tx, actor, node, doc)` / `handOver(ctx, shiftId, input)` / `totals(shiftId)` | shifts and their money (ADR-0064) |
| `PosEdgeNodesService.list` / `get` / `create` / `update` / `issueToken(ctx, id)` / `authenticate(nodeId, secret)` / `heartbeat` | the store's edge servers |
| `PosTillsService.list` / `get` / `activeByCode(nodeId, code)` / `create` / `update` / `issuePairingCode` | the tills |
| `PosCashiersService.list` / `setPin(ctx, userId, pin)` / `setStatus` / `unlock` / `verifyPin(userId, pin)` / `assertActive(userId, tx)` | cashiers and PINs |
| `PosSettingsService.get` / `update(ctx, patch)` | the store's settings |
| `PosQueryService.listShifts` / `getShift` / `listSales` / `getSale` / `listShortfalls` / `resolveShortfall` / `listRejections` / `attention` | reads for the pages |
| `PosDevService.openShift` / `sell` / `closeShift` | the test till (development only, `POS_DEV_ONLY` in production) |
| document types `SaleDoc`, `ShiftOpenDoc`, `ShiftCloseDoc`, `ReceiptStatusDoc`, `TillBoundDoc`, `SyncEvent`, `SyncOutcome` | what the edge sends (S2 reuses them) |

## 3. REST surface (`/api/v1`, permissions in brackets)

| Route | Does |
|---|---|
| `GET /pos/settings` [`pos.read`], `PUT` [`pos.manage`] | the settings |
| `GET /pos/edge-nodes` [read], `POST`, `PUT /:id`, `POST /:id/token` [`pos.manage`] | edge servers; the token is returned once |
| `GET /pos/tills` [read] (`edgeNodeId`), `POST`, `PUT /:id`, `POST /:id/pairing-code` [`pos.manage`] | tills; the pairing code is returned once, valid 15 minutes |
| `GET /pos/cashiers` [read], `PUT /:userId/pin`, `PUT /:userId/status`, `POST /:userId/unlock` [`pos.manage`] | cashiers; a PIN is six digits and never read back |
| `GET /pos/shifts`, `GET /pos/shifts/:id` [read]; `POST /pos/shifts/:id/handover` [`finance.payments.record`, idempotent] | shifts with their totals (live for an open one); the hand-over voucher (`moneyAccountId`, `amount`, `paidOn` optional) |
| `GET /pos/sales`, `GET /pos/sales/:id` [read] | sales and returns (`q` on number, ДДТД, TIN, buyer; `tillId`, `shiftId`, `cashierUserId`, `kind`, `ebarimtStatus`, `from`, `to`; `total` on the first page); one with lines, tenders, shortfalls and its returns |
| `GET /pos/shortfalls` [read]; `POST /pos/shortfalls/:id/resolve` [`inventory.adjustments.manage`] | the storekeeper's list; «Шалгасан» with a note |
| `GET /pos/sync-rejections` [read]; `POST /pos/sync-rejections/:id/replay` [`pos.manage`, idempotent] | refused documents; a replay after the data was fixed |
| `GET /pos/attention` [read] | open shifts, shifts to hand over, open shortfalls, rejections |
| `POST /pos/sync/events`, `POST /pos/sync/heartbeat` [edge token] | the edge's replay (≤ 50 documents, in order; APPLIED / DUPLICATE / REJECTED each) and its heartbeat (answers the settings) |
| `GET /pos/sync/snapshot?since=` [edge token] | the node's snapshot (ADR-0067 #2), or `{ changed: false, version }` when `since` is current; notes the pull on the node |
| `POST /pos/dev/shifts/open`, `POST /pos/dev/sales`, `POST /pos/dev/shifts/:id/close` [`pos.manage`, idempotent; development only] | the test till |

Money is serialised with two decimals, quantities as entered, instants in ISO 8601, business days as `YYYY-MM-DD`.

## 4. Rules worth knowing

- **Accepting a sale (ADR-0063 #4, #5).** In order: the duplicate check on `(edge, client_id)`; the till by code (active); the shift by `client_id`, locked FOR UPDATE, OPEN, of that till; the cashier active; a return's supervisor when the setting asks; the products and units (a unit belongs to its product, the frozen factor is the unit's); the money (`subtotal = qty × unit price`, `total = subtotal − discount`, `vat = taxSplit(total, rate, 0)`, the VAT rate against `TaxService.companyRates(sold day)` + `ratesFor(product)`, the header as the sum of the lines, the tenders summing to the total); for a return its sale (locked), the window, the sold lines (same product and unit, same unit price, no more than what is left). Then the rows, then stock: the SALESFLOOR balances of the sold products are locked (`StockQueryService.lockOnHandInBin`), what is missing is adjusted in by `AdjustmentsService.postSystemInTx` with `POS_SHORTFALL` (one line per product, the base unit, `pos_shortfalls` rows) and the sale posts `POS_SALE` (external document `POS`) in full; a return posts `RETURN_IN` onto SALESFLOOR, or DAMAGED for damaged lines, at the warehouse's average cost. The effective date is the posting time.
- **Refusals.** An `AppError` other than `BIN_LOCKED_FOR_COUNT` / `STOCK_INSUFFICIENT` is permanent: the document is logged in `pos_sync_rejections` and the batch continues; those two are thrown so the edge resends the batch (applied documents answer DUPLICATE then). Codes: `POS_TOTALS_MISMATCH` (422, `field`, `lineNo`, `expected`, `got`), `POS_TAX_MISMATCH` (422), `POS_SHIFT_STATE_INVALID` (409, `status`), `POS_TILL_BUSY` (409), `POS_TILL_INACTIVE` (409), `POS_CASHIER_INACTIVE` (409), `POS_RETURN_EXCEEDS` (422, `remaining`), `POS_RETURN_WINDOW` (422, `windowDays`), `POS_NUMBER_TAKEN` (409), `POS_NOT_CONFIGURED` (409), `POS_DEV_ONLY` (404).
- **The close (ADR-0064 #2).** Totals come from the shift's accepted documents, never from the till; `expected = float + cash sales − cash refunds`, `variance = counted − expected`; the entry Dr `POS_CASH` (counted − float), Dr `CARD_CLEARING` (card net), Dr `SALES_RETURN` + Dr `VAT_PAYABLE` (returns), Cr `POS_SALES` + Cr `VAT_PAYABLE` (sales), the variance on `CASH_VARIANCE` (Cr over, Dr short); zero lines skipped, a negative movement swaps sides, nothing posted when nothing moved. Dated the Ulaanbaatar day of the close, described `«shift number — till · cashier»`.
- **The hand-over (ADR-0064 #3).** CLOSED → HANDED_OVER with an `OTHER_IN` voucher (`PaymentsService.recordInTx`) on the chosen cash box (default: the settings' box) against `POS_CASH`, for `counted − float kept` by default, `collectedBy` = the cashier, reference = the shift's number; once per shift (409 `POS_SHIFT_STATE_INVALID`).
- **Lock order.** The shift row (FOR UPDATE) → a return's sale and its lines (FOR UPDATE) → the SALESFLOOR `bin_stock` rows of the sold products in product order (FOR UPDATE) → inventory's posting locks (bins FOR SHARE, caches) → the number counters. Two sales of the same shift serialise on the shift; two tills run in parallel.
- **Numbers.** The edge allocates them per till and day (`posSaleNumber`, `posShiftNumber` in `@tugeel/shared/pos`); the centre stores them verbatim and refuses a repeat with `POS_NUMBER_TAKEN`. The test till allocates them on the centre with `NumberingService` (`POS_SALE:<node>:<till>` / `POS_SHIFT:<node>:<till>`, period = the day).
- **PINs.** Six digits; `PinHasher` = argon2id with `secret` = `POS_PIN_PEPPER` (else `AUTH_PEPPER`); five wrong tries lock the cashier for a minute (`verifyPin`); an admin unlocks. The edge gets the hashes in its snapshot and checks them offline with the same pepper (§9).
- **The edge token.** `tgs_<node id>_<32-byte base64url secret>`; the centre keeps the sha-256 of the whole token and its first 8 hex as the prefix shown in the admin; a new token replaces the old one at once. `EdgeTokenGuard` on `@Public()` routes, `@CurrentEdge()` for the node.
- **Settings.** `pos_settings` is one row with defaults until saved; the STORE warehouse must be of kind STORE, the hand-over box an active CASH account. The edge's own warehouse is on its row (the settings' warehouse is the admin's default).

## 5. Audit

`pos_settings` UPDATE; `pos_edge_nodes` CREATE / UPDATE / TOKEN_ISSUED; `pos_tills` CREATE / UPDATE / PAIRING_CODE / BIND; `pos_cashiers` PIN_SET (never the PIN) / UPDATE / UNLOCK; `pos_shifts` OPEN / CLOSE / HANDOVER; `pos_sales` ACCEPT (number, kind, till, shift, cashier, total, lines, the shortfall adjustment, the refunded sale); `pos_shortfalls` RESOLVE; `pos_sync_rejections` REPLAY. Replayed documents are audited with the actor `edge:<code>`; the test till with the admin.

## 6. Screens (`apps/web`, group «Супермаркет», `pos.read`)

`/pos/tills` (edge servers with their tokens and the tills, `?new=1` dialogs), `/pos/cashiers` (PIN dialog), `/pos/shifts` (+ `?shift=` panel: facts, Z totals, variance, the entry and the voucher, «Бэлэн мөнгө хүлээн авах» for `finance.payments.record`), `/pos/sales` (+ `?sale=` panel: lines, tenders, receipt facts, shortfalls, returns; `/pos/sales/:id/print` 80 mm / A4 copy without lottery or QR), `/pos/settings` (`pos.manage`), `/pos/test-till` (development builds only). Home tile «Хүлээн авах ээлж» for `finance.payments.record`.

## 7. Tests

`test/integration/pos-edge.int-spec.ts` (the edge against a listening centre: the snapshot and its version, pairing with a code newer than the snapshot, the PIN, a shift, offline prices, cash with change and card, the shortfall, the centre away and the queue replayed, a repeated sale, a refused document parked, the close at the centre), `pos-accept.int-spec.ts` (the accept path: posting, shortfall, duplicate, arithmetic and tax refusals, returns), `pos-shifts.int-spec.ts` (open / close / the entry / the hand-over / the cash book), `pos-admin.int-spec.ts` (settings, nodes and tokens, tills, cashiers, the sync route's token, rejections and replay); `test/integrity/pos-guards.spec.ts` (REVOKEs and the tenders' triggers), `pos-races.spec.ts` (one `client_id` twice at once; the last units sold twice at once; a close racing a sale); `packages/shared/src/pos/pos.test.ts`; `apps/web/src/features/pos/*.test.tsx`.

## 8. Open items

- S3: `RECEIPT_STATUS` from a real provider; `ebarimt_status` other than NONE.
- S4: returns, parked baskets and price check at the till; the shortfall and rejection pages; `ai.pos_*` views.
- The ledger date of a replayed offline sale is the centre's posting day (ADR-0063 #5); an `effectiveDate` override in `StockPostingService` is a later decision.

## 9. The store edge (S2, ADR-0067)

The same image as `ROLE=edge` (`apps/api/src/edge.ts`, `apps/api/src/edge/**`): no `modules/**`, only `common/**` and `@tugeel/shared`; the shapes it exchanges with the centre and the kiosk are in `@tugeel/shared/pos` (`edge.ts`).

- **Environment** (`EdgeEnvSchema`; `apps/api/.env.edge` locally, `deploy/edge/.env` in Docker): `EDGE_PORT` 3400, `EDGE_DATABASE_URL`, `EDGE_DB_POOL_MAX` 5, `CENTRAL_API_URL`, `EDGE_NODE_TOKEN`, `EDGE_JWT_SECRET` (no `dev-` value in production), `POS_PIN_PEPPER` (the centre's value, or its `AUTH_PEPPER`), `EBARIMT_PROVIDER=fake`, `EDGE_TIMERS`, `EDGE_PUSH_INTERVAL_MS`.
- **Tables** (its own database; `apps/api/src/edge/db`, migration `0000_edge`, applied by `db:migrate:edge` and by the entrypoint): `edge_state` (one row: the snapshot document and version, the pull, push and contact times, the last error), `edge_devices` (bound browsers: till, sha-256 of the device token, user agent, seen, revoked), `edge_sequences` (`SALE:<till>` / `SHIFT:<till>` per day), `edge_shifts` (one OPEN per till), `edge_sales` (the document and the receipt as sent), `edge_outbox` (`UNIQUE (kind, client_id)`; PENDING, then SENT or REJECTED), `edge_pin_attempts`.
- **Routes** (`/edge/v1`, `KioskGuard`: public, device, or device and cashier session): `GET health` and `POST pair` (public); `GET device` and `POST auth/pin` (device); `POST auth/logout`, `GET session`, `POST shifts/open`, `POST shifts/close`, `GET products/search?q=`, `GET products/barcode/:code`, `POST quote`, `POST sales`, `GET sales/recent` (cashier). The device token travels in `x-bto-device`, the session as a bearer token.
- **Codes.** `POS_PAIRING_INVALID` (422), `POS_DEVICE_UNKNOWN` (401), `POS_PIN_INVALID` (401, `attemptsLeft`), `POS_CASHIER_LOCKED` (423, `until`), `POS_SESSION_EXPIRED` (401), `POS_SNAPSHOT_MISSING` (503: the edge has never reached the centre), plus `POS_SHIFT_STATE_INVALID`, `POS_TOTALS_MISMATCH`, `POS_TILL_INACTIVE`, `POS_CASHIER_INACTIVE`, `PRICE_MISSING`.
- **Loops** (`SyncRunner`, off with `EDGE_TIMERS=false`): pull every `snapshot_interval_sec` (60), push every `EDGE_PUSH_INTERVAL_MS` while documents wait (back-off from 2 s to 60 s after a failure), heartbeat every 30 s. The tests call `pullOnce`, `pushOnce` and `heartbeatOnce`.
- **Rules.** A pairing code is checked against the till's hash in the snapshot (sha-256 of `<till id>:<code>`, not expired); one the snapshot does not know yet makes the edge pull once more. A PIN is checked against the snapshot's hash; five wrong ones lock the cashier on this edge for a minute; a session lives 12 hours, bound to the device and the till, and ends when the snapshot no longer lists the cashier as active. A sale is priced from the snapshot (RETAIL), refused when a line has no price, paid by cash (with the amount handed over and the change) and card (typed by hand) that make the total, and written with its document and its outbox entry in one edge transaction; a repeated client id answers its receipt. The receipt is a test receipt (`ebarimt.mode = TEST`, no ДДТД).
- **Running it.** Docker (the owner's PC now, the store PC in S5): `pnpm edge:up`, `pnpm edge:down`, `pnpm edge:logs` over `deploy/edge/docker-compose.edge.yml` (`edge-db`, `edge`, `kiosk` on `KIOSK_PORT` 7400); the tills open `http://<LAN address>:7400`. Without Docker: `pnpm --filter @tugeel/api db:migrate:edge`, then `pnpm --filter @tugeel/api edge:dev` (port 3400, `apps/api/.env.edge`), and the kiosk at `http://localhost:5173/pos.html` (Vite proxies `/edge`).
- **First use.** In the admin: the store's settings, an edge server with its token (into the edge's env), a till, the cashiers' PINs; then «Холбох код» on the till, typed once into the till's browser with the till's code.
