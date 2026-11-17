# ADR-0208: The till drives the bank's card terminal

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-17 |
| Deciders | Owner (2026-11-17, the brief «BTO кассад Хаан банкны карт уншигч (POS terminal) холбох», written from the running Erxes POS and the till PC), Claude (the direct-mode session) |
| Amends | ADR-0111 (a card payment type may drive a terminal), ADR-0109 (a card row no longer always «asks nothing») |

## Context

Until now a card payment at Bto's till was the cashier's word: the cashier keyed the amount on the bank's terminal by hand and tapped the card type; nothing tied the till's amount to what the terminal took. The Erxes POS the till replaces does it for the cashier: the till PC runs Databank's **GoConnection** Windows service (v2.1.5.199, port 27028), which speaks to Khan Bank's terminal (Q80, terminal id 70107480) on the PC's USB serial port (COM7) and answers plain HTTP/JSON on the PC's own loopback address, with CORS open. Erxes' browser calls it directly.

Read from the running system: `GET /ajax/get-status-info` answers `{"status_code":"ok","ret":{…terminal_id, terminal_name, port_num…}}` and makes no transaction; `POST /` with `{"service_name":"doSaleTransaction","service_params":{"db_ref_no","amount","vatps_bill_type"}}` answers only after the card and the PIN, and is a success only on `status` truthy with `response.response_code === "000"`; `{"service_name":"doSettlement","service_params":{"db_ref_no"}}` is a success on `response.response_code === true`; a failure of the service itself is `status` false with `response.Exception.ErrorMessage`. There is **no test mode**: every `doSaleTransaction` moves real money.

## Decision

1. **The browser on the till PC asks the terminal; no server ever does.** The address is `http://localhost:27028` on that PC (`apps/web/src/pos/khan-terminal.ts`: `checkStatus`, `sale`, `settlement`); a till PC whose service listens elsewhere keeps its address in that browser's `localStorage` (`bto.kiosk.khan-terminal-url.v1`). On the edge or the centre `localhost` is not the till.
2. **A card payment type may name its terminal** (`pos_payment_types.terminal`, `KHAN` or null; a CARD type only; set on «Супермаркет → Тохиргоо → Төлбөрийн хэлбэрүүд»; in the snapshot only when set). A type without one is paid as before. Nothing is switched on by the migration: the admin chooses.
3. **The sale is written only after the terminal approved.** At «Баримт хэвлэх» the kiosk sends each card row with a terminal to the terminal, one after another, shows «Терминал дээр картаа уншуулна уу» and cannot be closed or pressed twice; only when every such row is approved does it post the sale, whose tender names the charge (`cardAttemptId`). The edge refuses a sale on a type with a terminal that names no approved charge of exactly the tender's amount (409 `POS_CARD_NOT_CHARGED`), and a charge pays one sale once (claimed in the sale's transaction).
4. **Every charge is written before the terminal is asked** (`edge_card_attempts`, edge migration `0009_card_attempts`): PENDING with the reference the terminal is given, then how it ended — APPROVED, DECLINED (the terminal said no), FAILED (the service's Exception, or the cashier found no charge) — with **the terminal's whole answer kept as it came** (`response`, jsonb). The centre receives the terminal's id on the tender (`pos_tenders.terminal_id`, as built since 0027).
5. **A charge sent and not answered is never sent again by itself.** It stays PENDING, and a till has at most one PENDING charge (a partial unique index; 409 `POS_CARD_PENDING`), so nothing goes to the terminal until the cashier has read the terminal's paper slip and said «Баримт гарсан — төлөгдсөн» or «Баримт гараагүй — төлөгдөөгүй» (kept with `source = CASHIER` and who said it). A lost page leaves the same trace: the next payment at that till shows it.
6. **An approved charge no sale used comes back.** The payment lists it («Картаас татагдсан, борлуулалтад ороогүй гүйлгээ»): the cashier puts it into the sale being paid, or marks it «Терминал дээр буцаасан» (VOIDED) after giving the money back on the terminal by hand.
7. **The terminal is asked whether it is ready before every charge** (`get-status-info`, free): not ready means nothing is sent or written, the card type is off in the payment and says why.
8. **`db_ref_no` is digits only**: the Ulaanbaatar day and a number of this edge (`YYYYMMDD` + four digits, the sequence `CARD-REF`), the shape Erxes sends. The receipt number is not used: it has Cyrillic letters and is allocated only when the sale is written.
9. **The settlement is the cashier's button**, «Өдрийн нэгтгэл → Карт уншигчийн өдрийн хаалт», confirmed, written like a charge (`kind = SETTLEMENT`); never automatic.
10. **No automated test reaches a terminal.** `fetch` and the terminal are fakes in every test; a real charge is made only by a person, with the owner's word, for the smallest amount.

## Not verified (TODO-VERIFY, from the brief)

- **The fields of an approved answer** beyond `response_code` and `response_msg` (RRN, approval code, masked card number). No real transaction was sent; the whole answer is stored, and `pos_tenders.rrn` / `masked_pan` stay empty until a real answer shows the names — then the edge fills them from `response`.
- **`vatps_bill_type`**: the kiosk sends `1` for «Хувь хүн» and `3` for «Байгууллага», the values Erxes' `billType` holds; Databank has not confirmed them.
- **Refunds and voids**: Erxes calls none; a card refund is made on the terminal by hand, as before.
- **What `db_ref_no` a settlement wants**: the edge's reference is sent.
- **Chrome's local network permission**: a page on a LAN address calling `localhost` may be asked for once; Erxes runs under the same conditions. To be looked at again if the tills ever move to https or a public name.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| The edge (or the centre) calls GoConnection | It listens on the till PC's loopback; a server's `localhost` is another machine. |
| Record the sale first, charge after | A declined card would leave a sale to undo; Erxes records the payment only after `000`. |
| Send the charge again when no answer came | The card may have been charged: a second send could take the money twice. |
| A setting per till PC instead of per payment type | The type is what the cashier presses; a PC without the service shows the type off, and a second card type without a terminal covers it. |
| Carry the terminal's whole answer to the centre now | It would change the sale document the centre accepts while its fields are unknown; the edge keeps it, the centre's `rrn` / `masked_pan` wait for the real names. |

## Consequences

- With the type switched on, a card sale at a till with the service cannot be recorded without the terminal's approval; a till PC without the service cannot use that type (keep a card type without a terminal for it and for a day the service is down).
- A browser page left open from before the change must be loaded again once the type is switched on.
- `edge_card_attempts` is the trail for reconciliation and disputes until the answer's fields are mapped.

## Related

ADR-0109, ADR-0111, ADR-0067, docs/modules/pos.md (the store edge), `apps/web/src/pos/khan-terminal.ts`.
