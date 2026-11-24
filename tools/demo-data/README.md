# Local fictional grocery demo data

This tool adds visibly labelled `DEMO` data through the normal staff HTTP API. It preserves existing records, including the owner's administrator and manually created documents. It contains no SQL or database client. It does not install dependencies, migrate, deploy, configure integrations or close accounting periods.

Run with the repository's Node 26 runtime. A normal run previews the fixed dataset and makes **no HTTP requests or file/database writes**:

```powershell
& '<node.exe>' tools/demo-data/seed.mjs
```

Apply requires the running local API, the installed checkout with built shared packages, and credentials supplied only through process environment variables. Use your existing local account; no credentials belong in this file or a committed script.

```powershell
# Set BTO_DEMO_LOGIN and BTO_DEMO_PASSWORD securely in the current process first.
& '<node.exe>' tools/demo-data/seed.mjs --repo '<installed-checkout>' --phase core --apply
& '<node.exe>' tools/demo-data/seed.mjs --repo '<installed-checkout>' --phase extras --apply
```

After integration into the installed checkout, `--repo` can be omitted. `--phase all` is the default. The extras file must be present to run `all` or `extras`.

The guard reads `<installed-checkout>/apps/api/.env` and requires development mode, API port `3300`, and `DATABASE_URL` pointing exactly at `127.0.0.1:15432/bto_local_shiro`. An incompatible process override also refuses the run. HTTP goes only to `http://127.0.0.1:3300/api/v1`, with redirects disabled. The operator must confirm the running local API uses that same checkout/configuration before applying. Back up this local database first.

| Core data | Count |
|---|---:|
| Synthetic branch / warehouses / picking bins | 1 / 3 / 6 |
| Product categories, three levels | 33 |
| Supplier categories, three levels | 25 |
| Supplier / customer records | 24 / 18 |
| Customer categories | 3 |
| Products with piece or kilogram base units and cartons | 72 |
| Main / secondary supplier links | 72 / 36 |
| Price profiles | 3 |
| Sale-ready / waiting / inactive products | 68 / 2 / 2 |
| Zero / low / normal stock products before extras | 6 / 9 / 57 |
| Posted, costed credit receipts and supplier bills | 24 |

Product names, names of partners, categories, warehouses and notes contain `DEMO`. Numeric SKU codes use `9900`, suppliers `9901`, customers `9902`. Barcodes use a synthetic internal-range prefix with the shared checksum helper. There are no real phone numbers, tax registrations or bank account numbers in the core dataset. Supplier emails use the reserved `example.invalid` domain. All money, factors, weights and quantities are decimal strings; arithmetic uses `@tugeel/shared/money` from the installed checkout.

The durable manifest lives under the installed checkout's ignored `.data/demo-data/`. Keep it for subsequent runs: completed operations replay locally without more HTTP writes, requests carry deterministic `Idempotency-Key` UUIDs, and named creates recover by exact identity. The original Ulaanbaatar business date and seed user are retained. A changed request under an existing operation key refuses to proceed, except after an explicit client-error rejection (such as validation 400/422), when a corrected payload may be sent. Pending or completed operations still require the original payload. Do not delete the manifest to restart stock or financial workflows.

Each request is checkpointed as pending before it is sent. A failed connection or server error leaves it pending. Server-declared idempotent routes can replay with the same key. An uncertain create is recovered by its unique DEMO identity; another non-idempotent request stops for inspection instead of blindly duplicating a write. Two simultaneous runs are prevented by a lock file. If a process was killed, confirm it is stopped before removing only its `.lock` file. Never remove the JSON manifest as a lock workaround.

No providers, SMS, emails, e-Barimt, Erkhet/Erxes, AI, print agents, password/PIN changes or fiscal-close workflows are invoked. Extras use their own e-Barimt-disabled sales pipeline. The fictional balances are for this isolated development database only.

Validation without touching the application database:

```powershell
& '<node.exe>' --test tools/demo-data/seed.test.mjs
& '<node.exe>' --check tools/demo-data/core.mjs
& '<node.exe>' --check tools/demo-data/extras.mjs
```

After applying, run the existing inventory and finance reconcile CLIs against the verified local configuration. Do not run integration suites that reset this owner's populated database. Useful UI pages include `/catalog/products`, `/partners/suppliers`, `/partners/customers`, `/inventory/stock`, `/inventory/receipts`, `/procurement/orders`, `/sales/boards`, `/finance/payables` and `/hr`.
