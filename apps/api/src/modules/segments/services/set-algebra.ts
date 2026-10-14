/**
 * Set algebra on ascending id lists (ADR-0049 #3): the evaluator combines the owners' answers
 * with these. Inputs are ascending and free of repeats; so are the results.
 */

/** Ids in both lists (AND). */
export function intersect(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as number;
    const y = b[j] as number;
    if (x === y) {
      out.push(x);
      i += 1;
      j += 1;
    } else if (x < y) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return out;
}

/** Ids in either list (OR). */
export function union(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const x = a[i];
    const y = b[j];
    if (y === undefined || (x !== undefined && x < y)) {
      out.push(x as number);
      i += 1;
    } else if (x === undefined || y < x) {
      out.push(y);
      j += 1;
    } else {
      out.push(x);
      i += 1;
      j += 1;
    }
  }
  return out;
}

/** Ids of the universe that are not in the list (a negative condition). */
export function difference(universe: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let j = 0;
  for (const x of universe) {
    while (j < b.length && (b[j] as number) < x) j += 1;
    if (b[j] !== x) out.push(x);
  }
  return out;
}

/** An owner's answer made ascending and free of repeats (a defensive normalisation). */
export function ascendingUnique(ids: readonly number[]): number[] {
  const sorted = [...ids].sort((x, y) => x - y);
  return sorted.filter((id, index) => index === 0 || id !== sorted[index - 1]);
}
