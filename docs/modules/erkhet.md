# Module: erkhet («Эрхэт тулгалт», ADR-0203)

Erkhet's customers and items checked against Bto's while Erkhet is still the company's books, and Bto brought to Erkhet for the differences that close safely. Web: `/finance/erkhet`. It never writes to Erkhet. It reads partners, catalog and pricing through their public services and changes customers and prices only through them; nobody imports it. It ends with Erkhet on the go-live day (ADR-0077).

## Owned tables (`modules/erkhet/schema.ts`, migration `0104_erkhet_sync`)

| Table | Holds |
|---|---|
| `erkhet_settings` | One row: the address (`https://host`), the company's number inside Erkhet, the name, the password sealed under `ERKHET_KEY_SECRET`, the nightly switch |
| `erkhet_sync_runs` | A check: `QUEUED` → `RUNNING` → `DONE` or `FAILED` with its `failure`; `MANUAL` or `NIGHTLY`; the counts in `summary`. `active_slot` is 1 while it waits or runs (unique: one at a time); a `NIGHTLY` run is unique per `business_day` |
| `erkhet_sync_items` | The rows of a check that differ: Erkhet's side as it stood in the list, Bto's side as it was, a new customer's `plan`, and `resolution` (`APPLIED`, `STALE`, `REFUSED`). Only the last five finished checks keep their rows |

Erkhet's lists themselves are never stored.

## The integration (`src/integrations/erkhet`)

Erkhet has no API. `ErkhetClient` signs in as a browser would (the form's token from the `csrftoken` cookie, the session cookie from the redirect, both kept by hand), enters the company of the settings, and downloads a list from `/{company}/transactions/trs/to-excel/?source=/{company}/<list>`: `inventory/item/list/` and `customers/list/`. `https` only, no redirect followed to another address, GET only after the sign-in, one client per check. `ErkhetGateway` (global `ErkhetIntegrationModule`, imported by both composition roots) makes clients over `ERKHET_FETCH`, which tests replace with a scripted Erkhet.

## The rules (`@tugeel/shared/erkhet`, `services/erkhet-compare.ts`)

- **Customers by code.** `NAME_DIFFERS` (names compared as Bto stores them), `INACTIVE_IN_BTO`, `MISSING_IN_BTO` (its Erkhet group is an active customer category in Bto; the row carries the plan: that category, and the settlement group and kind most of its customers have, the first phone that reads), `GROUP_NOT_TAKEN` (no such category: Kharkhorin and the suppliers of ADR-0107), `MISSING_IN_ERKHET` (active in Bto only).
- **Items by barcode**, through `lookupCandidates`; without a barcode by code, only to a Bto product without barcodes. `PRICE_DIFFERS` (Erkhet's «Нэгж үнэ» against the warehouse price in force today, more than 0.5 apart; an empty or zero Erkhet price is not compared), `MISSING_IN_BTO`, `NO_BTO_PRICE`, `INACTIVE_IN_BTO`, `AMBIGUOUS`, `NO_BARCODE`, `MISSING_IN_ERKHET`.
- A code repeated in a list is read once. A list without its columns («Код», «Нэр», «Баркод», «Нэгж үнэ»; «Код», «Нэр», «Бүлэг нэр») or without rows fails the check with `UNEXPECTED_FILE`.

## Reads and writes in other modules

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
