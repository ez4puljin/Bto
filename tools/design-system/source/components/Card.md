The white box of the system: `shadow-card` plus a 1 px `hairline-ring`, `radius-xl`, 16 px padding (12 px at `size="sm"`).

**Parts:** `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`.

**Rules:** a card clips its content (`overflow-hidden`), which stops `sticky`: put `StickyActions` after the card, never inside. Never nest a card in a card, and never give it a coloured edge.
