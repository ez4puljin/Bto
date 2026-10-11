# Module `imports` — contract

Status: **built** in delivery 1 (week 4), session of 2026-10-11; accepted locally together with the rest of delivery 1. Code: `apps/api/src/modules/imports/`, shared rules in `packages/shared/src/imports`, screens in `apps/web/src/features/imports/`. Decisions: ADR-0015 (pipeline), ADR-0036 (as built: all or nothing, parsed by the worker), ADR-0013 (pg-boss), ADR-0030 (local file storage), ADR-0027 (access control), architecture §4 (imports row).

imports depends on `identity` (files, audit, warehouses, actors), `catalog`, `partners` and `inventory`, always through their `index.ts` and their `*InTx` / bulk methods inside its own transaction; it never writes another module's tables. Nothing imports `imports` in-process.

## 1. Owner's answers behind the design (interview of 2026-10-11)

- **A file with any error is refused entirely.** The owner fixes the sheet in Excel and uploads it again; nothing is half-imported.
- **References are created by hand first.** A category, brand, supplier, warehouse or shelf missing from the system is an error, so typos never create new master data.
- **Opening stock** comes from today's spreadsheets per warehouse, without shelves and without costs (costs stay 0 until a later decision).
- **Sheets.** The product sheet has one box-quantity column and several barcodes in one cell; the customer sheet has no company/individual column. The owner fills the system's templates (columns found by their headers), saves `.xlsx`, and only admins import.
- **Public repository.** The owner's real files never enter the repository; tests use synthetic data and logs carry counts only.

## 2. Owned tables

Migration `0008_imports` (generated, then `REVOKE DELETE, TRUNCATE ON import_jobs, import_documents FROM app` by hand).

| Table | Purpose | Key rules (DB-enforced unless noted) |
|---|---|---|
| `import_jobs` | one per uploaded sheet | `kind` PRODUCTS/CUSTOMERS/SUPPLIERS/OPENING_STOCK; `status` UPLOADED → VALIDATING → VALIDATED/INVALID → COMMITTING → COMMITTED → REVERTING → REVERTED (FAILED: unreadable sheet); `phase` (PARSING, CHECKING, APPLYING, REVERTING) and `processed_rows` for the progress bar; `heartbeat_at`; `summary` (counts by action and code, file issues, `refreshed`); `last_error` JSON `{code, params}` ≤ 2,000 chars; `committed_at` exactly in COMMITTED/REVERTING/REVERTED, `reverted_at` exactly in REVERTED; never deleted |
| `import_rows` | one per data row | `(job_id, row_no)` unique (`row_no` as Excel shows it); `raw` cells as text, `cell_issues`, `normalized`, `errors` / `warnings` `[{column, code, params}]` with counts and partial indexes for the filters; `action` CREATE/UPDATE/UNCHANGED; `changes` (what the commit did: ids created, values before and after) and `target_id` for the revert |
| `import_documents` | the OPENING adjustment an opening-stock import posted per warehouse | one `active` row per warehouse (partial unique); `reversal_adjustment_id` set exactly when inactive |

## 3. Public API (`modules/imports/index.ts`)

| Export | Use |
|---|---|
| `ImportsModule` / `ImportsHttpModule` / `ImportsWorkerModule` | services; + controller (api); + the three job handlers (worker) |
| `ImportsService` | template, create, get, list, rows, `requestCommit`, `requestRevert` (state checks, then enqueue in the same transaction) |
| `ImportPipelineService.validate / commit / revert(jobId)` | the work the jobs run; tests call it in-process |
| `IMPORT_LOCK` (`72_029_001`) | the transaction-level advisory lock one commit or revert holds (`IMPORT_BUSY` when taken) |
| types `ImportJob`, `ImportRow` | |

## 4. REST surface (`/api/v1`)

Every route needs `imports.manage` (ADMIN; assignable to custom roles).

| Method and path | Notes |
|---|---|
| `GET /imports/templates/:kind` | the `.xlsx` template: Mongolian headers from `mn.json` (required ones marked `*`), code and barcode columns formatted as text, an instructions sheet «Заавар»; file name `tugeel-<kind>.xlsx` |
| `GET /imports`, `GET /imports/:id` | history (keyset) and one job with `canRevert` |
| `GET /imports/:id/rows?filter=ERRORS\|WARNINGS\|ALL` | keyset by row number |
| `POST /imports` (`Idempotency-Key`) | `{ kind, fileId, fileName }` after the presigned upload of a private `imports.source` file (`.xlsx`, ≤ 5 MiB, ZIP magic checked); enqueues `imports.validate` |
| `POST /imports/:id/commit` (200, `Idempotency-Key`) | VALIDATED only (`IMPORT_HAS_ERRORS`, `IMPORT_STATE_INVALID`); enqueues `imports.commit` |
| `POST /imports/:id/revert` (200, `Idempotency-Key`) | the most recent COMMITTED import of any kind only (`IMPORT_REVERT_BLOCKED`); enqueues `imports.revert` |

## 5. Pipeline (ADR-0036)

- **Jobs.** Queues `imports.validate` (retry 2, expire 900 s), `imports.commit`, `imports.revert` (retry 1, expire 3,600 s): policy `exclusive`, `singletonKey` = the import id, heartbeat 60 s, kept 7 days. The handlers in `jobs/*.job.ts` only call `ImportPipelineService`.
- **Reading.** The worker opens the file through `StorageService.openPrivate`, loads the workbook with ExcelJS 4.4 (whole workbook; the streaming reader loses shared strings and hyperlink targets), takes the first sheet, finds the header row in the first 10 rows by the labels and aliases of `mn.json` (`matchHeaders`), and stores at most 20,000 rows × 60 columns, 1,000 characters per cell. Cells: numbers become text without float noise, formulas give their stored result (none → `FORMULA_WITHOUT_RESULT`), dates in a code or quantity column are refused, hyperlinks give their address (Google Maps links → GPS), a numeric code whose check digit shows a lost leading zero is restored with `NUMERIC_CODE`. File-level problems (`EMPTY`, no header, unknown or duplicate columns, too many rows, unreadable) end in FAILED with `summary.fileIssues`.
- **Checking.** Each importer normalises its rows with the shared rules (`@tugeel/shared/text`, `gtin`, `units`, `phone`, `taxpayer`, `geo`, `inventory`), looks everything up in bulk, marks duplicates inside the file (`DUPLICATE_IN_FILE` names the first row) and against the database (`TAKEN`), and plans CREATE / UPDATE / UNCHANGED with the changed fields. Rows are stored in chunks of 1,000; progress every 250 rows.
- **Commit.** One transaction: `IMPORT_LOCK`, re-validation against the current database (a different outcome rolls back, stores the new preview with `summary.refreshed` and leaves the job VALIDATED or INVALID), then every row through the owners' bulk services under table locks (no per-product advisory locks, so 10,000 products fit one transaction). Progress goes through a separate pool connection; the job row changes in the transaction only at the end. A failure rolls everything back and returns the job to VALIDATED with `last_error`.
- **Revert.** One transaction under `IMPORT_LOCK`, LIFO across all kinds (only the newest committed import). A failure leaves the job COMMITTED with `last_error`.

## 6. The four importers

| Kind | Key | What a row does |
|---|---|---|
| PRODUCTS | SKU | category (full path `Хүнс / Гурил` or a leaf name only one category has; `AMBIGUOUS` otherwise), brand, base unit (default the piece unit), barcodes of the base unit and of the box (several per cell, split on spaces, `,`, `;` or new lines), box quantity → a box unit (a different factor on an existing product is `MISMATCH`: factors change only on the product page), VAT type (code or Mongolian label), weight, home warehouse (WHOLESALE, code or name), fixed shelf (an active STORAGE/PICKING bin of the given or current home warehouse; without one `REQUIRED` on the home column), supplier (code, else name) → main supplier link. Existing products get only the fields that differ; empty cells never clear anything |
| CUSTOMERS | code | kind from the registration number, else the TIN's length, else company with `KIND_GUESSED`; TIN, consumer number, phone, address with the GPS point of a Google Maps link (added when the customer does not have that address yet; the first becomes the default), credit limit and payment term (blank limit = not decided); an inactive customer is reactivated with `REACTIVATED` |
| SUPPLIERS | code, else name | TIN, phone, email, address, bank, payment term; a contact person is added when the supplier does not have them yet |
| OPENING_STOCK | warehouse + SKU + bin | one `OPENING` adjustment per warehouse posted at commit (`AdjustmentsService.postSystemInTx`); quantity in the row's unit (default the base unit; must be exact in base units); bin optional: the product's fixed shelf, else SALESFLOOR at the supermarket, else the warehouse's `NOSHELF` storage shelf «Тавиургүй» (sellable, created on demand) with `NO_SHELF`; cost optional (per row unit, ex-VAT): empty = 0 with `NO_COST`; a RECEIVING bin warns `NOT_SELLABLE`; the home rule applies (`NOT_ALLOWED`); a warehouse with an active opening import refuses another (`ALREADY_IMPORTED`); more lines than one posting allows (`MAX_MOVEMENTS_PER_POST`) is `OUT_OF_RANGE` |

Row error codes: `REQUIRED`, `FORMAT`, `TOO_LONG`, `DATE_IN_CELL`, `FORMULA_WITHOUT_RESULT`, `ERROR_VALUE`, `NOT_FOUND`, `AMBIGUOUS`, `DUPLICATE_IN_FILE`, `TAKEN`, `NOT_ALLOWED`, `MISMATCH`, `INEXACT`, `NOT_POSITIVE`, `OUT_OF_RANGE`, `ALREADY_IMPORTED`; warnings: `NUMERIC_CODE`, `KIND_GUESSED`, `NO_COST`, `NO_SHELF`, `NOT_SELLABLE`, `REACTIVATED`. Messages: `imports.issues.<code>` in `mn.json`.

## 7. Revert per kind

- products: created products become INACTIVE and release their barcodes (refused while one holds stock, `IMPORT_REVERT_BLOCKED` with the first SKU); the supplier links the import added are removed and home warehouses and fixed shelves return to what they were; on existing products the updated fields go back only where they still hold the imported value, and the barcodes and box unit the import added are removed / retired if still there;
- customers and suppliers: created ones become INACTIVE; updated fields and credit terms go back only where they still hold the imported value;
- opening stock: an `OPENING_REVERSAL` adjustment per document (`AdjustmentsService.reverseOpeningInTx`, `adjustments.reverses_adjustment_id` unique, so never twice); refused when the stock has moved on and the reversal would overdraw (`STOCK_INSUFFICIENT`).

## 8. Error codes introduced

`IMPORT_STATE_INVALID`, `IMPORT_HAS_ERRORS`, `IMPORT_BUSY`, `IMPORT_REVERT_BLOCKED` (409), `IMPORT_FILE_INVALID` (422). Also used: `VALIDATION_FAILED` (422), `NOT_FOUND` (404), `FORBIDDEN` (403), `STOCK_INSUFFICIENT` (409, revert).

## 9. Audit

`CREATE`, `COMMIT`, `REVERT` on `import_jobs`; the rows each owner service writes inside the commit (products, units, barcodes, product locations, product suppliers, customers, addresses, contacts, suppliers, bins, adjustments) through `AuditService.recordMany` in chunks; a revert's deactivations are `UPDATE` rows with the status and released barcodes before and after.

## 10. Screens (`apps/web`)

Menu «Систем» → «Импорт» (`imports.manage`): `/imports` — a card per kind with the hint, «Загвар татах» and «Файл оруулах» (an `.xls` is refused before uploading; the file is sent as `.xlsx` whatever the browser reports), then the history; `/imports/:id` — status, progress while the worker runs (polling every 1.5 s, paused in a hidden tab), counts, file problems, the rows filtered by errors / warnings / all with the first cells in template order plus every cell with a problem and the Mongolian messages, «Системд оруулах» with a confirmation (VALIDATED only), «Буцаах» (only the newest committed import, with the reason shown otherwise).

## 11. Tests

Shared (Vitest): `imports` (headers, cells, lists, decimals, kind guess). Api unit: `sheet-reader.spec.ts`. Integration: `import-services.int-spec.ts` (the bulk owner services: create/update/deactivate products, supplier links and locations under table locks, opening adjustments and their reversal, private file reading), `imports.int-spec.ts` (template, upload → validate → preview, every kind create/update/unchanged, a file with one bad row refused whole, re-validation on commit, double commit, LIFO revert of each kind, rights, a worker end-to-end run). Integrity: `imports-scale.spec.ts` (10,000 products in one commit with bounded locks and time, reconciled). Web: `features/imports/imports-pages.test.tsx`. Verified by hand in the browser (2026-10-11) with synthetic sheets: a bad product file refused with «Ангилал: «Цай» олдсонгүй», a good one committed with units, barcodes, supplier, home warehouse and fixed shelf, opening stock into the fixed shelf and «Тавиургүй» at cost 1,500 and 0, both reverted newest first, reconciliation OK, every step in the audit log.

## 12. Open items

- The owner's real sheets (products, customers, suppliers, opening stock) are run locally with the owner during the delivery-1 acceptance; they never enter the repository.
- Price lists: delivery 2 (`pricing`). Opening receivables: delivery 3 (`finance`). The TIN lookup through PosAPI for customers: delivery 3.
- Housekeeping of old import files and rows (retention): with the identity housekeeping jobs.
