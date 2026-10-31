# ADR-0132: «Бэлтгэл» in the staff app — the keeper picks their warehouse's part on the phone

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-31 |
| Deciders | Owner («Ажилтны аппын бэлтгэлийн дэлгэцийг хий», 2026-10-31; the part B left open by ADR-0126), Claude (the direct-mode session) |
| Amends | ADR-0116 #1 (who may use the staff app), ADR-0126 #2 (the pick form on the web only) |

## Context

The picking by warehouse (ADR-0126) lives on the web, in the order's «Бараа» tab since ADR-0130. The keeper walks the shelves with a phone, not a PC; the owner asked for the picking in the staff app. The app already has the store seller's transfers with receiving by scan (ADR-0116), the camera sheet, the transfer keypad and the idempotent sends to build on.

## Decision

1. **Who.** The staff app opens for the picking right `sales.orders.pick` as it does for the rep's and the seller's rights (`mayUseApp`); a keeper with only that right lands on «Бэлтгэл», a rep who also picks gets the «Бэлтгэл» link on «Нүүр», a seller who also picks finds «Шилжүүлэг» in the header of «Бэлтгэл». The transfers' screens are now behind the rep's or the seller's right.
2. **The work list.** `GET /sales-picks` (back from before 9342d36, for the phone) returns the parts of the open orders in the caller's warehouses — a lead's every warehouse —, not done or done today, soonest delivery first, each with the order's number, status, customer, delivery date and the lines in that warehouse. The phone sections them: to take (OPEN), mine (PICKING by me), others' (PICKING by someone else) and done today; the list re-reads every 15 s and on pull.
3. **The part.** One screen per order and warehouse: the customer, the part's tone and pill, the picker, the delivery date, then the warehouse's lines with the ordered quantity (and the reserved one when short), the count's badge («Тоолоогүй» grey, «Дууссан» red, «Дутуу n» orange, «Бүтэн» green) and the shelf. «Бэлдэж эхлэх» takes an OPEN part. The picker (a lead on any PICKING part) counts by scanning — `GET /barcodes/:code`, the product's line opens the keypad in the scanned unit, «Дууссан» = 0 — or by tapping a row; the base unit and the ordered pack are the keypad's units, a count is kept in base units by line while the order re-reads; a line with several shelves changes its shelf from an action sheet. «Батлах» sends every line once (`POST …/picks/:warehouseId/pick`, an Idempotency-Key per attempt): an uncounted line goes at its reserved count (the footer says how many); a line without a shelf blocks the button (the web assigns one). The same server rules as the web: one picker per part, the part row and the order row locked, a second confirmation refused, a short count the deduction (ADR-0130 #2).
5. **The work menu** (owner 2026-10-31, «цэс алга»: a keeper saw «Бэлтгэл» alone and could not find «Ирц»). Everyone but a rep gets a bottom tab bar, `app/(staff)/(work)/`: «Бэлтгэл» (the picking right), «Шилжүүлэг» (the transfer right), «Ирц» (all, ADR-0131) and «Профайл» (the profile without the rep's context, «Гарах»); a tab without the right is hidden and the first one left opens. The bar is the shop's flat bar without the scan button. A rep keeps the shop's tabs and opens «Бэлтгэл», «Шилжүүлэг» and «Ирц» from «Нүүр» as before: there the work bar is not drawn and the screens show the back arrow and the initials to the rep's profile.
4. **No offline queue.** Unlike receiving (one count per request), a part is confirmed in one request; a failed send keeps the counts on the screen for a retry.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A separate keeper app | One APK, one sign-in, the same kit; the screens are gated by right like the seller's. |
| Counting line by line to the server (as receiving does) | The web's part is confirmed at once and the server's ledger posts the part once; a queue would double the model. |
| Taking the part implicitly at the first count | The web takes explicitly; the list's «Авах» and «Миний бэлдэж буй» sections depend on it. |

## Consequences

- Staff app 0.10.0: `app/(staff)/picking/index.tsx`, `app/(staff)/picking/[id].tsx`, `src/picking/*` (the pure sections, states, units, confirmation body with Vitest), `src/api/picking.ts`.
- `sales-picking` integration suite: the keeper's work list carries only their warehouse's part.
- `docs/modules/mobile.md` §1c, `docs/modules/sales.md` §4.
