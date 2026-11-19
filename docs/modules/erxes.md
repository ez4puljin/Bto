# Module: erxes (new erxes deals as draft orders, ADR-0218, ADR-0220)

Every deal created in a ticked pipeline of the company's erxes is copied once into Bto as a draft order, whole, under the Bto user who is its erxes creator. A person may also copy the deals created within whole days they pick («Хугацаагаар татах», ADR-0220). Web: `/sales/erxes` («Борлуулалт → Erxes-ээс ирсэн»). It never writes to erxes. It reads catalog, partners and identity through their public services and makes orders only through `SalesOrdersService.createInTx`; nobody imports it.

## Owned tables (`modules/erxes/schema.ts`, migration `0111_erxes_deal_copy`)

| Table | Holds |
|---|---|
| `erxes_settings` | One row: the address (`https://host`, the company's erxes when null), the email, the password sealed under `ERKHET_KEY_SECRET` (context `erxes_settings.password`), the switch, and what the last pull came to (`last_pull_at`, `last_ok_at`, `last_failure`, `last_failure_detail`) |
| `erxes_pipelines` | A pipeline of erxes as «Erxes-ээс шинэчлэх» read it (`erxes_id` unique): its board, `blocked` (a board never copied), `gone`, `enabled` with `enabled_at` (only deals created after it are copied), the Bto pipeline and stage its copies land in, `last_seen_created_at` (where the next pull stops) and `first_pull` (the first answers erxes gave, kept to compare) |
| `erxes_users` | A user of erxes (`erxes_id` unique): email, name, phone, and `bto_user_id`, a person's choice of the same person in Bto |
| `erxes_deals` | A deal a pull saw (`erxes_id` unique, `order_id` unique): `WAITING`, `COPIED` or `DISMISSED`; `raw` (the deal as erxes answered, never rewritten), `products`, `field_labels`; `issues` (why it waits), `choices` (a person's customer and units), `matched_units` (erxes product → the unit its line became), the creator's erxes name and matched Bto user, the order and its customer |

## The one file that knows erxes (`erxes-wire.ts`, `erxes.client.ts`)

erxes's GraphQL is at `<address>/gateway/graphql`; introspection is off there. `erxes-wire.ts` holds every query as a tree of fields (`BOARDS`, `USERS`, `DEAL_PAGE`, `DEAL_RANGE`, `DEAL_DETAIL`, `PRODUCTS`, `DEAL_FIELDS`), the `login` mutation, `readDeal`, which reads an answer defensively into what the copy and the panel use, and `dealTotal`. `erxes-wire.fixture.ts` is the deal Bto expects. `ErxesClient` signs in (`login`; the session is the `auth-token` cookie), then sends queries only; a field erxes refuses («Cannot query field …», or the gateway's «no field `…` in type `…`») is cut and the query sent again (`cuts`), and the cut shape is kept for the client's next query of it; a shape erxes refuses otherwise (an unknown root, a missing argument) moves to the next shape (`salesBoards(type: "deal")`, then `boards(type: "deal")`); when every shape is refused the error is `UNEXPECTED_ANSWER` with what erxes said of each, never an empty answer. An ended session signs in once more. `https` only, 30 s a request. Failures are `LOGIN_FAILED`, `UNREACHABLE`, `TIMEOUT`, `UNEXPECTED_ANSWER`.

Checked against the company's erxes on 2026-11-19 (ADR-0220): `salesBoards` requires `type: "deal"`; `deals` skips archived deals unless `noSkipArchive: true` (every `deals` query sends it: deals move to «Архивлах» within hours); `createdStartDate`/`createdEndDate` of type `Date` filter `deals` by creation (`startDate`/`endDate` filter something else, `dateRangeFilters` errors, `status` is no argument); `dealDetail` takes every field of `DEAL_DETAIL` (Company has no `registrationNumber`, so it is not asked); `productsData` lines carry `_id, productId, uom, currency, quantity, maxQuantity, unitPrice, taxPercent, tax, discountPercent, discount, amount, tickUsed, branchId, departmentId, conditions`; `products(ids, perPage) { _id name code barcodes uom }` works. `DEAL_RANGE` asks more of a list item (number, stage, creator, parties, lines, amount) than was checked: what erxes refuses there is cut.

When erxes's real shape differs: read `erxes_pipelines.first_pull` (or the worker's log line «erxes first answers of pipeline …»), change `erxes-wire.ts` and its fixture, nothing else.

## The rules

- **Which deals.** Ticked pipelines only, and only deals created after the tick. A board named «Хархорин» is blocked. A ticked pipeline needs a live Bto stage without an action.
- **The pull** (`ErxesPullFlowService`): per ticked pipeline, pages of 50 newest first (archived deals too) until a page holds nothing newer than ten minutes before `last_seen_created_at` (20 pages at most); each unseen deal is read whole (`fetchDeal`: `dealDetail`, its products and, when it has custom fields, the field labels), the row inserted `ON CONFLICT DO NOTHING` (`storeDeal`), and tried. Then up to 200 waiting deals are tried again. erxes is never called inside a transaction.
- **A failure is seen** (ADR-0220): a pull, a refresh or a range read that erxes refuses writes `last_failure` and erxes's words in `last_failure_detail` (the page shows both in red and a toast); a refresh whose answer holds no pipeline fails with `UNEXPECTED_ANSWER` and changes nothing. A successful pull clears it.
- **The range copy** (`ErxesRangeFlowService`, ADR-0220): whole Ulaanbaatar days `from`…`to` (from ≤ to, 31 days at most), any chosen pipeline that is not blocked, not gone and has its Bto place (ticked or not; Kharkhorin never). «Харах» reads `DEAL_RANGE` per pipeline in pages of 100 newest first, checks each `createdAt` against the range again, stops at 1000 deals (`tooMany`) and marks each deal Bto holds (`known`: its row's state and order). «Bto руу хуулах» takes 50 deals at most a request (the page sends parts of 20 and shows the progress): a deal Bto holds is skipped (`KNOWN`); the rest is read whole and checked (another pipeline now → `OTHER_PIPELINE`, outside the range → `OUT_OF_RANGE`), kept by `storeDeal` and tried by `tryCopy` with the person as the presser, each on its own; a deal erxes answers wrong fails alone, erxes that cannot be reached or signed in to fails the rest of the request. One audit row `RANGE_COPY` keeps who, the range, the pipelines and the counts. The minute pull's tick moment and `last_seen_created_at` are not touched.
- **The copy** (`ErxesCopyService.tryCopy`): matched outside a transaction, then one transaction: the deal row `FOR UPDATE`, the stage and its pipeline `FOR SHARE` (`SalesPipelinesService.lockStage`), `createInTx` on channel `ADMIN`, the row set `COPIED`, an audit row. A refusal by Bto's order rules leaves nothing and the deal waits with `ORDER_REFUSED` and the code.
- **Product:** erxes code = Bto SKU, else the code or erxes's barcodes as a barcode of exactly one product. **Unit:** the Bto unit named like the line's unit; the erxes product's own unit = Bto's base unit; otherwise `UNIT_NOT_FOUND`.
- **Customer:** a person's choice; else the code of the deal's companies, then customers; else the register number; else the phone.
- **Author:** `erxes_users.bto_user_id`; else the phone; else the full name with its words in any order; exactly one Bto user, active ones first. No match: `created_by` NULL and the panel shows «Erxes: <name>».
- **The draft:** PICKUP, CASH, the close date when not past (else tomorrow), the note from the deal's name and description, the contact from the deal's first person. Never submitted here.

## Reads and writes in other modules

- `sales`: `SalesOrdersService.createInTx`, `SalesPipelinesService.lockStage`, `SalesAccessService.load`, `SalesBoardsService.tree`, `SalesOrderQueryService.detail` (the panel's visibility check).
- `catalog`: `CatalogImportService.productsBySku`, `BarcodeService.lookup`, `UnitConversionService.currentUnits` / `describe`, `CatalogService.getMany`.
- `partners`: `CustomersService.findByCodes`, `list` (register number and phone, exact matches kept), `get`, `getMany`.
- `identity`: `AuditService`, `UserNamesService.allStaff` / `namesOf`.

## Jobs

| Job | When | Does |
|---|---|---|
| `erxes.pull` | every minute | `ErxesPullFlowService.scheduled`: nothing while the switch is off; else one pull |

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
| `GET orders/:orderId/deal` | `sales.orders.read` | `{ deal }` for the order panel, null for an order made in Bto; 404 when the caller does not see the order |

## Invariants

- No route, job or client method writes to erxes: besides `login`, only documents that begin with `query` are sent.
- The password is never returned, audited or logged; it reaches only the saved address. The session token is in memory only.
- An erxes deal is one row and at most one order, whatever pulls, retries and presses meet.
- `raw` is what erxes answered and is never rewritten.
- A copied order is a DRAFT: nothing here prices, reserves, submits or posts.

## Tests

`erxes-wire.spec.ts` (reading the fixture, the query tree and the checked arguments, the client against a scripted erxes: one sign-in, cut fields in both wordings, an ended session, the older query name, every shape refused), `test/integration/erxes-deal-copy.int-spec.ts` (rights, the sign-in's secrecy, pipelines paired by name and Kharkhorin blocked, a new deal as one draft with its customer, lines, note and creator, an archived deal, a second pull and two pulls at once, an unmatched creator and the mapping, a deal waiting for a product and for a customer, setting aside, the whole deal served to the panel, queries only, a refused refresh and pull seen with erxes's words) and `test/integration/erxes-range.int-spec.ts` (rights, the pipelines offered, the range's limits, the whole UB day with archived deals, known deals marked, drafts by the pull's rules with the presser and the audit, one failing deal stopping none, no deal twice, a deal outside the range skipped, 1000 at most).
