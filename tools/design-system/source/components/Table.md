A dense table: rows `row-h` 36 px, heads `row-head-h` 32 px, tabular figures in every cell.

**When:** every list goes in a `ListTable` with a `COLUMNS` spec: fixed kinds (`check`, `image`, `icon`, `code`, `number`, `date`, `datetime`, `money`, `qty`, `count`, `percent`, `status`, `actions`, `chevron`) keep a width in rem, `text` columns share the rest by `weight` (a name 3, a partner 2, short text 1), a `spacer` may vanish.

**Row kinds:** `LinkRow` opens a record's page on a click anywhere and keeps its name as a real link; `ButtonRow` opens a panel of this page; lists edited by dialogs end in `RowActions` with `RowAction` icons (`RowActionSpacer` where one is missing). `TruncateCell` cuts long text with «…» and shows the whole on hover.

**Rules:** money and counts right-aligned in `figure`; ticked rows take `data-state="selected"`. No per-cell `max-w-*` or `min-w-*` in a `ListTable`. A list wider than 1366 shows a default column set and keeps the rest in «Баганууд».
