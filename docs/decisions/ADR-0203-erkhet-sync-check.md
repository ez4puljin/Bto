# ADR-0203: «Эрхэт тулгалт»: Erkhet's customers and items checked against Bto's, and Bto brought to Erkhet

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-16 |
| Deciders | Owner (2026-11-16: «Эрхэт дээрхи харилцагч болон бараа материалын мэдээллийг sync шалгадаг болон хийдэг болгомоор байна. Харилцагчдыг шууд кодоор нь match … бараа материалын код bto болон Эрхэт дээр өөр байгаа тул баркодоор нь match … Bto системд бүртгэлтэй эсэх, Үнэ таарч байгаа эсэхийг шалгахад болно»; answers the same day: «Bto өөрөө татна», «Эрхэт → Bto», the sign-in typed by the owner), Claude (the direct-mode session) |
| Migration | `0104_erkhet_sync` |
| Amends | ADR-0077 (Erkhet still stops on the go-live day and nothing is exported to it; until then Bto reads two of its lists) |

## Context

Until the cut-over Erkhet is the company's books and the wholesale side still works in the old system, which feeds Erkhet. Bto runs beside it (the supermarket's pilot, ADR-0186), with customers carried over on 2026-10-24 (ADR-0107) and products on 2026-10-22 (ADR-0098). Since then both sides have moved: new customers and renamed ones in Erkhet, prices changed there every day. Nobody could say how far apart the two were.

Customers have the same code in both systems. Products do not: Bto gave many a new code (ADR-0098), so the barcode is what joins them. Erkhet has no API. The old ERP on the same PC already reads it as a browser would: a session cookie after a form sign-in, and each list from the address of its own «Excel» button.

A trial on the day's real lists against the development database: of 1,664 Erkhet customers 1,395 agree, 6 have another name, 3 can be added, 260 belong to groups Bto left out on purpose; of 13,053 items 11,535 agree, 543 have another price, 375 are not in Bto.

## Decision

1. **A module `erkhet` and an integration `integrations/erkhet`.** The module owns `erkhet_settings`, `erkhet_sync_runs` and `erkhet_sync_items`; it reads partners, catalog and pricing through their public services and nobody imports it. Screen: «Санхүү → Эрхэт тулгалт» (`/finance/erkhet`).
2. **The sign-in is typed, sealed and read-only in use.** The address (`https://` only), the company's number inside Erkhet (one sign-in may hold several companies; the one of the settings is entered, never where the sign-in leads), the name and the password. The password is sealed with AES-256-GCM under a new secret, `ERKHET_KEY_SECRET`, which the api (it seals) and the worker (it opens, to run a check) both read; `AI_KEY_SECRET` stays api-only. No response, audit row or log carries the password. A password saved for one address is never sent to another: changing the address clears it. After the sign-in the client sends GET requests only, follows no redirect away from Erkhet's address, and lives for one check.
3. **Customers are matched by code.** A row is `NAME_DIFFERS`, `INACTIVE_IN_BTO`, `MISSING_IN_BTO`, `GROUP_NOT_TAKEN` or `MISSING_IN_ERKHET`. A customer missing in Bto can be added only when its Erkhet group is an active customer category in Bto: the groups left out at the migration (Kharkhorin, the suppliers; ADR-0107) have none, and so stay out without a second list of them.
4. **Items are matched by barcode**, through the same lookup keys the scanner uses (`lookupCandidates`). An item without a barcode is matched by its code, and only to a Bto product that has no barcode either. A row is `PRICE_DIFFERS`, `MISSING_IN_BTO`, `NO_BTO_PRICE`, `INACTIVE_IN_BTO`, `AMBIGUOUS` (its barcodes belong to several Bto products), `NO_BARCODE` or `MISSING_IN_ERKHET`. The price compared is Erkhet's «Нэгж үнэ» against Bto's warehouse price in force today, both per base unit; half a tugrik or less is no difference.
5. **A check is a row and a job.** «Шалгах» inserts a run and enqueues `erkhet.sync` in one transaction; the worker signs in, downloads the two lists with no transaction open, compares, and writes the rows that differ with the counts in one transaction. One check waits or runs at a time (a unique index); one that outlived 20 minutes was interrupted. `erkhet.nightly` starts a check at 04:40 when the sign-in is complete and the switch is on, once a day. Only the last five checks keep their rows. A failed check says why on its row; the page keeps showing the last good one.
6. **«Bto-д тааруулах» goes one way, Erkhet → Bto**, for three differences: a missing customer is created (code, name, first phone, the category of its group, and the settlement group and kind most customers of that category have); a customer takes Erkhet's name; a product's warehouse price becomes Erkhet's from today, keeping its profile and whole pack. Each row is one transaction through `CustomersService` / `ProductPricesService`, so it is audited and bound by the same rules as a change by hand. Each row is checked again first: where Bto changed since the check it is marked `STALE` and left; where a rule refuses (a price with a fraction, an invalid whole pack) it is `REFUSED`. Only rows of the latest finished check are taken, up to 500 at a time. Products missing in Bto are shown, not created: a registration needs a category, a supplier, a photo and a home warehouse (ADR-0044).
7. **Nothing is ever written to Erkhet.** What is only in Bto is listed for a person to enter there.
8. **Rights.** `erkhet.sync.read` (the accountant has it), `erkhet.sync.manage` (start a check, bring Bto to Erkhet) and `erkhet.settings.manage`, the last two with the admin until given on «Эрх».

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| The owner uploads Erkhet's two Excel files | No password to keep, but by hand at every check; the owner chose the direct way. The readers take the same files, so an upload can be added if Erkhet's pages change |
| Bto → Erkhet, or a choice per row | Erkhet is the official books; its import is a queue of files that cannot be undone from here. Asked and declined for now |
| Sealing with `AI_KEY_SECRET` | The worker is deliberately kept without it (ADR-0162) |
| The check inside the request, in the api | Parsing 13,000 rows blocks the api for seconds, and a proxy may cut a request that waits on Erkhet |
| Matching products by code | Wrong for every product Bto renumbered (ADR-0098) |

## Consequences

**Positive.** The distance between the two systems is a number on a page every morning, and the three differences that can be closed safely close with one button. **Negative.** Erkhet is read through its web pages, not an API: a change of its sign-in form or of a list's columns fails the check (with `LOGIN_FAILED`, `UNEXPECTED_ANSWER` or `UNEXPECTED_FILE`), never silently. The customer list's address (`customers/list/`) is taken from the study of Erkhet's menu and was not tried against Erkhet before the owner typed the sign-in. Erkhet's password, sealed, is in the database and its secret in the environment of two processes. All of it ends with Erkhet on the go-live day (ADR-0077).

**Follow-ups.** The owner types the sign-in on the development server and on the real system and presses «Шалгах»; the customer list's address is confirmed by that first check.

## Related

ADR-0077, ADR-0098, ADR-0107, ADR-0048, ADR-0162, `docs/modules/erkhet.md`, docs/architecture.md §4, §9, §10.2.
