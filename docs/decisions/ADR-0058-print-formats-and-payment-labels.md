# ADR-0058: Sales documents on A4 or an 80 mm roll; the payment method as each order's label, its author on the card

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-15 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0056 (#7: two paper sizes for the documents, the order's payment and author in their header; #8: a card shows its label and who entered it), ADR-0057 (#7: the list view gains a payment column) |
| Amended by | ADR-0059 (#3: the print buttons sit in the order panel's header) |

## Context

After ADR-0057 the owner asked for:
- an order with goods from each warehouse, its pick list («Бэлдэх падаан») showing the goods by warehouse;
- the pick list on A4 or an 80 mm printer;
- every order showing who entered it;
- a label on every order: «Зээл», «Бэлнээр».

Before this decision:
- **Pick list.** It already split its lines by warehouse, but no dev order held goods from two warehouses.
- **Paper.** One A4 layout and no `@page` rule.
- **Author.** The card named its author in small grey type after the channel; the paper did not name it at all.
- **Payment.** Every order has a payment method (`payment_method` NOT NULL: CASH, BANK_TRANSFER, CREDIT), but the cards and the list rows did not carry it.

## Decision

1. **The label is the payment method.**
   - Nothing new is stored: the label reads the method every order already has.

     | Method | Label | Colour |
     |---|---|---|
     | CREDIT | «Зээл» | orange (`warning`) |
     | CASH | «Бэлнээр» | green (`success`) |
     | BANK_TRANSFER | «Дансаар» | blue (`default`) |

   - The label is square (`rounded-md`), so it never reads as the round status pill.
   - It shows on the card beside the number, in a «Төлбөр» column of the list view, under the side panel's title, and as the «Төлбөр» row of both documents.
   - The method names follow the owner's words everywhere (the form, the filters, the label).
   - `GET /sales-pipelines/:id/cards` and `GET /sales-orders` return `paymentMethod`.
2. **The author.**
   - A card reads «Оруулсан: <name> · <channel>», the name in body colour.
   - Both documents carry an «Оруулсан» row; the side panel and the list had it already.
3. **Two paper sizes.**
   - Both documents print on **A4** or on an **80 mm roll**. One «A4 | 80 мм» switch stands before every print button: the side panel, the dialog after a move, a stage's «Баримт хэвлэх», and the printable page itself.
   - **Who remembers it:** the browser keeps the choice for every user of that computer (`localStorage tugeel.printFormat.v1`), because the printer belongs to the computer, not the person. Blocked storage means A4 until the page is closed.
   - **The address:** `?format=a4|80mm` carries the size to the printable page. The page uses the address's size first, else the computer's, and still prints itself once loaded.
   - **A4:** `@page { size: A4; margin: 12mm }`, the layout of ADR-0056.
   - **80 mm:**
     - `@page { margin: 0 }` with no size, so the roll's width and length come from the receipt printer's own driver (80 × 297 mm sheets or a continuous roll);
     - the text 72 mm wide (4 mm each side), 12 px;
     - only black: a thermal printer fades grey and browsers skip backgrounds, so dashed and solid rules separate the parts;
     - each order on its own sheet.
   - **The 80 mm pick list:** a section per warehouse under a bold «<warehouse> · N мөр». Each line takes two or three short rows: code and name; ordered quantity; reserved quantity and «☐ ____» or the picked count; the shelf once known.
   - **The 80 mm delivery note:** per line its name, then «2 хайрцаг × 12,000₮ … 24,000₮» per priced part; then the totals and the two signatures.
   - The browser draws the text and the printer's Windows driver receives an image, so Ө and Ү print. The POS receipts' ESC/POS path (ADR-0022) is not touched.
4. **By warehouse.** On both sizes the pick list keeps a section per warehouse, now with its line count; lines keep their order.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Free labels per pipeline (erxes: a name and a colour, chosen per card) | The owner named the two values, and every order already has its payment method; a second field could disagree with it. Free labels can come later. |
| The paper remembered per user | The printer stands at a computer; the warehouse PC prints the roll whoever signs in. |
| A fixed `@page` size for the roll (80 × 297 mm, or measured to the content) | Drivers differ (sheets or a continuous roll); without a size the driver's own paper applies, and a long list is never shrunk to fit. |
| 80 mm for the pick list only | One switch should mean the same beside both buttons, and a pickup's delivery note may as well come off the roll. |
| The suggested shelf on the pick list before picking | Not asked now; the dev products mostly sit on NOSHELF. Recorded as a follow-up. |

## Consequences

**Positive.**
- Credit and cash orders are told apart at a glance.
- Every card names its author.
- The warehouse prints its pick list on its receipt printer without a setting each time.

**Negative.**
- The 80 mm look depends on the printer's driver: its paper must be set to the roll, and its own setting for blank paper at the end decides how much roll is fed.
- Only the browser's preview was checked; no thermal printer was at hand.

**Follow-ups.**
- The suggested shelf (the product's default bin in the line's warehouse) on the pick list before picking.
- Free labels, if the owner wants more than the payment method.

## Related

ADR-0022, ADR-0055, ADR-0056, ADR-0057; SPEC §5.7; `docs/modules/sales.md`; `docs/ui.md`.
