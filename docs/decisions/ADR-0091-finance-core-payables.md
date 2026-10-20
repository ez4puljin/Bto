# ADR-0091: The Finance Core's payables (F3): the goods receipt is the supplier's bill, re-costings book their difference, supplier returns lower the payable, payments are manual entries

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-20 |
| Deciders | Owner (three interview rounds and the plan, 2026-10-20), Claude (Claude Code session, Finance Core F3) |
| Implements | ADR-0083 #3 (phase F3), ADR-0077 (payables before procurement), ADR-0078 #4 and #5 (the receipt's figures and payment facts reach the books), ADR-0072 #1, #2, #7 (AP classes, the party control, the manual allocation for suppliers) |
| Amends | ADR-0078 #5 (the payment method stays a note: no automatic payment for CASH / BANK), ADR-0081 (a goods issue to a SUPPLIER books an AP credit), ADR-0083's F4 scope (the receipt's stock and input VAT are booked in F3, with the bill), ADR-0090 #1 (FinReader reads payables as well as receivables) |

## Context

Erkhet stops on the go-live day (ADR-0077), so Bto's books need what the company owes its suppliers. F1 and F2 built the ledger and the intake with every class, AP_BILL and AP_CREDIT included (ADR-0089, ADR-0090), but Bto had no payable account, no supplier party and no supplier document. The goods receipt already holds everything a bill needs (ADR-0078 #4): per receipt, from its latest costing version, the payable Σ `doc_amount`, the input VAT Σ `receiptLineVat`, the stock Σ `amount`; plus the payment method and money account.

The owner answered three rounds on 2026-10-20:
1. When does a receipt become a payable? **When it gets its prices**: a fully priced receipt at «Батлах», a pending one when the accountant costs it. A later re-costing books **only the difference**, so a bill already paid is corrected too.
2. A CASH or BANK receipt? **Only the bill.** The payment method stays a note.
3. The accounts? **Temporary codes** until Erkhet's chart is imported in F5: 310101 «Дансны өглөг», 130301 «НӨАТ-ын авлага (худалдан авалт)», 140101 «Бараа материал» (TODO-VERIFY D16).
4. Due dates? **None**: a bill is due on its date.
5. Supplier payments? **Only by a manual journal entry** (asked twice): a payable line names its supplier, then «Тулгалт хийх» pairs it with the bills. Service bills (transport, rent) the same way.
6. A supplier return («Зарлага» to a supplier)? **Automatically**, at the average cost plus the supplier's VAT, left open for the accountant to pair (TODO-VERIFY D8).
7. Screens? **«Санхүү → Нийлүүлэгчийн тооцоо»** only; nothing on the receipt or supplier pages.
8. Opening supplier balances? With **F5's opening import**.

## Decision

1. **Chart, keys, types.** Three chart roles and keys join Bto's installation: `AP` (310101, control PAYABLE), `VAT_INPUT` (130301, a tax code `MN.VAT.STD` on every line), `INVENTORY` (140101). Four source-numbered document types of source BTO: `BTO.SUPPLIER_BILL` (AP_BILL), `BTO.SUPPLIER_BILL_CREDIT` (AP_CREDIT), `BTO.RECEIPT_RECOST` (JOURNAL), `BTO.SUPPLIER_RETURN` (AP_CREDIT). Migration `0035_fin_payables` (data only) writes them into an existing company with one party per supplier; a new database gets them from the boot step and the chart template.
2. **Suppliers are parties.** `supplier:<id>` under source BTO, kind COMPANY (suppliers have no kind), with the TIN and register number. Partners' `SUPPLIER_CHANGED_HOOK` (bound by fin-bridge, as the customers' hook) keeps the party in step in the supplier's transaction.
3. **The receipt books its bill through a hook.** Inventory declares `PURCHASE_BOOKS` (`receiptCostedInTx`, `supplierReturnPostedInTx`); finance's `SupplierBillsService` binds it and posts through `submitInTx` inside the receipt's or the issue's transaction, as source BTO with the staff member as the actor, so the warehouse needs no finance right and a finance refusal rolls the posting back (as a sale, D11). Nothing is booked when nothing is bound (the worker, inventory-only tests).
   - **Version 1** (the receipt gets its prices) → `BTO/GOODS_RECEIPT/<id>`, numbered as the receipt, dated the delivery note's date: Dr INVENTORY stock, Dr VAT_INPUT VAT / Cr AP payable, its item due on its date and grouped `receipt:<id>`. A receipt of free goods only books nothing.
   - **Version n ≥ 2** (a re-costing) → `BTO/RECEIPT_RECOST/<id>:<n>`, numbered `<receipt>/<n>`, dated the costing day, the difference from version n − 1: a bill when the payable grows; a credit when it shrinks, settling what is still open of the receipt's group (the group's party is locked first, `FinReader.groupOpenInTx`), the rest an open debit item; a journal when only the stock and the VAT move. The receipt's AP lines always add up to its latest payable.
   - **A supplier return** → `BTO/SUPPLIER_RETURN/<issue>`, numbered as the issue: Dr AP (cost + VAT) / Cr INVENTORY cost, Cr VAT_INPUT VAT, each line at the cost it left at (two decimals) and the receipt's VAT rule on the issue's date; it settles nothing.
4. **Payments are manual entries.** A manual journal line on a PAYABLE account names its supplier (`supplierId`; 422 `lines[i].supplierId` without it); the allocation (`POST /finance/allocations`) takes `supplierId` instead of `customerId` and pairs on key AP. No voucher kind is added.
5. **Reads.** `FinReader`'s party reads take `control: 'PAYABLE'` (balances as credit − debit, the oldest open bill's date); finance's `ApLedgerService` and `GET /supplier-balances`, `/:supplierId`, `/:supplierId/ledger`, `/:supplierId/open-items` (`finance.read`); «Санхүү → Нийлүүлэгчийн тооцоо» lists and opens them, with «Тулгалт хийх» in the supplier's sides (a payment paired with bills).
6. **The development re-post** (`pnpm finance:repost-journal`) books the bills of posted, costed receipts (at their latest version) and the credits of posted supplier returns once, skipping what the books hold.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A bill at «Батлах» for every receipt, priced or not | An unpriced receipt has no amount; a zero bill is not a document. |
| Re-costing as REVERSE + revision n + 1 | A paid bill cannot be reversed while its allocations live (`FIN_REVERSAL_BLOCKED`); the owner wants a paid bill corrected too. |
| A bill plus an automatic payment for CASH / BANK receipts | The owner chose the bill only (rounds 1 and 3). |
| A «Нийлүүлэгчид төлөх» voucher on «Төлбөр» | Offered twice; the owner chose manual entries. |
| A GR/IR clearing account between the receipt and the bill | Bto's receipt is the delivery note with its prices: the goods and the bill arrive together. |
| Waiting for D8 before booking the stock side | An AP_BILL must balance; the receipt's stock and VAT are what the bill pays for, so F3 books them and F4 the rest. |

## Consequences

**Positive.** Every priced receipt is a supplier bill the moment it is costed; the payable always equals the latest costing; supplier returns lower it; the accountant sees each supplier's balance and ledger, pays by a manual entry and pairs payments with bills by hand, like the customers'.

**Negative.** The account codes are temporary (F5 re-points the rules). A receipt dated in a closed month cannot be costed until the month is reopened (`FIN_PERIOD_CLOSED`, no close exists yet). A pending receipt's stock is not in the books until it is costed. The payment method on a CASH receipt is not booked.

**Follow-ups.** F4 books the goods issues by expense type, adjustments, stocktakes, transfers and COGS, and must leave supplier returns out (booked here). The accountant answers D8 (accounts, the return's valuation) and D16 (the chart). The opening supplier balances come with F5. Procurement (delivery 8) later sends its bills the same way.

## Related

ADR-0072, ADR-0077, ADR-0078, ADR-0081, ADR-0083, ADR-0089, ADR-0090, `docs/modules/finance-core.md` §3.9, `docs/modules/finance.md`, `docs/modules/fin-bridge.md`, `docs/modules/inventory.md`, `docs/modules/partners.md`.
