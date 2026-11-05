# ADR-0142: the receipt editor's tools from the best POS editors — logo, QR, receipt barcode, values, conditions

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-04 |
| Deciders | Owner («Баримтын загвар гаргадаг Tools судалж, хамгийн шилдэг tool хэрэгтэй зүйлс авч сайжруул», 2026-11-04), Claude (the direct-mode session) |
| Amends | ADR-0141 #2 (the free blocks) |

## Context

ADR-0141 gave the receipt a block editor with texts, rules and spaces. The owner asked to study the receipt editors of the best POS systems and take what is useful. What they offer: Shopify POS's visual editor (a logo of about 400 × 200, custom text blocks with a hide / show toggle per block, a receipt barcode that opens the order when scanned, a custom QR code with a title and a link, a preview by receipt type and 80 / 57 mm printer), Square (a strictly black-and-white logo up to 400 × 200, custom text for promotions and the return policy), Lightspeed (a logo per register, printed black and white), Toast (a promotional area in the footer), Dynamics 365 Commerce (receipt fields as variables, a monochrome bitmap logo, test printing before use), commercetools InStore (`{{…}}` variables, conditional sections and barcodes in templates), Loyverse (header and footer texts, a logo dropped in text mode).

## Decision

1. **Logo.** A `LOGO` block: a picture chosen in the editor is made fit for the receipt printer in the browser — at most 576 × 300 dots, on white, every dot black or white (a threshold for a logo, Floyd–Steinberg dithering for a photo) — and kept in the layout as a PNG data URL of at most 60,000 characters; width 40–100 % and alignment. It travels to the edge inside the snapshot like the rest of the layout.
2. **The store's own QR code.** A `QR` block: any text or link (≤ 300) with a caption, three sizes; separate from e-Barimt's QR.
3. **The receipt's barcode, scanned for a return.** A `BARCODE` block (at most once): Code 128 of 18 digits — `993`, the POS's id (4), the day (`YYMMDD`), the number of the day (4) and a Luhn digit — digits only, so a scanner reads it the same in any keyboard layout. Scanned at the till it opens «Буцаалт» with that sale; the edge's `GET /edge/v1/returns/sale?number=` takes the barcode as well as the printed number. `993` sits beside the coupons' `991` and the partner vouchers' `992`. The session gives the kiosk its POS's id.
4. **The receipt's values in a text.** `{{number}}`, `{{date}}`, `{{time}}`, `{{till}}`, `{{cashier}}`, `{{total}}`, `{{customer}}`, `{{member}}`, `{{points}}`, `{{store}}`, inserted by a tap in the editor; a text may also print white on black.
5. **On which receipts, on which days.** A free block (text, logo, QR, rule, space) prints on every receipt or only on a credit slip, every one but credit, a bonus card member's, a company's or a person's, and only from / to a business day (a promotion). Any optional block can be hidden without being removed. The required blocks stay unconditional.
6. **Editing.** Undo and redo (Ctrl+Z / Ctrl+Y, typing counted as one step), copying a block, back to the built-in layout, a test print of the preview on the office PC's printer at the paper's width.
7. Older layouts stay valid: the new options are optional and only written when they differ from «always, shown». No migration.

## Consequences

**Positive.** The receipt carries the store's logo, links and promotions with dates; a return starts with one scan; texts can quote the receipt's figures.

**Negative.** A logo adds up to ~45 KB to every snapshot pulled while it is in a template. A receipt reprinted from history uses the POS's current template.

## Related

ADR-0141, ADR-0110 (the `991` / `992` codes), ADR-0104 (returns at the till), ADR-0065, docs/modules/pos.md.
