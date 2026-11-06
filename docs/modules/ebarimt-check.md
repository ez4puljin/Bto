# Module: ebarimt-check («Ebarimt», ADR-0168, ADR-0170)

A month's purchases from the posted goods receipts against e-Barimt's file, per supplier: what staff chase suppliers about. Web: `/finance/ebarimt`. It posts nothing and moves no stock or money. It only reads other modules, attaches its own file through `StorageService.confirm`, and nobody imports it.

## Owned tables (`modules/ebarimt-check/schema.ts`, migrations `0084_ebarimt_check`, `0086_ebarimt_review`, `0087_ebarimt_history_guard`)

| Table | Holds |
|---|---|
| `ebarimt_check_accounts` | The account codes whose receipts count. No row: the key AP's account |
| `ebarimt_check_files` | A month's file: one `ACTIVE` per period (partial unique index), older ones `REPLACED` or `REMOVED`, never deleted |
| `ebarimt_check_entries` | A file's lines. `receipt_key` is ДДТД, else delivery note, date, TTD and total; `ttd` normalized |
| `ebarimt_check_month_values` | A supplier's month: exempt amount and note |
| `ebarimt_check_assignments` | A supplier given to an employee from a period on; NULL returns to the orderer |
| `ebarimt_check_supplier_profiles` | Registers, phone and remark typed on this page; NULL means the supplier's record |
| `ebarimt_check_receipt_links` | A receipt counted for a chosen supplier; undone by `removed_at`, one live per period and key |
| `ebarimt_check_history` | Append-only (role app holds no UPDATE or DELETE). Employee, e-Barimt total and exempt amount as they changed; kinds `INIT`, `FILE`, `MANUAL`, `REVERT`, `EDIT`, `LINK`, `UNLINK`, `REMOVE` |

A **period** is year × 100 + month (202610). Helpers in `@tugeel/shared/ebarimt-check`.

## Reads from other modules

- `inventory`: `ReceiptsService.postedBetween(from, to, supplierId?)` (each receipt's amount: the payable once costed, before that the note's total), `counterAccounts()`.
- `partners`: `SuppliersService.allBrief()`, `getMany()`.
- `procurement`: `SupplierOrderersService.changes()`, every change of every orderer by date.
- `identity`: `StorageService.openUploaded` (reads a file before it is accepted), `confirm`, `openPrivate` (the download), `AuditService`, `UserNamesService`.

## API (`/api/v1/ebarimt-check`)

| Route | Right | Does |
|---|---|---|
| `GET report?periods=202610,202609` | read | Rows, unregistered registers, links, months with no file |
| `GET receipts?periods&supplierId` | read | The supplier's posted receipts in brief, those not counted marked |
| `GET entries?periods&supplierId` or `&ttd` | read | e-Barimt's lines behind a figure |
| `GET files?year` | read | Last December and the year's months with their files, and the latest month holding one |
| `POST files` (idempotent) | edit | Reads an uploaded `ebarimt.source` file into the month of its dates |
| `DELETE files/:period` | settings | Takes the month's file out of force |
| `GET files/:id/download` | read | The file as uploaded |
| `GET settings`, `PUT settings` | read, settings | The accounts and which count |
| `PUT month-values` | edit | Exempt amount and/or note of a supplier's month, each with the value its cell showed |
| `PUT assignments` | assign | Suppliers given to an employee from a period on |
| `PUT suppliers/:id/profile` | edit | Registers, phone, remark, each with the value its cell showed; null returns to the record's |
| `PUT receipt-links` | edit | Receipts counted for a supplier; `supplierId` null undoes; a receipt already linked is skipped |

Rights: `ebarimt.check.read`, `.edit`, `.assign`, `.settings` (ADMIN all; ACCOUNTANT read, edit, settings; PROCUREMENT read, edit).

## Invariants

- Purchases are never stored: they are worked out from posted receipts on every read, in the delivery note's month (else the posting's), on the accounts that count. A receipt before its price check counts at the note's total, else what was typed less its discount, else nothing; `pendingCount` says how many (ADR-0170 #1).
- «Зөрүү» = purchases − e-Barimt − exempt amount. Half a tugrik or less reads as none (`EBARIMT_DIFF_TOLERANCE`).
- An entry belongs to a live link's supplier first, then to every supplier holding its register, else to the unregistered list. A link wins over a register, so a linked receipt never counts twice.
- A link whose receipt left the month's file counts for nothing, is shown as such, and counts again when a file brings the receipt back.
- A month's employee is the latest assignment on or before it, else the orderer the supplier had at that month's end (before its first orderer, that first one; `OrdererTimeline`, ADR-0170 #2). `supplier_orderers` is never written here.
- A month's first file ever is each supplier's first reading (`INIT`, hidden while alone); a total rising from nothing after it is a change. A link notes only the suppliers it can move. A register changed on the supplier's own record is noted only at the month's next file.
- Registers, phone and remark typed here never reach `suppliers`.
- A value written names what its cell showed; a difference under the row's lock answers 409 `EBARIMT_CELL_CONFLICT` (`value`) and writes nothing (ADR-0170 #8).
- Nothing is deleted but the rows of `ebarimt_check_accounts` when the setting is saved (audited).

## File format

e-Barimt's export «EBARIMT Падаан (Худалдан авалт)»: heads «Падаан №, ДДТД, Огноо, Харилцагчийн нэр, Харилцагчийн ТТД, НӨАТ, Цэвэр дүн, Нийт дүн, Төрөл», found by their words within the first ten rows; «ТТД», «Огноо» and «Нийт дүн» are required. A line with no TTD is skipped. Dates may be text or date cells, and only a real day counts. A blank total, an error cell (a register's too), a formula never worked out, an amount of 1,000,000,000,000 or more, or a text amount in any notation but digits, commas grouping thousands and at most two decimals refuses the file, naming the row. `.xlsx` only, at most 5 MiB and 20,000 lines; read in the API request before any transaction (ADR-0170 #5); `ebarimt-sheet.ts`.

Errors: `EBARIMT_FILE_UNREADABLE`, `EBARIMT_FILE_COLUMNS`, `EBARIMT_FILE_EMPTY`, `EBARIMT_FILE_ROW` (`row`), `EBARIMT_FILE_MONTHS` (`months`), `EBARIMT_FILE_LIMIT` (`max`).

## Screen

The month, mode, chosen months, employee, «Дутуутай», filters and the open brief of receipts stay in the address (`period`, `mode`, `months`, `emp`, `missing`, `q`, `c_<column>`, `receipts`), so a receipt opened from the brief comes back to it. Months chosen one by one make one read after 250 ms, the last rows staying dimmed; a month's rows never stand in for another's. Wide tables use `DialogContent size="2xl"`.

## Tests

`test/integration/ebarimt-check.int-spec.ts`, `services/ebarimt-sheet.spec.ts`, `packages/shared/src/ebarimt-check/ebarimt-check.test.ts`, `apps/web/src/features/ebarimt-check/ebarimt-page.test.tsx`.

## Status

Built 2026-11-07. `bto_main` holds the old system's eleven months (2025-12 … 2026-10) carried over by a one-off script through this API: Orgil's e-Barimt files, registers, phones, remarks, exempt amounts, notes, links, and employees for the three whose names plainly match staff. Real data stays out of the repository.
