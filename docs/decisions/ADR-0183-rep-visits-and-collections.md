# ADR-0183: The rep's weekly round, visit log and collected money

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-11 |
| Deciders | Owner (2026-11-11: «Хагас баригдсан хэсгүүдийг надаас асуулт асуухгүйгээр өөрөө мэдэж хий»; the rep app's v1 left out «visit plans» and «payments», ADR-0061), Claude (the shapes below) |
| Amends | ADR-0061 (the rep app's scope: visits and collected money join it) |

## Context

The rep app takes orders and shows a map coloured by the last order (ADR-0068), but a rep had no list of where to go today, the office had no record of who went where, and money a rep took at a store reached the books only when someone told the accountant. The rule that only the accountant's voucher records a payment stands (CLAUDE.md, ADR-0080).

## Decision

1. **A weekly round.** `rep_visit_plans` holds, per rep and ISO weekday (1 = Monday), the stores in visiting order. The office sets it on «Борлуулалт → Айлчлал» (`PUT /rep-visits/plans/:userId/:weekday`, `sales.orders.manage`; reading with `sales.orders.read`); a rep may set their own through `PUT /sales-rep/plan/:weekday`. A day is replaced as a whole, audited with the stores before and after; at most 200 stores a day, active customers only.
2. **A visit is one row, written once** (`rep_visits`, `REVOKE DELETE`): the rep, the store, the business date, the time and what it came to — `ORDERED`, `NO_ORDER`, `CLOSED` or `PAYMENT` — with a note. A store may be visited again the same day; the day's list shows the last one. No location is taken: the round and the orders already say where a rep works, and attendance keeps its own punches.
3. **Today's list** (`GET /sales-rep/visits/today`) is the weekday's stores in plan order with the day's visit, then the stores visited outside the plan. Any active customer may be visited.
4. **The office's log** (`GET /rep-visits`, `/rep-visits/summary`, `sales.orders.read`): every rep's visits by rep, store and days, newest first, and the count of each result.
5. **Collected money is a report, never a payment.** `POST /sales-rep/collections` (`sales.orders.rep`, `Idempotency-Key`) writes `rep_collections`: store, amount, cash or transfer, note — `PENDING`. It changes no balance, no invoice and no book. The table is finance's, because finance may read sales and not the other way round.
6. **The accountant decides once** («Санхүү → Цуглуулсан төлбөр», `finance.payments.record`): «Орлого бичих» chooses the cash or bank account and the day, and in one transaction writes an ordinary customer payment voucher (`PaymentsService.recordInTx`, the rep as `collectedBy`, the oldest invoices settled first, source key `rep-collection:<id>`) and marks the report `RECORDED` with the voucher's id and number; «Татгалзах» marks it `REJECTED` with a reason the rep reads. A decided report is refused a second decision (409 `DOC_ALREADY_POSTED`). A wrong voucher is voided like any other; the report keeps naming it.
7. **The staff app 0.18.0**: «Цэс → Ажил → Айлчлал» for the holder of `sales.orders.rep`, among the first favourites. «Өнөөдөр» lists the round with «N / M», a tap opens the visit sheet (four results, a note; «Төлбөр авсан» asks the amount and cash or transfer and sends the report before the visit, each with its own idempotency key), «Өөр дэлгүүр нэмэх» finds a store outside the round. «Төлбөр» lists the rep's own reports of the last 60 days with what became of each.

## Consequences

- Migration `0098_rep_visits`: `rep_visit_plans`, `rep_visits`, `rep_collections` (the last two `REVOKE DELETE, TRUNCATE`).
- The accountant's list is the single place where field money enters the books; nothing is posted from a phone.
- Not built: the plan edited in the app (the API exists), a visit's GPS point, a map of the day's round, visit targets and their report, returns taken by a rep.

## Related

ADR-0061, ADR-0068, ADR-0060, ADR-0080, docs/modules/sales.md, docs/modules/finance.md, docs/modules/mobile.md.
