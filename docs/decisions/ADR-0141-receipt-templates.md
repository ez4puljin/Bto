# ADR-0141: receipt templates laid out from blocks in the office, chosen per POS

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-04 |
| Deciders | Owner («Пос баримтын загварыг өөрчилдөг болго … Баримтыг загварыг бүхэлд нь хийдэг Editor хийнэ»; then «Блокоор, гэхдээ пос бүр дээр баримтыг загвар арай өөр байж болно», «Борлуулалт + буцаалт», «Нэг загвар, пос бүрт сонгож болно», 2026-11-04), Claude (the direct-mode session) |
| Amends | ADR-0065 (the receipt's fixed layout: only a heading and a closing line were the store's) |

## Context

The till's receipt was drawn by one fixed component: the store could change only its heading and closing line (`pos_settings`). The owner wants to lay the receipt out as a whole, and a POS may print a slightly different receipt from another. The receipt carries what the e-Barimt rules and the books need — the seller and its TIN, the ДДТД, the lines, the totals with VAT, the payments, the lottery and the QR code, a credit slip's signature — and a template must not be able to lose them. Templates are edited in one place and must reach the stores' edges, which may be offline.

## Decision

1. **Edited at the centre, carried by the snapshot, drawn by the kiosk.** «Супермаркет → Баримтын загвар» (`pos.read` reads, `pos.manage` changes). The published layouts travel in the edge's snapshot (`receiptTemplates`, each till's `saleTemplateId` / `returnTemplateId`); the edge resolves the POS's layouts into `GET /edge/v1/session` (`receiptLayouts`); the kiosk draws and prints the receipt from them. No edge migration: the snapshot is one JSON document.
2. **A layout is blocks.** `ReceiptLayout` (`@tugeel/shared/pos`): the paper (80 mm or 58 mm, printed 72 / 48 mm wide), a base text size and up to 40 blocks in print order. Locked blocks — exactly once, moved and set but never removed: the heading (title over the seller; the TIN and the copy, credit, test and return banners automatic), the receipt's facts (number and time always; the POS and the cashier optional; the buyer, credit customer and ДДТД whenever there), the lines, the totals with VAT, the payments, the e-Barimt part, the credit signature. At most once: the bonus card, the closing line. Free: texts (align, size, bold), rules (dashed, solid, double), spaces. `checkReceiptLayout` is the one check the api and the web share.
3. **One template per kind of receipt.** A template is a SALE or a RETURN receipt's. One default of each kind (seeded at boot from the receipt as it printed before) serves every POS that chose none; a POS chooses another of the same kind on «Пос».
4. **Draft, publish, versions.** The admin's edits are saved as a draft; the POS keep printing the published layout. «Нийтлэх» makes the draft the next version (kept in `pos_receipt_template_versions`, append-only); the edge takes it on its next pull. An older version can be brought back as the draft. A template a POS uses, or the default, is never deleted.
5. Migration `0067_pos_receipt_templates`: `pos_receipt_templates`, `pos_receipt_template_versions`, `pos_tills.sale_template_id` / `return_template_id`.

## Consequences

**Positive.** The owner lays out receipts without a developer; a POS can print its own variant; the legally required parts cannot be dropped; a bad change is undone by restoring a version.

**Negative.** A receipt reprinted from history uses the POS's current template, not the one it first printed with. Images (a logo) are not supported yet.

**Follow-ups.** A logo block when the owner asks for one (it needs an image carried to the edge).

## Related

ADR-0065, ADR-0067, ADR-0109, ADR-0112, docs/modules/pos.md.
