# ADR-0111: The till's payment types and payment rows, its sales history, and its day summary with a banknote count

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-27 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0109 (#1: the tender modes become payment rows; #8: the shift's entry also books transfers), ADR-0064 (#2, #4: a transfer clearing account), ADR-0065 (printing: the Windows default printer stays the mechanism) |

## Context

After trying ADR-0109's kiosk on 2026-10-27, the owner asked for three things:

1. **Coupons and vouchers.** These went to their own session.
2. **Printing and records.** «Касс эрхийн тохиргоонд printer сонгож хадгалсан байх ба шууд хэвлэгддэг байх. Касс өөрийн борлуулалтын түүх харагддаг байх. Өнөөдрийн борлуулалтын нэгтгэл хэвлэх боломжтой болго…» The owner also gave the slip's layout:
   - the till, the date, the start and print times;
   - per payment kind, «Бэлэн мөнгө нийт - 2,515,000 / ……»;
   - the cash handed over, counted per note from 20 000 down to 50, kept, with empty notes not printed;
   - «Тушаасан {касс} касс» and «Хүлээн авсан Заалны зохион байгуулагч», each with a signature.
3. **Payment step.** «Төлбөр дарахад төлбөрийн хэлбэрийн жагсаалт байх ба дарж дүн оруулдаг. Хольсон гэсэн сонголт байхгүй.» For example: Төлөх ёстой 20 000, Бэлэн 15 000, Зээл 5 000 (a customer is required). When fully paid, «Баримт хэвлэх» asks Хувь хүн НӨАТ or Байгууллага НӨАТ; with credit, the slip prints without VAT.

Interview, two rounds:
- The admin defines the payment kinds.
- A transfer is checked by the cashier, who then taps it. The money goes into the till's own account, so the books record no bank directly.
- The printer is USB, and pressing print prints at once without a window.
- The summary is per till per day, at the end of the day.
- The history is chosen by date.
- The cashier enters the counts and prints the summary.

## Decision

1. **Payment types.**
   - `pos_payment_types` (migration `0050_pos_payment_types`) holds name, kind (CASH / CARD / TRANSFER / CREDIT), sort and status.
   - At most one active CASH type and one active CREDIT type; exactly one active CASH type is required.
   - The first four are seeded by the migration and at an empty boot: Бэлэн, Khaanbank terminal, Шилжүүлэг, Зээл.
   - The admin saves the whole ordered list on «Супермаркет → Тохиргоо» (`GET/PUT /pos/payment-types`, `pos.manage`).
   - A type is never deleted, only made INACTIVE, and keeps its kind once saved.
   - The snapshot carries the active types, and the kiosk session lists them.
2. **Tenders.**
   - `TENDER_KINDS` gains TRANSFER.
   - A tender names its type: `paymentTypeId` on the kiosk request, `paymentTypeId` and `paymentTypeName` on the wire, and `pos_tenders.payment_type_id` / `payment_type_name`.
   - The edge takes the kind from the type. A tender from an older kiosk with a kind alone gets the first active type of that kind.
   - The centre checks that the type exists and has the tender's kind. An INACTIVE type still counts, because the till sold with the list it had.
   - TRANSFER is never tendered (no change) and reaches PosAPI as `BANK_TRANSFER`.
   - A partial return's replacement receipt keeps the card and transfer parts up to the new total.
3. **The payment dialog.**
   - Төлөх ёстой / Төлсөн / Үлдэгдэл (or Хариулт) are shown, with one button per type; the keys 1–9 add the type in that position.
   - A tap adds a row pre-filled with what is left.
   - Cash may exceed what it pays: the cash rows become one CASH tender with `tendered`. No other row may pass the total.
   - A CREDIT row is added once and needs its customer (ADR-0109).
   - «Баримт хэвлэх» (Enter) is enabled when the rows cover the total. Without credit it asks «Хувь хүн НӨАТ» or «Байгууллага НӨАТ» (the company found by the lookup); with credit it prints the slip without VAT at once.
   - The mode buttons and «Хольсон» are gone.
4. **The books.**
   - The new role `TRANSFER_CLEARING` maps to account 120302 «Шилжүүлгийн төлбөрийн авлага».
   - The till's transfers stay there until the accountant matches them with the bank statement (`TODO-VERIFY` with the accountant).
   - The shift's close debits it; `pos_shifts.transfer_sales` / `transfer_refunds` keep the totals.
   - A credit sale's transfer part is on its invoice (Dr TRANSFER_CLEARING).
   - The admin's shift panel lists the money by payment type.
5. **The till's history.**
   - `GET /edge/v1/sales?day=&q=` returns this till's sales and returns of a day, newest first, from `edge_sales`.
   - The kiosk's «Борлуулалтын түүх» replaces «Сүүлийн баримтууд»: a date (today by default), a search by number, a receipt shown with «Хуулбар хэвлэх».
6. **The day summary.**
   - `GET /edge/v1/day-summary?day=` gives this till's day: the first shift's opening time, the money by payment type (sales less refunds), the expected cash (the first shift's float + cash sales − cash refunds), and the latest count.
   - `POST /edge/v1/day-summary` saves the cashier's banknote counts (`DENOMINATIONS` 20 000 … 50) in `edge_day_counts` (edge migration `0005_day_counts`) and replays them once as a `DAY_COUNT` document into `pos_day_counts` (append-only, the latest shown on the shift panel).
   - It posts nothing.
   - The kiosk prints the owner's layout; notes with no count are left off.
7. **Printing.**
   - The tills keep printing from Chrome started with `--kiosk-printing` to the PC's Windows default printer, now a USB printer (runbook `docs/runbooks/pos-till-printing.md`).
   - The till record keeps a `printer_name` as information.
   - The kiosk menu has «Хэвлэгч шалгах». No print agent.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Fixed tender modes (ADR-0109's four buttons) | The owner wants the admin's list and rows («Хольсон гэсэн сонголт байхгүй»). |
| Transfers straight to a bank money account | The owner: the till's account is not booked directly; a clearing account lets the accountant match the statement. |
| Printing from the edge to the printer's IP (ESC/POS) | The printers are USB on the till PCs; the browser's default printer already prints without a window. |
| The day summary as the shift's close | A day may hold several shifts, and the owner wants one slip per till per day; the counts post nothing. |

## Consequences

**Positive.**
- The cashier enters any mix of the store's ways to pay, and the receipt choice comes at the end.
- Transfers show apart in the books and on the summary.
- The till has its own history and a signed day slip.

**Negative.**
- The transfer clearing account needs the accountant's matching.
- The printer is chosen on each PC, in Windows, not in Bto.
- The day summary's expected cash takes the first shift's float, so a day with several floats is shown as the cashier counted it.

**Follow-ups.**
- `TODO-VERIFY` (accountant): the transfer clearing account and its matching.
- The card terminal's data per terminal type stays as ADR-0065.

## Related

ADR-0064, ADR-0065, ADR-0067, ADR-0104, ADR-0109, ADR-0110 (coupons and vouchers, a parallel session); `docs/modules/pos.md`; `docs/runbooks/pos-till-printing.md`.
