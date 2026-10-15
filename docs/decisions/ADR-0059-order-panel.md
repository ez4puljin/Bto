# ADR-0059: The order panel: an erxes-like deal view where the order is read, edited, moved and filled

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-15 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0055 (the order pages: the editor and the read view become the panel; a new order starts from its customer), ADR-0056 (#8: the side sheet becomes the panel; the activity names who moved a card), ADR-0057 (#7: a card and a list row open the panel; «+» and «Шинэ захиалга» open the create dialog), ADR-0058 (#3: the side sheet's print buttons move to the panel's header) |

## Context

The owner showed erxes's deal view twice: a panel over the right three quarters of the screen with Overview, Properties and Activity on the left plus a Products plugin, a stage dropdown beside a row of stage steps, the deal's fields, a description, and the activity («gereet.aguulah moved from "Баримт хэвлэх" to "Бэлдсэн захиалга"»). The request: «Sales цонх дээр захиалга руу ороход ингэж харагддаг болго. Барааны жагсаалт дээр агуулахаар шүүж харах, барааны нэр болон кодоор хайх гэх мэт боломжтой болгоно.»

Before:
- **Opening an order.** A card opened a narrow side sheet; editing happened on a separate page (`/sales/orders/:id`) that edited drafts only. A confirmed order could be edited through the API (ADR-0056 #4) but not on screen.
- **Activity.** The history listed state changes without names; stage moves were not shown.
- **New orders.** They were entered on a separate page, header and lines together.

The owner's answers (2026-10-15, one round):
- **Editing.** Both the products and the header are edited inside the panel.
- **Fields.** No extra erxes fields: no assignee, priority, tags or attachments.
- **Product filters.** By warehouse, by name or code, and «Бэлтгэсэн эсэх».
- **New orders.** As in erxes: the customer first, then the panel to add the products.

## Decision

1. **The panel.**
   - **Shape.** A wide sheet from the right (about 80 % of the screen, the whole screen on phones).
   - **Header.** The number, the customer with board / pipeline, the status badge, the payment label, «Архивласан». Then the paper switch and the documents (ADR-0058) and «⋯»:
     - «Илгээх» for a draft outside every pipeline;
     - «Архивлах» / «Сэргээх»;
     - «Цуцлах» with a reason.
   - **Sections** on the left: «Ерөнхий», «Мэдээлэл», «Бараа», «Бэлтгэх» (pickers, CONFIRMED or PICKING), «Түүх». On phones they are a row of tabs.
   - **Address.** The work page keeps the open order and section in its URL (`?order=&tab=`).
   - **Unsaved edits.** The editing sections stay mounted, so edits survive a change of section. Closing with unsaved edits asks first, and moving the stage waits until they are saved.
2. **«Ерөнхий».**
   - **Stage steps.** The pipeline's visible stages as steps (passed ones ticked, the current one marked) beside a stage select. A step the user may move into moves the order by the board's rules: a CANCEL stage asks its reason, and the stage's documents are offered afterwards.
   - **Facts as chips:** customer, delivery date, fulfilment, payment label, the board's branch, board / pipeline, who entered it and when, total.
   - The note, then the five latest activity entries.
3. **«Мэдээлэл».** The header read first (`DetailCard`), edited in place while the order may change: a draft, or confirmed before picking, by the stage's EDIT holders.
   - Fields: fulfilment, delivery date, address, contact, payment, note. The customer stays.
   - Saving sends the stored lines with the new header. A confirmed order is priced and reserved again (ADR-0056 #4), and the form says so.
4. **«Бараа».**
   - **Filters:** a search by name or code (the shared `matchesQuery`), the warehouse, and picked or not. All three filter in the browser (≤ 200 lines).
   - **Columns:** code and name, warehouse, unit, quantity, unit price (by part when a line is split), amount, reserved, backordered, picked.
   - **Editing.** While the order may change, units and quantities are edited in place and products are added (the product search) and removed. «Хадгалах» sends them with the stored header.
   - **Prices** come from the rules only. A confirmed order nobody is editing shows its frozen prices; otherwise a quote of the lines (`POST /pricing/quote`, read again 300 ms after a change) is shown as an estimate.
   - A product that may not be sold (or has no home warehouse) is flagged and blocks saving.
5. **«Түүх».** Newest first:
   - who created the order and the stage it landed in;
   - every stage move (««ХТ Захиалга» шатнаас «Нярав Хяналт» руу зөөсөн»);
   - every change of state with its reason;
   - the archiving.

   The order's events and moves carry `actorName`, and moves carry `fromStageName` / `toStageName` (archived stages keep their names).
6. **New orders.**
   - «Шинэ захиалга» and a stage's «+» open a dialog on the work page (`?new=1&stage=`), as erxes adds a deal.
   - The dialog asks for the customer, the payment (default «Бэлнээр») and the pipeline; from «+» it shows the fixed stage.
   - It creates the draft at once: numbered, no lines, a pickup for tomorrow. The panel then opens on «Бараа».
   - The old addresses redirect: `/sales/orders/new` to the dialog, `/sales/orders/:id` to the panel.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep the side sheet and the order page | The owner asked for erxes's view; one place to read, edit and move an order. |
| erxes's assignee, priority, tags, attachments, checklist | Not wanted (the owner, 2026-10-15). |
| Edit the unit price in the panel (erxes does) | Prices come from the rules only (ADR-0041, no manual discounts). |
| Save header and products in one form | The two sections are edited apart; each save sends the other part as stored, so neither waits for the other. |
| Create the order with its lines in the dialog | erxes creates the deal first; the number exists at once (ADR-0057) and the products are added where they are listed. |
| Filter the lines on the server | An order has at most 200 lines; the browser filters them with the shared search rule. |

## Consequences

**Positive.**
- One place to read, edit, move, print and archive an order.
- Confirmed orders can be edited on screen until picking.
- The activity says who moved what.

**Negative.**
- Empty drafts appear when a dialog is confirmed but no products follow; they can be cancelled or archived like any draft.
- The panel holds more code than the sheet.

**Follow-ups.**
- Payments in the panel come with finance (delivery 3).
- Moving an order between pipelines (ADR-0057) is still open.

## Related

ADR-0041, ADR-0055, ADR-0056, ADR-0057, ADR-0058; SPEC §5.7; `docs/modules/sales.md`; `docs/ui.md`.
