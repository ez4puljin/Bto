/** The gap between tiles (`gap-3`). */
const GAP = 12;
/** A tile that keeps the longest shortcut label on one line («Тооллого эхлүүлэх», 13rem). */
const ONE_LINE = 208;
/** The narrowest tile at all (10rem): its label may take two lines. */
const NARROWEST = 160;

/**
 * How many tiles a row of the home page's shortcuts holds (ADR-0066): as many as keep their labels
 * on one line, then evened out so the rows are about as full as each other (9 tiles in 3 × 3 or
 * 5 + 4, never 4 + 4 + 1). When a lone tile would still end the last row, one column more is tried
 * (while the tiles stay at least 10rem wide), then one less. Narrow screens keep two columns.
 */
export function tileColumns(count: number, width: number): number {
  if (count <= 1) return 1;
  const fit = Math.max(2, Math.floor((width + GAP) / (ONE_LINE + GAP)));
  const columns = Math.min(count, Math.ceil(count / Math.ceil(count / fit)));
  if (!lonely(count, columns)) return columns;
  const wider = columns + 1;
  if (wider <= count && tileWidth(width, wider) >= NARROWEST && !lonely(count, wider)) {
    return wider;
  }
  const narrower = columns - 1;
  if (narrower >= 2 && !lonely(count, narrower)) return narrower;
  return columns;
}

/** The last row holds a single tile under fuller rows. */
function lonely(count: number, columns: number): boolean {
  return count > columns && count % columns === 1;
}

function tileWidth(width: number, columns: number): number {
  return (width - GAP * (columns - 1)) / columns;
}
