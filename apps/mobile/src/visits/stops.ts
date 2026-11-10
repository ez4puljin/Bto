// «Айлчлал» (ADR-0183), the pure part: the day's stops in the order the rep works them, the
// counts on the header, and the amount a rep types read as money.

export interface Stop {
  customerId: number;
  planned: boolean;
  visit: { result: string } | null;
}

/** The stores still to visit first, in the plan's order, then the visited ones. */
export function orderedStops<T extends Stop>(stops: readonly T[]): { open: T[]; done: T[] } {
  return {
    open: stops.filter((stop) => stop.visit === null),
    done: stops.filter((stop) => stop.visit !== null),
  };
}

/** «3 / 12»: the planned stores visited today out of the planned ones. */
export function progressOf(stops: readonly Stop[]): { visited: number; planned: number } {
  const planned = stops.filter((stop) => stop.planned);
  return {
    visited: planned.filter((stop) => stop.visit !== null).length,
    planned: planned.length,
  };
}

/**
 * The amount as the API takes it, or null when it is not money: digits with optional spaces or
 * commas between thousands, at most two decimals, above zero ("1 500 000" → "1500000").
 */
export function amountOf(typed: string): string | null {
  const plain = typed.replace(/[\s,]/g, '');
  if (!/^[1-9]\d{0,11}(\.\d{1,2})?$/.test(plain)) return null;
  return plain;
}
