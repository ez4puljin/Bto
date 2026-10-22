# Module `fin-bridge` — contract

Status: **built 2026-10-20** (Finance Core P1, ADR-0084); F3 (ADR-0091) added the suppliers' parties (`supplier:<id>`, partners' `SUPPLIER_CHANGED_HOOK`), the keys `AP`, `VAT_INPUT`, `INVENTORY` and four BTO purchase document types; F2 (ADR-0090) added Bto's document types, number series and the `MANUAL` key to the installation, `newCommandId()` and `FinPartiesBridge.customerPartyIn`; F1's ledger (ADR-0089) added the chart seed, the customers' parties for journal lines and `finance` as an importer. Code: `apps/api/src/modules/fin-bridge/`; the web page «Компани» in `apps/web/src/features/company/`.

`fin-bridge` is Bto's side of the Finance Core (`docs/modules/finance-core.md`): the only Bto code that builds a `FinCallContext` and runs the installation step `ensureDefaultCompany` (ESLint G2, ADR-0076, ADR-0084 #4). It depends on identity and partners through their `index.ts` and on the core through `finance-core/index.ts` (`MODULE_DEPS['fin-bridge']`); the composition roots import it — `FinBridgeHttpModule` in the api's `AppModule`, `FinBridgeModule` in the `WorkerModule` (the customer import runs in the worker) — and, since F1's ledger, `modules/finance` for its contexts and the customers' parties (ADR-0089 #7). It owns no table: the core writes `fin.*`, identity writes `user_company_roles`.

## 1. Owner's answers behind the design

The interview of 2026-10-20 (ADR-0084): tenant `BUTEN_ORGIL`; this installation books into company **BO** (Бүтэн-Оргил ХХК); Kharkhorin («Боломж бөөний төв») is a separate ХХК with its own TIN and its own Bto installation, so only this installation's ACTIVE branches map to BO; BO's register number and TIN are typed on «Компани» by the owner, never written into the repository.

## 2. Public API (`index.ts`)

| Export | What |
|---|---|
| `FinBridgeModule`, `FinBridgeHttpModule` | the services and the boot step; the HTTP side adds `CompanyController` |
| `FinContexts` | `companyCode()` (the locked setting `bto.company_code`, read once per process); `forSource(actor)` → principal `SOURCE {tenant BUTEN_ORGIL, system BTO}`; `forUser(ctx)` → principal `USER {tenant, ref user:<id>}` with `ctx.companyPermissions` as its rights. The actor (`STAFF user:<id>` with the full name, or `SYSTEM <label>`) is recorded, never trusted |
| `FinPartiesBridge` | bound as partners' `CUSTOMER_CHANGED_HOOK`: `onCustomerChanged(tx, actor, customer)` upserts the party `customer:<id>` in the customer's transaction; `resolveCustomerParty(tx, actor, customerId)` for F2's invoices (ADR-0083); since F1's ledger `customerPartyInTx(tx, actor, customerId)` (the party a journal line carries, made from the customer's facts when the core has not seen it), `partiesOfCustomers(ids)` and `customersOfParties(partyIds)` (the journal's filters and lines in Bto's terms) |
| `FinCompanyBridge` | `get(actor)` (as source BTO, for every staff member); `update(ctx, {legalName, registerNo, tin})` checks the Mongolian shapes (`regNoShape` = COMPANY: 7 digits; `isTinFor('COMPANY')`: 11 digits; blank clears) and calls the core as the user |
| F3 (ADR-0091) | `FinPartiesBridge` is also partners' `SUPPLIER_CHANGED_HOOK`: `onSupplierChanged` (party `supplier:<id>`, kind COMPANY), `supplierPartyInTx`, `supplierPartyIn`, `partiesOfSuppliers`, `suppliersOfParties`; `supplierRef`, `supplierIdOfRef`; `FIN_DOC_TYPES.SUPPLIER_BILL` / `SUPPLIER_BILL_CREDIT` / `RECEIPT_RECOST` / `SUPPLIER_RETURN` |
| `FIN_DOC_TYPES`, `MANUAL_KEY`, `ALLOCATION_NUMBER_DEFAULT`, `newCommandId()` | F2 (ADR-0090): Bto's document types in the core (code, source system, source doc type), the key of a typed journal line, the allocations' first number format (TODO-VERIFY), a uuid v7 for an intake command's `commandId` |
| `btoInstallationSpec`, `btoChartTemplate`, `POSTING_KEY_OF_ROLE`, `ROLE_OF_POSTING_KEY`, `BTO_TENANT`, `BTO_SOURCE`, `FIN_SOURCE`, `LEGACY_PARTY_REF`, `customerRef`, `customerIdOfRef` | what the installation books into (§3); the role of each posting key (finance shows roles) |

## 3. The installation (`installation.ts`, `FinBridgeBootstrap`)

At every api and worker start, `FinBridgeBootstrap` builds the spec from `bto.company_code` and Bto's branches and runs the core's `ensureDefaultCompany` in one transaction (advisory lock 72_026_130, idempotent):

- tenant `BUTEN_ORGIL` «Бүтэн-Оргил групп»; company `bto.company_code` (legal name «Бүтэн-Оргил ХХК» for BO only as a first value), `MNT`, `Asia/Ulaanbaatar`;
- sources `BTO` and `FIN`, both granted to the company;
- 29 posting keys (18 until F4, 15 until F3; F4 added `GOODS_RECEIVED`, `COGS`, `STOCK_LOSS`, `STOCK_GAIN`, `OPENING_STOCK` and six `ISSUE_*`, the series `STOCK` and the type `BTO.STOCK_VALUE`), one per chart role (F3 added `AP` (PAYABLE), `VAT_INPUT` (a tax code), `INVENTORY`) (`POSTING_KEY_OF_ROLE`, typed over `GlRole`, so a new role fails typecheck until it has a key): `AR` (RECEIVABLE), `SALES`, `SALES_DISCOUNT`, `SALES_RETURN`, `VAT_OUTPUT` and `CITY_TAX_OUTPUT` (requiring a tax code), `CUSTOMER_ADVANCE` (ADVANCE_RECEIVED), `CASH` and `BANK` (MONEY), `OTHER_INCOME`, `OTHER_EXPENSE`, `POS_CASH`, `CARD_CLEARING`, `POS_SALES`, `CASH_VARIANCE`;
- the party `LEGACY_UNASSIGNED` under source FIN;
- since F2 (ADR-0090): the key `MANUAL`; the number series PAYMENT and JOURNAL (the owner's defaults) and ALLOCATION (`Х-{year}{month}{day}-`); the document types `BTO.SALES_INVOICE`, `BTO.SALES_RETURN` (numbered by Bto), `FIN.CUSTOMER_RECEIPT`, `FIN.CUSTOMER_REFUND`, `FIN.OTHER_RECEIPT`, `FIN.OTHER_PAYMENT`, `FIN.JOURNAL`, `FIN.ALLOCATION` (numbered by the core), insert-only;
- the branches: every Bto branch by its id under source BTO; an unmapped INACTIVE one is skipped, a mapped one follows its code, name and status (a branch added or closed on «Салбар» reaches the core at the next start).

In the same transaction, since F1's ledger (ADR-0089), the core's `ensureDefaultChart` fills an **empty** chart from `btoChartTemplate()` — today's `DEFAULT_GL_ACCOUNTS` named from mn.json, debit-normal for assets, expenses and the two contra-income roles, the control of each role's key — with one rule per role from 2000-01-01; a chart with accounts is never re-seeded.

Insert-only otherwise: a company the owner edited on «Компани» is never overwritten. Migration `0032_fin_foundation` wrote the same rows for the existing database (plus one party per customer and the role mirror).

## 4. REST surface (`/api/v1`)

| Route | Rule | What |
|---|---|---|
| `GET /company` | `@Authenticated()` | `Company`: code, legal name, register number, TIN, currency, time zone, fiscal-year start, status, tax registrations, branches with their refs |
| `PATCH /company` | `finance.settings.manage` | `{legalName (1–200), registerNo, tin}` (null or blank clears); 422 `VALIDATION_FAILED` on `registerNo` / `tin` / `legalName`; 403 `FIN_COMPANY_FORBIDDEN` when the user's roles do not reach the company (no `user_company_roles` row); audited in `fin.audit_log` as `STAFF user:<id>`, principal `USER:user:<id>` |

## 5. The web

«Систем → Компани» (`/company`, the menu item for `finance.read`, before «Салбарууд»; the page itself opens for everyone signed in): a read-first `DetailCard` «Хуулийн этгээд» (edited with the form kit, the same shared checks as the api), a read-only card of the tax registrations and one of the mapped branches. The finance, sales and POS print pages wait for the company and print its legal name (`useCompanyName`, the brand string until it loads). The web's problem parser accepts `FIN_*` codes; mn.json has the texts of the four P1 raises.

## 6. Invariants and tests

- Only fin-bridge (and `apps/api/test/harness/static-caller.ts`) builds a context or runs the installation step (`tools/lint-guards/guards.test.mjs`).
- Every customer has exactly one party `customer:<id>` in BO, kept in step with its kind, name, TIN and register number in the customer's own transaction, in the api and in the worker; nothing else changes the party (`test/integration/fin-bridge.int-spec.ts`).
- The boot maps only ACTIVE branches; the company keeps the owner's edits (`fin-bridge.int-spec.ts`).
- The migration's data section replays against today's rows in a rolled-back transaction (`fin-bridge.int-spec.ts`).
- Rights per company come from `user_company_roles` only (`test/integration/company-roles.int-spec.ts`, `fin-bridge.int-spec.ts`).

## 7. Not built now

The POS kiosk snapshot's company name (the edge keeps its own until the POS sessions take it from the core), a per-company grant screen, a branch hook (the boot sync is enough), and the legacy finance routes (H1). F2 posts through `modules/finance`'s `FinPosting` with the contexts and parties of this module (ADR-0090); the F1 façade is `modules/finance`'s, never fin-bridge's (ESLint G2).
