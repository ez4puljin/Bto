import { applied, inForceOn } from './support';

/** A dated row: in force from `validFrom` up to (not including) `validTo`; null = open. */
export interface DatedRow {
  id: number;
  validFrom: string;
  validTo: string | null;
}

export interface PlannedChange<T extends DatedRow> {
  /** The row in force on the day, to be closed on it (voided when it starts that day). */
  close: T | null;
  /** The new row's end: the closed row's old end, else the next planned row's start, else open. */
  validTo: string | null;
}

/**
 * A change from `date` on (ADR-0041 #1, ADR-0048 #1–#2): the row in force that day is closed on
 * it and the new row runs up to that row's old end, or up to the next planned row, so a change
 * slots in between planned ones and the history is never rewritten. Null when the row in force
 * already says the same. Rows closed on their first day never applied and are ignored.
 */
export function planChange<T extends DatedRow>(
  rows: readonly T[],
  date: string,
  same: (row: T) => boolean,
): PlannedChange<T> | null {
  const live = rows.filter(applied).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const covering = live.find((row) => inForceOn(row, date)) ?? null;
  if (covering && same(covering)) return null;
  const next = live.find((row) => row.validFrom > date);
  return { close: covering, validTo: covering ? covering.validTo : (next?.validFrom ?? null) };
}
