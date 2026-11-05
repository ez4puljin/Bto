# ADR-0143: the wholesale documents (pick list, delivery note) laid out from templates, chosen per pipeline

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-04 |
| Deciders | Owner («Агуулахын борлуулалтын баримтын загварын тохиргоо хийдэг болго»; then «Падаан + Бэлтгэх хуудас», «Посынх шиг блок editor», «Нэг үндсэн, дамжлага бүрт сонгож болно», 2026-11-04), Claude (the direct-mode session) |
| Amends | ADR-0056 #7 and ADR-0058 (the fixed pick list and delivery note) |

## Context

«Агуулахын борлуулалт» prints two documents from the order boards, on A4 or the 80 mm roll: the pick list («Бэлтгэх хуудас») and the delivery note («Падаан»). Their layout was fixed in code. The POS receipts got a block editor the same day (ADR-0141, ADR-0142); the owner wants the same for these two documents, one template by default and another per pipeline when needed. The invoice («Нэхэмжлэх», finance) stays as it is.

## Decision

1. **Templates in the sales module.** `sales_document_templates` (kind PICK_LIST or DELIVERY_NOTE, the published layout, the draft, the version, one default per kind) and `sales_document_template_versions` (append-only), migration `0068_sales_document_templates`; the first defaults, laid out as the documents printed before, are seeded at boot. «Борлуулалт → Падааны загвар» (`/sales/document-templates`, `sales.boards.manage`): list, copy, the editor, draft → «Нийтлэх» as versions, restore, default, delete when unused.
2. **Per pipeline.** `sales_pipelines.pick_list_template_id` / `delivery_note_template_id` (null: the default), chosen in the pipeline's settings by a manager of the boards; a save without the fields keeps them. The print pages read `GET /sales/document-templates/print-layouts?pipelineIds=` (`sales.orders.read`) and draw each order with its pipeline's template.
3. **Blocks** (`@tugeel/shared/sales` `DocumentLayout`, checked by `checkDocumentLayout`): the heading (title override, company, ТТД and register number from «Компани», print time, alignment), the order's facts (each switched on or off), the lines (the kind's columns switched and ordered — product and quantity always; a pick list by warehouse or not), a delivery note's totals (required), signature lines (1–4), and the receipts' free blocks — texts with `{{number}}`-style values, a logo, a QR code, rules, spaces — with dates and hiding (ADR-0142; no receipt conditions). The paper is still chosen when printing: a template draws both A4 (a table) and the roll (short rows).
4. **One editor for every template.** The POS receipt editor's page became a shared `TemplateEditor` (`components/template-editor.tsx`): history, blocks, versions, preview, test print and the free blocks' options; each kind brings its catalogue, options and preview. Its texts live under `templateEditor` in `mn.json`.

## Consequences

**Positive.** The documents match the company's paperwork without code; a pipeline (e.g. a transfer or a regional one) can print its own; the receipts and the documents share one editor.

**Negative.** A pick list or delivery note reprinted later uses the pipeline's current template.

## Related

ADR-0056, ADR-0057, ADR-0058, ADR-0141, ADR-0142, docs/modules/sales.md.
