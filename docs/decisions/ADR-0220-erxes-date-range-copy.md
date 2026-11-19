# ADR-0220: erxes deals created within chosen days are copied on request; erxes's verified query shape

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-19 |
| Deciders | Owner (2026-11-19: «Date_range дотор үүссэн deal-үүдийг хуулж оруулах боломжтой байхаар хийх хэрэгтэй»), the brain (the brief, and the query facts it checked that day against the company's erxes signed in as a real user), Claude (worker `bto-core`, task `erxes-range`) |
| Migration | none |
| Builds on | ADR-0218 (the erxes deal copy: one row and at most one order per deal, drafts only, the creator, the waiting list, Bto pulls and never writes) |

## Context

ADR-0218 copies only the deals created after a pipeline is ticked. The owner also wants the deals made before, or missed, to come in: a person picks the days and copies what erxes holds of them.

ADR-0218 wrote erxes's shape from its open source, since introspection is off there. On the real system its first use failed quietly: «Erxes-ээс шинэчлэх» answered and stored no pipeline, and no failure was shown. On 2026-11-19 the brain tried the queries against the company's erxes and found:

1. `salesBoards` requires `type: String!`; `salesBoards(type: "deal") { _id name pipelines { _id name } }` works. Without it erxes answers only an error.
2. `deals` skips archived deals unless `noSkipArchive: true` is given, and in this company deals move to the stage «Архивлах» within hours (with it, 500 deals back to 2023-10-24 in one pipeline; without it, 6).
3. `deals(pipelineId, limit, skip, sortField: "createdAt", sortDirection: -1, noSkipArchive: true, createdStartDate: $a, createdEndDate: $b)` with `$a: Date, $b: Date` filters by creation (a `String` is refused); `startDate`/`endDate` filter something else, `dateRangeFilters` errors, `status` is no argument of `deals`.
4. `dealDetail(_id)` takes every field of Bto's selection except `companies { registrationNumber }` (Company has no such field).
5. A line of `productsData` carries `_id, productId, uom, currency, quantity, maxQuantity, unitPrice, taxPercent, tax, discountPercent, discount, amount, tickUsed, branchId, departmentId, conditions`; `products(ids: [String], perPage: Int) { _id name code barcodes uom }` works.

## Decision

1. **The queries follow the checked shape.** `BOARDS` asks `salesBoards(type: "deal")` (and `boards(type: "deal")` after it); every `deals` query carries `noSkipArchive: true`; the range filters by `createdStartDate`/`createdEndDate` typed `Date`; `DEAL_DETAIL` no longer asks a company's `registrationNumber` (its `taxNumber` is the register); `PRODUCTS` asks only the checked fields. The line mapping already uses the checked names. All of it stays in `erxes-wire.ts`.
2. **A refused query is a failure that is seen.** The client tries each shape of a query; one erxes refuses for any reason other than a field (an unknown root, a missing argument) moves to the next; when all are refused it fails `UNEXPECTED_ANSWER` with erxes's words for each, never with an empty answer. A field erxes refuses, in its «Cannot query field» or its gateway's «no field … in type …» wording, is still cut, and the cut shape is kept for the client's next query. A refresh, a pull or a range read that fails writes `erxes_settings.last_failure` and erxes's words in `last_failure_detail`; the page shows them in red and a toast; the refresh's answer carries the words too. A refresh whose answer holds no pipeline fails the same way and changes nothing.
3. **The range.** «Борлуулалт → Erxes-ээс ирсэн → Хугацаагаар татах»: a first and a last day, whole days of Ulaanbaatar (00:00 of the first to 23:59:59.999 of the last), the first not after the last, 31 days at most; the pipelines to read, by default the ticked ones, any that is not blocked, still in erxes and has its Bto pipeline and stage (ticked or not); a board «Хархорин» never.
4. **«Харах» lists, writes nothing.** Per pipeline, `deals` of the range in pages of 100 newest first; Bto checks each `createdAt` against the range again and stops reading past it; at 1000 deals it stops and asks to narrow the range (the first 1000 are listed). Each row: erxes number and name, created time, creator, erxes stage, customer, line count, total, and the row Bto holds of it (copied, waiting or set aside: shown, never ticked). New deals are ticked by default.
5. **«Bto руу хуулах» copies by the pull's rules.** Each ticked deal is read whole (`dealDetail`, its products, its field labels), kept as it came (`raw`), and tried by `ErxesCopyService.tryCopy` exactly as the pull does: a draft, the creator matched, an unmatched deal waiting with its reasons, the person who pressed written as `copied_by`. Bto checks again that erxes places the deal in the chosen pipeline and within the range (else `SKIPPED`), and a deal Bto holds is skipped (`erxes_deals.erxes_id` stays the dedupe). No HTTP call is made inside a transaction; each deal is its own transaction; a deal erxes answers wrong fails alone; erxes that cannot be reached or signed in to fails the rest of that request. The result: copied, waiting with reasons, skipped, failed.
6. **In parts, from the page.** A request takes 50 deals at most; the page sends the ticked ones oldest first in parts of 20 and shows «Хуулж байна: n / N». Each part is short enough for a request (and Cloudflare's limit on the office's web), needs no job, no table and no state in the api's memory, and a part sent again copies nothing twice.
7. **Rights and audit.** `sales.orders.manage`, as the rest of the page. One audit row `RANGE_COPY` per request keeps the person, the range, the pipelines and the counts; each copied deal keeps its own `COPY` row as before.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| An on-demand job with its progress in a table | A migration and a job registration for what parts of 20 do in seconds each; parts keep the progress honest and need nothing new |
| Reading every listed deal whole for «Харах» | A thousand `dealDetail` calls to show a list; the list's own fields suffice, and a field erxes does not give on a list is cut, not fatal |
| Moving the minute pull's tick moment back instead | It would copy every deal of the past at once, without a person choosing which |
| Copying waiting deals again from the range | They are Bto's already and wait for a person's choice on the list; a second path would blur which one holds |

## Consequences

**Positive.** Deals made before the tick, or archived before a pull saw them, come in under the same rules, chosen by a person, never twice. A query erxes refuses is now seen with erxes's own words instead of a silent empty list.

**Negative.** `DEAL_RANGE` asks a list item for more than was checked (number, stage, creator, parties, lines, amount); what erxes refuses is cut, and the list then shows less. A range copy of many deals is as slow as erxes answers (`dealDetail` and `products` per deal); the page shows the progress. A refresh failure stays shown until the next pull that reaches erxes.
