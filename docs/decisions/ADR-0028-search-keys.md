# ADR-0028: Search keys: a strict and a phonetic form for mixed-script names

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-11 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0011 #4 (one `search_text` with a fixed look-alike list) |

## Context

The owner's product names mix scripts: some rows say "Coca-Cola 0.5L", others "Кока кола 0,5л" (interview of 2026-10-10). SPEC §5.2 requires that "Кока", "Coca" and "кока" find the same product. ADR-0011 #4 folds Latin look-alike letters (a/o/e/c/p/x/y/k/h) into Cyrillic, which repairs stray Latin letters inside Cyrillic words but cannot make "Coca" meet "Кока": the Latin c is a look-alike of Cyrillic с, not of к. Staff without a Mongolian keyboard layout also type о/у for ө/ү and е for ё. Upper-case Latin B, H, M and T look like Cyrillic В, Н, М and Т; after lower-casing they no longer do, so the list in ADR-0011 misses them. With pg_trgm, a substring pattern shorter than three characters produces no trigrams and cannot use the index.

## Decision

1. **Two keys per searchable row**, both computed in `packages/shared/src/text/normalize.ts` and stored as columns maintained by the owning service on every write:
   - `search_text` (strict): NFKC, lower case, decimal comma read as a dot, letters split from digits ("0.5л" → "0.5 л"), Latin look-alikes **a b c e h k m o p t x y** folded to Cyrillic, ё → е. Ө and ү stay distinct ("ус" water ≠ "үс" hair).
   - `search_phonetic`: the same words romanised (Mongolian Cyrillic → Latin with ө → o, ү → u, х → h, ц → ts, ч → ch, ш/щ → sh, ж → j, ё → io, ю → iu, я → ia, ъ/ь dropped) and Latin spellings folded to the same sounds (kh → h, zh → j, ph → f, th → t, ck → k, qu → kv, c → s before e/i/y else k, q → k, w → v, x → ks, y → i, diacritics stripped), with doubled letters collapsed. "Coca-Cola 0.5L" and "Кока кола 0,5л" both become ` koka kola 0.5 l`; "өндөг" and "ондог" both become `ondog`.
2. A key is the word list with a **leading space and single spaces**. A query is split into words the same way; **every word must match** one of the two keys. A word form shorter than three characters matches as a word prefix (`' ' || form`), which pg_trgm indexes; a longer one matches anywhere. Rows whose words all match the strict key rank first.
3. `matchesQuery()` in the same module is the reference implementation of the SQL predicate; an integration test asserts that SQL and the function agree.
4. **Versioned keys.** `SEARCH_KEYS_VERSION` is stored per row (`search_version`); changing a table in `normalize.ts` bumps it, and a reindex command recomputes stale rows. Names are stored NFC-normalised for display.
5. **Unique names** (categories, brands, units) use `nameKey()` (the strict form), so a name with a stray Latin letter cannot duplicate an existing one.
6. Chat-Latin habits (ү typed as v, ө as q) are not encoded until real queries from the owner show them.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One `search_text` holding both forms | Strict matches cannot rank above phonetic ones, and a word can match the wrong half; two columns cost nothing at 10,000 rows. |
| Database collation or `unaccent` only | Folds case and accents, not scripts or look-alikes; not testable in the shared package. |
| A transliteration dependency | General-purpose libraries follow Russian rules (х → kh, ө unknown) and cannot be tuned per business vocabulary. |
| Full-text search (`tsvector`) | Stemming dictionaries for Mongolian do not exist; prefix and substring matching on short product names is what users need. |

## Consequences

**Positive.** SPEC §5.2 search works across scripts and Russian keyboards; partners and bins reuse the same function; the behaviour is unit-tested without a database.

**Negative.** Two columns and two GIN indexes per searchable table; the phonetic key merges some distinct words (ус/үс), which only affects ranking; a table change needs a reindex.

## Related

ADR-0011, ADR-0015, `docs/SPEC.md` §5.2, `docs/architecture.md` §5.2, `docs/modules/catalog.md`.
