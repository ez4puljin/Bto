# ADR-0231: «Төстэй бараа (AI)» on the stock list: the model picks among a name pre-filter's candidates

|          |                                                                                                                                                                                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status   | Accepted                                                                                                                                                                                                                                                                                              |
| Date     | 2026-11-20                                                                                                                                                                                                                                                                                            |
| Deciders | Owner (2026-11-20: «AI ашиглан төстэй бараануудын үлдэгдэл болон тайлан зэрэг авах боломжтой байна. Жишээ нь лашпа 3кг аль нэг будаа ... Лапша бүх төрлийн 3кг будаануудын үлдэгдэл зэрэг харж тайлан харах.»), Claude (the brain's session and its worker)                                               |
| Amends   | ADR-0045 #7 and ADR-0162 (one more kind of work that calls the model; the same connection, limit and meter), ADR-0198 (the same shape: the model proposes, the server checks every id it names)                                                                                                         |

## Context

On «Үлдэгдэл» (`/inventory/stock`) the owner wants to see, for one product, every product of the same kind and size (all kinds of «Лапша 3кг»), their stock side by side and one report of all of them. The catalogue has no «kind» or «size» field: brands, flavours and sizes live in the product name («Лапша Ролтон 3кг», «Lapsha Big Bon 3 кг»), sometimes also in `weight_kg`. A name search alone mixes 1 kg and 3 kg packs and misses another brand's wording; a model alone would have to read the whole catalogue (7 000+ names) on every click.

## Decision

1. **Pre-filter in code, judgement by the model.** `GET /stock/similar/:productId` (`@Authenticated`, as every stock read; costs only for `inventory.costs.manage`) gathers candidates with the catalogue's own search — each word of three letters or more of the product's name, and the products of its category, active ones only — and keeps those of the same kind (a shared word, or names alike by pg_trgm's trigram measure) and never of another pack size when both sizes are known (from the name, «3кг» / «500 гр» / «0,5л», else `weight_kg` within 5 %). At most 30 candidates, the same size first, go to the model, which answers only ids (structured output); an id it was not shown is dropped. The pure rules are `@tugeel/shared/inventory` `prefilterSimilar` / `fallbackSimilar`, unit-tested.
2. **Without the model the pre-filter answers.** A user without `ai.ask` (the right to put work to the model, ADR-0162) never reaches it: the route stays a stock read for every signed-in user and the button stays for everyone. No connection, AI switched off, the month's limit reached, or a failed or malformed answer: the answer is the candidates of the same kind and the same known size (of the same kind alone when the product's own size is unknown), marked `NAME` («Нэрээр сонгосон»); the model's is `AI` («AI-аар сонгосон»). The screen never fails because of the model.
3. **Nothing is stored.** No table and no audit row; the call runs in `SimilarProductsFlowService` outside any transaction; the prompt (product names and weights only) and the answer are never logged. Each answered call is counted in `ai_usage` (ADR-0162) under `PRODUCT_READ`, with the other product work of the model: a purpose of its own would need a migration of the `ai_usage_purpose` check, which was not wanted for this.
4. **The answer carries the stock.** Each product with its per-warehouse balances (one read for all of them), so the panel shows the warehouses side by side, leaves out a warehouse where none of them holds stock, totals the ticked products and opens «Бараа материалын үлдэгдэл» with them (`pr` once per product).

## Alternatives considered

| Alternative                                   | Why rejected                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The model reads the whole catalogue           | Thousands of names per click: slow and costly, and the answer could name products that do not exist                  |
| Name search only                              | Mixes sizes and misses another brand's wording; kept as the fallback with the size rule                               |
| A «kind» and «size» field on every product    | A catalogue-wide data entry the owner did not ask for; the names already carry both                                   |
| Embeddings and a vector index                 | A new extension and a nightly index for one button; trigram search is already in the database                         |

## Consequences

- One click costs one model call of a few hundred tokens; the panel keeps its answer five minutes.
- The pre-filter misses a product whose name shares no word with the source and stands in another category; the owner can search it by name instead.
- «Бараа материалын үлдэгдэл» takes several products: `pr` (and its label `prn`) once per product on the page, `productIds` on `GET /reports/stock-balance`; one product still goes as `productId`.
