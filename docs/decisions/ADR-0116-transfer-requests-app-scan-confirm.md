# ADR-0116: Transfer requests from the staff app in groups per home warehouse, received by scan with the differences saved, and confirmed by the sending keeper (slice 2)

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-29 |
| Deciders | Owner (scope in `docs/workflows.md` §5, one question round, 2026-10-29: every proposal accepted), Claude (Claude Code session started by «Bto удирдлага») |
| Amends | ADR-0035 #1 (the statuses: COUNTED between SHIPPED and RECEIVED; every REQUEST belongs to a request header), #2 (the destination of a request counts and the source confirms; only a push is received by the destination in one step), #5 (the destination's shelf is scanned while counting); ADR-0046 (a request is also taken back as a whole, through its header); ADR-0047 #7 (a new attention count, «Батлах шилжүүлэг») |

## Context

Slice 2 of the approved order of work (`docs/workflows.md` §3): transfers cause the most errors today, after receiving. The real flow (`docs/workflows.md` §2 #3 and §5):

1. The supermarket's seller sends the request from the staff app. One request holds many products, which come from several of the Mörön warehouses.
2. Each warehouse's keeper ships their own goods; the quantity shipped may be short.
3. The store receives by scanning barcodes in the app; the differences, and goods with another barcode, are recorded there and confirmed finally.
4. The sending warehouse's keeper confirms as well.
5. Differences keep ADR-0035's rule: a shortfall goes back to the sender's stock, a surplus is taken from it. Nothing is charged to a person.

Before this decision a transfer (ADR-0035) was one source → one destination on the web, requested by the receiver, shipped by the sender and received by the receiver in one step that posted the ledger. There was no app for it, no scan receiving and no count the sender could see before the goods moved.

## Decision

### 1. A request header with groups; a group is today's transfer

- New table `transfer_requests`: the destination, the note, `status` (the lowest of its live groups), `requested_at/by`, `created_by`. It has no number.
- `transfers.request_id` links each group. A group keeps one source → one destination, its own `TR-` number and its own ledger postings, so the `TR` document of `StockPostingService`, the legs of ADR-0035 #4 and the one-document-one-status rule of ADR-0034 are untouched.
- **Every REQUEST has a header** (migration `0053` makes one for each existing request): a one-source request made on the web (`POST /transfers`, the dialog, «Бага үлдэгдэл → Шилжүүлэг хүсэх») is a request with one group. A PUSH has none.
- A request from the app is for a STORE destination: `POST /transfer-requests` groups the lines by the products' home warehouses (`PRODUCT_NO_HOME` for a product without one, `TRANSFER_REQUEST_EMPTY` without lines). Requests between the Mörön warehouses keep the web's one-source dialog (`docs/workflows.md` §5 #13).

### 2. Numbers

`TR-` per group, allocated when the request is sent (every group in one transaction, in group-id order), kept when the request is taken back (ADR-0046). Screens show a request by its groups' numbers.

### 3. Status per group

REQUEST: `DRAFT → REQUESTED → SHIPPED → COUNTED → RECEIVED`, with CANCELLED from DRAFT and REQUESTED. PUSH: `DRAFT → SHIPPED → RECEIVED`, received by the destination in one step as before. The request's status is the lowest of its non-cancelled groups (`lowestTransferStatus`; CANCELLED when every group is).

### 4. The count is saved on the server, line by line

- `transfer_lines.counted_qty_base` and `counted_at` (null until counted; 0 = «ирээгүй»), `to_bin_id` when a shelf was scanned (ADR-0035 #5 kept for a wholesale destination). `PUT /transfers/:id/counts` saves what the seller typed or scanned as they go: the phone may die, and the keeper later sees exactly what was counted.
- `POST /transfers/:id/finish-count` (SHIPPED → COUNTED, destination scope) needs every line counted (`TRANSFER_LINES_UNCOUNTED`, 409, `params.count`) and stamps `counted_at/by`. Pressed again on a counted group it answers the group as it is.
- The web's receiving editor on a request is this count step; the receipt itself is the keeper's confirmation.

### 5. A product that was not asked for

A line with `requested_qty = 0`, `unrequested = true`, `shipped_qty_base = 0` and the scanned unit (`POST /transfers/:id/count-lines`, Idempotency-Key). The confirmation posts only legs 5 and 6 for it: out of the sender's stock, into the destination. It may be removed while the group is still SHIPPED.

### 6. The confirmation posts the receipt

- `POST /transfers/:id/confirm` (source scope, Idempotency-Key, COUNTED → RECEIVED) posts the receive legs of ADR-0035 #4 with received = counted: the destination shelf as counted or suggested, a shortfall back onto the line's source shelf, a surplus out of it. `received_by` is the keeper, `counted_by` the seller.
- `POST /transfers/:id/return-count` (source scope, a reason of 1–300 characters, COUNTED → SHIPPED) keeps the line counts, clears the header's count stamps and stores `count_return_reason` for the seller, who counts again; the next finish clears it.
- `POST /transfers/:id/receive` refuses a request group (`DOC_STATE_INVALID`); it stays the push's one-step receipt.
- The home page counts the groups waiting for the keeper's confirmation (`transfersToConfirm`: COUNTED, source in scope).

### 7. Lock order

Every change of a group with a request reads `request_id` without a lock (it never changes), locks `transfer_requests FOR UPDATE`, then the group's `transfers` row. Request-level operations (send, take back, cancel, the cell save) lock the header, then each group in id order. The posting's own lock on the group follows in the same transaction. So a shipment and a take-back of the whole request never wait on each other both ways (`transfers-races`).

### 8. The request in the app

- A staff user may use the app with `sales.orders.rep` or `inventory.transfers.manage`. The rep's screens stay behind the rep's right; a seller lands on «Шилжүүлэг». `GET /transfer-requests/context` names the STORE warehouses in the caller's write scope; a keeper sees an empty state there.
- The request editor shows, beside each product (`GET /transfer-requests/rows`): its home warehouse, the stock there, the stock at the store, last month's sales at the store and its units. The draft lives on the phone until «Илгээх», which creates and sends the request with an Idempotency-Key kept until an answer.
- Receiving in the app: a scan jumps to the line and shows the shipped quantity; the arrived quantity is typed or «Ирээгүй» pressed; a known product's other barcode resolves to its line; a product not on the request is added after a question. Each count goes to the server at once, in order; the seller finishes each sender's group.
- **Last month's sales at the store** = the store's outflow: `StockPostingService.outflow` counts a STORE warehouse's till sales less the till's returns (wholesale outflow is unchanged, ADR-0115).

### 9. The cell save

A draft request's lines are saved as changed cells against the value the page opened with (slice 1's rule): a stale cell is skipped and returned in `conflicts`, a product without a home in `refused`; a new product joins its home's group, created when needed; a zero removes the line, and a group left empty is cancelled (never deleted; a cancelled group's number is never reused). The header stays a draft even with every group cancelled, so it can be filled again.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One transfer with a source per line, posted per keeper | A document posting in several steps breaks the one-number, one-status model (ADR-0034); one group per source keeps every existing posting rule. |
| Several transfers under one shared number | Two groups cannot share `transfers.number`; a suffix would change every number on paper. The groups' own numbers are what the keepers already know. |
| Counts kept on the phone until the finish (the web's `localStorage` rule, ADR-0047 #6) | The keeper must see the seller's count on another device, and a phone that dies mid-count would lose the work. |
| The destination still receiving a request in one step (as before) | The owner decided the sending keeper confirms (`docs/workflows.md` §5 #11); the wholesale-to-wholesale request uses the same steps (#13). |
| A separate app for the seller | One staff login and one app; the rep's screens are gated by the rep's right. |
| Charging a shortfall to a person | Out of scope: ADR-0035's rule stays, the sender's stock takes the difference. |

## Consequences

**Positive.** The store asks once for goods from every warehouse; each keeper ships only their own group; the count travels to the keeper before the stock moves; TRANSIT still returns to zero per line; the web's single-source flow and the push keep working.

**Negative.**
- Two steps where there was one: a request is counted, then confirmed; the stock moves only at the keeper's confirmation.
- A surplus or an unrequested product can still fail at the confirmation when the sender's shelf no longer holds it (ADR-0035's known case).
- The outflow at the store is read from the ledger on each rows page; it is cheap for a search but not cached.

**Follow-ups.** The picking app (slice 4); counts in the app (slice 5, its own interview); a transfer report; lots on transfer lines.

## Related

ADR-0027, ADR-0034, ADR-0035, ADR-0046, ADR-0047, ADR-0061, ADR-0115, `docs/workflows.md` §2, §3, §5, `docs/modules/inventory.md`, `docs/modules/mobile.md`.
