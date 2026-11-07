# expiry — the register of expiry dates (ADR-0172)

**Status:** built 2026-11-07. **Depends on:** identity, catalog, partners, inventory (public `index.ts` only). **Imported by:** nobody. It never writes the stock ledger; `lots` (ADR-0019) is a different thing.

## 1. Owned tables (migration `0090_expiry`)

| Table | Holds | Notes |
|---|---|---|
| `expiry_items` | one record | `product_id` FK; `expiry_date date`; `qty_floor`, `qty_warehouse` `qty` NOT NULL DEFAULT 0, CHECK ≥ 0; `status` CHECK in `REVIEW`, `CITY_RETURN`, `INTERNAL_SALE`, `ARCHIVED`; `liability_type` CHECK in `NONE`, `SPECIFIC`, `ALL_STAFF`; `liability_note` (≤ 500, NULL when empty); `note` (≤ 1000, NULL when empty); `edit_version int` DEFAULT 1, bumped by date, quantity and note edits only; `created_at`, `created_by` FK NULL, `created_by_name` NOT NULL; `updated_at` NOT NULL, `updated_by` FK NULL (a carried row stays NULL until someone touches it in Bto); `archived_at`, `archived_by` FK NULL, `archived_by_name`; `legacy_id bigint` NULL with a partial unique index. CHECK `(status = 'ARCHIVED') = (archived_at IS NOT NULL)`. Indexes on `(expiry_date, id)`, `(status, expiry_date, id)`, `(product_id)`. `REVOKE DELETE, TRUNCATE FROM app`. |
| `expiry_item_changes` | the quantity history | `item_id` FK; `kind` CHECK in `CREATE`, `UPDATE`; `qty_floor_old/new`, `qty_warehouse_old/new`; `changed_at`; `changed_by` FK NULL; `changed_by_name` NOT NULL; `legacy_id bigint` NULL with a partial unique index. `REVOKE UPDATE, DELETE, TRUNCATE FROM app`. |
| `expiry_item_roles` | liable roles | `(item_id, role_id)` primary key, FK to `roles`. Replaced whole by a liability save. |
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

## 7. Invariants

- Stock never moves: this module imports nothing that posts, and its suite proves `expectReconciled` still holds.
- A record is never deleted; a history row never changes.
- Every write is audited in its transaction.
- A carried author's name is never turned into a Bto user.
- Real records and names never enter the repo: the dump stays in gitignored `tmp/`.
