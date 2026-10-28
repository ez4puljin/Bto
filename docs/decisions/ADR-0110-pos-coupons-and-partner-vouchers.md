# ADR-0110: The till's discount coupons and partner vouchers — printed batches, one use per code, the partner billed the face value

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-27 |
| Deciders | Owner, Claude (Claude Code session) |

## Context

The owner asked on 2026-10-27: «Voucher, coupon ашиглах боломжтой байна. Ашигласны дараа төлбөр төлөх цонх гарч ирдэг байх.» SPEC §11 #26 had left vouchers and coupons open («хэн гаргах, хэдэн төгрөг, хэзээ хүртэл, касс эсвэл захиалгад»).

The supermarket's till already prices a cart with the RETAIL discount programs (`resolveQuote`, ADR-0048), takes cash, card and CREDIT (ADR-0109), and sells offline from the store edge (ADR-0063, ADR-0067). The edge is the store's single server, so it can enforce one use per code for every till, offline too.

The owner's answers, in five rounds on 2026-10-27:
1. Three things are meant:
   - a **discount coupon**;
   - a **partner voucher**, which another organisation gives its people and the store bills it for afterwards;
   - a **bonus card** for registered customers, using phone + PIN, points, and tiers by spend (1 % up to 10 M, 2 % from 20 M). The bonus card goes to its **own later session**.
2. The **admin creates and prints** batches in Bto, with barcodes. They print **A4 with 10 cards per page**.
3. A code is used **once, whole**.
4. A coupon is a **percentage or tugriks, chosen per batch**. It comes off the basket after the other discounts.
5. A partner voucher is **billed after use**, to the partner registered as a customer. Each sale's use is invoiced **automatically**.
6. The partner pays the voucher's **full face value**: a 50,000 ₮ voucher spent on 42,000 ₮ is billed 50,000 ₮.
7. A sale with a partner voucher gets a **VAT receipt to the buyer**, «Хувь хүн» or «Байгууллага» as usual. The partner's invoice gets no second receipt.
8. **Supermarket till only**: no wholesale orders, rep app or «Bto300».
9. A batch has **validity dates**. Using codes needs **a supervisor's PIN once per sale**.
10. **Any number** of codes per sale. Bto caps it at 20.
11. The **voucher part is never paid back**: a return beyond what was paid in cash or by card is refused, and an exchange happens at the shelf.
12. **No credit and partner voucher** in one sale. A coupon with credit is fine.

## Decision

1. **Batches and codes at the centre** (`modules/pos`, migration `0049_pos_vouchers`).
   - `pos_voucher_batches`: kind COUPON / PARTNER; name; effect PERCENT / AMOUNT (a partner voucher is AMOUNT, its face value); value (0 < p ≤ 100, or whole ₮ up to 10 M); `customer_id` (PARTNER only, an ACTIVE customer); `valid_from` / `valid_to` (Ulaanbaatar days); qty (≤ 1000); status ACTIVE / STOPPED.
   - `pos_vouchers`: one row per printed code; ISSUED until a sale takes it, then REDEEMED with the sale, the time and the amount.
   - A code is 16 digits: `99`, a kind digit (1 coupon, 2 partner), 12 random digits from `crypto.randomInt` and a Luhn check digit (`voucherCodeOf`, `parseVoucherCode` in `@tugeel/shared/pos`).
     - No GTIN (8/12/13/14 digits) or scale label can be one.
     - A wedge scanner types it the same on a Latin or Cyrillic keyboard.
     - It is printed as Code 128 (set C).
   - Batches are stopped, never deleted: `REVOKE DELETE, TRUNCATE` on all three tables.
   - Routes:
     - `GET/POST /pos/voucher-batches` (`pos.read` / `pos.manage`, the POST idempotent), `GET /:id` (with codes and uses), `POST /:id/stop`;
     - `GET /pos/sale-vouchers`, `POST /pos/sale-vouchers/:id/review`.
   - Admin screens «Супермаркет → Купон, ваучер»: the list, `?new=1`, the `?batch=` panel, A4 2×5 cards and the partner's «Ашигласан жагсаалт» print.
2. **The feed.** The edge pulls `GET /api/v1/pos/sync/vouchers?since=` beside the customer feed, every pull.
   - It carries every ISSUED code of an ACTIVE batch not past its last day, with the batch's terms and partner, under a content-hash version.
   - The edge keeps it in `edge_state.vouchers` (edge migration `0004_vouchers`).
   - A stopped batch's codes leave the tills at the next pull.
3. **At the till** (the edge):
   - `GET /edge/v1/vouchers/:code` answers the code or 422 `POS_VOUCHER_INVALID` with `reason`: UNKNOWN, USED, NOT_YET, EXPIRED, STOPPED, or NOTHING_DUE (a partner voucher with nothing left to pay).
   - `POST /quote` takes `codes`, in scan order.
     - **Coupons** are a fifth stage of the shared resolver, after the order programs. Each comes off the amount the earlier ones left, a percentage per part and tugriks split by amount (`QuoteContext.coupons`). Each applied entry carries the code, so the discount sits inside the lines' `discountAmount` and the centre, e-Barimt and returns need no new arithmetic.
     - **Partner vouchers** then pay the total in scan order, each its face value or what is left (`voucherPayments`).
     - The quote answers `vouchers`, `voucherTotal` and `due`.
   - `POST /sales` takes `codes` and `voucherApproval` (a supervisor's id and PIN, checked like a void's; 403 `POS_SUPERVISOR_REQUIRED` without it, always).
     - The edge prices again and derives one **VOUCHER tender** per partner voucher. The kiosk's own tenders make the `due`, and are none when it is 0.
     - Credit beside a partner voucher is 422 `POS_VOUCHER_WITH_CREDIT`.
     - In the sale's transaction the edge reads its uses again and inserts one `edge_voucher_uses` row per code. The code is the key, so a second sale of the store is refused 409 `POS_VOUCHER_USED`, offline too.
   - `POST /edge/v1/approvals/check` lets the kiosk check the PIN before the payment.
4. **The kiosk.**
   - «Купон, ваучер (F2)», or a code scanned on the sale screen, opens the voucher dialog. Each code is checked by the edge and the whole cart's quote, and listed with what it takes off or pays and «Төлөх дүн».
   - «Төлбөр рүү» asks for the supervisor's PIN once, then **opens the payment dialog with what is left**:
     - the codes are listed above it;
     - «Зээл» is hidden beside a partner voucher;
     - with nothing left, only the receipt choice and «Баримт хэвлэх» remain.
   - The receipt shows the coupons and «Ваучер» among the payments.
5. **e-Barimt.** The buyer's receipt covers the whole sale at the discounted prices. The voucher part goes as a payment under `VOUCHER_PAYMENT_CODE` = `CASH` (**TODO-VERIFY** with the accountant and ITC: PosAPI has no voucher code we know of).
6. **The centre accepts every sale** (ADR-0063 #5).
   - Shape checks:
     - every VOUCHER tender is a partner voucher of `doc.vouchers` for its amount;
     - a coupon's amount equals what its code took off the lines;
     - no credit beside a partner voucher;
     - a return takes no codes.
   - The codes and their batches are locked after the customer, before the shelf, and the partners they bill are locked after them.
   - A code already REDEEMED, a stopped batch or a sold day outside the dates is **kept** with its issue in `pos_sale_vouchers`. It is counted as `vouchersToCheck` in `/pos/attention` and marked «Шалгасан» by `pos.manage`.
   - An unknown code or a face value that differs from its batch is a permanent rejection.
   - `pos_sales.voucher_total` keeps the vouchers' part (CHECK: SALE only, never with credit). `pos_tenders.voucher_id` names the code (CHECK: VOUCHER ⇔ a code).
7. **The books** (temporary codes until D16; **TODO-VERIFY** with the accountant).
   - The sale stays a till sale, booked at the shift's close. The close gains Dr **VOUCHER_CLEARING** (120303 «Ваучерын тооцоо») for the vouchers' tenders (`pos_shifts.voucher_sales`).
   - Per sale and partner, `PosVoucherBillingService.chargeInTx` writes one **lineless invoice** for the full face value, due on the partner's settlement day, with no VAT and the codes in its note. It is posted as `BTO.SALES_INVOICE`:
     - Dr AR (the open item);
     - Cr VOUCHER_CLEARING for what was used;
     - Cr **VOUCHER_BREAKAGE** (511040) for the unspent rest.
   - A code with an issue is not billed: its amount stays in the clearing for the office to settle.
8. **Returns.** A return of a sale with vouchers gives back at most its cash and card less earlier returns (`voucherSaleRefundable`). Beyond that it is 409 `POS_RETURN_VOUCHER_PART` with `refundable`, on the edge and at the centre. A coupon's discount is already shared on the lines, so a coupon sale's return pays back the discounted price. A code is never given back.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A coupon as a discount program with a code | Programs apply to everyone and have no use count; the till needs a single use per printed code and its own order after the programs. |
| A partner voucher as CREDIT to the partner (ADR-0109) | Credit sales get no e-Barimt; the owner wants the buyer's VAT receipt (answer 7). |
| Billing only the amount used | The owner: the partner pays the face value (answer 6). |
| One monthly invoice per partner | The owner: automatic per sale (answer 5); the statement groups them anyway. |
| Codes with letters | A Mongolian keyboard layout changes what a wedge scanner types; digits are the same on every layout. |
| A store credit (a new coupon) for a voucher sale's return | More state on the edge offline; the owner chose no refund of the voucher part (answer 11). |

## Consequences

**Positive.**
- The admin prints codes, the till takes them with one PIN, and the payment opens for the rest.
- Partners are billed at once, on their statement and in the aging.
- Double use is impossible inside the store, offline too.

**Negative.**
- Invoices without lines exist. The print page and the lists show their total and note.
- The VAT on a voucher's unspent rest and the PosAPI payment code are unknown until the accountant answers.
- A code with an issue leaves its amount in the clearing until the office settles it by hand.

**Follow-ups.**
- The bonus card (members, phone + PIN, points, tiers): its own session (owner, 2026-10-27).
- `TODO-VERIFY` (accountant, ITC): the payment code, the VAT on the breakage, the accounts (D16).
- The `ai.pos_*` views (S4) show the vouchers.

## Related

ADR-0048 (programs), ADR-0063, ADR-0064 (amended: #2, the close's VOUCHER_CLEARING), ADR-0065, ADR-0067, ADR-0090, ADR-0101, ADR-0104, ADR-0109; `docs/modules/pos.md`; SPEC §5.7, §6.6, §11 #26.
