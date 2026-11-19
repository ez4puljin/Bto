# ADR-0221: Erkhet's stock by location, read through erxes, beside Bto's

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-19 |
| Deciders | Owner (2026-11-19: the source is erxes's `erkhetRemainders`; first show the difference, a button to level comes later; the owner links each Erkhet location to a Bto warehouse himself; an unlinked location is not compared; several locations may go to one warehouse), the brain (the brief), Claude (worker `bto-core`, task `erkhet-stock-view`) |
| Migration | `0113` (new tables only) |
| Builds on | ADR-0218 (erxes sign-in, queries only, the client called from flow services between transactions, the product match of #6), ADR-0220 (a refused query is seen, never an empty answer), ADR-0084 (Kharkhorin is another company's stock) |

## Context

Until Bto's books replace Erkhet, Erkhet holds the stock the accountant reports, location by location. The owner wants to see, per Bto warehouse, how Bto's on-hand stands against Erkhet's, and later to level Bto to Erkhet with one button. Bto cannot reach Erkhet's stock directly; erxes's «syncerkhet» plugin can: `erkhetRemainders(productIds, stageId, pipelineId) { _id remainder remainders }` asks Erkhet once for a list of products at the locations that the pipeline's entry of erxes's `remainderConfig` names (`{ account: "150101", location: "01,02,…" }`). No pipeline covers every location. The old ERP read it this way (2026-10-22): 50 products a call (200 got no answer), 2 calls at once at most, the fewest pipelines that cover all locations. erxes has about 13,000 active products, so a full read is a few hundred calls; introspection is off, so the shape is best knowledge.

## Decision

1. **A run, started by a person, done by the worker.** «Үлдэгдэл татах» inserts a run (`erxes_stock_runs`, one waiting or running at a time, `active_slot`) and enqueues the job `erxes.stockRead { runId }` in the same transaction; pressing it again answers the run under way. The worker (`ErxesStockRunFlowService`, a flow service: it is the one that calls erxes, never inside a transaction) reads `configsGetValue(code: "remainderConfig")`, plans the fewest pipelines of account `150101` that cover every location (each location taken from the first step that covers it), reads erxes's active products in pages, matches each to a Bto product, then calls `erkhetRemainders` for 50 products through each step of the plan, two callers at once with a pause after each call. The page shows the progress, the estimated finish (the pace so far) and, afterwards, when, how many products and how many calls failed.
2. **A refused call does not stop the run.** It is counted (`batches_failed`) and its products are marked `read_ok = false`: their Erkhet quantity is unknown and shows «—», never 0. A refused sign-in, or ten refused calls in a row, ends the run `FAILED` with erxes's words. A run whose heartbeat stops for ten minutes (a restart) is closed `INTERRUPTED` by the next start and shown so.
3. **What is kept.** The run's products (`erxes_stock_products`: erxes id, code, name, unit, the matched Bto product or why none) and its non-zero balances per location (`erxes_stock_balances`); when a run finishes, the rows of older runs go and a failed run's rows go with it, so the newest finished run is the one compared.
4. **Products are matched by the deal copy's rule** (ADR-0218 #6, `ErxesProductMatchService`, now shared by both): erxes code as SKU, else the code or a barcode as the barcode of exactly one product; ambiguous and not found are reasons.
5. **Locations are linked by hand, once** (`erxes_stock_locations`: code → warehouse). Every location Erkhet is known to have is listed (the 2026-10-22 names as labels, plus what a run's plan reads); the owner picks a Bto warehouse (not transit, active) for each. Several locations may be linked to one warehouse: their balances add up. An unlinked location is not compared; Kharkhorin's 04 and 05 are listed and stay unlinked unless the owner links them.
6. **The comparison is made when the page asks**, per Bto warehouse: Erkhet's side is the newest finished run summed over the warehouse's locations, Bto's is the on-hand (lots summed) of this moment through `StockQueryService`. Three groups: products in both (Erkhet, Bto, difference Erkhet − Bto; «Зөвхөн зөрүүтэй» keeps the rows that differ or are unknown), erxes products with Erkhet stock not found in Bto («Bto-д олдоогүй»), Bto products with stock here that no erxes product of the run is («Эрхэтэд байхгүй»). Several erxes products matched to one Bto product add up.
7. **Units are not converted.** Erkhet's quantity is shown in erxes's unit of the product beside Bto's on-hand in its base unit; a row whose unit name is not Bto's base unit's is marked «Нэгж өөр». The rule of conversion is the owner's to decide with the levelling task.
8. **Rights.** Bto has no inventory read right (stock is open to every user), so reading the page takes `inventory.stocktakes.manage`, the right of the people who compare counted with recorded stock; linking locations and starting a run take `inventory.setup.manage`, plus a working erxes sign-in. No new right.
9. **Read-only.** Nothing here writes stock, erxes or Erkhet; the only document sent besides `login` begins with `query`. The levelling button («Тааруулах») will be a separate decision: it can level one warehouse to the run's sum of its locations through an adjustment, from the same comparison rows.

## Consequences

- erxes's shape of `configsGetValue` (JSON, or an object with `value`) and of `remainders` (JSON list, or objects) is read defensively and kept in `erxes-wire.ts` with its fixture; the second shapes are tried when erxes refuses the first. None of it was checked against the company's erxes when this was written.
- Bto's side counts only positive stock for «Эрхэтэд байхгүй» (the stock list's `inStock`); a product with negative on-hand and no Erkhet balance is not listed there.
- The erxes module now reads inventory (`StockQueryService`): the module map in `eslint.config.mjs` and architecture §4 gain erxes → inventory.
