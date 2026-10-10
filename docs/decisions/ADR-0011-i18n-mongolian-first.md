# ADR-0011: i18n from day one: i18next keys, `mn` as the only locale, English codes in the database

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0028 (#4: strict and phonetic search keys, extended look-alike list) |

## Context

The UI is Mongolian Cyrillic only, but extracting strings later across three clients is expensive. SQL, logs, enum values and agent prompts need unambiguous English identifiers. Existing Excel data mixes Cyrillic and Latin look-alike letters (Latin `a`, `o`, `e` inside Cyrillic words). Mongolian letters Ө/ө and Ү/ү are absent from the Russian code pages (PC866, CP1251) that cheap printers offer. Business dates are in Asia/Ulaanbaatar (UTC+8, no DST).

## Decision

1. **All UI strings are i18next keys** in `packages/shared/i18n/mn.json` (an empty `en.json` skeleton exists so the structure is locale-ready). Web and mobile load the same catalog. Keys are English dot-paths (`orders.status.CONFIRMED`, `errors.STOCK_INSUFFICIENT`).
2. **Lint rule against literal Cyrillic in components.** An ESLint rule (`no-restricted-syntax` with a selector on string literals and JSX text matching `/[Ѐ-ӿ]/`) runs on `apps/web/**/*.tsx` and `apps/mobile/**/*.tsx`; the only exemptions are `mn.json` and test fixtures. `eslint-plugin-i18next/no-literal-string` is enabled in addition for JSX text. Both rules are in the lint-guard list (`docs/architecture.md` §12, CLAUDE.md) and are never deleted.
3. **The backend is English-only**: enum values, error `code`s (ADR-0004), log lines, column names. Mongolian text appears only in catalogs (`mn.json`) and user data (product names, customer names, addresses).
4. **Search.** Every searchable table (`products`, `customers`, `suppliers`, `bins`) has a `search_text` column maintained by the owning service on every write: NFKC normalisation, lowercase, Cyrillic/Latin look-alike mapping (Latin a/o/e/c/p/x/y/k/h -> Cyrillic), whitespace collapse. Search uses `pg_trgm` GIN indexes on `search_text`; the same normaliser (`packages/shared/text/normalize.ts`) runs on import and on the query string. The database is created with an ICU UTF-8 collation and `lower('ӨҮЁ')` is asserted at boot (ADR-0003).
5. **Printing and PDFs.** Noto Sans is embedded in every generated PDF (pdfmake). Receipt and label text containing Mongolian letters is printed as **raster** by default (ADR-0021).
6. **Time.** `timestamptz` (UTC) in storage; `effective_date` and report periods are plain dates in Asia/Ulaanbaatar; dayjs with the timezone plugin; `new Date().toISOString().slice(0, 10)` is banned for business dates (`docs/architecture.md` §12, "Time"). PosAPI date strings are stored verbatim alongside a derived timestamp (ADR-0017).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Hard-coded Cyrillic strings in components | Cheap now, expensive forever; untestable error texts. |
| Mongolian labels and enums in the database | Ambiguous identifiers in SQL and prompts; impossible to grep. |
| Rely on collation only for search | Collation may fold cases but not look-alikes; `search_text` is deterministic and testable. |
| Local timestamps in the database | Wrong the first time a server or laptop runs in another zone. |
| A Mongolian full-text dictionary | None exists for PostgreSQL; trigram search is good enough for names and SKUs. |

## Consequences

**Positive.** Negligible cost now, i18n-ready later; search quality independent of the managed cluster's locale details; printed Mongolian text is correct on any printer.

**Negative.** The agent must add a key for every new string (the lint rule makes forgetting a CI failure); `search_text` must be maintained on every write path (one helper, covered by tests).

**Follow-ups.** Delivery 1: `mn.json`, both lint rules, `normalize.ts`, `search_text` on products/customers, collation assertion.

## Related

ADR-0003, ADR-0004, ADR-0015, ADR-0017, ADR-0021, `docs/architecture.md` §12, `docs/SPEC.md` §4 (glossary).
