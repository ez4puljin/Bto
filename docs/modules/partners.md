# Module `partners` — contract

Status: **built** (minimal) in delivery 1 (week 2), session of 2026-10-11; accepted locally together with the rest of delivery 1. Code: `apps/api/src/modules/partners/`, shared rules in `packages/shared/src/{taxpayer,geo}`, screens in `apps/web/src/features/partners/`. Decisions: ADR-0027 (access control), ADR-0028 (search keys), ADR-0032 (product ↔ supplier link), architecture §4 (partners row) and §5.5.

partners depends on `identity` (audit, settings, access decorators) and, for `product_suppliers` only, on `catalog` (ADR-0032: `CatalogModule`, read through `CatalogService.getMany`). inventory, imports, pricing, sales, finance, delivery, procurement and notifications import its `index.ts`.

## 1. Owner's answers behind the design (interview of 2026-10-11)

- **Customer sheet.** The owner's Excel has code, name, phone, address, registration number, TIN, credit limit and payment term; the import is week 4 (`imports`). Codes are digits only and the system suggests the next one.
- **One customer per store.** A company with several stores is one customer per store, so registration number, TIN and phone may repeat (the import warns, it does not refuse). One name per customer, no second "legal name".
- **Prices.** No price tiers today, contract prices may come: `customer_tiers` and `tierId` move to delivery 2 (pricing).
- **Credit.** One payment term for everybody, the number of days is decided later by the accountant: setting `credit.payment_term_days` (0–365, no default) with an optional per-customer override. The limit is per customer; a blank limit in the sheet means "not decided yet" (`credit_limit` NULL, not 0) — what an order does then is decided in delivery 3.
- **Sales reps and zones.** Reps are divided by zone; how zones are drawn is still open (SPEC §11), so the address only carries `zone_id` without a foreign key until delivery 5.
- **Addresses.** The GPS point matters most. The office pastes it from Google Maps today; drivers and reps will correct it on site later (`gps_source` OFFICE/FIELD, `setLocationInTx`).
- **Citizens.** Many individual customers, and their e-Barimt consumer numbers usually cannot be collected: `consumer_no` stays optional, so delivery 3 prints many B2C receipts with a lottery.
- **Suppliers.** Name, phone, address, contact person, registration number, TIN, bank account and payment terms; codes are digits only; the owner keeps a separate supplier sheet (the week-4 import gains a supplier importer). A product usually comes from one supplier; the link is built now (ADR-0032).
- **Rights.** Admin: everything. Office: customers. Accountant: customers and the credit terms. Suppliers: admin only. Customer data is visible to the office, accountants and admins only.

## 2. Owned tables (migration `0004_partners`)

| Table | Purpose | Key rules (DB-enforced unless noted) |
|---|---|---|
| `customers` | customers | `code` `^[0-9]{1,20}$` unique (`customers_code_key`); `kind` COMPANY/INDIVIDUAL; `name` 1–200 + `search_text`/`search_phonetic`/`search_version` (service-written, GIN trigram); `reg_no` normalised, ≤ 20 (index); `tin` `^[0-9]{11,14}$` with `tin_source` LOOKUP/MANUAL (both or neither; index); `consumer_no` 8 digits, INDIVIDUAL only; `phone` `^[+]976[0-9]{8}$` (index); `vat_payer`, `city_payer` (default false) with `tax_status_source` + `tax_status_checked_at` (both or neither; unchecked ⇒ both flags false); `credit_limit NUMERIC(14,2) ≥ 0` or NULL (= not decided); `payment_term_days` 0–365 or NULL (= the setting); `credit_hold` + `credit_hold_reason` (1–300, only while held); `note`; `status` ACTIVE/INACTIVE. `REVOKE DELETE, TRUNCATE … FROM app` |
| `customer_addresses` | delivery addresses | `label`, `address`, `note` (landmark); `lat`/`lng NUMERIC(9,6)` both or neither, inside Mongolia (lat 41.5–52.2, lng 87.7–120); text or GPS required; `gps_source` OFFICE/FIELD exactly when there is a point; `zone_id` (no FK until delivery 5); one `is_default` per customer (`customer_addresses_one_default`); `archived_at` (an archived address is never the default). `REVOKE DELETE, TRUNCATE … FROM app` |
| `customer_contacts`, `supplier_contacts` | people to call | `name`, `position`, `phone` (E.164), `note`; name or phone required; deletable |
| `suppliers` | suppliers | `code` digits unique (`suppliers_code_key`); `name` + `name_key` unique (`suppliers_name_key_key`) + search keys; `reg_no`; `tin` 11–14 digits; `phone`; `email`; `address`; `bank_name`; `bank_account` `^[A-Z0-9]{5,34}$`; `payment_term_days` 0–365; `note`; `status`. `REVOKE DELETE, TRUNCATE … FROM app` |
| `product_suppliers` | product ↔ supplier | `product_id` → `products`, `supplier_id` → `suppliers`; the pair unique (`product_suppliers_pair_key`); one `is_main` per product (`product_suppliers_one_main`); the first link becomes the main one, unlinking the main one promotes the oldest remaining link |

## 3. Public API (`modules/partners/index.ts`)

| Export | Use |
|---|---|
| `PartnersModule` | import into a feature module to get the services below (`PartnersHttpModule` adds the controllers; app module only) |
| `CustomersService.get(id, executor?)`, `getMany(ids, executor?)`, `list(query)`, `nextCode()` | detail with active addresses and contacts; summaries; the search of `GET /customers` |
| `CustomersService.assertActive(tx, id)` | `CUSTOMER_INACTIVE` (409) for a deactivated customer (orders, delivery 2) |
| `CustomersService.lockForUpdate(tx, id)` → `LockedCustomer` | the credit check of an order confirmation (delivery 3): `SELECT … FOR NO KEY UPDATE` of status, limit, own term and hold. It serialises credit decisions on one customer but does not block inserts that reference the row (addresses, orders) |
| `CustomersService.creditTerms(id, onDate?, executor?)` → `CreditTerms` | limit (`Decimal` or null), hold and `paymentTerm { days, source: CUSTOMER / DEFAULT / UNSET }`; the setting is read for the Ulaanbaatar business date |
| `CustomersService.visibleTo(ctx)` | the one filter of every customer read; today `true`, delivery 7 limits sales reps to their zones here |
| `CustomersService.createInTx / updateInTx / setCreditInTx`, `findByCodes(codes)`, `findByIds(ids)` | for the Excel import (week 4), inside the import's transaction; `findByIds` reads the rows a revert restores |
| `CustomerAddressesService.ofCustomer(id, executor?, withArchived?)`, `defaultAddress(id, executor?)` → `AddressSnapshot` | an order copies the snapshot (text, point as `Decimal`, zone, landmark) onto itself |
| `CustomerAddressesService.addInTx(tx, actor, customerId, input)`, `ofCustomers(ids)`, `setLocationInTx(tx, actor, id, { lat, lng, source })` | the import (adds an address the customer does not have yet); the on-site GPS correction of drivers and reps (delivery 4/5) |
| `SuppliersService.get / getMany / list / nextCode`, `assertActive(tx, id)` | `SUPPLIER_INACTIVE` (409) for goods receipts (week 3) and product registration (ADR-0044) |
| `SuppliersService.createInTx / updateInTx`, `findByCodes(codes)`, `findByNames(names)`, `findByIds(ids)` | the supplier and product imports (week 4): a product sheet's supplier column is matched by code, then by name (`name_key`) |
| `SupplierContactsService.addInTx(tx, actor, supplierId, input)` | the supplier import adds a contact person the supplier does not have yet |
| `ProductSuppliersService.ofProduct(productId)`, `ofProductIds(productIds)`, `productsOf(supplierId, query)`, `mainSupplierOf(productIds)` → `Map<productId, supplierId>`, `linkInTx(tx, actor, productId, supplierId)`, `linksOfProducts(productIds)`, `linkManyInTx(tx, actor, pairs)`, `unlinkManyInTx(tx, actor, linkIds)` | the receiving screen suggests the main supplier; a product registration (inventory, ADR-0044 #5) links its supplier with `linkInTx` after its product and locations; the import links many products at once under `LOCK TABLE product_suppliers` (existing pairs skipped, the first link of a product becomes the main one) and a revert removes exactly the links it added, after restoring products and locations (the table order of every product writer) |
| types `CustomerInput`, `CustomerPatch`, `CreditInput`, `SupplierInput`, `SupplierPatch`, `ContactInput`, `SupplierContact`, `PartnerStatus`, … | the importers build these inputs |
| types `CustomerDetail`, `CustomerSummary`, `CreditTerms`, `LockedCustomer`, `PaymentTerm`, `AddressInput`, `AddressSnapshot`, `GpsSource`, `Supplier`, `SupplierDetail`, `SupplierSummary`, `ProductSupplierLink`, `SupplierProduct` | |

Other modules never write partners tables and never read them directly.

## 4. REST surface (`/api/v1`)

Permissions (ADR-0027 system mappings, assignable to custom roles): `partners.customers.read` and `partners.customers.manage` (ADMIN, OFFICE, ACCOUNTANT), `partners.credit.manage` (ADMIN, ACCOUNTANT), `partners.suppliers.manage` (ADMIN). Every authenticated user reads suppliers and product links.

| Method and path | Access | Notes |
|---|---|---|
| `GET /customers` | `partners.customers.read` | `q` (name in either script, code; digits also match code, phone, TIN and registration number exactly, then code prefixes), `kind`, `status`, `creditHold`, `tinPending` (a company without a TIN), `gpsMissing` (the default address has no point), keyset `cursor`/`limit`. Rows are `CustomerListItem`: the summary plus `consumerNo`, payer flags with `taxStatusSource`, `creditLimit`, `paymentTerm` (own, company setting or unset), `creditHoldReason`, `note`, the default address's `gps` point and the first `contact` (ADR-0037) |
| `GET /customers/next-code` | `partners.customers.manage` | the largest code + 1, same width |
| `GET /customers/:id` | `partners.customers.read` | data, credit terms with `paymentTerm`, active addresses (default first), contacts |
| `POST /customers` | `partners.customers.manage`, `Idempotency-Key` | code optional (allocated under an advisory lock); the first address becomes the default; a taken code → `DUPLICATE_VALUE` with `params.constraint = 'customers_code_key'` |
| `PATCH /customers/:id` | `partners.customers.manage` | changing the TIN records `tin_source = MANUAL`; sending a payer flag records a manual check (`tax_status_source = MANUAL`, now) |
| `PUT /customers/:id/credit` | `partners.credit.manage` | `{ creditLimit, paymentTermDays, creditHold, creditHoldReason }`, all four every time; audit action `CREDIT` |
| `GET/POST /customers/:id/addresses`, `PATCH /customer-addresses/:id`, `POST /customer-addresses/:id/default` (200), `DELETE /customer-addresses/:id` (204 = archive) | read / `partners.customers.manage` | moving the point sets `gps_source = OFFICE`; archiving the default promotes the oldest active address; archived addresses are read-only |
| `GET/POST /customers/:id/contacts`, `PATCH/DELETE /customer-contacts/:id` | read / `partners.customers.manage` | |
| `GET /suppliers`, `GET /suppliers/:id`, `GET /suppliers/:id/products` | authenticated | search like customers; list rows are `SupplierListItem` (the summary plus registration number, e-mail, address, bank, account, payment term, note, the first `contact` and `productCount`; ADR-0037); products paged by link id |
| `GET /suppliers/next-code`, `POST /suppliers` (`Idempotency-Key`), `PATCH /suppliers/:id` | `partners.suppliers.manage` | a taken name → `DUPLICATE_VALUE` `suppliers_name_key_key`; bank account spaces and dashes removed, upper case |
| `POST /suppliers/:id/contacts`, `PATCH/DELETE /supplier-contacts/:id` | `partners.suppliers.manage` | |
| `GET /product-suppliers?productId=` or `?productIds=1&productIds=2` | authenticated | the product's suppliers, the main one first; with `productIds` (repeated, ≤ 200, exactly one of the two) the links of several products, by product then main first (the product list, ADR-0037) |
| `POST /product-suppliers`, `POST /product-suppliers/:id/main` (200), `DELETE /product-suppliers/:id` (204) | `partners.suppliers.manage` | an unknown product → 404 through `CatalogService.getMany`; a repeated pair → `DUPLICATE_VALUE` `product_suppliers_pair_key` |

## 5. Rules worth knowing

- **Taxpayer numbers (`@tugeel/shared/taxpayer`).** The database checks the generic shapes only (TIN 11–14 digits, consumer number 8 digits for citizens). The kind-specific rules are shared by the API, the web and the import: a company TIN has 11 digits, a citizen's 12–14; spaces and dashes are removed. Registration numbers are normalised (NFKC, no spaces, upper case, Latin look-alikes → Cyrillic); a number that does not look like the kind's (7 digits for a company, 2 letters + 8 digits for a citizen) only gets a hint on the form, because old and foreign numbers exist.
- **GPS (`@tugeel/shared/geo`).** `parseCoordinates` reads "lat, lng" (either order when only one lies in Mongolia) and Google Maps links: the dropped pin (`!3d…!4d…`) first, then `?q=` / `query=` / `ll=`, then the map centre (`@lat,lng`). Short links (`maps.app.goo.gl`) cannot be expanded offline and are refused with a hint (right-click the pin and copy the numbers). Points are rounded half-up to 6 decimals and must lie in Mongolia; `mapsUrl` opens a point in Google Maps.
- **Codes.** Numeric codes keep their width (`010` → `011`); a typed code is taken as is. Allocation and creation run under the per-table advisory lock, so parallel creations get distinct codes.
- **Locks.** `lockForUpdate` uses `FOR NO KEY UPDATE`; making an address the default locks the customer row; `product_suppliers` changes take a per-product advisory lock (`LOCKS.productSuppliers`), so one main supplier survives every race.
- **Search (ADR-0028).** Customers and suppliers reuse catalog's keys (name + code). After changing the rules run `pnpm partners:reindex-search` (`--all` recomputes every row).
- **Payer flags.** The create form sends them only when one is ticked and the edit form only when they change; until then the customer shows "not checked". The PosAPI lookup of delivery 3 will set them with `LOOKUP`.

## 6. Error codes introduced

`CUSTOMER_INACTIVE` 409, `SUPPLIER_INACTIVE` 409. Also used: `DUPLICATE_VALUE` 409, `VALIDATION_FAILED` 422, `NOT_FOUND` 404.

## 7. Audit

Actions `CREATE`, `UPDATE`, `CREDIT`, `ARCHIVE`, `DELETE` on the entities `customers`, `customer_addresses`, `customer_contacts`, `suppliers`, `supplier_contacts`, `product_suppliers` (labels in `mn.json` `audit.*`). Search keys are not part of the snapshots.

## 8. Screens (`apps/web`)

Menu group «Харилцагч»: `/partners/customers` (`partners.customers.read`; search, kind and status filters, "TIN pending", "no GPS" and "credit hold" checkboxes, all in the URL; every customer field as a column — kind, registration number, TIN, consumer number, phone, payer flags («Шалгаагүй» until checked), default address, GPS map link, first contact, credit limit, payment term, credit hold with its reason, note, status — chosen with «Баганууд» and remembered per browser under `tugeel.partners.customers.hiddenColumns.v1`; a sticky «Засах» / «Харах» button and a click on the row open the customer; full page width; ADR-0037), `/partners/customers/new` (`partners.customers.manage`; suggested code, kind-dependent fields, first address with the GPS box), `/partners/customers/:id` (data — read-only without `partners.customers.manage`; credit card editable with `partners.credit.manage`, otherwise read-only with the effective payment term; addresses with map links, add/edit/make default/archive; contacts), `/partners/suppliers` (everyone; every supplier field as a column — registration number, TIN, phone, e-mail, address, bank, account, payment term, first contact, product count, note, status — with «Баганууд» (`tugeel.partners.suppliers.hiddenColumns.v1`) and «Засах» for `partners.suppliers.manage`, «Харах» for everyone else), `/partners/suppliers/new` (`partners.suppliers.manage`), `/partners/suppliers/:id` (data, contacts, linked products). The product page (`/catalog/products/:id`) shows the product's suppliers; admins search and link, move the main one, remove. Creating a customer or supplier sends one `Idempotency-Key` per page and resends it after an error.

## 9. Tests

Shared (Vitest): `taxpayer`, `geo`. Integration (`apps/api/test/integration/`): `partners-schema` (CHECKs, uniques, REVOKEs), `customers` (codes, kind/TIN rules, permission matrix, search, addresses, contacts, credit terms with the setting), `suppliers` (normalisation, unique names, read/write rights, main supplier, inactive supplier). Integrity (`apps/api/test/integrity/`): `partners-guards` (`has_table_privilege`), `partners-races` (parallel code allocation, one default address, the credit lock serialises credit checks but not address inserts, one main supplier under link/main races). Web: `features/partners/partners-pages.test.tsx`, `features/partners/partners-logic.test.ts`, the settings range message in `features/identity/identity-pages.test.tsx`.

## 10. Open items

- Number of payment-term days (`credit.payment_term_days`): accountant, before delivery 3 (SPEC §11).
- What an order does when the credit limit is not decided (NULL): delivery 3 (SPEC §11).
- Zone definition and the `zone_id` foreign key: before delivery 5 (SPEC §11); the FK is added by hand in delivery's migration.
- PosAPI TIN and taxpayer lookup (`tin_source` / `tax_status_source` = LOOKUP): delivery 3, together with deciding whether partners calls ebarimt or the reverse.
- Customer and supplier Excel import, product ↔ supplier column: `imports`, week 4.
- `customer_users` (one shop owner, several customer accounts; many-to-many): delivery 6.
- Price tiers and contract prices: delivery 2 (pricing).
- Sales reps limited to their zones through `visibleTo`: delivery 7.
