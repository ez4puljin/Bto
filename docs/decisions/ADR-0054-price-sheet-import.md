# ADR-0054: The price sheet import

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-15 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0036 (a sixth import kind, `PRICES`, and a template filled with the system's data); adds to ADR-0044 (an import may complete the products it prices) and ADR-0048 (price terms written for many products at once) |

## Context

ADR-0048 gave each product one warehouse price per base unit, one price profile and a whole pack, dated from a chosen day. Prices are entered product by product: on the product page, or from «Үнэ хүлээгдэж буй». The development database alone has 20,000 products waiting, and the owner has no price list to start from.

ADR-0036's importers always begin from an empty template. A price sheet has to begin from the products the system already has.

The owner's answers (2026-10-15):
- A product the import prices completely from today leaves «Үнэ хүлээгдэж буй» by itself.
- The template always lists every active product; no choice when downloading.
- The owner creates the price profiles at «Үнэ» → «Үнийн тохиргоо»; the sheet names them.

## Decision

1. **A new kind, `PRICES`** (migration `0022_imports_prices` widens the `import_jobs.kind` CHECK).
   - **Columns:** Код*, Нэр, Суурь нэгж, Савлагаа, Агуулахын үнэ, Үнийн тохиргоо, Бүтэн савлагаа, Хэдээс.
   - **Read-only columns.** Нэр, Суурь нэгж and Савлагаа are for reading only and are never checked.
   - **The day** is text `YYYY-MM-DD`; an empty cell means today.
2. **A filled template.**
   - **Rows.** One row per active product, by code, with the terms in force today: price, profile name and whole pack.
   - **Sheets.** A second sheet lists the live profiles with their percentages and rounding; the third is the instructions.
   - **Format.** Codes and the day are text cells.
3. **Rows.**
   - **Empty price.** The row keeps the product's terms (UNCHANGED).
   - **Filled price** needs:
     - whole tugriks above zero;
     - a profile by name, live, with values on the day;
     - for a product with packs, the whole pack by its unit name, one of the product's packs; a product without packs leaves it empty;
     - a day of today or later.
   - **Same terms.** A row equal to the terms in force on that day is UNCHANGED.
   - **Errors.** An unknown or inactive product, a repeated code and any rule above are row errors. As everywhere (ADR-0036), one error refuses the file.
4. **Writing.**
   - **Core.** `ProductPricesService.setManyInTx(tx, actor, inputs)` applies `set`'s dated-row rule (`planChange`) to each product, with one audit row per changed product (`recordMany`).
   - **Locks.** Up to 20,000 products are too many for per-product advisory locks (ADR-0051 accepted 500). The import locks `product_prices` in `SHARE ROW EXCLUSIVE` mode, as ADR-0036 locks whole tables for large commits, and then the named profiles `FOR SHARE`.
     - A single change or a bulk profile change already writing waits the import out.
     - A later one waits for the import.
     - Neither holds the table lock, so no cycle forms.
5. **Completion.**
   - **What completes.** A product that was waiting (ACTIVE, no `sale_ready_at`) and has complete terms in force today after the import is completed in the same transaction.
   - **How.** `SaleReadinessService.completeManyInTx` applies `complete`'s checks without its 200 limit.
   - **Report.** The import summary counts those products.
6. **Revert** (LIFO, ADR-0036). Price rows are never deleted, and only their end can move earlier. The revert therefore writes forward from the revert day, and only for products whose imported terms still stand:
   - **Terms before.** The terms the product had before come back from the revert day.
   - **No terms before.** The imported row is closed on the revert day; a row not started yet closes on its first day and never applies.
   - **Completion.** Products the import completed return to «Үнэ хүлээгдэж буй», unless someone completed them again since. Catalog's `markWaitingInTx` does this, audited.
7. **Rights.** Like every import, `imports.manage` (admins first, assignable).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Per-product advisory locks for the import | Up to 20,000 locks in one transaction; ADR-0051 judged 500 acceptable for a rare action. |
| An empty template like the other kinds | The owner would type 20,000 codes; the sheet must start from the products. |
| Filters on the template (a category, only waiting products) | The owner chose one sheet with every active product. |
| Completing by hand after the import | The owner chose completion by the import. |
| A real date cell | The reader refuses date cells (`DATE_IN_CELL`) because Excel's dates depend on the computer; text keeps one form. |

## Consequences

**Positive.**
- The whole price list can be entered once in Excel and taken back if wrong.
- A product the sheet prices from today goes straight into orders.

**Negative.**
- While a price import commits, single price changes wait.
- A revert leaves dated rows behind: history shows the imported terms closed on the revert day.
- A price clerk without `imports.manage` cannot use the sheet.

## Related

ADR-0036, ADR-0044, ADR-0048, ADR-0051, SPEC §5.5, §5.6, architecture §5.4, `docs/modules/imports.md`, `docs/modules/pricing.md`.
