A capsule that does one thing; `default` is the one main action of a view and is blue.

**When:** `default` once per view; `secondary` for «Засах»-like actions; `outline`, `ghost` for the rest («Болих» is ghost); `destructive` on a tinted red for what cannot be undone; `link` for a quiet text action.

**Consumer provides:** a label in Mongolian (a dictionary-form verb) or an icon. An icon-only button needs `aria-label` and `title`, the same text.

**Props:** `variant`, `size` (`default`, `xs`, `sm`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg`), `pending` (spinner before the label, disabled, `aria-busy`), `asChild` (render a link).

**Don't** let a button only dim while its request runs: set `pending`. Don't place two blue buttons side by side, or a «Буцах» button anywhere. In a row of many items, use `RowAction` icons instead of text buttons.
