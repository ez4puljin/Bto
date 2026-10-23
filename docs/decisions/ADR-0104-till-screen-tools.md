# ADR-0104: The till's tools: F7 quick buttons from the admin, F8 price check, a search by barcode and code, voids approved by a supervisor's PIN and logged at the centre, parked baskets per till, returns by receipt number refunded in cash

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-23 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0067 (#9: the kiosk's screens gain the tools below; the snapshot gains the quick groups and the printed barcodes; the edge's database gains migration `0001_till`), ADR-0063 (#4: the edge replays a new document kind, `VOID`) |

## Context

The owner (2026-10-23): «Касс дэлгэц асааж, хөгжүүлэлтийг сайжруулах». The development database had been rebuilt with the real product master (ADR-0098), so the store edge was paired again first (a new edge server SM1 «Супермаркет» on S1, till К1, a new token in `deploy/edge/.env`; the snapshot brought the 12,818 sale-ready products with their prices). Then four interview rounds:

- The owner signs in at the till as the admin for now. Receipt printing and e-Barimt are wanted, but there is **no printer and no PosAPI box yet**, so POS S3 (ADR-0065) stays blocked; a company's TIN at the till waits for PosAPI too («PosAPI-г хүлээ»).
- Search, speed and scanning: a better search (price, unit, barcode, code in the results), **a price check**, **quick buttons** for goods without a barcode, **chosen by the admin**, opened by a key, the same on every till.
- Payment: the cash buttons and the cash-plus-card split asked for already exist (S2); the owner tries them before asking for more.
- **A supervisor's PIN** for a return, for removing a line or lowering a quantity, and for cancelling a cart; **every such void listed for the admin**.
- **Parked baskets**, called back **only on the till that parked them**.
- **Returns by the receipt's number**, the money given back **always in cash**.

## Decision

1. **Search and price check.** The edge's search puts a typed barcode first, then an exact SKU, then the strict and the phonetic name matches as before (Latin ↔ Cyrillic). The snapshot's units carry their printed barcodes (`codes`, beside the lookup keys), the kiosk shows code · unit · barcode · price in each row. «Үнэ шалгах» (F8) takes a scan or a search and shows every unit's price and barcodes without touching the cart.
2. **Quick buttons.** The centre keeps `pos_quick_groups` and `pos_quick_buttons` (a product unit with an optional label, ordered; migration `0043_till_screen`); the admin edits them on «Супермаркет → Товчнууд» and saves the whole set at once (`PUT /pos/quick-buttons`, audited); at most 12 groups of 60 buttons. The snapshot carries the sellable ones (`quickGroups`); the kiosk's «Хурдан товч» (F7) shows the groups as tabs and the buttons with today's price; a press adds one and the panel stays open. No pictures yet: thumbnails live on the centre and the till reaches only the edge.
3. **Approval.** A supervisor is a cashier holding `pos.till.supervise` (the role «Ахлах кассчин»); at the till they pick their name and type their PIN, checked offline against the snapshot like a sign-in, with the same five-tries lock. The signed-in cashier may approve their own action when they are a supervisor (the owner works alone for now). The store's existing setting `supervisorRequired` turns the PIN off for voids and returns alike; voids are logged either way.
4. **Voids.** Removing a line, lowering a quantity (−, a smaller number typed, or Delete) and cancelling the cart call the edge first (`POST /edge/v1/voids`); the cart changes only after the edge accepted. The edge values the goods at today's prices, keeps the void (`edge_voids`) and replays it as the new document kind `VOID` (the sync log's CHECK gains it). The centre keeps it append-only in `pos_voids` / `pos_void_lines` (REVOKE UPDATE, DELETE, TRUNCATE and the `forbid_update_delete` triggers, like the tenders) and lists it on «Супермаркет → Хасалт» with the cashier, the approver, the till, the reason, the lines and the sum. Stock and money do not move: nothing left the store.
5. **Parked baskets.** «Түр хадгалах» (F9) keeps the cart on the edge (`edge_parked`: its lines, the value when parked, a preview of the first names), at most 20 per till; «Хадгалсан сагс» (F10) lists only this till's baskets; «Дуудах» brings one back into an empty cart and prices it again; «Цуцлах» drops it as a `CART_CANCELLED` void with the approval. A basket outlives the shift; the shift close only says how many wait.
6. **Returns.** «Буцаалт» (F4) finds a sale the edge made by its receipt number (a Latin «K» finds till «К1»), shows each line with what is left to return after earlier returns on the edge, and refuses past the store's return window. The cashier types the quantities (a damaged item goes to DAMAGED), the supervisor approves, and the edge writes a RETURN under the till's own number series: the sale's unit price, the line's discount shared out by quantity (the rest of a line takes the rest of its discount), VAT at today's rate, one CASH tender of the total. The centre's existing accept path (ADR-0063 #5) checks it again and posts the goods back; the edge's shift figures now show the returns and take the cash refunds out of the expected cash, as the centre already did.
7. **Keys and screens.** F4 return, F6 search, F7 quick buttons, F8 price check, F9 park, F10 parked baskets, F12 payment; the right column gets four buttons for the same tools, the menu the return and the baskets. Every text is in `posKiosk.*` / `pos.*`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Quick buttons chosen per till by the cashier | The owner wants the admin to choose them, the same on every till. |
| Voids recorded only in the kiosk (no centre table) | The owner asked for the list in the admin, to watch for losses; the edge already replays documents in order. |
| Voids as part of the next SALE document | A cancelled cart has no sale; a separate append-only log is simpler to read and to guard. |
| Parked baskets shared by every till | The owner chose the parking till only. |
| Refunds by the way the sale was paid | The owner: always cash (the card terminal's own refund is done by hand there). |
| Approving with the PIN alone, without picking the supervisor | A PIN is hashed per user; matching one PIN against every supervisor's hash is slow and ambiguous. |

## Consequences

**Positive.** Goods without barcodes sell in two presses; customers' price questions no longer touch the cart; every removal from a cart carries a name and is visible at the centre; a customer who went back for something does not block the line; returns no longer need the centre's test till.

**Negative.** A return already paid out in cash may still be refused by the centre (it appears among the rejected documents for the admin to fix); the edge can return only sales it made (not the centre's test till's); every removal now needs a supervisor at the till while the setting is on; a centre older than this change refuses a batch with a `VOID` in it, so the centre is updated before the edge (both run from the same commit here).

**Not built (blocked or later).** Receipt printing, e-Barimt and a company's TIN at the till (POS S3, ADR-0065 stays reserved: no printer, no PosAPI box); product pictures on the buttons; the Aclas scale's weight barcodes; a barcode on the receipt for the return's search.

## Related

ADR-0063, ADR-0064, ADR-0065 (reserved), ADR-0067, ADR-0097, ADR-0098, `docs/modules/pos.md`, `deploy/edge/`.
