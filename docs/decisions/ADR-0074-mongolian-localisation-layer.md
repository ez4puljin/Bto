# ADR-0074: Mongolian tax rules and e-Barimt form a shared localisation layer keyed by source documents, used by every system

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0088 (2026-10-20: #4 shared with the resort by copy only) |
| Amends | ADR-0010 (#4: the split's code moves to `@tugeel/shared/mn`; the rounding is unchanged); ADR-0017 ("Module": `ebarimt_receipts` is keyed by company and source document and has no `invoice_id`; the module depends on no other module; the topology, the two-phase issue, the `lottery` / `qrData` ban, the receipt type per customer kind, the corrections, the spike and the certification gate stand); architecture §4 (the `ebarimt` row) and §5.9 (the row model) |

## Context

Mongolian law and infrastructure sit today inside Bto's finance and POS code:
- the tax-inclusive split `taxSplit` (`packages/shared/src/finance/index.ts:188-201`, ADR-0010 #4), used by invoices and credit notes and, through `lineVat` (`packages/shared/src/pos/index.ts:157-158`), by the POS and the store edge;
- the company's tax facts as global settings `tax.vat_rate_pct`, `tax.city_tax_rate_pct`, `company.vat_payer` and `company.city_tax_payer` (`packages/shared/src/settings/index.ts:8-14`), read by catalog's `TaxService` (`apps/api/src/modules/catalog/services/tax.service.ts:50`);
- the default chart in Erkhet's numbering style (`packages/shared/src/finance/index.ts:327-349`) and the number letters Н, Т, К, Ж (`:25-31`);
- the e-Barimt receipt types and statuses (`packages/shared/src/pos/index.ts:21-38`).

ADR-0017 is Deferred and nothing of it is built: `apps/api/src/modules` has no `ebarimt` module, and `apps/api/src/integrations` holds only `llm`. Its design binds receipts to finance: `ebarimt_receipts.invoice_id` (ADR-0017 "Module"). The lint graph agrees: `MODULE_DEPS.ebarimt = ['identity', 'catalog']`, and `sales` and `finance` both list `ebarimt` (`eslint.config.mjs:44`, `:46`, `:47`).

QPay, the QR payment rail of ADR-0018, is dropped system-wide (owner, 2026-10-18: not in the customer app, nor for the drivers, nor at the till; ADR-0080). So nothing of ADR-0018's provider interface or `payment_intents` is built, and no payment module belongs in this layer.

ADR-0069 forbids the Finance Core to import Bto code, and ADR-0073 moves the product invoice into Bto's `billing`. The PMS needs the same Mongolian rules: VAT, city tax for a hotel and e-Barimt receipts. The owner (2026-10-18): the PMS is a separate repository (D22), starts after Bto's go-live (D4), and runs on its own small server at the resort because the internet there is weak (D3). So the PMS consumes published rules and never Bto's modules. ADR-0017 already runs a PosAPI instance per site.

The next e-Barimt session puts receipts on Finance I's invoices (SPEC §11 #2, answered by the owner 2026-10-16). If its first migration bound `ebarimt_receipts` to `invoices.id`, ADR-0073's move would change that table. This ADR comes first so it never does.

## Decision

1. **Two parts, one direction.** The Mongolian layer is `@tugeel/shared/mn` (pure rules and data) and `modules/ebarimt` (an integration with state). Business systems use them; they use no business system. The Finance Core imports neither (ADR-0069): tax codes, tax rates and a chart reach it as data through its configuration port (`FinConfig.loadTaxCodes`, `loadTaxRates`, `upsertAccount`; `docs/modules/finance-core.md`). The core stores tax lines and verifies them; the sender computes them with `mn` (ADR-0071).

   There is no `paygate` module and no QPay integration. Payments reach the core as RECEIPT documents from the accountant's vouchers, the till's cash and card tenders and the bank statement import, each keyed by its source document (ADR-0071). A later QR payment rail would be a new ADR and would follow the same pattern: keyed by the source document, it tells its source system, which posts the RECEIPT; the core never sees a callback.

2. **`@tugeel/shared/mn`**, a new subpath of `@tugeel/shared` (phase P0b). A lint rule, proved by a `tools/lint-guards/guards.test.mjs` fixture, lets it import only `@tugeel/shared/money`, `time` and `taxpayer`. It holds:
   - the tax kinds `VAT` and `CITY_TAX` and the codes `MN.VAT.STD`, `MN.VAT.ZERO`, `MN.VAT.EXEMPT` and `MN.CITY.<activity code>`. Erkhet's settings show eight city-tax activity codes, among them hotel 6331000 and resort 6313000, with this company at 0 % (seen in Erkhet's UI only). How catalog's `vat_type` values (`VAT_ABLE`, `VAT_FREE`, `VAT_ZERO`, `NO_VAT`; `apps/api/src/modules/catalog/schema.ts:105`) map to the codes is set with the accountant (TODO-VERIFY);
   - the tax-inclusive split, moved unchanged from `packages/shared/src/finance/index.ts:188-201`; the old paths re-export it, and a test compares the results on 1,000 random lines;
   - the chart template that fills an empty chart (from `:327-349`), for tests and for a new company before its chart is imported; company BO's chart is Erkhet's, imported (owner 2026-10-18, ADR-0072);
   - the number defaults Н, Т, К, Ж (from `:25-31`);
   - the e-Barimt shapes: receipt types and statuses (from `packages/shared/src/pos/index.ts:21-38`), the receipt type per customer kind (SPEC §6.10), the payment codes `CASH`, `PAYMENT_CARD`, `BANK_TRANSFER` (SPEC §6.11 #6; `BANK_TRANSFER_QPAY` is not used), one sub-receipt per tax type with header = Σ sub-receipts = Σ payments; later the PosAPI request builders, which the store edge may import (ADR-0067 #1);
   - later the statutory templates as data: the VAT-return rows and the financial statement forms. Erkhet keeps both as editable rows (seen in its UI; its four statement templates are NGO forms). Which forms the company files and which rows they hold are the accountant's to say (TODO-VERIFY, D17).

   `mn` is versioned with its package. The PMS repository consumes it as a published version. The package cut (all of `@tugeel/shared`, or `mn` with a small money and time kernel) is chosen at the PMS kickoff (ADR-0077); the import limit keeps either cut mechanical.

3. **`modules/ebarimt`** (ADR-0017), built in the e-Barimt-on-invoices session with `MODULE_DEPS.ebarimt = []`: it uses only `common/**`, `@tugeel/shared/mn` and `src/integrations/ebarimt`. `sales` drops `ebarimt` from its list; `billing` lists it (ADR-0073).
   - `ebarimt_receipts` has, from its first migration, the source key `company_code`, `source_system`, `source_doc_type`, `source_doc_id`, `source_revision` in place of `invoice_id` (ADR-0017 already listed `source_doc_type` and `source_doc_id`). A wholesale invoice's receipt is keyed `BTO/SALES_INVOICE/<invoice id>/1`, a sales return's `BTO/SALES_RETURN/<id>/1`.
   - `EbarimtService.prepare(tx, request)` runs in the caller's transaction and takes the receipt request by value: buyer, lines with their classification codes, tax amounts, payments. The caller checks its own data first (`EBARIMT_ATTRIBUTES_MISSING`, `TIN_PENDING`; `packages/shared/src/errors/error-codes.ts:107-108`).
   - `ebarimt_config` (one row per PosAPI instance) gains `company_code`; an integrity test compares its `merchant_tin` with the company's TIN.
   - Unchanged from ADR-0017: the issue after commit, no HTTP inside a transaction, never a blind retry, the INDETERMINATE queue, `lottery` and `qrData` never persisted, corrections chained by `inactiveId`, the nightly `sendData`.
   - The module reads no `fin.*` table; the core never sees `lottery`, `qrData` or a receipt request. The monthly comparison of the books' VAT with the issued receipts belongs to reporting, over the `ai.fin_*` and e-Barimt views or `FinReader`. The VAT tax point per document type is the accountant's (TODO-VERIFY, D25).

4. **Every system, the same rules.** Bto calls `ebarimt` inside its own transactions. The store edge issues its receipts on the store's own PosAPI box (ADR-0063; the path is ADR-0065's, reserved) and builds them from the same `mn` rules. The PMS, in its own repository and on its own server with its own PosAPI box, uses the published `mn` rules. How it issues receipts (a published issuer package, or its own module over the same rules, never a copy of Bto's modules; ADR-0069) is decided at the PMS kickoff.

5. **Order of work.** This ADR precedes the e-Barimt-on-invoices session. That session creates `ebarimt_receipts` keyed by source and calls `prepare` from wherever invoicing lives then (`modules/finance` until H1, `billing` after it); when the call moves, the table does not change. P0b moves the split, the chart template, the number defaults and the receipt shapes into `mn` before POS S3 starts.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep the split and the receipt shapes in `@tugeel/shared/finance` and `@tugeel/shared/pos` | The PMS would import Bto's finance and POS vocabulary, and the split would reach the core through finance. |
| e-Barimt inside the Finance Core | The core would hold Mongolian law and receipt secrets, and depend on integrations; a source with its own PosAPI box could not use it. |
| `ebarimt_receipts.invoice_id` as ADR-0017 drew it | It binds receipts to a table ADR-0073 moves, and cannot key a sales return, a POS shift or a PMS checkout. |
| Publish `mn` as a package of its own now | No second repository exists before the PMS (after go-live); a separate package now means a rebuild on every edit (ADR-0025). |

## Consequences

**Positive.**
- One place holds the Mongolian tax arithmetic and the receipt rules; Bto, the edge and the PMS compute the same amounts.
- The receipt table is right from its first migration, whatever module calls it.
- The core stays free of receipt secrets.
- The PMS adds receipts with configuration in the core, not core code.

**Negative.**
- Each caller builds its receipt request (classification codes, tax amounts) over `mn`; billing and each later source has a small builder.
- ADR-0080 leaves the certified relay vendor as the only e-Barimt fallback at the certification gate (QPay's `ebarimt_v3` is no longer a path); the source key and `prepare` do not depend on the provider.
- The package cut for the PMS stays open until its kickoff.

**Follow-ups.**
- P0b: `@tugeel/shared/mn` with the split, the chart template, the number defaults and the receipt shapes; the old paths re-export; the lint rule and its fixture; the Jest, Vitest, tsconfig and package `exports` mappings.
- The e-Barimt-on-invoices session: `modules/ebarimt` with the source key, `MODULE_DEPS.ebarimt = []`, `sales` without `ebarimt`.
- TODO-VERIFY (accountant): the `vat_type` → tax code map; the VAT tax point and the monthly e-Barimt comparison (D25); the statement forms and the VAT-return rows (D17); VAT timing on deposits and forfeits, and whether city tax applies at the resort (D12).
- PMS kickoff: the package cut, and how the PMS issues receipts.

## Related

ADR-0010, ADR-0017, ADR-0018, ADR-0025, ADR-0063, ADR-0065 (reserved), ADR-0067, ADR-0069, ADR-0070, ADR-0071, ADR-0072, ADR-0073, ADR-0077, ADR-0080; `docs/architecture.md` §4, §5.9, §9.1; `docs/SPEC.md` §6.10, §6.11, §11 #2; `docs/modules/finance-core.md`.
