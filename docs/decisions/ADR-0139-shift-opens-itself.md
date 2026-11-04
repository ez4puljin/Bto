# ADR-0139: a POS shift opens by itself, with no opening cash

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-04 |
| Deciders | Owner («Ээлж нээх болон эхний бэлэн мөнгө хэрэггүй. Шууд ажиллахад болно», 2026-11-04), Claude (the direct-mode session) |
| Amends | ADR-0063 (the cashier opens a shift with the drawer's counted change) |

## Context

After the PIN the cashier met «Ээлж нээх» and had to type the change in the drawer. The owner wants the cashier to start selling at once.

## Decision

1. When the signed-in cashier's POS has no open shift, the POS app opens one by itself (`POST /edge/v1/shifts/open` with `openingFloat` `0`) and goes on to the sale screen; a refusal (another cashier's shift open at this POS) shows with a retry and sign-out.
2. The shift itself stays: sales, returns and the day's money hang on it, its journal entry and hand-over (ADR-0064) are unchanged, and «Ээлж хаах» still counts the cash at the end.

## Consequences

- The expected cash at close is the cash taken during the shift; change left in the drawer from the day before shows as a difference unless it is handed over.
