# ADR-0084: The Finance Core's organisation (P1) — one installation, one company; roles mirrored per company; a locked company code

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-20 |
| Deciders | Owner (interview and plan approved 2026-10-20), Claude (Claude Code session, Finance Core P1) |
| Implements | ADR-0070 (tenant, company, branch, source system), ADR-0075 #8 (rights per company), ADR-0076 (company isolation): phase P1 of ADR-0077, which is the organisation half of F1 in ADR-0083's lean go-live plan (accepted the same day) |
| Relation to ADR-0083 | Built before ADR-0083 landed. #2 (rights per company) and the per-company checks of #4 are items ADR-0083 defers until the PMS; the owner kept them (2026-10-20) because they are built and tested and grant exactly today's permissions. Numbered 0084 with the main session; drafted as a local 0083 |
| Amends | ADR-0070 #2 (the company code is locked, not "editable until posted"); docs/modules/finance-core.md §16.1 (the audit trail moves into P1, the balance function to P2, `tax_rates` to P3); architecture §4 (`fin-bridge` in `MODULE_DEPS`, `user_company_roles` in identity); SPEC §11 #23 |

## Context

P0a decided the core's organisation (ADR-0070) and its isolation (ADR-0076); P0b built an empty core. P1 creates schema `fin` with the tenant, the company, branches, source systems, parties and rights, without moving any ledger table (that is P2). The owner answered on 2026-10-20:

- The tenant is `BUTEN_ORGIL`; this installation books into company **BO** (Бүтэн-Оргил ХХК).
- The number the owner gave is BO's state register number (7 digits); its TIN (11 digits) follows. Both are typed by the owner on a new «Компани» page into the database only: the repository is public, so no file, test, document or commit carries them.
- «Боломж бөөний төв» in Kharkhorin is a **separate ХХК with its own TIN** and will run **its own Bto installation on another server**. This installation's BO is the Mörön centre and the supermarket.

The code of 2026-10-20 (40f5f78) had no company record (the name was an i18n string printed on every document), rights per user only (`user_roles`), and customers only in `public.customers`.

## Decision

1. **One installation books into one company.** The Kharkhorin branch is not part of BO: it gets its own company in tenant `BUTEN_ORGIL` when its installation starts. Only ACTIVE Bto branches are mapped to `fin.branches` (by `identity.branches.id` under source `BTO`); a closed branch is never mapped, and a mapped branch that closes becomes INACTIVE in the core at the next boot. On the owner's machine the Kharkhorin branch is set INACTIVE before the migration (answers SPEC §11 #23 for this installation).
2. **Rights per company mirror the roles.** `identity.user_company_roles (user_id, company_code, role_id)` holds a user's roles inside a company. Until a per-company grant screen exists, every write of `user_roles` (the users service, `pnpm user:create-admin`, the test harness) rewrites the user's rows for the installation's company in the same transaction, and migration 0032 copies today's roles. `AccessService` puts the `finance.*` permissions per company into `AuthContext.companyPermissions`; fin-bridge hands exactly those to the core for a USER principal, so ADR-0075's "no row, no access" holds without locking out a new accountant. Deleting a role counts its holders in both tables (`ROLE_IN_USE`).
3. **The company code is a locked setting.** `bto.company_code` (a new setting kind `code`, default `BO`) is fixed at installation: the settings api refuses a new value (`SETTING_NOT_EDITABLE`) and «Тохиргоо» shows it read-only. ADR-0070 #2 said "editable until the first posting"; until P4 nothing posts through the core, so locking it is equivalent and simpler. Another installation writes its own value once, at setup.
4. **Who may build a call context.** `createFinCallContext` and the installation step `ensureDefaultCompany` are imported only by `modules/fin-bridge` and by exactly one test file, `apps/api/test/harness/static-caller.ts` (the StaticCaller, which boots the core without any Bto module); every other file, test or not, is refused by ESLint. Loading the StaticCaller marks the process, and the core refuses to start a production process with the mark. Both principals carry their tenant: `SOURCE {tenant, system}` and `USER {tenant, ref}`; the core resolves every company inside the principal's tenant and checks a USER's rights or a SOURCE's ACTIVE grant before reading any of the company's rows (`FIN_COMPANY_UNKNOWN` / `FIN_COMPANY_FORBIDDEN` / `FIN_SOURCE_NOT_GRANTED`). A context is branded: a copy is refused.
5. **The phase boundary moves.** The core's own audit trail `fin.audit_log` (append-only) comes in P1, because the company's legal identity is edited now and every change must be traceable. The deferred balance function moves to the ledger half of F1 (there is no journal yet) and `tax_rates` to F2 with the tax codes (ADR-0083); P1 copies only the tax *registrations* from the settings `company.vat_payer` / `company.city_tax_payer`.
6. **A customer is a party, kept in step in its transaction.** Partners declares `CUSTOMER_CHANGED_HOOK`, fired when a customer is created and when its kind, name, TIN or register number change; fin-bridge binds it in the api and in the worker (the customer import runs there) and upserts the party `customer:<id>` under source BTO into BO. A party is never matched by TIN (stores share TINs). The migration backfills one party per existing customer, plus `LEGACY_UNASSIGNED` under source FIN for P2's control-account lines without a known counterparty.
7. **The company record drives the documents.** `GET /api/v1/company` (every signed-in user: the print headers carry the legal name) and `PATCH /api/v1/company` (`finance.settings.manage`, checked again by the core per company) serve «Компани» in «Систем». The Mongolian shapes (a company register number of 7 digits, a TIN of 11) are checked in fin-bridge with `@tugeel/shared/taxpayer`; the core checks only generic shapes. The finance, sales and POS print pages wait for the company and print its legal name, falling back to the brand string. The till kiosk's offline snapshot keeps its own name until the POS sessions take the company from the core (deferred).
8. **Boot, idempotent.** `ensureDefaultCompany` runs at every api and worker start under an advisory lock: insert-only for the tenant, company, sources, grants, posting keys and the legacy party (a company edited on «Компани» is never overwritten), and it follows the mapped branches' code, name and status. The 15 posting keys are today's chart roles, the tax ones named `VAT_OUTPUT` and `CITY_TAX_OUTPUT`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Kharkhorin as a second branch of BO | The owner: a separate ХХК with its own TIN and its own server; one set of books cannot hold two legal entities. |
| Kharkhorin as a second company in this installation | One installation books into one company (ADR-0070); the branch runs its own Bto. |
| A per-company grant screen now | Nobody needs a different right per company yet; the mirror keeps today's behaviour and the table is ready for the screen. |
| Reading rights from `user_roles` in the core | The core would know Bto's roles; ADR-0075 asks for rights per company. |
| Editable company code until the first posting | Nothing posts through the core before P4; a locked code removes a case without losing anything. |
| Seeding the register number and TIN in the migration | The repository is public. |
| A branch hook instead of the boot sync | Branches change rarely; the boot sync is enough until a screen needs the core's branches the same minute. |

## Consequences

- Migration `0032_fin_foundation`: schema `fin` (12 tables, `app` has USAGE and no DELETE or TRUNCATE, `ai_reader` nothing), the append-only guards, `identity.user_company_roles`, and the data section (tenant, BO without its numbers, sources BTO and FIN with grants, tax registrations, the legacy party, one party per customer, the role mirror) with a check that raises on any count mismatch.
- New module `fin-bridge` (`MODULE_DEPS`: identity, partners; only the composition roots import it).
- `AuthContext` has a new required field; code that builds one by hand (tests) sets it.
- The web's problem parser accepts `FIN_*` codes; their texts are in mn.json from now on.
- An installation's legal name is a first value only; the owner keeps it on «Компани».
