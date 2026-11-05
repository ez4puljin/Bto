A record panel's facts as label and value chips, with small money or count tiles beneath them.

**Parts:** `FactChips({ facts })`, `TotalsGrid({ items, columns })` (3 or 4 columns), `PanelSection({ title, children })` for a small title over its content.

**Rules:** the label is `muted-foreground` on `fill`; totals read `figure-strong`. Facts are `dl`, so screen readers read them as pairs.
