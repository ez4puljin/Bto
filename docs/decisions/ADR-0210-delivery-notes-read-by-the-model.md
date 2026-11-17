# ADR-0210: «Падаан унших»: a supplier's delivery note read by the model into a draft receipt, remembered per supplier, with pages straight from a scanner

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-17 |
| Deciders | Owner (2026-11-17: «Орлого падаан оруулахад OCR хийж орлого мөрүүдийг бөглөж ноорог хадгалдаг болго. Ai-д компани бүрийн падаан загварыг ойлгож хадгалдаг байх … орлого засах эрхтэй хүн эцсийн байдлаар нягталж засвар хийх боломжтой байна. Хэрэглэгч олон падаан зураг эсвэл pdf файл оруулах боломжтой байна. Системээс шууд printer scanner ашиглаж файлаа авдаг байвал бүүр nice … хуудас нэмэх эсвэл шууд OCR хийх сонголттой»), Claude |
| Amends | ADR-0045 and ADR-0122 #7 (the model may receive PDF files; one call may ask for a longer time limit), ADR-0115 (a receipt may start from a read note), ADR-0162 (a fourth usage purpose) |

## Context

A goods receipt is typed from the supplier's paper: the supplier, the note's number and date, and a line per product with its unit, quantity and price, dozens of lines a note, several notes a day. The paper already says all of it. ADR-0122 lets the model compare an invoice photo with a purchase order, and ADR-0198 lets it fill the product registration form from photos; neither writes a receipt.

Every supplier prints its own form: other columns, quantities counted in boxes or in pieces, prices with VAT or with VAT added below, its own item codes and its own names for our products. A reader that starts from nothing every time repeats the same mistakes on the same form, and matching «Кола 0.5 /24ш/» to our product is the part a person has to do again and again.

The office has a multifunction printer; today a note is photographed with a phone, sent to a PC and then typed.

## Decision

1. **A reading is a stored proposal, never a document.** `receipt_note_readings` holds one delivery note given to the model: its pages (`receipt_note_reading_pages`, files of the new private kind `inventory.note_page`: JPEG, PNG, WebP or PDF, 10 MiB, twelve pages a reading), its status `READING → READY | FAILED`, then `SAVED` (with the receipt made of it) or `DISCARDED`, the model that answered, the proposal as JSON and, for a failure, the provider's reason, status and code. No stock and no money moves: the first thing a reading can become is a **draft** receipt.

2. **The model reads in the background.** `POST /receipt-notes` answers at once with the reading in `READING`; the api goes on outside any transaction and the screen asks again every two seconds. A long note takes minutes (the call asks for up to 280 s through the new `LlmRequest.timeoutMs`; the configured limit stays the floor), longer than a browser request should hang and than Cloudflare lets one (100 s, ADR-0188). A reading whose process was lost (an update restarts the api) is `stale` after six minutes and can be read again, as a failed one can (`POST …/:id/retry`). The outcome is written only by the run that is still the reading's latest.

3. **What the model is given and asked.** The pages in order (pictures upright and within 2000 px; PDF files as they are, a new `document` part of `LlmContentPart`: a content block for Anthropic, an `input_file` for OpenAI, refused by the Ollama client before any call), and before them: the supplier, the notes kept from that supplier's earlier readings (#6), and the supplier's products, one current product unit a row (`unitId | code | name | unit x factor`, at most 2000: the largest supplier of the day has about 950 products). It answers in a schema: the seller as printed, the note's number, date and totals, whether the line amounts include VAT, and every goods line with its page, printed name, the supplier's code, barcode, unit, quantity, unit price, amount, whether it is free, the `productUnitId` it chose from the list (or null), and whether it was unsure.

4. **The supplier is named by the person or recognised from the note.** With no supplier given, a first short call reads the seller's name and registration number from the first page; `supplierOf` takes the one active supplier whose registration or taxpayer number is that, else the one whose name is that without its company form (ХХК, ХК, …); otherwise the reading goes on without products and the person chooses the supplier at the check.

5. **Nothing of the answer is trusted.** `noteProposalOf` (pure, `services/receipt-note-ai.ts`) builds the proposal: numbers are parsed as printed numbers or dropped; a date must be a real day; a line's product is, in this order, the catalogue's product unit of its printed **barcode**, the unit a person saved this supplier's same line as before (**memory**, #6), the **model's** choice when it is on the list it was shown; else none. A line whose quantity × price is not its amount, or whose quantity did not read, is marked unsure. When the note says VAT is added below the lines and the totals look like it (a ratio up to 1.25), the line amounts are raised to the note's total, the rounding on the largest line. Text on the pages is data to the model, said so in its instructions; whatever it writes can only become a proposal a person checks.

6. **A supplier's memory, taught by people.** Saving a reading as a receipt writes, in the same transaction:
   - `receipt_note_aliases (supplier, key) → product unit`: each saved line under `noteLineKey`: the supplier's own item code with the unit when the note prints a code, else the printed name with the unit. The next note of that supplier with the same line is matched to what the person chose, whatever the model thinks.
   - `receipt_note_templates (supplier)`: the model's own notes on the form (`layoutNotes`: the columns, what the quantity counts, VAT, where the number and totals stand; at most 2000 characters, instructed to describe the form and never a delivery) and how many notes were saved. The notes go back to the model with that supplier's next note, as a hint the page overrules.
   - `DELETE /receipt-notes/memory/:supplierId` forgets both (audited); the receipts made stay.

7. **A person checks, then a draft receipt.** `/inventory/receipts/notes/:id` shows every read line beside what it becomes: a tick to leave it out, the quantity, the product with its unit and how it was matched («баркодоор», «санасан», «AI таамаг», «гараар»). A line without a product is searched in the catalogue or left out; «Ноорог хадгалах» waits until the supplier is chosen and every line going in has a product and a quantity. `POST /receipt-notes/:id/receipt` (idempotent) makes the receipt through `ReceiptsService.createInTx`: MANUAL origin, numbered at once (ADR-0153), the note's number and date, `note_total_amount` from the note's printed total, each line priced as printed (`notePriceOf`: the unit price when it makes the amount exactly, else the amount). The printed total quantity is shown but not written to `note_total_qty`: that column counts base pieces and a note may count boxes. From there the receipt is the ordinary draft of ADR-0115: edited in the receipt window, confirmed by the keepers, priced by the accountant.

8. **Prices stay with the cost right.** A reading's unit prices, amounts and total are shown only to holders of `inventory.costs.manage` (ADR-0033 #8). They are taken from the stored reading when the draft is made, never from the caller, so a keeper saves a note's prices unseen, as the paper in their hand carries them; the accountant's price check stays the only place a cost is made.

9. **Rights.** `inventory.receipts.manage` starts, checks, saves, discards and retries readings, scans, and forgets a supplier's memory; a reading and its pages can also be opened by `inventory.costs.manage`. Every receipt holder sees every open reading: one person scans, another checks. `inventory.setup.manage` keeps the scanners.

10. **Pages straight from a scanner, over eSCL.** `note_scanners` holds a name and the device's address; `POST /receipt-notes/scanners/:id/scan {source}` makes the api ask the device for a sheet and stores each sheet as a page of the caller's, returned with a small preview: «Падаан scan хийх», then «Хуудас нэмэх» or «Унших (OCR)». `integrations/scanner` speaks eSCL (AirScan / Mopria), the driverless HTTP protocol of network multifunction printers: `GET /eSCL/ScannerCapabilities`, `POST /eSCL/ScanJobs` (colour, 200 dpi, JPEG, glass or feeder), `GET …/NextDocument` per sheet until 404, 503 waited out while the lamp warms, the job deleted afterwards. The server scans because a browser cannot reach a scanner (no driver access, and an https page may not call an http device).

11. **The scanner's address is a private IPv4 address and nothing else.** `scannerUrlOf` accepts `http(s)://<10.x | 172.16–31.x | 192.168.x>[:port]` with no path, name or sign-in; the client follows no redirect and takes the job's path, never the host, from the device's `Location`. The setting can therefore not point the server at the internet or at itself.

12. **Usage.** Each call is metered as `RECEIPT_READ` (`ai_usage_purpose`), under the limits of ADR-0162; `/system/status` counts «Падаан уншуулсан». Prompts, pages and answers are never logged; the answer is kept only as the checked proposal.

Migration `0108_receipt_notes`: the five tables, the purpose check, `REVOKE DELETE, TRUNCATE` on all but the aliases (which «Мартуулах» deletes).

## What leaves the building

The pages of a delivery note (a supplier's name, registration number, our purchase prices and quantities), the supplier's product list of ours (codes, names, units) and the kept layout notes go to the model's provider, as an invoice photo already does (ADR-0122). Nothing goes to the scanner but the request to scan; nothing else is new.

## Alternatives considered

- **A local OCR engine (Tesseract, PaddleOCR) and rules per supplier.** Mongolian Cyrillic print, stamps over the table and a different form per supplier make hand-written rules the work this feature removes; the vision model reads the table as a table and the per-supplier knowledge is two small tables it and the people fill.
- **Waiting for the answer in the request** (as ADR-0122 and ADR-0198 do). A many-page note outlasts Cloudflare's 100 s and an update's restart would lose it without a trace.
- **A pg-boss job in the worker.** The worker has no model gateway (ADR-0198); a background promise with a stored status and a retry needs no new process wiring. If readings ever queue, the job is the next step.
- **Saving the draft without a check.** A line without a product cannot be a receipt line, and a wrong match would teach the memory a mistake.
- **Letting the model match against the whole catalogue.** Thousands of rows per call; the supplier's own products are the right short list, and the barcode and the memory need no model at all.
- **Scanning from the browser** (TWAIN/WIA through a helper on each PC). A program to install and keep alive on every office PC; eSCL needs none and works from any PC, tablet or outside address the web runs on.
- **Fine-tuning or storing example pages per supplier.** Notes in words and line aliases are small, readable, forgettable and enough to try first.

## Consequences

**Positive.** A note becomes a draft receipt in the time it takes to check it; the same supplier's next note needs fewer corrections; a keeper can scan and an accountant check; the paper's pages stay with the receipt (the receipt window links to them).

**Negative.** A reading costs model tokens (a three-page note is roughly ten thousand input and a few thousand output tokens) and is a reading, not a count: the keeper's confirmation and the accountant's price check stay the record. The layout notes are written by the model from a supplier's document and return to it later: they are bounded, instructed to hold no delivery data, and can only shape another proposal a person checks. A scanner without eSCL, or one plugged into an office PC by USB only, cannot be driven from the server; files and photos still work. Not yet tried against the real model or a real scanner (none answered on the building's network on the day it was built): the rules, the routes and the eSCL exchange are tested with scripted ones.

**Follow-ups.** The owner's walk with real notes of several suppliers, and what the model misreads; the scanner's address once the device is on the network (or its USB shared with `ipp-usb` on this PC); the same screen in the staff app with the phone's camera; a product that is not in the catalogue yet registered from the check screen; discounts printed on a note.

## Related

ADR-0033, ADR-0045, ADR-0078, ADR-0115, ADR-0122, ADR-0153, ADR-0162, ADR-0188, ADR-0198; `docs/modules/inventory.md`, `docs/modules/ai.md`, `docs/architecture.md` §9.
