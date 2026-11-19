# Module: erxes (new erxes deals as draft orders, ADR-0218, ADR-0220; Erkhet's stock by location, ADR-0221)

Every deal created in a ticked pipeline of the company's erxes is copied once into Bto as a draft order, whole, under the Bto user who is its erxes creator. A person may also copy the deals created within whole days they pick («Хугацаагаар татах», ADR-0220). Web: `/sales/erxes` («Борлуулалт → Erxes-ээс ирсэн»). It also reads Erkhet's stock by location through erxes and shows it beside Bto's on-hand («Агуулах → Эрхэтийн үлдэгдэл», `/inventory/erkhet-stock`, ADR-0221). It never writes to erxes or to stock. It reads catalog, partners, inventory and identity through their public services and makes orders only through `SalesOrdersService.createInTx`; nobody imports it.

## Owned tables (`modules/erxes/schema.ts`, migration `0111_erxes_deal_copy`)

| Table | Holds |
|---|---|
| `erxes_settings` | One row: the address (`https://host`, the company's erxes when null), the email, the password sealed under `ERKHET_KEY_SECRET` (context `erxes_settings.password`), the switch, and what the last pull came to (`last_pull_at`, `last_ok_at`, `last_failure`, `last_failure_detail`) |
| `erxes_pipelines` | A pipeline of erxes as «Erxes-ээс шинэчлэх» read it (`erxes_id` unique): its board, `blocked` (a board never copied), `gone`, `enabled` with `enabled_at` (only deals created after it are copied), the Bto pipeline and stage its copies land in, `last_seen_created_at` (where the next pull stops) and `first_pull` (the first answers erxes gave, kept to compare) |
| `erxes_users` | A user of erxes (`erxes_id` unique): email, name, phone, and `bto_user_id`, a person's choice of the same person in Bto |
| `erxes_stock_locations` | An Erkhet location (`code`, «01») with its label and the Bto warehouse a person linked it to (null: not compared); migration `0113` |
| `erxes_stock_runs` | A read of Erkhet's balances: `QUEUED` → `RUNNING` → `DONE`/`FAILED`, one active (`active_slot`), the plan (pipeline → locations), products, calls planned, done and refused, `heartbeat_at`, the failure and erxes's words |
| `erxes_stock_products` | An active erxes product as a run read it: code, name, unit, the matched Bto product or `PRODUCT_NOT_FOUND`/`PRODUCT_AMBIGUOUS`, `read_ok` (false: a call for it was refused, its quantity is unknown) |
| `erxes_stock_balances` | Erkhet's non-zero balance of a product at a location, in erxes's unit; only the newest finished run keeps its rows |
| `erxes_deals` | A deal a pull saw (`erxes_id` unique, `order_id` unique): `WAITING`, `COPIED` or `DISMISSED`; `raw` (the deal as erxes answered, never rewritten), `products`, `field_labels`; `issues` (why it waits), `choices` (a person's customer and units), `matched_units` (erxes product → the unit its line became), the creator's erxes name and matched Bto user, the order and its customer |

## The one file that knows erxes (`erxes-wire.ts`, `erxes.client.ts`)

erxes's GraphQL is at `<address>/gateway/graphql`; introspection is off there. `erxes-wire.ts` holds every query as a tree of fields (`BOARDS`, `USERS`, `DEAL_PAGE`, `DEAL_RANGE`, `DEAL_DETAIL`, `PRODUCTS`, `DEAL_FIELDS`), the `login` mutation, `readDeal`, which reads an answer defensively into what the copy and the panel use, and `dealTotal`. `erxes-wire.fixture.ts` is the deal Bto expects. `ErxesClient` signs in (`login`; the session is the `auth-token` cookie), then sends queries only; a field erxes refuses («Cannot query field …», or the gateway's «no field `…` in type `…`») is cut and the query sent again (`cuts`), and the cut shape is kept for the client's next query of it; a shape erxes refuses otherwise (an unknown root, a missing argument) moves to the next shape (`salesBoards(type: "deal")`, then `boards(type: "deal")`); when every shape is refused the error is `UNEXPECTED_ANSWER` with what erxes said of each, never an empty answer. An ended session signs in once more. `https` only, 30 s a request. Failures are `LOGIN_FAILED`, `UNREACHABLE`, `TIMEOUT`, `UNEXPECTED_ANSWER`.

Checked against the company's erxes on 2026-11-19 (ADR-0220): `salesBoards` requires `type: "deal"`; `deals` skips archived deals unless `noSkipArchive: true` (every `deals` query sends it: deals move to «Архивлах» within hours); `createdStartDate`/`createdEndDate` of type `Date` filter `deals` by creation (`startDate`/`endDate` filter something else, `dateRangeFilters` errors, `status` is no argument); `dealDetail` takes every field of `DEAL_DETAIL` (Company has no `registrationNumber`, so it is not asked); `productsData` lines carry `_id, productId, uom, currency, quantity, maxQuantity, unitPrice, taxPercent, tax, discountPercent, discount, amount, tickUsed, branchId, departmentId, conditions`; `products(ids, perPage) { _id name code barcodes uom }` works. `DEAL_RANGE` asks more of a list item (number, stage, creator, parties, lines, amount) than was checked: what erxes refuses there is cut.

When erxes's real shape differs: read `erxes_pipelines.first_pull` (or the worker's log line «erxes first answers of pipeline …»), change `erxes-wire.ts` and its fixture, nothing else.

Erkhet's stock (ADR-0221, from the old ERP's working code, not checked by Bto): `REMAINDER_CONFIG` (`configsGetValue(code: "remainderConfig")`, erxes's JSON: pipeline id → `{ account, location: "01,02" }`, read by `readRemainderConfig` as JSON, inside `value` or as text), `PRODUCT_PAGE` (`products(status: "active", perPage, page) { _id code name barcodes uom }`), `ERKHET_REMAINDERS` (`erkhetRemainders(productIds, stageId: "", pipelineId) { _id remainder remainders }`, read by `readRemainders`), `planRemainders` (the fewest pipelines of account `150101` that cover every location) and `ERKHET_LOCATION_NAMES` (the 2026-10-22 labels). The fixture holds `FIXTURE_REMAINDER_CONFIG` and `FIXTURE_REMAINDERS`.

## The rules

- **Which deals.** Ticked pipelines only, and only deals created after the tick. A board named «Хархорин» is blocked. A ticked pipeline needs a live Bto stage without an action.
- **The pull** (`ErxesPullFlowService`): per ticked pipeline, pages of 50 newest first (archived deals too) until a page holds nothing newer than ten minutes before `last_seen_created_at` (20 pages at most); each unseen deal is read whole (`fetchDeal`: `dealDetail`, its products and, when it has custom fields, the field labels), the row inserted `ON CONFLICT DO NOTHING` (`storeDeal`), and tried. Then up to 200 waiting deals are tried again. erxes is never called inside a transaction.
- **A failure is seen** (ADR-0220): a pull, a refresh or a range read that erxes refuses writes `last_failure` and erxes's words in `last_failure_detail` (the page shows both in red and a toast); a refresh whose answer holds no pipeline fails with `UNEXPECTED_ANSWER` and changes nothing. A successful pull clears it.
- **The range copy** (`ErxesRangeFlowService`, ADR-0220): whole Ulaanbaatar days `from`…`to` (from ≤ to, 31 days at most), any chosen pipeline that is not blocked, not gone and has its Bto place (ticked or not; Kharkhorin never). «Харах» reads `DEAL_RANGE` per pipeline in pages of 100 newest first, checks each `createdAt` against the range again, stops at 1000 deals (`tooMany`) and marks each deal Bto holds (`known`: its row's state and order). «Bto руу хуулах» takes 50 deals at most a request (the page sends parts of 20 and shows the progress): a deal Bto holds is skipped (`KNOWN`); the rest is read whole and checked (another pipeline now → `OTHER_PIPELINE`, outside the range → `OUT_OF_RANGE`), kept by `storeDeal` and tried by `tryCopy` with the person as the presser, each on its own; a deal erxes answers wrong fails alone, erxes that cannot be reached or signed in to fails the rest of the request. One audit row `RANGE_COPY` keeps who, the range, the pipelines and the counts. The minute pull's tick moment and `last_seen_created_at` are not touched.
- **The copy** (`ErxesCopyService.tryCopy`): matched outside a transaction, then one transaction: the deal row `FOR UPDATE`, the stage and its pipeline `FOR SHARE` (`SalesPipelinesService.lockStage`), `createInTx` on channel `ADMIN`, the row set `COPIED`, an audit row. A refusal by Bto's order rules leaves nothing and the deal waits with `ORDER_REFUSED` and the code.
- **Product** (`ErxesProductMatchService`, shared by the copy and the stock read): erxes code = Bto SKU, else the code or erxes's barcodes as a barcode of exactly one product. **Unit:** the Bto unit named like the line's unit; the erxes product's own unit = Bto's base unit; otherwise `UNIT_NOT_FOUND`.
- **Customer:** a person's choice; else the code of the deal's companies, then customers; else the register number; else the phone.
- **Author:** `erxes_users.bto_user_id`; else the phone; else the full name with its words in any order; exactly one Bto user, active ones first. No match: `created_by` NULL and the panel shows «Erxes: <name>».
- **The draft:** PICKUP, CASH, the close date when not past (else tomorrow), the note from the deal's name and description, the contact from the deal's first person. Never submitted here.

- **Erkhet's stock** (ADR-0221): «Үлдэгдэл татах» inserts a run and enqueues `erxes.stockRead` in one transaction (a second press answers the run under way; a run whose heartbeat stopped ten minutes ago is closed `INTERRUPTED` first). The worker (`ErxesStockRunFlowService`) reads the plan, the active products in pages of 500, matches them, then `erkhetRemainders` for 50 products through each step, two calls at once, 300 ms after each; a refused call is counted and its products marked unread, a refused sign-in or ten refusals in a row end the run `FAILED`. When it finishes the older runs' rows go and the plan's locations are listed. The comparison (`ErxesStockService.compare`, `compareStock`) is made per Bto warehouse when the page asks: the newest finished run summed over the warehouse's linked locations beside Bto's on-hand now; groups `MATCHED` (difference Erkhet − Bto, null when unknown), `NOT_IN_BTO`, `NOT_IN_ERKHET` (positive Bto stock that no erxes product is). Units are not converted; a unit name other than Bto's base unit is marked.

## Reads and writes in other modules

- `sales`: `SalesOrdersService.createInTx`, `SalesPipelinesService.lockStage`, `SalesAccessService.load`, `SalesBoardsService.tree`, `SalesOrderQueryService.detail` (the panel's visibility check).
- `catalog`: `CatalogImportService.productsBySku`, `BarcodeService.lookup`, `UnitConversionService.currentUnits` / `describe`, `CatalogService.getMany`.
- `inventory`: `StockQueryService.overview` (`inStock`, one warehouse) and `balancesOf` (ADR-0221, read only).
- `partners`: `CustomersService.findByCodes`, `list` (register number and phone, exact matches kept), `get`, `getMany`.
- `identity`: `AuditService`, `UserNamesService.allStaff` / `namesOf`.

## Jobs

| Job | When | Does |
|---|---|---|
| `erxes.pull` | every minute | `ErxesPullFlowService.scheduled`: nothing while the switch is off; else one pull |
| `erxes.stockRead` | on «Үлдэгдэл татах» | `ErxesStockRunFlowService.execute(runId)`: one read of Erkhet's balances (ADR-0221) |

## API (`/api/v1/erxes`)

| Route | Right | Does |
|---|---|---|
| `GET settings`, `PATCH settings` | `sales.boards.manage` | the sign-in without its password, the switch, the last pull and the count of waiting deals; a new address clears the saved password |
| `POST settings/test` | `sales.boards.manage` | signs in with what is typed, saves nothing: `{ ok, reason, status }` |
| `GET pipelines`, `POST pipelines/refresh`, `PATCH pipelines/:id` | `sales.boards.manage` | erxes's pipelines with their Bto place; read them again from erxes (`{ ok, reason, status, detail }`); tick, untick, choose the place (422 for a blocked board, a stage with an action, a tick without a stage) |
| `GET users`, `PATCH users/:id` | `sales.boards.manage` | erxes's users with the chosen and the matched Bto user; choose or clear the choice |
| `POST pull` | `sales.orders.manage` | one pull now: `{ ok, failure, detail, pipelines, seen, copied, waiting }` |
| `GET range/pipelines` | `sales.orders.manage` | the pipelines a range may read, with `enabled` (chosen by default) |
| `POST range/preview` | `sales.orders.manage` | `{ from, to, pipelineIds }` → `{ ok, failure, detail, tooMany, deals }`, each deal with `known` (422 for a wrong range or pipeline) |
| `POST range/copy` | `sales.orders.manage` | `{ from, to, pipelineIds, deals: [{ erxesId, pipelineId }] }` (≤ 50) → `{ ok, failure, detail, copied, waiting, skipped, failed, results }` |
| `GET deals?status&cursor&limit`, `GET deals/:id` | `sales.orders.manage` | the list by state, keyset by id; a deal whole |
| `PATCH deals/:id` | `sales.orders.manage` | a waiting deal's customer and units; 409 `DOC_STATE_INVALID` otherwise |
| `POST deals/:id/copy` | `sales.orders.manage` | tries the deal now and answers it: `COPIED` with its order, or `WAITING` with its reasons; a copied deal answers the same order |
| `POST deals/:id/dismiss`, `POST deals/:id/restore` | `sales.orders.manage` | set a waiting deal aside; take it back |
| `GET stock` | `inventory.stocktakes.manage` | `{ configured, active, latest, failed }`: runs with progress, refused calls, unread products and the estimated finish |
| `POST stock/runs` | `inventory.setup.manage` | «Үлдэгдэл татах»: starts a run or answers the one under way; nothing starts without a saved sign-in (`configured: false`) |
| `GET stock/locations`, `PATCH stock/locations/:code` | `inventory.stocktakes.manage` / `inventory.setup.manage` | the Erkhet locations with their warehouse; link `{ warehouseId }` or unlink `null` (422 for transit, inactive or unknown; 404 for an unknown code; audited) |
| `GET stock/compare?warehouseId&group&onlyDifferent&q&cursor&limit` | `inventory.stocktakes.manage` | the comparison for one warehouse: its locations, the run's time, the counts of each group and a page of rows |
| `GET orders/:orderId/deal` | `sales.orders.read` | `{ deal }` for the order panel, null for an order made in Bto; 404 when the caller does not see the order |

## Invariants

- No route, job or client method writes to erxes: besides `login`, only documents that begin with `query` are sent.
- The password is never returned, audited or logged; it reaches only the saved address. The session token is in memory only.
- An erxes deal is one row and at most one order, whatever pulls, retries and presses meet.
- `raw` is what erxes answered and is never rewritten.
- A copied order is a DRAFT: nothing here prices, reserves, submits or posts.
- Nothing of Erkhet's stock read writes stock; an Erkhet quantity that a refused call left unknown is never shown as zero.

## Tests

`erxes-stock.spec.ts` (`remainderConfig` in its three forms, the plan, the calls of 50, `erkhetRemainders` read, the comparison's groups, sums, unknowns and unit marks, the finish time), `test/integration/erxes-stock.int-spec.ts` (the run with a scripted erxes: rights, links, a refused call counted, the comparison). `erxes-wire.spec.ts` (reading the fixture, the query tree and the checked arguments, the client against a scripted erxes: one sign-in, cut fields in both wordings, an ended session, the older query name, every shape refused), `test/integration/erxes-deal-copy.int-spec.ts` (rights, the sign-in's secrecy, pipelines paired by name and Kharkhorin blocked, a new deal as one draft with its customer, lines, note and creator, an archived deal, a second pull and two pulls at once, an unmatched creator and the mapping, a deal waiting for a product and for a customer, setting aside, the whole deal served to the panel, queries only, a refused refresh and pull seen with erxes's words) and `test/integration/erxes-range.int-spec.ts` (rights, the pipelines offered, the range's limits, the whole UB day with archived deals, known deals marked, drafts by the pull's rules with the presser and the audit, one failing deal stopping none, no deal twice, a deal outside the range skipped, 1000 at most).
