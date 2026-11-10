# ADR-0182: Supermarket price labels of ticked products, printed from the browser on three sheets

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-11 |
| Deciders | Owner (the label's content, 2026-10-14: name, supermarket price, supermarket bulk price, code, unit, date, no barcode; 2026-11-11: «Хагас баригдсан хэсгүүдийг надаас асуулт асуухгүйгээр өөрөө мэдэж хий»), Claude (the sheets) |
| Closes | ADR-0051 #4 and SPEC §11 #27 (the labels waited for the owner's template) |

## Context

The labels of ADR-0051 #4 waited for a template: a size, a printer, a layout. None came, and the content was agreed long ago. The store has an office printer today and may buy a label printer; the choice of paper should not hold the labels back.

## Decision

1. **From the «Бараа» list.** Ticking products shows «Үнийн шошго» in the selection bar; it opens `/pricing/labels/print` in a new tab, without the shell. A short list travels in the address (`?ids=`), a long one through the browser's storage under a one-time name (`?set=`), swept after a day.
2. **What a label says:** the product's name (two lines at most), the supermarket price of one base unit in large type, «N нэгж-с дээш: үнэ» when the price profile has a supermarket bulk price, the code, the base unit and the day of the prices. No barcode.
3. **The prices are today's**, read by `POST /product-prices/labels { productIds }` (`@Authenticated()`, at most 5,000 products, in the order asked): the base unit's row of the unit price table every other screen shows (`unitPriceTable`), so a label never disagrees with the till. A product without terms or without profile values today gets no label and is counted in a note above the paper. Discount programs are not on a label: they come and go by date.
4. **Three sheets, chosen above the paper and remembered on the computer:** A4 with 24 stickers of 70 × 37 mm (the default), A4 with 8 labels of 105 × 74 mm for a shelf edge, and a thermal roll of 58 × 40 mm with one label a page. Each sets its own `@page` without margins; the page says to print at 100 % without margins. Printing stays the browser's (ADR-0058).
5. **Another size is a row** in `LABEL_SHEET_SPECS` (`apps/web/src/features/pricing/price-labels.ts`): width, height, columns, labels a page. When the store's printer and sticker stock are known, the default changes there.

## Consequences

- No table, no migration, no right of its own: whoever sees the product list prints labels.
- A sticker sheet with another pitch or with margins between the stickers needs its own row; until then the dashed outlines on the screen (not printed) show where a label ends.

## Related

ADR-0041, ADR-0048, ADR-0051, ADR-0058, docs/modules/pricing.md.
