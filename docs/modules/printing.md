# Module `printing` — contract (price labels on 80 mm printers, ADR-0226)

A staff member a till names as its cashier prints supermarket price labels from the staff app: the old system's label, drawn by the server, at the price and bulk price that till charges today. The bytes go back to the phone (its Bluetooth printer), to an 80 mm printer on the LAN, or to a printer on a Windows PC through its print bridge.

Status: the api side, the print bridge and the office's page, built 2026-11-20. The staff app's screen is the task `label-print-app`.

- **Code:** `apps/api/src/modules/printing/`; the bridge in `tools/print-bridge/`; the office's page in `apps/web/src/features/printing/`; the guide's article `apps/web/src/features/guide/content/system/10-price-labels.md`.
- **Decisions:** ADR-0226 (everything here), ADR-0207 and ADR-0159 #5 (how a till prices), ADR-0124 (a till's lists), ADR-0069 #7 (the module's own error catalog).
- **Tests:** `src/modules/printing/label/label-render.spec.ts` (the label and its ESC/POS; writes `tmp/labels/sample-label.png`), `test/integration/printing.int-spec.ts`.

printing depends on these modules, always through their `index.ts`; nobody imports printing:

- `identity`: the route decorators, `AuditService` (the stations), the foreign key to `users`.
- `catalog`: `CatalogService.posCatalogue` (what the store's snapshot sells), `CategoriesService.subtreeIds`.
- `pricing`: `ProductPricesService.inForce`, `PriceProfilesService.versionsInForce`, `DiscountProgramsService.inForce`, `ProgramTargetsService.productSets`; the pure `resolveQuote` and `programServes` of `@tugeel/shared/pricing`.
- `pos`: `PosTillsService.list` (a till's lists and categories), `PosCashiersService.tillsByCashier`; the foreign key to `pos_tills`.

## 1. Owned tables (migration `0115_printing`)

| Table | Holds |
|---|---|
| `print_stations` | A printer: `name` (1–80), `kind` BRIDGE / NETWORK, `host` and `port` (NETWORK: both), `key_hash` (BRIDGE: the sha-256 of the whole key `bps_<id>_<secret>`), `printer_name` (the Windows printer the bridge last named), `width_dots` 576 / 384, `status` ACTIVE / DISABLED, `last_seen_at`, `created_by`, `created_at`, `updated_at` |
| `print_jobs` | A print: `station_id`, `till_id` (the till whose prices; null for the office's test label), `payload` (the ESC/POS bytes, null once ended), `labels` 1–100, `status` QUEUED / PRINTING / DONE / FAILED, `error` (exactly when FAILED: a code, optionally «: » and the printer side's words), `created_by`, `created_at`, `picked_at`, `finished_at` (exactly when ended). Partial index of the QUEUED ones per station |

The app's role may not DELETE or TRUNCATE either. The store seed leaves both empty.

## 2. Services

| Service | Use |
|---|---|
| `TillPricesService.search(till, q)`, `byCode(till, code)`, `items(till, productIds)` | the till's products at its prices today (`LabelItem`: name, code, barcodes, base unit, `price`, `bulkQty`, `bulkPrice`): the snapshot's inputs read once a minute per process, one base unit priced alone with the RETAIL plans that serve the till; the bulk price is a unit's price at the smallest quantity (the profile's bulk quantity or a step of the product's own quantity plan) that costs less. Search: a barcode, an exact code, then names that match strictly, then by sound, then barcodes containing the digits |
| `PriceLabelsService.tillsOf(ctx)`, `till`, `search`, `byCode`, `escPos`, `stationsFor`, `print`, `test` | who may print (§3), the labels' bytes (≤ 100 labels), queueing on a station, the office's test label |
| `PrintStationsService.list / get / active / create / update / newKey / authenticate / touch` | the stations; a key is made with the row and shown once; `authenticate` checks a bridge's key in constant time and marks the station seen |
| `PrintJobsService.create / get / next / finish / expire` | the jobs: a NETWORK job is sent right after it is written (`label/raw-socket.ts`, outside any transaction, 8 s); `next` is the bridge's long poll (`FOR UPDATE SKIP LOCKED`); `expire` fails the late ones (§4) and runs whenever jobs are read |
| `label/label-render.ts` `renderLabel(face, widthDots)`, `labelPng`; `label/escpos.ts` `labelEscPos` | the label (ADR-0226 #2) and its bytes |

## 3. Rules

- **Who.** A staff member is the till's when the till's own list (`pos_till_users` CASHIER) or theirs (`pos_cashier_tills`) names them and both lists admit them (an empty list admits everyone); only ACTIVE tills. None: `PRINT_NO_TILL` (403); a till not theirs: `PRINT_TILL_NOT_YOURS` (403).
- **What.** Products ready for sale and priced today, inside the till's categories when it has a list. Anything else: `PRINT_PRODUCT_NOT_FOUND` (404).
- **How many.** 1–100 products, 1–20 copies each (422 VALIDATION_FAILED otherwise), at most 100 labels a print (`PRINT_TOO_MANY_LABELS`, 422, `params.count`, `params.limit`).
- **Online.** A station whose bridge called, or that the api reached, within 60 s.
- **Late jobs.** QUEUED for 2 minutes, or PRINTING for 2 minutes since taken: FAILED `PRINTER_OFFLINE`.
- **Fonts.** The api's image must have Arial or Liberation Sans (`fonts-liberation`, `fontconfig`).

## 4. REST surface (`/api/v1`)

| Route | Access | Notes |
|---|---|---|
| `GET /price-labels/tills` | authenticated + a till | `[{ id, code, name, storeName }]` |
| `GET /price-labels/products?tillId&q` | authenticated + that till | ≤ 30 `{ productId, name, code, barcodes[], unit, price, bulkQty, bulkPrice }`; empty `q` → `[]` |
| `GET /price-labels/barcode/{code}?tillId` | authenticated + that till | one item, or `PRINT_PRODUCT_NOT_FOUND` |
| `POST /price-labels/escpos` | authenticated + that till | `{ tillId, items: [{ productId, copies }], widthDots? }` → `{ data (base64), labels }`, 200 |
| `GET /print-stations` | authenticated + a till | `[{ id, name, kind: bridge/network, online }]` (the active ones) |
| `POST /price-labels/print` | authenticated + that till, Idempotency-Key | `{ tillId, stationId, items }` → `{ jobId, labels }`, 201 |
| `GET /print-jobs/{id}` | its maker or `pos.manage` | `{ id, status: queued/printing/done/failed, error, detail, labels }` |
| `GET /printing/stations` | `pos.manage` | the office's list (with host, port, printerName, widthDots, status, lastSeenAt, createdAt) |
| `POST /printing/stations` | `pos.manage`, Idempotency-Key (the key is not stored in the replay) | `{ name, kind, host?, port?, widthDots? }` → `{ station, key }` (key: BRIDGE only), 201 |
| `PUT /printing/stations/{id}` | `pos.manage` | `{ name?, host?, port?, widthDots?, status? }` |
| `POST /printing/stations/{id}/key` | `pos.manage` | a BRIDGE's new key `{ station, key }`; the old one stops |
| `POST /printing/stations/{id}/test` | `pos.manage`, Idempotency-Key | one sample label → the job |
| `GET /print-bridge/next` | `@Public()` + `Authorization: Bearer bps_…`, optional `X-Printer-Name` | `{ job: { id, labels, data } | null }` after ≤ 25 s |
| `POST /print-bridge/jobs/{id}/done` | the same key | `{ ok, message? }` → the job; a job not PRINTING at this station → `PRINT_JOB_STATE` (409) |

## 5. Error codes (the module's own catalog, `printing.errors.ts`)

`PRINT_NO_TILL` 403, `PRINT_TILL_NOT_YOURS` 403, `PRINT_PRODUCT_NOT_FOUND` 404, `PRINT_TOO_MANY_LABELS` 422, `PRINT_STATION_NOT_FOUND` 404, `PRINT_KEY_INVALID` 401, `PRINT_JOB_NOT_FOUND` 404, `PRINT_JOB_STATE` 409; a job's `error`: `PRINTER_OFFLINE`, `PRINTER_UNREACHABLE`, `PRINTER_REFUSED`. Texts in mn.json `errors.*`.

## 6. Audit

`print_stations` CREATE, UPDATE (before and after, never the key's hash) and TOKEN_ISSUED (a new key). Jobs are not audited: the row is the record.
