# expiry — the register of expiry dates (ADR-0172)

**Status:** register built 2026-11-07, commercial approvals added locally 2026-11-22. **Depends on:** identity, catalog, partners, inventory, payroll (public `index.ts` only). **Imported by:** POS and sales through public ports. It never writes the stock ledger; `lots` (ADR-0019) is a different thing.

**Commercial approvals (2026-11-22, ADR-0245).** Sales/POS and expiry consume synchronous transaction-aware ports owned by the consumer. The API/worker composition bridge binds them to `ExpiryCommerceService` and the public payroll source-deduction service; no forbidden module dependency is added. The bridge also supplies named sale contexts through `EXPIRY_SALE_CONTEXTS`. The existing authenticated list/item DTOs stay observation-only. No existing record receives a receipt link, a price or a salary charge automatically.

## 1. Owned tables (migration `0090_expiry`)

| Table | Holds | Notes |
|---|---|---|
| `expiry_items` | one record | `product_id` FK; `expiry_date date`; `qty_floor`, `qty_warehouse` `qty` NOT NULL DEFAULT 0, CHECK ≥ 0; `status` CHECK in `REVIEW`, `CITY_RETURN`, `INTERNAL_SALE`, `ARCHIVED`; `liability_type` CHECK in `NONE`, `SPECIFIC`, `ALL_STAFF`; `liability_note` (≤ 500, NULL when empty); `note` (≤ 1000, NULL when empty); `edit_version int` DEFAULT 1, bumped by date, quantity and note edits only; `created_at`, `created_by` FK NULL, `created_by_name` NOT NULL; `updated_at` NOT NULL, `updated_by` FK NULL (a carried row stays NULL until someone touches it in Bto); `archived_at`, `archived_by` FK NULL, `archived_by_name`; `legacy_id bigint` NULL with a partial unique index. CHECK `(status = 'ARCHIVED') = (archived_at IS NOT NULL)`. Indexes on `(expiry_date, id)`, `(status, expiry_date, id)`, `(product_id)`. `REVOKE DELETE, TRUNCATE FROM app`. |
| `expiry_item_changes` | the quantity history | `item_id` FK; `kind` CHECK in `CREATE`, `UPDATE`; `qty_floor_old/new`, `qty_warehouse_old/new`; `changed_at`; `changed_by` FK NULL; `changed_by_name` NOT NULL; `legacy_id bigint` NULL with a partial unique index. `REVOKE UPDATE, DELETE, TRUNCATE FROM app`. |
| `expiry_item_roles` | liable roles | `(item_id, role_id)` primary key, FK to `roles` with no cascade (§7). Replaced whole by a liability save. |
| `expiry_item_users` | liable staff | `(item_id, user_id)` primary key, FK to `users`. Replaced whole by a liability save. |

Names are text on every row (ADR-0172 #12): the signed-in user's full name at the time, or the old system's username on carried rows.

## 2. Shared rules (`@tugeel/shared/expiry`, `packages/shared/src/expiry/index.ts`)

`EXPIRY_STATUSES`, `EXPIRY_LIABILITY_TYPES`, `EXPIRY_VIEWS`, `EXPIRY_URGENCIES`, `EXPIRY_CHANGE_KINDS`, `EXPIRY_CARRY_OUTCOMES`, `EXPIRY_SOON_DAYS = 30`, `EXPIRY_URGENT_DAYS = 7`, `EXPIRY_MAX_PAST_YEARS = 5`, `EXPIRY_MAX_FUTURE_YEARS = 15`, `EXPIRY_NOTE_MAX = 1000`, `EXPIRY_LIABILITY_NOTE_MAX = 500`, `EXPIRY_NAME_MAX = 200`, `EXPIRY_QTY_PATTERN`, `expiryUrgency(daysLeft)` (`EXPIRED` < 0, `URGENT` 0–7, `SOON` 8–30, `OK`), `isExpiryDateInRange(date, today)`. Dates only through `@tugeel/shared/time` (Asia/Ulaanbaatar), never the phone's or browser's clock: every row answers `daysLeft` and the summary answers `today`.

## 3. API (`/api/v1`)

| Route | Access | Body / query → answer |
|---|---|---|
| `GET /expiry/items` | authenticated | `view` (`ACTIVE` default, `EXPIRED`, `URGENT`, `SOON`, `REVIEW`, `CITY_RETURN`, `INTERNAL_SALE`, `ARCHIVED`), `q`, `supplierId`, `warehouseId`, `createdByName`, `liability`, `productId`, `cursor`, `limit` (≤ 200) → `{ data: ExpiryItemDto[], nextCursor }`. `ACTIVE` = not archived; `EXPIRED`, `URGENT` and `SOON` = open records of the summary's same counts, so both `URGENT` and `SOON` start today (a row's own `urgency` says `SOON` only from day 8); a status view = that status. Order `(expiry_date, id DESC)`, except `ARCHIVED`: `(expiry_date DESC, id DESC)`. |
| `GET /expiry/summary` | authenticated | → `{ today, soonDays, urgentDays, active, expired, urgent, soon, archived, byStatus: { REVIEW, CITY_RETURN, INTERNAL_SALE } }`. `expired`, `urgent` and `soon` count open records; `soon` = today … today + 30, as the old page's card; `urgent` = today … today + 7. |
| `GET /expiry/filters` | authenticated | `view` → `{ suppliers: {id,name}[], warehouses: {id,name}[], creators: string[] }` from the records in that view, each sorted by name. |
| `GET /expiry/attention` | authenticated (zeros without `expiry.items.manage`) | → `{ expired, dueSoon, cap }`; `dueSoon` = today … today + 7; counts stop at `cap` = 100. |
| `GET /expiry/items/:id` | authenticated | → `ExpiryItemDto` |
| `GET /expiry/items/:id/history` | authenticated | → `{ data: ExpiryChangeDto[] }`, oldest first: `id, kind, qtyFloorOld, qtyFloorNew, qtyWarehouseOld, qtyWarehouseNew, changedAt, changedByName` |
| `POST /expiry/items` | authenticated, `Idempotency-Key` | `productId, expiryDate, qtyFloor, qtyWarehouse, note?, allowDuplicate?` → 201 `ExpiryItemDto`. 422 on a date out of range, a fraction on a whole unit, or both quantities zero. 409 `EXPIRY_ITEM_EXISTS` `params: { itemId }` on an open record with the same product and date. |
| `PATCH /expiry/items/:id` | authenticated | `expectedVersion, expiryDate?, qtyFloor?, qtyWarehouse?, note?` (empty note clears it) → `ExpiryItemDto`. 409 `EXPIRY_ITEM_CHANGED` `params: { currentVersion }`; 409 `EXPIRY_ITEM_ARCHIVED`. Adds a history row only when a quantity changed. Asking for what already stands changes nothing and does not bump the version. |
| `PUT /expiry/items/:id/status` | `expiry.items.manage` | `{ status }` → `ExpiryItemDto`. To `ARCHIVED` fills `archived_*`; from `ARCHIVED` clears them, and only `REVIEW` restores (ADR-0172 #3): another status on an archived record answers 409 `EXPIRY_ITEM_ARCHIVED`. Asking for the status that stands writes nothing. Leaves the version alone. |
| `PUT /expiry/items/:id/liability` | `expiry.liability.manage` | `{ type, roleIds[], userIds[], note? }` → `ExpiryItemDto`. `SPECIFIC` needs a role or a person (422). `NONE` and `ALL_STAFF` store no roles or people; `NONE` clears the note. Allowed on an archived record. Asking for what stands writes nothing. Leaves the version alone. |
| `GET /expiry/liability-options` | `expiry.liability.manage` | → `{ roles: {id,code,name}[], users: {id,fullName}[] }`, every role and active staff. A system role has its `code` and no `name` (its label is mn.json `roles.system.<code>`), a custom role its `name` and no `code`. |
| `POST /expiry/items/carry` | `expiry.items.carry`, `Idempotency-Key` | One old record (§5) → `{ id, outcome: 'CREATED' \| 'UPDATED' \| 'UNCHANGED' \| 'KEPT' }`. |

`ExpiryItemDto`: `id; product: { id, sku, name, baseUomName, thumbUrl }; supplier: { id, name } | null; homeWarehouse: { id, name } | null; expiryDate; daysLeft; urgency; qtyFloor; qtyWarehouse; qtyTotal; status; liability: { type, roles: {id,code,name}[], users: {id,fullName}[], note }; note; editVersion; createdAt; createdByName; updatedAt; archivedAt; archivedByName`. Quantities are strings, `Decimal` on the server.

**Errors:** `EXPIRY_ITEM_EXISTS`, `EXPIRY_ITEM_CHANGED`, `EXPIRY_ITEM_ARCHIVED`, all 409. A missing record is `notFound`, as is an unknown `productId` on `POST /expiry/items`. A `PATCH` checks the date range and the whole-number rule only on what it changes, so a carried record outside them can still be corrected; an archived record answers before a stale version. The `POST`'s 422s name the field: `expiryDate` constraint `range`, `qtyFloor` or `qtyWarehouse` constraint `whole`, `qtyFloor` constraint `positive` for both zero.

**Filters (§3 first row):** `q` becomes product ids through `ProductQueryService.orderedIds` (name, code, barcode), narrowed to the register's own products in the view, so its cap cannot cut a match off and nothing matching answers no rows. `createdByName` matches exactly what the filters route lists. `supplierId` and `warehouseId` walk the distinct `product_id`s of the records in the view through `ProductSuppliersService.mainSupplierOf` and `ProductLocationsService.homeOf`, then filter on `product_id`. Rows are paged on the register's own columns and filled with one batch per page (`CatalogService.getMany`, `mainSupplierOf`, `homeOf`, `OrgService.warehouseNames`, `SuppliersService.getMany`); nothing joins another module's tables.

## 4. Rights

`expiry.items.manage` (status, archive, the home tiles): ADMIN, OFFICE, PROCUREMENT, WAREHOUSE, ACCOUNTANT, POS_SUPERVISOR. `expiry.liability.manage`: ADMIN, ACCOUNTANT, HR. `expiry.items.carry`: ADMIN. Everything else is `@Authenticated()`. Roles can be edited on «Дүрүүд» (ADR-0165).

## 5. Carry (`POST /expiry/items/carry`, `tools/expiry-carry`)

Body: `legacyId, productId, expiryDate, qtyFloor, qtyWarehouse, status, liabilityType, liabilityRoleIds[], liabilityUserIds[], liabilityNote?, note?, createdAt, createdByName, archivedAt?, archivedByName?, history: { legacyId, kind, qtyFloorOld, qtyFloorNew, qtyWarehouseOld, qtyWarehouseNew, changedAt, changedByName }[]`. No date range, duplicate or positive-quantity check: the old data is what it is. `CREATED` inserts it with `updated_by` NULL. An existing `legacy_id` with `updated_by` NULL and any difference is overwritten (`UPDATED`, and a date, quantity or note difference bumps the version, so a screen holding the older values is refused), else `UNCHANGED`. One touched in Bto (`updated_by` set, which a status or liability decision does too) is left alone (`KEPT`). In every case old changes not yet present are appended, by their `legacyId`. The audit row (action `IMPORT`) names the person running the tool and is written only when something was.

What the tool must send: times with their zone (`2026-03-05T04:10:00Z`, `+08:00` also; the old system's naive UTC text is refused with 422, as it would be read as the server's clock); `createdByName` and `changedByName` of at least one character (the old page's empty author needs a word); quantities as `EXPIRY_QTY_PATTERN`, so at most three decimals; a note within 1000 characters and a liability note within 500. An existing product is required (422). `ARCHIVED` without `archivedAt` takes `createdAt`, which keeps the record's own rule; another status ignores `archivedAt` and `archivedByName`. Roles and people are stored only with `SPECIFIC`, which here may name nobody when the note says who. A record with no `CREATE` row in its `history` simply has none: nothing is invented. `updated_at` starts at `createdAt`.

## 6. Screens

- Web: `/inventory/expiry`, print `/inventory/expiry/print`, `apps/web/src/features/expiry/`.
- Staff app: `app/(staff)/(work)/expiry.tsx`, `app/(staff)/expiry/new.tsx`, `app/(staff)/expiry/[id].tsx`, rules in `apps/mobile/src/expiry/` (`docs/modules/mobile.md`).
- AI: `ai.expiry_items`, data group `stock` (`docs/modules/ai.md`).

Both clients keep what a person typed: leaving with unsaved values asks first; a save refused by a newer edit or an archive leaves the values on screen beside what the record now holds. `IDEMPOTENCY_KEY_REUSED` on `POST /expiry/items` proves an earlier save landed with its answer lost, so a client never re-posts by itself: it refreshes the product's open records, says so, and posts under a new key only when the person chooses to add another.

## 7. Invariants

- Stock never moves: this module imports nothing that posts, and its suite proves `expectReconciled` still holds.
- A record is never deleted; a history row never changes.
- A role a record names as liable, an archived record too, cannot be deleted: `DELETE /roles/:id` answers 409 `ROLE_NAMED_ON_RECORDS` from the foreign key's refusal. A holder of `expiry.liability.manage` takes it off each record first. The key never cascades, because that would erase who was held liable.
- Every write is audited in its transaction.
- A carried author's name is never turned into a Bto user.
- Real records and names never enter the repo: the dump stays in gitignored `tmp/`.

## 8. Identified commercial expiry units (ADR-0245)

The operator explicitly saves a posted, costed receipt line of the same product and a supported base quantity. `ReceiptsService.expirySources(productId, executor, lineId?, lock?)` is inventory's public provenance read: it returns the actual V1 gross amount and original quantity, discount/free-goods evidence, separately the latest corrected accounting cost and supplier net payable. It never treats `lastPrices` as this batch's purchase. A receipt contains no supplier campaign name or N+M pairing. Missing evidence is null/unavailable. Publishing locks the receipt header against re-costing and freezes the authoritative amount/quantity ratio and version. ADR-0236 discounts remain separate income; free goods cost zero.

| Table (migration `0129`) | Purpose |
|---|---|
| `expiry_item_sources` | Explicit receipt line and quantity, optimistic source version; no row for unmatched historic records. Quantity is reserved across records; publication freezes the source. |
| `expiry_markdowns` | Immutable revision: product/base unit/date, receipt cost version and exact ratio, warehouse/channel/context, fixed gross base-unit price and budget, frozen active liable users and explicit payroll month. |
| `expiry_markdown_stops` | Append-only stop time; does not rewrite the approval or older sales. |
| `expiry_markdown_balances` | Actual allocated sold quantity less valid returns, independent of the original observation and stock ledger. |
| `expiry_sale_allocations` | Immutable finalized sale evidence, actual net revenue, cost/loss and exact employee shares; unique source kind/sale/line. |
| `expiry_return_allocations` | Immutable source return identity, original sale reference, returned quantity and cumulative employee credits. |
| `expiry_sale_exceptions` | Durable completed offline sale which could not safely allocate; explicit one-way closure without charge and reason. No automatic retry charging. |

Each approval has its own Code128 `BTOEXP-<id>` label (`formatExpiryBarcode`/`parseExpiryBarcode` in shared expiry). Catalogue barcode registration and a database check reserve this namespace. Normal product pricing and fresh stock are unaffected. Retail and wholesale consumers validate the exact product/unit conversion, warehouse, named context, effective sale time and fixed price, and exclude other programs/manual price overrides. The shared API exposes a cashier-safe offer containing only label/product/unit/price/quantity/context/date/time fields; costs, liable people and payroll details stay on the server.

| Route | Rights and result |
|---|---|
| `GET /expiry/items/:id/commerce` | `inventory.costs.manage`; `ExpiryCommerceDto`, explicit source and all immutable approvals plus visible exceptions. Frozen IDs/month are redacted without `expiry.liability.manage`. |
| `GET /expiry/items/:id/receipt-sources` | `inventory.costs.manage`; `{ data: ExpiryReceiptSourceDto[] }`, up to 200 newest posted lines; explicit chosen historic line reads are not limited by that discovery page. |
| `GET /expiry/items/:id/prices` | Authenticated; quantity one base unit in its own cart, named retail till/wholesale pipeline+warehouse contexts and actual quote prices. `product_prices.warehousePrice` is global, not a physical warehouse dimension. |
| `GET /expiry/barcodes/:barcode?pipelineId=` | Authenticated; current eligible wholesale `ExpirySaleOfferDto`, no private cost/payroll fields. |
| `PUT /expiry/items/:id/source` | Costs + `expiry.items.manage`; `{ expectedVersion: sourceVersion, receiptLineId, qtyBase }`, returns commerce detail; published provenance cannot be edited. |
| `POST /expiry/items/:id/markdowns` | Costs + liability + `pricing.prices.manage`, warehouse write scope, idempotency; `{ expectedVersion: item.editVersion, expectedSourceVersion, expectedCostingVersion, expectedLiabilityFingerprint, receiptLineId, qtyBase, warehouseId, channel, contextId, unitPrice, payrollMonth? }`, returns commerce detail. All expected values come from the operator's pinned draft basis. Below-cost publication requires active frozen employees and an explicit month. |
| `POST /expiry/markdowns/:id/stop` | Same three rights/scope and idempotency; stops future use without changing past allocations or payroll. |
| `POST /expiry/sale-exceptions/:id/resolve` | Same three rights/scope and idempotency; `{ note }` explicitly closes without an employee charge. |

`ExpiryCommerceService.lockInTx(tx)` must be called before source sale/return inventory/finance work. The service then provides `resolveInTx`, `recordSaleInTx` and `recordReturnInTx` through its public index. Finalized sale allocations and `PayrollSourceDeductionsService.recordInTx` share the normal sale transaction. Acquisition loss uses the frozen exact cost ratio and **actual VAT-exclusive sale revenue**, never the ordinary selling-price reduction. Equal deduplicated frozen employees take cents in stable ID order; explicit selected payroll month persists even when no writable payroll exists.

Returns reverse the original allocation's employee shares cumulatively; the final return refunds all original cents, is idempotent and restores only eligible quantity capacity. Re-costing, staff role changes, changing register liability or stopping a label never rewrites past obligations. Late offline sales before a stop may use still-unsold proven global capacity; every replacement offer is capped by shared remaining units. If no supported capacity or correct price/approval exists, the completed POS sale remains visible as an unallocated exception, with no charge beyond the evidence.

Commerce detail's current `liableUsers` and `liabilityFingerprint` preview are redacted without liability permission. A markdown draft pins item/source/cost versions, receipt line and that fingerprint before editing. Source quantity, receipt re-costing, liability changes or active membership drift cause 409 rather than replacing the reviewed basis. The form retains typed money/quantity/month until the operator explicitly reviews current evidence.

New financial audit rows record only identifiers/change flags, without purchase cost, assessed loss or employee deduction amounts. The original floor/warehouse history remains an observation: expiry publication/allocation does not post stock or decrement its counts. An explicit count correction cannot reduce the observation below already allocated sold units. The normal POS/wholesale sale and return modules continue to own stock postings.


### Completed POS failure diagnostics

ADR-0245's POS adapter uses a per-marked-line savepoint. An expiry `AppError` rolls back only
that expiry/payroll work, persists `expiry_pos_exceptions` in the caller transaction and allows
normal SALE/RETURN posting. Missing item/markdown provenance is supported without mandatory
expiry foreign keys. Non-domain bugs and PostgreSQL `57014`/`55P03` abort the central document
and leave the already completed edge event pending retry. Diagnostic-write failure also aborts.
Wholesale remains strict; ordinary POS returns never enter the expiry fallback.

A failed marked RETURN posts its commercial return but leaves the original employee charge and
expiry allocation unchanged pending review. Its report label remains `RETURN_REVERSAL_UNRESOLVED`
after acknowledgement. Acknowledgement creates neither a charge nor a reversal and does not
restore allocation capacity. Normal central document idempotency and exception line identity
prevent duplicate posting or automatic repair on replay.

- `GET /expiry/commerce-exceptions`: `inventory.costs.manage`, keyset `{ data, nextCursor }` over
  legacy sale exceptions and new itemless SALE/RETURN diagnostics. Composite origin/ID identity
  is mandatory; timestamps retain database precision. Warehouse write scopes do not filter reads.
- `POST /expiry/commerce-exceptions/:id/acknowledge`: all cost/liability/price rights, warehouse
  write scope and idempotency; `{ origin, note }`. One acknowledgement only; no financial action.

The expiry register's cost-protected exceptions panel exposes the combined report independently
of an item detail, with document/original-sale identity, barcode, quantity, warehouse, stable
reason and unresolved-return warning. The database forbids diagnostic deletion, pre-acknowledged
inserts and changes to original facts. Error details/stacks and arbitrary parameters are omitted.
