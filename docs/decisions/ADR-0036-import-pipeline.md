# ADR-0036: The import pipeline as built: all or nothing, parsed by the worker

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-11 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0015 #2 (batched commits), #4 (customer kind and TIN lookup), #5 (opening-stock cost required) |

## Context

Delivery 1 week 4 builds the `imports` module of ADR-0015 (SPEC §5.5, §8.1 #6). The owner interview of 2026-10-11 settled what ADR-0015 left open:

- a file with any error is refused entirely; the owner fixes the sheet and uploads again;
- categories and brands missing from the system are errors (they are created by hand first);
- opening stock comes from the current spreadsheets per warehouse, without shelves and without costs; costs stay 0;
- the product sheet has one "box quantity" column and several barcodes in one cell; the customer sheet has no company/individual column;
- the owner fills the system's templates (columns found by their headers); the files are `.xlsx`; only admins import.

A design review found that a single-transaction commit of ~10,000 products would exhaust PostgreSQL's lock table through per-product advisory locks, that one opening-stock document per warehouse can exceed the bind-parameter limit of one ledger insert, and that parsing large sheets in the api process competes with the scanners for its event loop.

## Decision

1. **Upload and parsing.** The browser uploads the sheet through the presigned flow (private file kind `imports.source`, `.xlsx` only, 5 MiB). `POST /imports` only verifies and attaches the file and enqueues `imports.validate`. The worker streams the first sheet (ExcelJS), finds the header row in the first 10 rows by the labels and aliases in `mn.json`, and stores every data row (at most 20,000 rows, 60 columns, 1,000 characters per cell). The api and the worker share the file storage.
2. **Validation and preview.** Every row is normalised and checked in the worker (shared rules in `@tugeel/shared/imports`, bulk lookups against the database, duplicates within the file and against the database); errors and warnings are stored per row with a column and a code, shown in Mongolian.
3. **All or nothing.** A file with errors cannot be committed. `imports.commit` runs in one transaction: it validates again first (a different outcome rolls back and replaces the preview), then applies every row. Rows never use savepoints. Only one import commits or reverts at a time (`pg_advisory_xact_lock`, `IMPORT_BUSY`). Writes that would lock per product use table locks and bulk statements instead. Progress is written every 250 rows on a separate connection, and the job row is updated in the transaction only at the end.
4. **References must exist.** Categories (full path or a leaf name that is unique), brands, suppliers, warehouses and shelves are looked up, never created. A customer's kind is read from the registration number, else the TIN's length, else company with a warning; the TIN lookup through the office box waits for delivery 3.
5. **Opening stock.** One `OPENING` adjustment per warehouse, posted at commit; a warehouse with an active opening import refuses another. The bin column is optional: without it the line goes to the product's fixed shelf, else to the warehouse's `NOSHELF` storage bin («Тавиургүй», sellable, created on demand), at the supermarket to SALESFLOOR. The cost column is optional: empty means 0 with a warning.
6. **Re-import.** Rows are keyed on SKU (products) and code (customers, suppliers; a supplier without a code by name); only changed fields are written. Unit factors never change through an import: a different box quantity is an error.
7. **Revert.** Only the most recent committed import of any kind can be reverted, in one transaction: created products become inactive and release their barcodes (refused while they hold stock); created customers and suppliers become inactive; updated fields are restored only where they still hold the imported value; opening stock is taken back by an `OPENING_REVERSAL` adjustment per document (never twice). A failed revert changes nothing.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Commit in batches of 500 rows (ADR-0015 #2) | The owner wants a file to go in entirely or not at all. |
| Commit the valid rows and skip the rest | Same; partial imports also leave dependent rows (opening stock of products that failed) in a mess. |
| Create missing categories and brands | The owner chose errors, so typos never create new categories. |
| Parse in the api request | Heavy CPU and memory in the process that serves the scanners. |
| Savepoint per row | Thousands of subtransactions overflow PostgreSQL's per-backend cache and slow every snapshot. |

## Consequences

**Positive.** An import is predictable: the preview shows every problem, the commit is atomic, and a mistaken import can be taken back.

**Negative.** A large commit holds its locks until it ends (customer codes, the adjustment number sequence, updated products), so imports run when the system is idle. Opening stock without costs values the old stock at 0 until it sells out.

## Related

ADR-0013, ADR-0014, ADR-0015, ADR-0030, ADR-0033, ADR-0034, ADR-0035, `docs/modules/imports.md`, `docs/SPEC.md` §5.5, §8.1.
