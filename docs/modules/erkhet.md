# Module: erkhet («Эрхэт тулгалт», ADR-0203; «Авлага, өглөгийн гүйлгээ», ADR-0219)

Erkhet's customers and items checked against Bto's while Erkhet is still the company's books, and Bto brought to Erkhet for the differences that close safely. Web: `/finance/erkhet`. It never writes to Erkhet. It reads partners, catalog and pricing through their public services and changes customers and prices only through them; nobody imports it. Since ADR-0219 it also copies Erkhet's receivable and payable transactions into Bto's books (the second half of this document). It ends with Erkhet on the go-live day (ADR-0077).

## Owned tables (`modules/erkhet/schema.ts`, migration `0104_erkhet_sync`)

| Table | Holds |
|---|---|
| `erkhet_settings` | One row: the address (`https://host`), the company's number inside Erkhet, the name, the password sealed under `ERKHET_KEY_SECRET`, the nightly switch |
| `erkhet_sync_runs` | A check: `QUEUED` → `RUNNING` → `DONE` or `FAILED` with its `failure`; `MANUAL` or `NIGHTLY`; the counts in `summary`. `active_slot` is 1 while it waits or runs (unique: one at a time); a `NIGHTLY` run is unique per `business_day` |
| `erkhet_sync_items` | The rows of a check that differ: Erkhet's side as it stood in the list, Bto's side as it was, a new customer's `plan`, and `resolution` (`APPLIED`, `STALE`, `REFUSED`). Only the last five finished checks keep their rows |

Erkhet's customer and item lists themselves are never stored.

## The integration (`src/integrations/erkhet`)

Erkhet has no API. `ErkhetClient` signs in as a browser would (the form's token from the `csrftoken` cookie, the session cookie from the redirect, both kept by hand), enters the company of the settings, and downloads a list from `/{company}/transactions/trs/to-excel/?source=/{company}/<list>`: `inventory/item/list/` and `customers/list/`. `https` only, no redirect followed to another address, GET only after the sign-in, one client per check. `ErkhetGateway` (global `ErkhetIntegrationModule`, imported by both composition roots) makes clients over `ERKHET_FETCH`, which tests replace with a scripted Erkhet.

## The rules (`@tugeel/shared/erkhet`, `services/erkhet-compare.ts`)

- **Customers by code.** `NAME_DIFFERS` (names compared as Bto stores them), `INACTIVE_IN_BTO`, `MISSING_IN_BTO` (its Erkhet group is an active customer category in Bto; the row carries the plan: that category, and the settlement group and kind most of its customers have, the first phone that reads), `GROUP_NOT_TAKEN` (no such category: Kharkhorin and the suppliers of ADR-0107), `MISSING_IN_ERKHET` (active in Bto only).
- **Items by barcode**, through `lookupCandidates`; without a barcode by code, only to a Bto product without barcodes. `PRICE_DIFFERS` (Erkhet's «Нэгж үнэ» against the warehouse price in force today, more than 0.5 apart; an empty or zero Erkhet price is not compared), `MISSING_IN_BTO`, `NO_BTO_PRICE`, `INACTIVE_IN_BTO`, `AMBIGUOUS`, `NO_BARCODE`, `MISSING_IN_ERKHET`.
- A code repeated in a list is read once. A list without its columns («Код», «Нэр», «Баркод», «Нэгж үнэ»; «Код», «Нэр», «Бүлэг нэр») or without rows fails the check with `UNEXPECTED_FILE`.

## Reads and writes in other modules

The ledger copy adds: `fin-bridge` `FinErkhetBooks` (posting, the copied open items, Bto's own documents), `finance` `PaymentsService.voidInTx`, `JournalService.reverseManualInTx`, `ArLedgerService.heldByBankStatement`, and `partners` `SuppliersService.findByCodes`.

- `partners`: `CustomersService.directory()`, `findByCodes`, `findByIds`, `createInTx`, `updateInTx`; `CustomerCategoriesService.findByNames`.
- `catalog`: `CatalogImportService.directory()` (every product with its barcode count), `barcodeOwners(lookupKeys)`.
- `pricing`: `ProductPricesService.inForce(ids, day)`, `setInTx`.
- `identity`: `AuditService`, `UserNamesService`.

## Jobs

| Job | When | Does |
|---|---|---|
| `erkhet.sync` `{ runId }` | enqueued with the run | `ErkhetRunFlowService.execute`: sign in, download, compare, store. No retry; a second delivery leaves a finished check alone |
| `erkhet.nightly` | 04:40 Ulaanbaatar | starts the day's check when the sign-in is complete and the switch is on |

## API (`/api/v1/erkhet`)

| Route | Right | Does |
|---|---|---|
| `GET settings`, `PATCH settings` | `erkhet.settings.manage` | the sign-in without its password; a typed address is cut to its origin; a new address clears the saved password |
| `POST settings/test` | `erkhet.settings.manage` | signs in with what is typed (the saved values fill the rest; the saved password only for the saved address), saves nothing: `{ ok, reason, status }` |
| `GET sync` | `erkhet.sync.read` | `{ configured, nightly, active, latest, failed }`: the check under way, the latest finished one with its counts, and a later failed one |
| `POST sync/runs` | `erkhet.sync.manage` | 202 with the queued run; 409 `ERKHET_NOT_CONFIGURED`, `ERKHET_SYNC_RUNNING` |
| `GET sync/items?kind&issue&q&open&cursor&limit` | `erkhet.sync.read` | rows of the latest finished check, keyset by id |
| `POST sync/apply` `{ itemIds }` or `{ kind, issue }` | `erkhet.sync.manage` | brings Bto to Erkhet, up to 500 rows: `{ applied, stale, refused, skipped }`; 409 `ERKHET_RUN_SUPERSEDED` for rows of an older check |

## Invariants

- No route, job or client method writes to Erkhet.
- The password is never returned, audited or logged; it reaches only the saved address.
- A check changes nothing in Bto but its own three tables; only `sync/apply` changes customers and prices, one row and one transaction at a time, each audited as the acting person's.
- A row is settled once: applied, stale or refused, by whoever claimed it first.

## Tests

`integrations/erkhet/erkhet.client.spec.ts`, `services/erkhet-compare.spec.ts`, `services/erkhet-sheets.spec.ts` (synthetic rows only) and `test/integration/erkhet-sync.int-spec.ts` (rights, the sign-in's secrecy, a check end to end against a scripted Erkhet, the three changes, stale and superseded rows, failures, the nightly start).

---

# «Авлага, өглөгийн гүйлгээ» (ADR-0219)

Erkhet's transactions on its accounts of the customers' receivables and the suppliers' payables, copied into Bto's books under each party every night until the go-live day, with each party's balance before the start date. Web: `/finance/erkhet`, the part «Авлага, өглөгийн гүйлгээ». The customer ledger, the supplier ledger, the balances and the settlement SMS then read Erkhet's figures from the books.

## Owned tables (migration `0112_erkhet_ledger_copy`)

| Table | Holds |
|---|---|
| `erkhet_ledger_settings` | One row: Erkhet's two account codes (`120101`, `310101`), the start date (`2026-10-01`), `posting` (on once «Bto-д оруулах» ran, off after a revert), Erkhet's internal ids of the two accounts as the last run found them |
| `erkhet_ledger_runs` | A run: `CHECK`, `POST` or `REVERT`; `MANUAL` or `NIGHTLY`; the state, the failure with what it names, the totals in `summary`, what the person chose for Bto's own documents. One waits or runs at a time; the night's is once a day |
| `erkhet_ledger_trs` | An Erkhet transaction on one account (unique by account code and `tr_id`): its date, totals and hash as Erkhet shows it now, `gone` when the last complete download no longer held it, and where its copy stands (`state`, `posted_hash`, `live_revision`, `last_revision`, `posted_date`, `posted_parties`), the path that opens it in Erkhet |
| `erkhet_ledger_lines` | A transaction's lines on the account in Erkhet's order: party code and name, debit, credit, «Гүйлгээний утга», «Баримтын дугаар» |
| `erkhet_ledger_openings` | A party's debit and credit on an account before the start date, with the same standing columns |
| `erkhet_ledger_opening_reads` | Per account: the day the opening was summed through, the pages and lines read, the totals. A later run reads the history again only when the start date changed |
| `erkhet_ledger_parties`, `erkhet_ledger_allocations` | A party whose copied items want pairing (`dirty`) and the ALLOCATION documents that paired them (`live`) |

## The integration

`ErkhetClient.journalPage` (a page of the general journal filtered to an account), `accountIds` (the filter form's account list: code to Erkhet's internal id) and `transactionPath` (a transaction's `update_url`; `delete_url` is never read). `erkhet.journal.ts` reads a page: the rows of `var items = [ … ]`, or the table by its headings when the script is missing; amounts with thousands separators; a negative amount as the other side; an empty page past the end as no lines; `joinJournalPages` gives the lines a page begins with to the transaction the page before ended with.

## The rules (`services/erkhet-ledger-plan.ts`, `@tugeel/shared/erkhet`)

- `groupJournal`: lines into transactions, numbered in Erkhet's order also across a page break; the hash covers the date and each line's party code, amounts, text and bill number.
- `planCopy`: `POST` (not in the books), `REVISE` (the hash changed), `REVERSE` (gone), `UNMATCH` (posted, but a party is no longer known), `LEAVE_OUT` (a party code is not in Bto, or a line has none), `DROP` (gone before it was posted), `NONE`.
- `trPosting`, `openingPosting`: the document. The party line by key `AR` or `AP` under the party, the other side on key `ERKHET_CLEARING`; nothing for a transaction without amounts.
- `pairOldestFirst`: a party's copied credits against its copied debits, oldest first.

## Books (through `fin-bridge`'s `FinErkhetBooks`, as source BTO)

| Document type | Class | Source key | Number |
|---|---|---|---|
| `ERKHET.TR` | JOURNAL | `ERKHET_TR` / `<account>:<tr_id>` / revision | Erkhet's bill number, else its transaction number |
| `ERKHET.OPENING` | OPENING | `ERKHET_OPENING` / `<account>:<party code>` / revision | `<account>-<party code>` |
| `ERKHET.ALLOCATION` | ALLOCATION | `ERKHET_ALLOCATION` / the row id of `erkhet_ledger_allocations` | the core's allocation series |

The clearing account is «Эрхэтээс хуулсан гүйлгээний тохируулга», found by its key `ERKHET_CLEARING`: `390102` from the chart template on an empty chart; on a chart that is not empty migration 0112 creates it on `390102` or the next free code up to `390199`, and leaves a key that already has a rule alone. The ledgers (`ArLedgerService.ledger`, `ApLedgerService.ledger`) mark a line of these types with `erkhet: { kind, key, billNumber, text }`.

## A run (`ErkhetLedgerFlowService`, job `erkhet.ledger`)

1. **Download** (a check, the night's run, a post once posting is on): sign in, resolve the two account ids, read every page from the start date to today, and the whole history up to the day before the start date when no opening stands for that day. A line of another account or day, or a page that cannot be read, fails the run; the first page is read again at the end and the read repeated when it moved.
2. **Stage**, one transaction: new transactions inserted, changed ones replaced, unseen ones marked `gone`.
3. **Plan**: every copy's action, with the customers and suppliers of the party codes.
4. **Post** (not for a check), oldest first, a transaction per copy; pairings of the parties of copies about to be reversed are taken back first, and every dirty party is paired at the end, also after a failure.
5. **Addresses**, after the run has ended: up to 1,500 transactions without a path are asked for, newest first.

## Jobs

| Job | When | Does |
|---|---|---|
| `erkhet.ledger` `{ runId }` | enqueued with the run | `ErkhetLedgerFlowService.execute`. No retry; a second delivery leaves a finished run alone |
| `erkhet.ledgerNightly` | 03:10 Ulaanbaatar | starts the day's download and post when the sign-in is complete, the night's switch is on and posting is on |

## API (`/api/v1/erkhet/ledger`)

| Route | Right | Does |
|---|---|---|
| `GET` | `erkhet.sync.read` | the settings, the run under way, the latest finished one with its totals, a later failed one, whether a fresh check stands, the copies in the books and the blocked ones |
| `PATCH settings` | `erkhet.settings.manage` | the two account codes and the start date |
| `POST runs` `{ kind, ownDocuments?, reason? }` | `erkhet.sync.manage` | 200 `{ started, refusal, run }`. Refusals: `NOT_CONFIGURED`, `RUNNING`, `NOT_CHECKED` (the first post needs a check of the last 24 hours), `CHOICE_REQUIRED` (Bto's own documents stand and nothing was chosen), `NOT_REVERSIBLE` (one of them cannot be reversed from here: its kind, or a bank statement line holds it), `NOTHING_POSTED` (a revert with no copy in the books) |
| `GET parties?account&unmatched&q&cursor&limit` | `erkhet.sync.read` | per account and party code as Erkhet shows it: the opening, debit, credit, closing, the line count and the Bto customer or supplier (null: not in Bto) |
| `GET own-documents` | `erkhet.sync.read` | Bto's own documents on the receivable and payable accounts with a party, their total, and for each what keeps it from being reversed here (`KIND`, `BANK_STATEMENT`) |
| `GET links?keys=120101:13659251,…` | `finance.read` | the address of each copied transaction in Erkhet, `exact: false` while it is the journal list of the day |

## Invariants

- No request other than GET reaches Erkhet after the sign-in, and no address holding «delete» is ever requested or stored.
- A check posts nothing. A post never creates a party.
- A copy is one live document at most: a new revision posts only after the one before it was reversed.
- Bto's own documents are reversed only by a person's explicit choice, through their own services; none is deleted.
- Every run can be repeated: a stage replaces, a posting is keyed, a pairing clears its `dirty` mark in its own transaction.

## Tests

`integrations/erkhet/erkhet.journal.spec.ts` (the script and table forms, thousands separators, the empty last page, several lines in one transaction, the account list, the update address), `erkhet.client.journal.spec.ts` (the three requests, GET only, never «delete»), `services/erkhet-ledger-plan.spec.ts` (new, changed, vanished, unmatched; the documents; the pairing) and `test/integration/erkhet-ledger-copy.int-spec.ts` (rights; a check posts nothing; a post makes the party balance the opening plus debits less credits; a second run posts nothing; a changed and a vanished transaction follow; an unmatched party is left out and picked up; a revert; the ledger row's address; the SMS balance; a closed month; Bto's own documents; GET only).

