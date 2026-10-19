# ADR-0070: The core's organisation model: one tenant for the owner's group, a company per legal entity, branches on every line, registered source systems

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0010 (core amounts carry a currency code, MNT enforced until foreign currencies are decided; #4: whole-tugrik unit prices and the per-line split stay rules of the source systems; #7: the company's rates and flags move to `fin.company_tax_registrations` and `fin.tax_rates`, copied in P1 and read from P4); SPEC §2.2 and §10 (the «Олон валют, олон компани» exclusion: several companies in finance are now in scope, inside one tenant; currency stays MNT); SPEC §11 #11 (answered: only the owner's own group; the resort is a separate ХХК); architecture §5.1 (the core's company register beside Bto's branches and warehouses) |

## Context

The owner's goal of 2026-10-18 asks the Finance Core (ADR-0069) to model four things apart:
- the **tenant**, an isolated customer organisation;
- the **company**, a legal entity with its own books;
- the **branch**, a branch or operating unit;
- the **source system**, the system that made a document (Bto, later the PMS).

One company may run Bto and the PMS at the same time, so its books must not be duplicated per system. A later control system shows the approved companies one by one and consolidated, with intercompany transactions eliminated.

Facts from the code and the docs (HEAD 3577787):
- There is no tenant or company anywhere. Architecture §1 says "One company, one database, one deployable API"; SPEC §2.2 and §10 exclude multi-company and multi-currency.
- The company's name exists only as a UI string (`packages/shared/i18n/mn.json:2505`). Its TIN and register number are stored nowhere. The POS snapshot sends `company.name: null` (`apps/api/src/modules/pos/services/pos-snapshot.service.ts:92-96`).
- The company's tax position is four global effective-dated settings: `tax.vat_rate_pct`, `tax.city_tax_rate_pct`, `company.vat_payer`, `company.city_tax_payer` (`packages/shared/src/settings/index.ts:6-14`), read by catalog's `TaxService.companyRates` (`apps/api/src/modules/catalog/services/tax.service.ts:50-67`).
- Branches belong to Bto: an editable code (`apps/api/src/modules/identity/services/org.service.ts:15-22`), a name, the e-Barimt `branch_no` and `district_code`, no company and no TIN (`apps/api/src/modules/identity/schema.ts:116-144`). Journal lines carry no branch today.
- No finance table has a currency column; MNT is a convention (ADR-0010).
- Bto has one customer per store, so registration numbers and TINs repeat (ADR-0032, `docs/modules/partners.md:10`).
- Roles are global: `user_roles (user_id, role_id)` has no company (`apps/api/src/modules/identity/schema.ts:100-114`).
- Seen in Erkhet's UI: a company switcher per login (only one company was seen; how companies are isolated or consolidated is unknown), departments on accounts and on every journal line, one counterparty register for every kind of party, and one USD account in the chart (whether it is used is unknown).

The owner's answers (owner, 2026-10-18): only the owner's own group will use these systems; the resort is a separate ХХК. Defaults kept because they were not asked: MNT only with currency columns kept; the same real customer in two companies is one party with balances per company, linked by the accountant and never automatically by TIN.

## Decision

1. **Tenant.** `fin.tenants` (id, code, name, status) holds one row: the owner's group. Tenant-level tables carry `tenant_id`, and their unique indexes lead with it (the scope rules are ADR-0076). No other tenant is planned (owner, 2026-10-18); the column keeps a later separate installation for an outsider free of a backfill.
2. **Companies.** `fin.companies` (id, tenant_id, code, legal_name, register_no, tin, functional_currency char(3) default `MNT`, timezone default `Asia/Ulaanbaatar`, fiscal_year_start_month, control_approved, status), UNIQUE (tenant_id, code) and (tenant_id, id).
   - **`BO`**, Бүтэн-Оргил ХХК, is created in phase P1 with the TIN and register number the owner gives.
   - **`RES`**, the resort, is a separate ХХК (owner, 2026-10-18). It is created when the PMS starts, with its own TIN, chart, periods and VAT return.
   - The company's timezone decides its business dates (`businessDateIn`, ADR-0069 #7). Bto keeps `BUSINESS_TZ` for its own dates.
   - The fiscal year starts in January by default (TODO-VERIFY: the accountant confirms).
   - `control_approved` marks a company the later control system may read (ADR-0076).
   - From P1 the print header and the POS snapshot take the company's name from this register, not from `mn.json`.
3. **Tax registrations per company.** `fin.company_tax_registrations` (company_id, tax_kind, effective_from, registered, activity_code) and `fin.tax_rates` (company_id, code, effective_from, rate_pct) replace the global settings `company.vat_payer`, `company.city_tax_payer`, `tax.vat_rate_pct` and `tax.city_tax_rate_pct`.
   - Rows are never updated; a change is a new row from a date, as the settings are today (ADR-0010 #7).
   - P1 copies today's settings. In P4 the callers of `TaxService.companyRates` (invoicing, in `modules/finance` until H1 and in `billing` after it, and pos: `apps/api/src/modules/finance/services/invoicing.service.ts:59`, `apps/api/src/modules/pos/services/pos-accept.service.ts:505`, `pos-snapshot.service.ts:44`, `pos-dev.service.ts:165`) read `FinReader.taxPosition` through `fin-bridge`, and the global keys stop being read. Catalog keeps only the product's own tax attributes (`vat_type`, the city-tax flag) and gets no dependency on the core: it could not import `fin-bridge`, which depends on partners, which depends on catalog (`eslint.config.mjs:40`).
   - Tax kinds, tax codes and the city-tax activity codes are Mongolian data (ADR-0074).
   - `credit.payment_term_days` stays a Bto setting.
4. **Branches.** `fin.branches` (company_id, code, name, status) and `fin.branch_refs` (company_id, source_system_id, external_id → branch_id).
   - Bto refers to a branch by `identity.branches.id`, because branch codes are editable. Bto's branches stay in identity with their e-Barimt numbers.
   - Every journal line has a `branch_id`, taken from its document's branch. A company-level document (a manual accrual, for example) may have none.
   - Whether receivables are kept per branch is the accountant's question (TODO-VERIFY: AR by branch, and inter-branch lines on cross-branch payments). The dimension exists either way.
5. **Source systems.** `fin.source_systems` (id, tenant_id, code, link_template, status) registers every system that posts:
   - `BTO`; `FIN`, the core's own screens (manual and opening entries, vouchers the accountant types);
   - later `PMS`, and `HR` for payroll (ADR-0077);
   - codes beginning with `TEST_` in tests only.

   `fin.source_grants` (tenant_id, company_id, source_system_id, status) lets a system post into a company; a command for an ungranted company is refused (ADR-0071). `link_template` turns a document's source id into a link back to the source system's own page, for every document type.
6. **One company, one set of books.** A company has one chart, one journal, one period calendar and one balance per party and account, whatever systems feed it. `source_system_id` is a dimension on every document and every journal line, so a trial balance can be cut by source system and by branch. No system has books of its own.
7. **Currency.** Documents and journal lines carry `currency` and `amount_tx` beside the functional amounts.
   - In v1 the currency must equal the company's functional currency, MNT; any other is refused with `FIN_CURRENCY_UNSUPPORTED` (ADR-0071). There is no rates table until foreign currency is decided.
   - Core amounts are NUMERIC(14,2) with that code.
   - Whole-tugrik unit prices and the per-line tax split (ADR-0010 #4) are rules of the source systems. The core checks only that the lines balance and that each tax amount fits its base (ADR-0071).
8. **Parties.**
   - `fin.parties` (tenant_id, kind COMPANY / INDIVIDUAL / INTERNAL / TAX_AUTHORITY / EMPLOYEE / OTHER, name, tin, register_no, intercompany_company_id, merged_into_id, status) is one register per tenant.
   - `fin.party_refs` (tenant_id, source_system_id, external_id → party_id) maps each system's own id to a party. Bto's ref is a customer id, never a TIN.
   - `fin.party_companies` (company_id, party_id, tenant_id) is the per-company bridge that company-owned rows reference, and the lock row of every balance-changing write (ADR-0071). Balances are per company.
   - The accountant links the same real customer across systems or companies; a TIN match only suggests the link. Linking repoints a ref only while that ref's party has no postings. Merging two parties that both have postings needs a transfer document, built when it is first needed.
   - `partners.customers` stays the master of addresses, zones, prices, the credit limit, the hold and the payment term.
9. **Intercompany.** Each company appears in the other's books as a party of kind INTERNAL whose `intercompany_company_id` names it (composite foreign key `(tenant_id, intercompany_company_id)` → `companies (tenant_id, id)`). Goods that BO sells to the resort are a sale to the INTERNAL party RES; RES books its payable to the INTERNAL party BO. Intercompany is derived from the party, not tagged per line. VAT and e-Barimt on these sales follow the accountant (TODO-VERIFY). Consolidation with elimination is the later control system's job, posted in a separate group book; none of it is built now.
10. **One Bto installation books into one company.** The Bto setting `bto.company_code` (`BO`) names it, and it can no longer change once anything has posted. Bto's own data (orders, invoices, its AI views) is not company-scoped (ADR-0027 #7), so no company column is added to Bto's branches. A Bto that serves two companies needs its own ADR.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| No tenant concept, since only the group uses the systems | The owner's goal models the tenant apart; one column and one row cost little and avoid a backfill if a separate installation is ever made. |
| The resort as a branch of BO | The owner: a separate ХХК, with its own TIN and VAT return. As a branch it would share BO's books. |
| Books per source system | A company running Bto and the PMS would have two sets of books for one legal entity, which the owner's goal forbids. |
| Parties per company | The same customer of BO and RES would be two unrelated rows. One register per tenant with balances per company gives the group view and keeps the books apart. |
| Linking parties automatically by TIN | TINs and registration numbers repeat across Bto's customers (one customer per store, ADR-0032). |
| A company column on Bto's branches | Bto's own tables are not company-scoped; one installation per company makes mixing companies impossible by construction. |
| Foreign currency now | SPEC excludes it and no use was seen; the columns now avoid a backfill later. |
| Tax flags kept as global settings | A second company has its own VAT and city-tax registration. |

## Consequences

**Positive.**
- RES and any later company are rows and configuration, not code.
- One set of books per company, whatever feeds it; reports can be cut by source system and by branch.
- Foreign currency can come later without a backfill.
- The group view and the later consolidation have one party register and an explicit intercompany marker.

**Negative.**
- A tenant column with one row, and one more key in every tenant-level unique index.
- The accountant links shared customers by hand.
- Between P1 and P4 the tax position exists twice (the settings and the core). P4's migration checks that they agree before the readers switch.
- One Bto installation cannot serve two companies.
- One money value stays below 10^12 (`apps/api/src/common/db/types.ts:11`); consolidated figures will need a wider type when the control system is built.

**Follow-ups.**
- P1 (`fin_foundation`): the tenant, company BO, its tax registrations, its branches with refs, sources `BTO` and `FIN` with their grants, parties and refs from Bto's customers, `bto.company_code`, a «Компани» page, the print header from the company.
- The owner gives BO's TIN and register number before P1 (TODO-VERIFY).
- The accountant: the fiscal year start, receivables per branch, VAT and e-Barimt on intercompany sales (TODO-VERIFY).
- At PMS kickoff: company RES, source `PMS` and its grant, the INTERNAL parties BO and RES.
- Foreign currency, consolidation and the group book each get their own ADR when they are needed.

## Related

ADR-0010, ADR-0027, ADR-0032, ADR-0069, ADR-0071, ADR-0074, ADR-0075, ADR-0076, ADR-0077; SPEC §2.2, §10, §11 #11; architecture §1, §5.1; `docs/modules/finance-core.md`.
