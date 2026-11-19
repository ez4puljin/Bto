# ADR-0226: Price labels drawn by the server for 80 mm receipt printers, at the staff member's till's prices

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-20 |
| Deciders | Owner (2026-11-19: staff print supermarket price labels «үнийн шошго» from the staff app on an 80 mm thermal receipt printer, «ямар нэг PC холбоотой байгаа 80mm printer», in exactly the old system's label, with the price and bulk price the staff member's till charges; only a staff member a till names as its seller may print), Claude (the brain and a `bto-core` worker) |
| Migration | `0115_printing` (two new tables, nothing else changed) |
| Supersedes | ADR-0022 for the labels (its Node print agent was never built; the bridge here is PowerShell and takes ready bytes, not a printer address); ADR-0022 stays as it is for receipts, which ADR-0065 already moved to Chrome |
| Amends | architecture §4 (a new module `printing`); ADR-0182 stays: the browser's sheets of labels from «Бараа» are unchanged |
| Related | ADR-0207 (how a till prices), ADR-0159 #5 (plans naming tills), ADR-0124 and owner 2026-11-17 (who works a till), ADR-0067 (the till server's snapshot), ADR-0199 (sharp), ADR-0212 (the scan bridge's pattern), ADR-0069 #7 (a module's own error catalog) |

## Context

The old system printed a price label per product on the supermarket's XP-80C: Erxes' «Шошго» template as HTML (`pos_label.py`), drawn by a headless browser 272 CSS px wide, scaled to the printer's 576 dots, made 1-bit and sent as ESC/POS raster with a cut after each label (`label_printer.py`). The staff know that label. Bto's ADR-0182 prints sheets from the office's browser at the supermarket's list price; it does not reach a thermal roll from a phone and does not know a till's own plans. The till server prices a product with the profile values and the RETAIL plans in force that serve that till (ADR-0207, ADR-0159 #5), so a label printed from the centre's list price can disagree with the till.

## Decision

1. **The staff app asks the api** (`/api/v1`, staff-authenticated): `GET /price-labels/tills`, `GET /price-labels/products?tillId&q` (≤ 30), `GET /price-labels/barcode/{code}?tillId`, `POST /price-labels/escpos` (the bytes for the phone's Bluetooth printer, base64), `GET /print-stations`, `POST /price-labels/print` (Idempotency-Key) and `GET /print-jobs/{id}`. Money and quantities are whole numbers in JSON; kinds and statuses are lower case.
2. **The label is the old one, drawn by the server.** `label/label-render.ts` lays out the template's boxes and text at its CSS sizes × dots/272 and draws the text with libvips' Pango (sharp's `text` input): the 2 px frame in two boxes, the name centred 16 px bold and wrapped, «code: <code>» 12/14 px bold and the date 10 px on one baseline, «Үнэ :» 18 px and the price 22 px bold (thousands with commas, no ₮), «Бөөний ширхэг <qty> Бөөний үнэ: <price>» 16/20 px shrunk by 3 % steps to one line (`_FIT_JS`), empty values without a bulk price. Arial's metrics; the font is Arial or Liberation Sans (metric-compatible, Cyrillic). Grey below 150 prints black. `label/escpos.ts`: `ESC @`, `GS v 0` in bands of ≤ 255 rows, `GS V 66 0` after each label; 576 dots for 80 mm paper, 384 for 58 mm.
3. **The price is the till's.** `TillPricesService` reads what the store's snapshot carries — every product ready for sale, its terms and its profile's values today, the RETAIL plans in force — once a minute per api process, and prices one base unit of a product alone with `resolveQuote`, taking only the plans that serve the till. The bulk price is the price a unit costs at the smallest quantity that costs less: the profile's bulk quantity or a step of the product's own quantity plan. Only the till's products count: ready for sale, priced today, and inside the till's categories when it has a list (ADR-0124).
4. **Who prints: a staff member a till names as its cashier**, in the till's list (`pos_till_users` CASHIER) or in their own list (`pos_cashier_tills`), where both lists admit them; every such active till is offered. Nobody else: `PRINT_NO_TILL` («Танд Пос тохируулаагүй байна»). No new right: being named by a till is the right, as at the till itself.
5. **Printers are print stations** (`print_stations`): `NETWORK`, an 80 mm printer with its own address, to whose port 9100 the api writes the bytes itself right after the job is written, outside any transaction; or `BRIDGE`, a printer on a Windows PC whose bridge (`tools/print-bridge`, PowerShell, installed like the scan bridge) asks `GET /print-bridge/next` (a 25 s long poll) with the station's key `bps_<id>_<secret>` (kept as a sha-256, shown once), writes the bytes RAW through winspool and reports `POST /print-bridge/jobs/{id}/done`. A station is online when its bridge called (or the api reached it) within a minute. Every staff member with a till may print to every active station.
6. **Jobs** (`print_jobs`): the bytes, the labels' count (1–100; a product's copies 1–20), QUEUED → PRINTING → DONE or FAILED with a code (PRINTER_OFFLINE, PRINTER_UNREACHABLE, PRINTER_REFUSED and the printer side's words). A job not taken in two minutes, or taken and not reported in two more, fails PRINTER_OFFLINE («Принтер холбогдоогүй байна»); this is applied whenever jobs are read, without a timer. The bytes are cleared when a job ends. Only the maker (or `pos.manage`) reads a job.
7. **The office's page «Систем → Принтер»** (`/system/printers`, `pos.manage`, the right over the store's tills): the stations with their kind, address or Windows printer, paper, last contact and online state; add, edit, disable; a bridge's install line with its key once, «Шинэ түлхүүр» for a new one; «Туршилтын шошго».
8. **Errors** are the module's own catalog (`PrintError`, registered beside Bto's as the Finance Core registers its own, ADR-0069 #7), translated in mn.json `errors.*`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A headless browser on the server, as the old system | Chromium in the api's image for one picture; Pango through sharp is already there (ADR-0199) and the picture matches the template's layout. |
| The centre's list price (`POST /product-prices/labels`, ADR-0182) | A till's own plans would be missing: the label would disagree with the till. |
| SMB or the Windows spooler from the server to the PC's shared printer | The old system's way failed on this LAN (access denied, PrintNightmare's RPC guard); a bridge that calls out needs no credentials or open ports on the PC. |
| ADR-0022's Node agent | A Node runtime on every PC for a loop of 100 lines; PowerShell is on every Windows PC. |
| A right `pricing.labels.print` | The till's own list already says who sells there; a second list to keep in step adds nothing. |
| A pg-boss job for the network send | One socket write after the job is written; a job that a process lost is failed by the same two-minute rule. |

## Consequences

**Positive.** The label the staff know, at the price the till charges, from any phone, on a LAN printer or one on any office or till PC.

**Negative.** The api's image needs a font with Cyrillic (`fonts-liberation` and `fontconfig` in `apps/api/Dockerfile`'s runtime stage); without it Pango draws nothing legible. A label takes about 60 ms to draw, so 100 different products take some 6 s. The till prices are read once a minute: a price changed in the office reaches a label within a minute, as it reaches the till server.

**Follow-ups.** The staff app's screen (`label-print-app`). The printer's paper width per station is chosen in the office; the phone chooses its own (576 or 384).
