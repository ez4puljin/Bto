# ADR-0010: Money as NUMERIC MNT with decimal.js, whole-tugrik unit prices, per-line tax split

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |

## Context

MNT has no practical subunit, but percentage rules and derived per-piece prices produce fractions (1,235 x 0.97 = 1,197.95). Cash drawers, QPay invoices and bank transfers are whole tugrik. e-Barimt requires tax-inclusive totals, VAT and city tax per item and per sub-receipt, and the rule header total = Σ sub-receipts = Σ payments (`docs/architecture.md` §9). Drizzle returns `NUMERIC` as strings; a single `Number()` on such a string loses precision silently. The VAT registration threshold changes on 2027-01-01, so rates and payer flags must be effective-dated, not constants.

## Decision

1. **Column types.** Money `NUMERIC(14,2)`; quantities `NUMERIC(14,3)`; unit costs `NUMERIC(14,4)`; factors `NUMERIC(18,6)`; tax rates `NUMERIC(5,4)`.
2. **Decimal custom type.** Every `NUMERIC` column is declared through a Drizzle custom type in `apps/api/src/common/db/types.ts` (`money()`, `qty()`, `cost()`) that maps to/from `Decimal` (decimal.js). Services never see a numeric string or a JS number for money or quantity.
3. **Arithmetic only through `packages/shared/money`** (decimal.js, `ROUND_HALF_UP`). Lint: `no-restricted-syntax` bans `Number(` and `parseFloat(` in `apps/api/src/modules/**`; floats for money are banned by review. The rule is part of the lint-guard list in `docs/architecture.md` §12 and CLAUDE.md so later sessions do not delete it.
4. **Rounding points.**
   - Resolved **unit prices are rounded HALF_UP to 0 decimals (whole MNT)** before being frozen on a line (ADR-0009).
   - **Line totals are integers** (`unit_price x entered_qty`, both integral for piece units; fractional quantities round the line total HALF_UP to 0 decimals).
   - **VAT and city tax are computed per line to 2 decimals** from the tax-inclusive line total (`base = total / (1 + vat + city)`, `vat = base x vatRate`, `city = base x cityRate`, each rounded HALF_UP) and **summed** into sub-receipt and document headers. Headers are never recomputed from totals.
   - Document total = Σ line totals (integer). Payments are integers. Σ payments = document total = Σ sub-receipt totals.
5. **A table-driven test** in the integrity suite (ADR-0016, `docs/architecture.md` §10.4) asserts, for a set of carts with mixed VAT_ABLE/VAT_FREE lines and percentage rules, that Σ payments (integer) = document total = Σ sub-receipt `totalAmount` and that each sub-receipt's `totalVAT`/`totalCityTax` equals the sum of its lines (ADR-0016).
6. **Prices are tax-inclusive** everywhere (per-list flag allows exclusive lists later).
7. **Rates and flags are effective-dated configuration** in `settings` (VAT 10 %, city tax rate, company `vat_payer` / `city_payer`), customers carry `vat_payer`/`city_payer` snapshots, and the lottery/VAT matrix (B2C vs B2B, VAT-payer vs not) is a pure function over those flags.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Integer minor units (möngö) | MNT has no used subunit; tax splits still need 2 decimals; integers tempt `Number()` arithmetic. |
| JS numbers / floats | Silent precision loss; forbidden. |
| Tax-exclusive storage | Shops and e-Barimt think in inclusive prices; doubling the rounding points. |
| Hard-coded 10 % VAT | 2027 threshold change moves customers between payer and non-payer. |
| Rounding only at the document level | Cash totals and QPay amounts would not match line sums; sub-receipt sums would drift from the header. |

## Consequences

**Positive.** Exact arithmetic everywhere; whole-tugrik prices on every printed line; the e-Barimt header identity holds by construction; the custom type removes the most likely `Number()` mistake at the source.

**Negative.** A small discipline cost (`Decimal` everywhere); the lint rule cannot catch every float path, so the totals tests are the real safety net.

**Follow-ups.** Delivery 1: custom type, `money` helpers, lint rule. Delivery 2: rounding at SUBMIT. Delivery 3: tax split + totals test.

## Related

ADR-0003, ADR-0009, ADR-0016, ADR-0017, ADR-0018, `docs/architecture.md` §5.4, §5.9, §12.
