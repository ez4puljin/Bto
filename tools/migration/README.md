# The Erxes product master migration (ADR-0098)

These scripts move the product master of the old system (Erxes) into Bto through Bto's own imports. They hold no data. The export is real business data, so it, the converted sheets, the reports, the downloaded photos and the logins all stay in the gitignored `tmp/`. Never commit them, never paste them into docs or tests, and never print rows.

| File | What it does |
|---|---|
| `erxes-map.json` | The owner's decisions: top-group names per hundred, skipped categories, tag → warehouse, branch, store, settings, the temporary price profile |
| `erxes-rules.mjs` | Pure rules (category placement, code reassignment, barcode de-duplication, suppliers, home warehouse, the import cell limit), proved by `erxes-rules.test.mjs` on synthetic rows (`pnpm lint:guards`) |
| `erxes-master.mjs` | Converts the export into `suppliers.xlsx`, `products.xlsx`, `prices.xlsx`, `categories.json`, `images.json`, `overflow-barcodes.json`, `report.xlsx` and `summary.json` |
| `erxes-load.mjs` | Over the local api, idempotently: the branch, warehouses, settings, price profile and categories, then the SUPPLIERS → PRODUCTS imports, the barcodes one cell could not hold, then PRICES |
| `erxes-images.mjs` | `--phase download` fetches the photos (GET only, 2 at a time with a pause; never again once on disk); `--phase attach` uploads and attaches them |
| `bto-api.mjs` | The small api client: sign-in from the logins file, presigned uploads, keyset lists |

## Run (development or go-live)

1. Build the packages (`pnpm build:packages`). The scripts import the built `@tugeel/shared`.
2. Convert:
   ```bash
   node tools/migration/erxes-master.mjs --in "<export>.xlsx" --out tmp/erxes/<day>
   ```
   Read `summary.json` and `report.xlsx` before loading. An unknown category or tag stops the run; add it to `erxes-map.json` after asking the owner.
3. Start downloading the photos (it takes about an hour for 7,000 links):
   ```bash
   node tools/migration/erxes-images.mjs --dir tmp/erxes/<day> --phase download
   ```
4. Prepare an empty database: `pnpm db:provision`, `pnpm db:migrate`, then `pnpm user:create-admin` for the owner and for a script admin. Give the script admin a password through its one-time code and write it as `<user> <password>` in `tmp/dev-logins.txt`. Then start the api and the worker.
5. Load:
   ```bash
   node tools/migration/erxes-load.mjs --dir tmp/erxes/<day> --user <script admin>
   ```
   A refused import writes `<KIND>-errors.json` beside the sheets and stops. Fix the cause and run again; finished steps are skipped.
6. Attach the photos:
   ```bash
   node tools/migration/erxes-images.mjs --dir tmp/erxes/<day> --phase attach --user <script admin>
   ```
7. Check: `pnpm inventory:reconcile`, `pnpm finance:reconcile`, the counts against `summary.json`, and the screens.
