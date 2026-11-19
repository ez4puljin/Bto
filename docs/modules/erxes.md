# Module: erxes (new erxes deals as draft orders, ADR-0218)

Every deal created in a ticked pipeline of the company's erxes is copied once into Bto as a draft order, whole, under the Bto user who is its erxes creator. Web: `/sales/erxes` («Борлуулалт → Erxes-ээс ирсэн»). It never writes to erxes. It reads catalog, partners and identity through their public services and makes orders only through `SalesOrdersService.createInTx`; nobody imports it.

## Owned tables (`modules/erxes/schema.ts`, migration `0111_erxes_deal_copy`)

| Table | Holds |
|---|---|
| `erxes_settings` | One row: the address (`https://host`, the company's erxes when null), the email, the password sealed under `ERKHET_KEY_SECRET` (context `erxes_settings.password`), the switch, and what the last pull came to (`last_pull_at`, `last_ok_at`, `last_failure`, `last_failure_detail`) |
| `erxes_pipelines` | A pipeline of erxes as «Erxes-ээс шинэчлэх» read it (`erxes_id` unique): its board, `blocked` (a board never copied), `gone`, `enabled` with `enabled_at` (only deals created after it are copied), the Bto pipeline and stage its copies land in, `last_seen_created_at` (where the next pull stops) and `first_pull` (the first answers erxes gave, kept to compare) |
| `erxes_users` | A user of erxes (`erxes_id` unique): email, name, phone, and `bto_user_id`, a person's choice of the same person in Bto |
| `erxes_deals` | A deal a pull saw (`erxes_id` unique, `order_id` unique): `WAITING`, `COPIED` or `DISMISSED`; `raw` (the deal as erxes answered, never rewritten), `products`, `field_labels`; `issues` (why it waits), `choices` (a person's customer and units), `matched_units` (erxes product → the unit its line became), the creator's erxes name and matched Bto user, the order and its customer |

## The one file that knows erxes (`erxes-wire.ts`, `erxes.client.ts`)

erxes's GraphQL is at `<address>/gateway/graphql`; introspection is off there. `erxes-wire.ts` holds every query as a tree of fields (`BOARDS`, `USERS`, `DEAL_PAGE`, `DEAL_DETAIL`, `PRODUCTS`, `DEAL_FIELDS`), the `login` mutation, and `readDeal`, which reads an answer defensively into what the copy and the panel use. `erxes-wire.fixture.ts` is the deal Bto expects. `ErxesClient` signs in (`login`; the session is the `auth-token` cookie), then sends queries only; a field erxes refuses («Cannot query field») is cut and the query sent again (`cuts`), a refused root field moves to the next shape (`salesBoards`, then `boards(type: "deal")`), an ended session signs in once more. `https` only, 30 s a request. Failures are `LOGIN_FAILED`, `UNREACHABLE`, `TIMEOUT`, `UNEXPECTED_ANSWER`.

When erxes's real shape differs: read `erxes_pipelines.first_pull` (or the worker's log line «erxes first answers of pipeline …»), change `erxes-wire.ts` and its fixture, nothing else.

## The rules

- **Which deals.** Ticked pipelines only, and only deals created after the tick. A board named «Хархорин» is blocked. A ticked pipeline needs a live Bto stage without an action.
- **The pull** (`ErxesPullFlowService`): per ticked pipeline, pages of 50 newest first until a page holds nothing newer than ten minutes before `last_seen_created_at` (20 pages at most); each unseen deal is read whole, its products and (when it has custom fields) the field labels fetched, the row inserted `ON CONFLICT DO NOTHING`, and tried. Then up to 200 waiting deals are tried again. erxes is never called inside a transaction.
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
| `GET pipelines`, `POST pipelines/refresh`, `PATCH pipelines/:id` | `sales.boards.manage` | erxes's pipelines with their Bto place; read them again from erxes (`{ ok, reason, status }`); tick, untick, choose the place (422 for a blocked board, a stage with an action, a tick without a stage) |
| `GET users`, `PATCH users/:id` | `sales.boards.manage` | erxes's users with the chosen and the matched Bto user; choose or clear the choice |
| `POST pull` | `sales.orders.manage` | one pull now: `{ ok, failure, pipelines, seen, copied, waiting }` |
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

`erxes-wire.spec.ts` (reading the fixture, the query tree, the client against a scripted erxes: one sign-in, cut fields, an ended session, the older query name) and `test/integration/erxes-deal-copy.int-spec.ts` (rights, the sign-in's secrecy, pipelines paired by name and Kharkhorin blocked, a new deal as one draft with its customer, lines, note and creator, a second pull and two pulls at once, an unmatched creator and the mapping, a deal waiting for a product and for a customer, setting aside, the whole deal served to the panel, queries only).
