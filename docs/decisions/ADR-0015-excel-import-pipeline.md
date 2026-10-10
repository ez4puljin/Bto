# ADR-0015: Excel import as a validated, previewable, idempotent, revertible job pipeline

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0026 (real files are imported locally in delivery 1; the production import uses fresh exports in the go-live phase) |

## Context

All existing data lives in Excel: duplicate SKUs, mixed Cyrillic/Latin characters, inconsistent units, missing barcodes, and no e-Barimt classification codes. The delivery-1 go-live depends on importing 10,000+ products, thousands of customers and opening stock per warehouse. e-Barimt item attributes (7-digit classification code, tax product code, measure unit, barcode type) are needed only when receipts are issued (delivery 3), and the lookup services that help assign them are Mongolia-IP-only and reachable only through the office box (ADR-0012), which may not be ready in week 1. Customers are a mix of companies (7-digit registration number, 11-digit TIN) and individuals (10-character citizen ID, 12-14-digit TIN); TIN lookup by citizen registry number was scheduled to be disabled by ITC (`docs/architecture.md` §9). Opening stock enters through adjustments and needs a unit cost for valuation (ADR-0007).

## Decision

1. **`imports` module** with `import_jobs` (kind, file id, status UPLOADED/VALIDATED/COMMITTING/COMMITTED/REVERTED/FAILED, summary JSONB, created_by) and `import_rows` (job id, row no, raw JSONB, normalised JSONB, errors JSONB, target id after commit). REST `/imports`: download template, upload (presigned, ADR-0014), preview, commit, status, revert.
2. **Pipeline** (pg-boss jobs, ADR-0013): ExcelJS parse -> Zod row schema with Mongolian error messages (`mn.json` keys) -> normalisation (`packages/shared/text/normalize.ts`: NFKC, trim, Cyrillic/Latin look-alike map, ADR-0011) -> duplicate detection within the file and against the database (SKU, barcode, customer code, phone) -> **dry-run preview grid** with per-row errors and warnings -> **batched commit** in transactions of 500 rows -> **idempotent re-import** keyed on SKU / unit code / customer code (updates, never duplicates) -> **revert by job id** (opening stock reverts by posting reversing adjustments; master data reverts by restoring the `before` snapshot stored per row).
3. **Products + units + barcodes importer.** Required: SKU, name, category, base unit, VAT type. **e-Barimt attributes are nullable at import**: `classification_code`, `tax_product_code`, `measure_unit`, `barcode_type` may be empty in delivery 1. An **"e-Barimt readiness" report** (`GET /catalog/ebarimt-readiness`, catalog module, `docs/architecture.md` §4) lists products missing any of them, and a **bulk-assign tool** sets a default classification code per category (`categories.default_classification_code`) and fills `barcode_type` from the barcode shape (GS1 for valid GTINs). Validation becomes mandatory **only when a receipt line is built** (delivery 3): a product with missing attributes fails with `EBARIMT_ATTRIBUTES_MISSING`. The lookup of classification codes by barcode through the office box is best-effort enrichment, never a blocker.
4. **Customers importer.** Columns: code, name, **kind** (COMPANY / INDIVIDUAL), `reg_no` (free text: 7-digit registration number or 10-character citizen ID), **`tin` accepted directly** (11-14 digits) with `tin_source = MANUAL`, tier, credit limit, payment term days, phone (E.164, ADR-0005), address, zone hint. When `tin` is empty and `kind = COMPANY`, a best-effort `getTinInfo` lookup through the box fills it with `tin_source = LOOKUP`; failures mark the row "TIN pending" and never block the import. Individuals carry an optional `consumer_no` column (8-digit e-Barimt consumer number or `11******`); individuals without a TIN are valid customers and receive B2C receipts, with `consumerNo` when `consumer_no` is known (ADR-0017, `docs/SPEC.md` §6.10). `vat_payer`/`city_payer` flags are filled by `getInfo` when a TIN is known, else default false and flagged.
5. **Opening-stock importer.** Columns: warehouse, bin, SKU, unit, quantity, **unit cost (required)**, optional lot. Commits as one `ADJUSTMENT` document per warehouse (ADR-0007 cost rule), so the stocktake UI can slip below the cut line without blocking go-live.
6. **Price lists and contract prices** (delivery 2) import as a diff with preview against active rules (ADR-0009).
7. A cleanup week with the owner is budgeted before go-live; the preview grid is the tool for it.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One-off scripts | Not repeatable, no preview, no revert, no audit. |
| Direct SQL loads | Bypass validation, normalisation, ledger posting and audit. |
| CSV only | Owner's data is Excel; ExcelJS handles both. |
| Require classification codes at import | Turns a data-cleanup project into a delivery-1 blocker for 10,000 SKUs. |
| Resolve every TIN at import | Depends on the office box and on a lookup ITC is restricting; manual TIN column is faster and auditable. |

## Consequences

**Positive.** Repeatable, reversible, auditable loads; delivery 1 is not blocked by e-Barimt data cleanup; the readiness report makes the remaining work visible and measurable.

**Negative.** The imports module is on the delivery-1 critical path; readiness must reach 100 % for sold products before delivery 3 go-live, which is owner work.

**Follow-ups.** Delivery 1: products, customers, opening-stock importers; readiness report; bulk assign. Delivery 2: price diff import. Delivery 3: `EBARIMT_ATTRIBUTES_MISSING` guard.

## Related

ADR-0005, ADR-0007, ADR-0009, ADR-0011, ADR-0013, ADR-0014, ADR-0017, `docs/architecture.md` §4 (imports), §5.2, §5.5, `docs/SPEC.md` §5, §8.
