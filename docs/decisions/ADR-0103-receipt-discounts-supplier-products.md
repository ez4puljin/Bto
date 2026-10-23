# ADR-0103: Receipt discounts on chosen lines and on the note, free goods in their own list, the supplier's products first, a line per add

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-23 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0099 (#3 the line panel: the supplier's products first, no merging, no «Бонус» switch, the weight and the last price as a hint; #4 the discount: several discounts in their own section instead of one in the header), ADR-0078 #2 (free goods are added from the discounts section) |

## Context

The owner tried the window of ADR-0099 (merged as PR #17, 3840e5c) the same day and asked:

1. Choosing the supplier should make the product search show **that supplier's products by default**, with a switch to **all products**; the **weight** should show; **the same product may be added more than once**.
2. **The last receipt price as a hint under «Нэгж үнэ»**.
3. **No discount in the header.** Under the lines, a **«Хөнгөлөлт, урамшуулал»** section with «Нэмэх»: **free goods** («Урамшуулал бараа», given free), **a discount on chosen products**, or **a discount on the whole note**.

Answers (2026-10-23): the supplier's products are **every product linked to it** (main or additional supplier); a product taken from all products is **linked to the supplier** (at posting); a scan or «Нэмэх» **always makes a new line**; the weight **in the panel and as a table column**; a discount on chosen products is **one percentage or amount spread over the chosen lines by amount**; **any number** of such discounts plus a note discount, **the line discounts first, the note discount on what remains**; free goods are **a product and a quantity in their own list**. The owner allowed taking the next free numbers; the coordinator had meanwhile reserved ADR-0100 … ADR-0102 and migrations 0039 … 0041 for other work, so this is ADR-0103 with migration `0042`.

## Decision

1. **Discounts in their own table.** `goods_receipt_discounts` (receipt, kind `LINES` | `NOTE`, a percentage in (0, 100] or an amount > 0, at most one `NOTE` per receipt) with `goods_receipt_discount_lines` (the chosen lines; deleting a line drops it, cascade). Migration `0042_receipt_discounts` carries a header discount of 0038 into a `NOTE` row and drops `goods_receipts.discount_pct` / `discount_amount`.
2. **Allocation** (`allocateReceiptDiscounts`, `@tugeel/shared/inventory`): each `LINES` discount on the sum of its chosen priced lines (a percentage of it, or the amount), spread over them by amount (`allocateReceiptDiscount`, the remainder on the largest); then the `NOTE` discount on what the priced lines keep after those, spread by that remainder. A discount above its base, or two line discounts taking a line below zero, is `RECEIPT_DISCOUNT_TOO_LARGE` at posting and at costing; the draft shows `totals.discountTooLarge`. Each line's total share is the valuation's `discount_amount` (ADR-0099 #4); the books and `bookFacts` are unchanged.
3. **API.** `PUT /receipts/:id/discounts` (cost holders, drafts) replaces the list (line discounts name priced lines of the receipt that are not free goods). `PUT /receipts/:id/costs` takes an optional `discounts` list replacing the receipt's. The detail and the costing return `discounts` with each one's tugriks.
4. **Free goods** are lines with `free_goods` added from the section (a product, a unit, a quantity; no price), listed there and left out of the main table; still cost holders only (ADR-0078 #2).
5. **The supplier's products first.** `GET /products/lookup?supplierId=` keeps the products linked to that supplier through the segments' resolver (partners owns the links); with a supplier an empty search lists them by name. The panel has «Энэ нийлүүлэгчийн бараа | Бүх бараа», the first by default once a supplier is chosen.
6. **The posting links the supplier.** Each line product not yet linked to the receipt's supplier is linked to it in the posting's transaction (`ProductSuppliersService.linkInTx`; a product's first link becomes its main supplier).
7. **A line per add.** The window no longer adds to an existing line of the same product and unit; a scan of the product the panel holds still counts one more there.
8. **The panel** shows the weight per piece and for the quantity, and the last receipt price as a hint under «Нэгж үнэ»; the lines table has «Жин (кг)».

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep the header discount and add line discounts on the lines | The owner wanted the discounts out of the header, in one section with the free goods. |
| A discount per line (each its own % or amount) | The owner chose one discount spread over chosen lines; a different discount per line is several line discounts. |
| The note discount on the gross total, in parallel with the line discounts | The owner chose the line discounts first, the note discount on what remains. |
| Linking the supplier when the line is added | A draft may be cancelled; the posting is when the goods really came from that supplier. |

## Consequences

**Positive.** Delivery notes with promotions are typed as printed: free goods, product discounts and a note discount; the search starts from the supplier's own products and teaches the links as receipts are posted.

**Negative.** A posting may add product ↔ supplier links (audited by partners); a discount typed before the prices may only be checked at posting.

## Related

ADR-0032, ADR-0049, ADR-0078, ADR-0099, `docs/modules/inventory.md`, `docs/modules/catalog.md`, architecture §4.
