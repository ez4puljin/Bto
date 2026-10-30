# ADR-0122: Truck loads by line, a trucks page, late products on the order, and the AI's check of a supplier's invoice

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-30 |
| Deciders | Owner («нийлүүлэгчийн захиалсан бараануудын заримыг өөр машинд хуваарилах», «системд таниулсны дараа захиалга дээр нэмж оруулах, машинд сонгох», «хувиарлагдаагүй нийлүүлэгч болон бараануудыг шүүж машинд хуваарлах», «падааны зургыг оруулахад AI ашиглан нийт дүн барааны тоог тулгах», 2026-10-30), Claude (the direct-mode session) |
| Amends | ADR-0121 #4 and #5 (a supplier rode whole on one load; now its lines ride on one or several), ADR-0121 #3 (trucks get a page), ADR-0045 (the model may receive images) |

## Context

ADR-0121 put whole suppliers on trucks, the same morning. Trying it, the owner named four things the dispatcher really does: part of a supplier's goods goes on one truck and the rest on another; a supplier ships goods the system never knew, which are registered and then must join the order and a truck; the unassigned suppliers and products must be found with a filter and loaded; and when the supplier's final invoice arrives as a photo, the AI should read it and compare the total and the product counts with the order, naming every difference with an explanation. Trucks also needed a page of their own, and a deactivated truck must keep showing on the orders it carried.

## Decision

1. **Loads by line.** `purchase_order_load_lines` holds a quantity of one order line on one load, in the line's own unit (boxes); the sum over the loads of a line never exceeds its ordered quantity (`PO_LOAD_OVER`, 422). `purchase_order_suppliers.load_id` of ADR-0121 goes (the migration turns each whole-supplier assignment into one load line per ordered line). A supplier therefore rides on zero, one or several loads; the detail's supplier carries `loadIds[]` and `loadedBoxes`; a load carries `items[]` (line, supplier, product, qty) and `truckActive`.
2. **Two ways to load.** `PUT …/suppliers/:supplierId/load {loadId}` puts a whole supplier on a load — every quantity of its lines still off any truck — and `{null}` takes all of it off every load (the quick action of the panel). `PUT …/loads/:loadId/lines {lines: [{supplierId, productId, qty}]}` sets what the load carries of each named line (0 takes the line off; at most 500 lines per call). `GET …/load-lines?q&supplierId&unassigned` lists the order's lines with their supplier, product, unit, ordered quantity, what rides on which load and what is left, searched by code, name or supplier, 200 a page — the «Бараагаар хуваарилах» dialog: a load is picked, the lines narrowed to a supplier, the unassigned or a search, the quantity for this load typed per line (capped at what is left), «Үлдсэнийг бүгдийг энэ машинд» fills the rest, one save.
3. **Trucks page** `/procurement/trucks` («Машинууд» in the «Татан авалт» group): the list with the inactive ones on request, a dialog to register or change a truck, activation and deactivation (`PATCH /procurement/trucks/:id {isActive}`). A deactivated truck is offered for no new load, but every load it carries keeps its name, marked «идэвхгүй»; the order's history keeps the truck's name in the audit rows.
4. **Late products.** A product the supplier shipped without an order is registered in the catalog first (with this supplier as its main supplier, the rule of ADR-0115) and then added from the supplier's card: «Бараа нэмэх» searches the supplier's products, takes a quantity and a unit and saves through the grid's save (the editable statuses up to «Замд», the rights of ADR-0118), so the history shows who added what; the new line then loads like any other. No rule of ADR-0115 changes: nothing adds another supplier's product to a supplier.
5. **The history** (ADR-0118 #6) reads the loads: `LOAD_ADDED` / `LOAD_REMOVED` (the truck's name), `LOADED` (a whole supplier onto a truck, or a product's quantity on a truck, before → after), `INVOICE_CHECKED` (the invoice total and the model's summary).
6. **The AI's invoice check.** `purchase_order_invoice_checks`: the photo (a private file of kind `procurement.invoice_image`, 5 MiB, uploaded by order managers, orderers and cost holders), the model that answered, the invoice total it read, the order's estimate for the supplier at the time (Σ ordered × last receipt price per base unit, price readers only), the structured comparison (`result`: the invoice's lines matched to the ordered lines, each MATCH / QTY_DIFF / PRICE_DIFF / NOT_ORDERED / MISSING / UNREADABLE with both sides' figures and a note, plus a summary in Mongolian) and, on a provider failure, its reason. `POST …/suppliers/:supplierId/invoice-checks {fileId}` runs one check synchronously (503 `AI_NOT_CONFIGURED` while no model is set): the file is attached in one transaction, the model is called with the photo and the ordered lines between transactions (ADR-0045 §3.1 rule 6, `invoice-check-flow.service.ts`), the result is stored in a second. Managers, the supplier's orderer and cost holders run it; order readers read the checks (the amounts for price readers). The prompt and the raw answer are never stored or logged (ADR-0045 #7); the comparison is business data and is kept. «Падаан шалгах» on the supplier's card uploads the photo and shows the last ten checks: totals side by side, the differing lines highlighted, the model's explanation, the photo in a new tab.
7. **Images in a model request.** `LlmMessage.content` may be parts: text and images as base64 with their media type. The Anthropic client sends content blocks, the OpenAI Responses client `input_image` data URLs, the Ollama client the text with `images` beside it. The assistant of ADR-0045 keeps sending text.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keeping whole suppliers (ADR-0121) and noting the split in the note | The owner splits suppliers over trucks; the note gives no totals, no capacity, no history. |
| A `load_id` on the order line (one truck per line) | The owner's case is part of a line on each of two trucks. |
| Adding any catalog product to any supplier of the order | ADR-0115 keeps a supplier's order to its main products; the owner registers the product with its supplier first, which the dialog says and links to. |
| A pg-boss job for the invoice check | One photo, one call of about a minute at most; the orderer waits for the answer on the card (as the assistant of ADR-0045 does); a job would need polling and a result screen. |
| Letting the model read the invoice without the ordered lines | The matching by name is the whole value; the lines give it the codes, units and quantities to compare. |

## Consequences

**Positive.** The dispatcher's plan matches what the trucks really carry; the unassigned goods are one filter away; a late product joins the order and a truck without leaving the page; the invoice comparison names both sides of each difference.

**Negative.** The invoice check needs a model key (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, api `.env`) — until the owner sets one the button answers «AI тохируулаагүй»; the model's reading of a blurred photo is a reading, not a count: the keepers' counts at «Ирсэн» stay the record. The estimate against the invoice uses last receipt prices (ADR-0115), not a quotation.

**Follow-ups.** Receiving by truck in the staff app; the invoice check's lines offered as the shipped quantities at «Ачигдаж байна», on the owner's word; a trucks' capacity in boxes beside kg if the owner asks.

## Related

ADR-0045, ADR-0115, ADR-0118, ADR-0121, `docs/modules/procurement.md`, `docs/modules/ai.md`.
