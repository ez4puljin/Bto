# Module `pos` — contract

| | |
|---|---|
| Status | S1 built 2026-10-16 (the centre: tables, accept path, shifts and their money, admin pages, the test till); S2 edge, S3 printing + e-Barimt, S4 returns at the till and the rest, S5 store deployment |
| ADRs | ADR-0063 (the store edge and the centre's `pos` module), ADR-0064 (POS money); later ADR-0065 (e-Barimt and printing on the edge) |
| Owner's answers | `docs/decisions/ADR-0063-pos-store-edge.md` «Context» (2026-10-16, three interview rounds) |
| Depends on | identity, catalog, pricing, inventory, finance (`MODULE_DEPS.pos`) |
| Imported by | nobody (the edge calls the REST surface) |

The supermarket's eight tills talk to a **store edge server** on the store's LAN (S2); the edge replays every document to the centre, which is the system of record for stock and money. This file is the centre's half of the contract; the edge's half is added in S2.

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

Outside the module, the same migration: `POS_SHORTFALL` joins the adjustment reasons; `AUTO_POS_SHIFT` the journal sources and `POS_SHIFT` the journal's source documents; the four accounts `100102` / `120301` / `510102` / `740101` and the roles `POS_CASH` / `CARD_CLEARING` / `POS_SALES` / `CASH_VARIANCE` join the chart (seeded at boot by finance like the others); `ai.stock_movements` shows the `POS-` numbers.

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
| `POST /pos/dev/shifts/open`, `POST /pos/dev/sales`, `POST /pos/dev/shifts/:id/close` [`pos.manage`, idempotent; development only] | the test till |

Money is serialised with two decimals, quantities as entered, instants in ISO 8601, business days as `YYYY-MM-DD`.

## 4. Rules worth knowing

- **Accepting a sale (ADR-0063 #4, #5).** In order: the duplicate check on `(edge, client_id)`; the till by code (active); the shift by `client_id`, locked FOR UPDATE, OPEN, of that till; the cashier active; a return's supervisor when the setting asks; the products and units (a unit belongs to its product, the frozen factor is the unit's); the money (`subtotal = qty × unit price`, `total = subtotal − discount`, `vat = taxSplit(total, rate, 0)`, the VAT rate against `TaxService.companyRates(sold day)` + `ratesFor(product)`, the header as the sum of the lines, the tenders summing to the total); for a return its sale (locked), the window, the sold lines (same product and unit, same unit price, no more than what is left). Then the rows, then stock: the SALESFLOOR balances of the sold products are locked (`StockQueryService.lockOnHandInBin`), what is missing is adjusted in by `AdjustmentsService.postSystemInTx` with `POS_SHORTFALL` (one line per product, the base unit, `pos_shortfalls` rows) and the sale posts `POS_SALE` (external document `POS`) in full; a return posts `RETURN_IN` onto SALESFLOOR, or DAMAGED for damaged lines, at the warehouse's average cost. The effective date is the posting time.
- **Refusals.** An `AppError` other than `BIN_LOCKED_FOR_COUNT` / `STOCK_INSUFFICIENT` is permanent: the document is logged in `pos_sync_rejections` and the batch continues; those two are thrown so the edge resends the batch (applied documents answer DUPLICATE then). Codes: `POS_TOTALS_MISMATCH` (422, `field`, `lineNo`, `expected`, `got`), `POS_TAX_MISMATCH` (422), `POS_SHIFT_STATE_INVALID` (409, `status`), `POS_TILL_BUSY` (409), `POS_TILL_INACTIVE` (409), `POS_CASHIER_INACTIVE` (409), `POS_RETURN_EXCEEDS` (422, `remaining`), `POS_RETURN_WINDOW` (422, `windowDays`), `POS_NUMBER_TAKEN` (409), `POS_NOT_CONFIGURED` (409), `POS_DEV_ONLY` (404).
- **The close (ADR-0064 #2).** Totals come from the shift's accepted documents, never from the till; `expected = float + cash sales − cash refunds`, `variance = counted − expected`; the entry Dr `POS_CASH` (counted − float), Dr `CARD_CLEARING` (card net), Dr `SALES_RETURN` + Dr `VAT_PAYABLE` (returns), Cr `POS_SALES` + Cr `VAT_PAYABLE` (sales), the variance on `CASH_VARIANCE` (Cr over, Dr short); zero lines skipped, a negative movement swaps sides, nothing posted when nothing moved. Dated the Ulaanbaatar day of the close, described `«shift number — till · cashier»`.
- **The hand-over (ADR-0064 #3).** CLOSED → HANDED_OVER with an `OTHER_IN` voucher (`PaymentsService.recordInTx`) on the chosen cash box (default: the settings' box) against `POS_CASH`, for `counted − float kept` by default, `collectedBy` = the cashier, reference = the shift's number; once per shift (409 `POS_SHIFT_STATE_INVALID`).
- **Lock order.** The shift row (FOR UPDATE) → a return's sale and its lines (FOR UPDATE) → the SALESFLOOR `bin_stock` rows of the sold products in product order (FOR UPDATE) → inventory's posting locks (bins FOR SHARE, caches) → the number counters. Two sales of the same shift serialise on the shift; two tills run in parallel.
- **Numbers.** The edge allocates them per till and day (`posSaleNumber`, `posShiftNumber` in `@tugeel/shared/pos`); the centre stores them verbatim and refuses a repeat with `POS_NUMBER_TAKEN`. The test till allocates them on the centre with `NumberingService` (`POS_SALE:<node>:<till>` / `POS_SHIFT:<node>:<till>`, period = the day).
- **PINs.** Six digits; `PinHasher` = argon2id with `secret` = `POS_PIN_PEPPER` (else `AUTH_PEPPER`); five wrong tries lock the cashier for a minute (`verifyPin`); an admin unlocks. The edge gets the hashes in its snapshot (S2) and needs the same pepper.
- **The edge token.** `tgs_<node id>_<32-byte base64url secret>`; the centre keeps the sha-256 of the whole token and its first 8 hex as the prefix shown in the admin; a new token replaces the old one at once. `EdgeTokenGuard` on `@Public()` routes, `@CurrentEdge()` for the node.
- **Settings.** `pos_settings` is one row with defaults until saved; the STORE warehouse must be of kind STORE, the hand-over box an active CASH account. The edge's own warehouse is on its row (the settings' warehouse is the admin's default).

## 5. Audit

`pos_settings` UPDATE; `pos_edge_nodes` CREATE / UPDATE / TOKEN_ISSUED; `pos_tills` CREATE / UPDATE / PAIRING_CODE / BIND; `pos_cashiers` PIN_SET (never the PIN) / UPDATE / UNLOCK; `pos_shifts` OPEN / CLOSE / HANDOVER; `pos_sales` ACCEPT (number, kind, till, shift, cashier, total, lines, the shortfall adjustment, the refunded sale); `pos_shortfalls` RESOLVE; `pos_sync_rejections` REPLAY. Replayed documents are audited with the actor `edge:<code>`; the test till with the admin.

## 6. Screens (`apps/web`, group «Супермаркет», `pos.read`)

`/pos/tills` (edge servers with their tokens and the tills, `?new=1` dialogs), `/pos/cashiers` (PIN dialog), `/pos/shifts` (+ `?shift=` panel: facts, Z totals, variance, the entry and the voucher, «Бэлэн мөнгө хүлээн авах» for `finance.payments.record`), `/pos/sales` (+ `?sale=` panel: lines, tenders, receipt facts, shortfalls, returns; `/pos/sales/:id/print` 80 mm / A4 copy without lottery or QR), `/pos/settings` (`pos.manage`), `/pos/test-till` (development builds only). Home tile «Хүлээн авах ээлж» for `finance.payments.record`.

## 7. Tests

`test/integration/pos-accept.int-spec.ts` (the accept path: posting, shortfall, duplicate, arithmetic and tax refusals, returns), `pos-shifts.int-spec.ts` (open / close / the entry / the hand-over / the cash book), `pos-admin.int-spec.ts` (settings, nodes and tokens, tills, cashiers, the sync route's token, rejections and replay); `test/integrity/pos-guards.spec.ts` (REVOKEs and the tenders' triggers), `pos-races.spec.ts` (one `client_id` twice at once; the last units sold twice at once; a close racing a sale); `packages/shared/src/pos/pos.test.ts`; `apps/web/src/features/pos/*.test.tsx`.

## 8. Open items

- S2: the edge role, the snapshot (`GET /pos/snapshot`), `TILL_BOUND` from a real pairing, the kiosk.
- S3: `RECEIPT_STATUS` from a real provider; `ebarimt_status` other than NONE.
- S4: returns, parked baskets and price check at the till; the shortfall and rejection pages; `ai.pos_*` views.
- The ledger date of a replayed offline sale is the centre's posting day (ADR-0063 #5); an `effectiveDate` override in `StockPostingService` is a later decision.
