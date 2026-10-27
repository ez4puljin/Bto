# ADR-0065: POS S3: real e-Barimt receipts from the store's PosAPI on the LAN, printed from Chrome to the till's 80 mm printer; the lottery and the QR only in the edge's memory

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-26 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0022 (the supermarket's tills print with the browser through the printer's Windows driver, not through a print agent; the agent stays planned for the label printer's phase 2), ADR-0063 (#1: the edge talks to the store PosAPI on the LAN; #4: `RECEIPT_STATUS` documents are replayed), ADR-0067 (#1 and #8: `EBARIMT_PROVIDER=posapi` beside `fake`; the edge's migration `0002_ebarimt`; #9: the kiosk prints), ADR-0017 and architecture §5.9 and §9.1 for the supermarket (the store PosAPI is reached on the store LAN, not over Tailscale; the edge issues the receipts, not the centre's worker), SPEC §6.6 rule 9 |

## Context

POS S1 and S2 (ADR-0063, ADR-0064, ADR-0067) and the till's tools (ADR-0104) built the till with test receipts: no ДДТД, nothing printed. S3 had waited for a printer and a PosAPI box. On 2026-10-26 the owner said printing is no problem — every till PC is Windows with its 80 mm receipt printer installed as a Windows driver, and today the cashier prints from Chrome's dialog — and asked to connect to the store's running PosAPI on the Ubuntu PC at 192.168.1.254.

A read-only `GET /rest/info` (the only call made to it in this session without the owner's word) found PosAPI 3.2.50 on port 7080 (SQLite, one merchant — the company —, the old till vendor as its operator, about 13,300 lotteries left, receipts sent to the tax office the same day); ports 7000 and 7001 are the old till software's pages. The edge container reaches both PosAPI and the tax office's public taxpayer lookup (`api.ebarimt.mn`).

The owner's answers (five rounds, 2026-10-26):

1. PosAPI is `:7080`. At go-live the 192.168.1.254 PC is retired: PosAPI will run on the Ubuntu PC that runs the Bto edge. Until then Bto **shares** the running PosAPI with the old till, changing nothing on that PC; in S5 a new PosAPI on Bto's own Ubuntu is **activated by the old vendor** (its operator).
2. Test with a fake PosAPI first, then **one small real sale and its same-day return**, each live call only after the owner's yes.
3. **Print straight away**: Chrome on the till starts with `--kiosk-printing` and the 80 mm printer as the Windows default (no dialog); without the flag the dialog still works.
4. A reprint with the lottery and the QR only for **the till's last receipt**; any other reprint is a copy («ХУУЛБАР»).
5. A receipt a customer never took (the next day): **decided later**.
6. PosAPI away: the sale completes, the slip says the e-Barimt is waiting, the edge **issues it automatically** when PosAPI is back and the till can print it **once** with the lottery and the QR. A call that may have reached PosAPI and went unanswered is never sent again by itself: a supervisor checks it.
7. A company's receipt (B2B) is built now: the cashier types the registration number or TIN, the name comes from the tax office's lookup; **offline there are no company receipts**.
8. The receipt's heading is the store's name, its closing line a thank-you, both set by the admin.
9. One store district code and one default classification code, typed by the owner from the old till's settings; a product's (or its category's) own classification code wins. No product has one yet.
10. The cash drawer is opened with its key.
11. PosAPI's sending to the tax office: watched (last send, lotteries left) and a supervisor's button now; the nightly automatic send in S5.
12. Returns: everything back → the receipt is cancelled; part back → the receipt is replaced by one for the goods kept.
13. The wholesale centre runs on an external server and the store PosAPI sits on the company's internal (Univision) line: whether the wholesale e-Barimt uses it is open.

## Decision

1. **The store PosAPI on the LAN.** The edge's `EBARIMT_PROVIDER=posapi` talks to PosAPI 3.0 at `POSAPI_URL` (`http://<PosAPI PC>:7080`) on the store's LAN; nothing reaches it from outside the building and nothing on the PosAPI PC is changed. The `fake` provider stays for development and tests. Tests only ever talk to a fake PosAPI (`test/harness/fake-posapi.ts`).
2. **Two phases, never an HTTP call inside a transaction.** The sale's (or the return's) edge transaction writes its PosAPI operations into `edge_receipts` (edge migration `0002_ebarimt`): ISSUE for a sale, and for a return either CANCEL (nothing of the sale is left) or an ISSUE that replaces the receipt in force (`inactiveId`) with one for the goods kept. Right after the commit the cashier waits for one try (`POSAPI_TIMEOUT_MS`, 20 s); a loop every 10 s tries what is left, in order, an operation waiting for the receipt it changes. An operation is claimed (`SENDING`) before its call, so two callers never send it twice; one found `SENDING` at boot is INDETERMINATE (an ISSUE) or sent again (a CANCEL).
3. **What a failed call means.** The client uses a fresh connection per call (`node:http`, no keep-alive) so it knows whether the connection was ever made. No connection (refused, unreachable, nothing within 3 s) = NOT_SENT: PosAPI cannot have acted, the receipt is sent again automatically. `ERROR`/`PAYMENT` from PosAPI = certainly not issued: tried again with back-off for a day and listed with PosAPI's message. A timeout or a cut answer after the connection = INDETERMINATE: **never re-POSTed by the edge**; a supervisor looks it up on ebarimt.mn and records «Гарсан» (the ДДТД and date) or «Гараагүй» (a new operation is queued). A cancellation can always be sent again: it never makes a receipt.
4. **The lottery and the QR only in memory** (CLAUDE.md NEVER, architecture M3). `PosapiClient` hands them to `PrintableCache`, the edge process's memory, never the database, a file or a log: each till's **last** receipt (reprinted with them until the till's next sale or its shift's close) and each **late** receipt (issued by the loop; printed once, or dropped at its till's shift close). The kiosk gets them only in the answer of the sale, the return and `GET /edge/v1/receipts/:id/print`, keeps them in React state only to draw the receipt, and drops them once printed. A restart forgets them: every reprint is then a copy. The sale's stored receipt, the outbox, the centre and the audit never carry them (a test scans every table of both databases).
5. **Receipt facts to the centre.** The SALE document carries `ebarimt.status = PENDING` (NONE with the fake provider); each change of a sale's or a return's own receipt is a `RECEIPT_STATUS` document (a fresh client id each; the sale's client id and `status`, `ddtd`, `posapi_date` verbatim, `inactive_id`; no `billIdSuffix`) applied to `pos_sales` and audited. A replaced or cancelled receipt is CANCELLED; a full return has no receipt of its own (NONE). «Супермаркет → Борлуулалт» filters by the status; `/pos/attention` counts the sales whose receipt failed or went unanswered.
6. **The request.** `buildPosapiReceipt` (`@tugeel/shared/mn`, pure, for every system): B2C_RECEIPT or B2B_RECEIPT with the buyer's TIN, the merchant's TIN from `/rest/info` (exactly one merchant), the merchant's branch number at PosAPI (`EBARIMT_BRANCH_NO`, digits, required with `posapi`: PosAPI refuses a receipt whose `branchNo` is missing or not numeric; the old till sends "01") and the PosAPI's own `posNo` from `/rest/info`, the store's district code, one sub-receipt per tax type (the catalog's `vat_type`; VAT_FREE/VAT_ZERO with the product's tax product code), items tax-inclusive after the line's discount with the unit's printed barcode (GS1, or UNDEFINED with an empty `barCode` for a unit without one), the classification code (product → nearest category → the store's default) and the unit's name (`ш` when none), payments CASH and PAYMENT_CARD; Σ items = Σ sub-receipts = Σ payments is checked before sending; money is written as JSON numbers from `Decimal` (`posapiJson`). PosAPI numbers the receipt; no `billIdSuffix` is sent (its behaviour with a shared PosAPI is unknown, a spike item).
7. **The store's settings** (central migration `0047_pos_ebarimt`): `pos_settings.receipt_title`, `receipt_footer`, `ebarimt_district_code` (4 digits), `ebarimt_classification_code` (7 digits), in the snapshot with each product's `vatType`, `taxProductCode` and resolved `classificationCode`. Without a district code a receipt is refused before sending (listed as ERROR). `pos_edge_nodes` keeps what the edge's heartbeat reports of PosAPI (`/rest/info` every 5 minutes): version, `lastSentDate` verbatim, lotteries left, when, the error; «Касс» warns after a day without a send or under 500 lotteries.
8. **A company's receipt.** `GET /edge/v1/ebarimt/taxpayer?no=` turns a 7-digit registration number into the TIN (`getTinInfo`) and finds the name (`getInfo`) on the tax office's public lookup (`EBARIMT_LOOKUP_URL`), cached for 10 minutes; offline it answers `EBARIMT_LOOKUP_UNAVAILABLE` (503) and the sale is a citizen's. The sale takes `buyer: { tin }` and looks it up again (from the cache) before its transaction.
9. **Printing.** The kiosk prints the receipt right after a sale or a return with `window.print()`: a sheet beside the app (`@page { margin: 0 }`, 72 mm wide; the paper size is the printer driver's), everything else hidden while printing. It shows the store's heading, the seller and its TIN, «ХУУЛБАР» on a copy, a waiting / to-check / failed / cancelled notice, the buyer's TIN and name, the ДДТД, the lines, totals and VAT, the replaced receipt on a return, the lottery after «Сугалаа» and the QR code as crisp squares (`qrcode-generator` 2.0.4), and the closing line. «Дахин хэвлэх» asks the edge, which decides between the last receipt and a copy. Chrome on the till runs with `--kiosk-printing` (`docs/runbooks/pos-till-printing.md`).
10. **The supervisor's «e-Баримт».** The kiosk's menu (a badge while something waits) lists the late receipts to print, the unanswered ones to check, the refused ones with PosAPI's message and those still waiting, PosAPI's last send and lotteries left, and «Татвар руу илгээх» (`GET /rest/sendData`). Deciding on a receipt and sending to the tax office take a supervisor's PIN while the store asks for one.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| The ESC/POS print agent of ADR-0022 | Every till already prints through its Windows driver; an agent is a deployable per till for what Chrome does. |
| Storing the lottery and the QR (encrypted) for any reprint | The NEVER rule and ITC's «QR код хадгалахгүй»; the owner chose the last receipt only. |
| Re-POSTing a timed-out receipt automatically | It may already exist: two receipts for one sale. Only a call that never connected is sent again. |
| `billIdSuffix` to make a retry idempotent | Its behaviour is unverified and the PosAPI is shared with another system; recorded as a spike for the live test. |
| A second PosAPI now on the owner's PC or Bto's Ubuntu | Needs an operator's activation; sharing the running one changes nothing and the address is configuration. |
| The centre issuing the store's receipts | The centre is on an external server; the store PosAPI is on the internal LAN and the tills must work offline. |

## Consequences

**Positive.** The tills issue real receipts offline from the internet (PosAPI keeps lotteries and sends later); an outage of PosAPI never stops a sale and never makes a double receipt; the printout is the browser's, the same on every till; returns keep the tax office's books right; the centre sees each receipt's state.

**Negative.** A late B2C receipt reaches its customer only if they come back while the till's shift is open; a reprint after the next sale or a restart has no lottery; an unanswered call waits for a person; while the PosAPI is shared, the old till's receipts and Bto's draw on one lottery pool.

**Verified live (2026-10-27, each call on the owner's yes).** One small sale on the dev till against the shared store PosAPI: the first try was refused (`branchNo` must be numeric, three attempts, no receipt), the fix above went in, and the one resend was issued (a 33-digit ДДТД, `posapi_date` stored verbatim, CONFIRMED at the centre); the late receipt printed once with its lottery and QR from «e-Баримт»; its same-day full return sent one `DELETE`, accepted at once (CANCELLED at the centre, the return NONE). A scan of both databases, the edge's log and the api's log found no lottery or QR. The partial return (`inactiveId`) and a B2B receipt were not tried live.

**Open items.** The new PosAPI on Bto's Ubuntu activated by the old vendor (S5); a missed receipt's re-issue (`inactiveId`) to verify with the vendor or ITC; the wholesale centre's e-Barimt reachability (the centre is external, the PosAPI internal); the `billIdSuffix` spike and whether PosAPI accepts a B2B TIN while the internet is down; `reportMonth` and `consumerNo` at the till; the card terminal's data on `PAYMENT_CARD`; the nightly automatic `sendData` (S5).

## Related

ADR-0017, ADR-0022, ADR-0063, ADR-0064, ADR-0067, ADR-0074, ADR-0104, `docs/modules/pos.md`, `docs/architecture.md` §5.9, §9.1, §9.4, §10.2, `docs/runbooks/pos-till-printing.md`.
