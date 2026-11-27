import { Decimal } from '../money';
import { type QuoteLineInput, type QuoteProduct, type QuoteResult, targetsProduct } from './cart';
import { dealLabel } from './deals';
import { allocate, type QuoteProgram } from './discounts';

/**
 * N+M at the till by the quantity the customer pays for (owner 2026-11-17). The engine stays as
 * ADR-0159 #3 has it: a line's quantity is the goods that leave, and of the product's quantity every
 * N+M has M free. The cashier types the paid quantity p and the till sends p + floor(p / N) × M,
 * which the engine splits back into exactly p charged: p = qN + r (r < N) makes the total
 * q(N+M) + r, of which floor(total / (N+M)) × M = qM are free. These two functions are the only
 * place the conversion is made; the till and the edge both call them.
 */

const ZERO = new Decimal(0);

/** The quantity to send for `paid` charged units: paid + floor(paid / N) × M. */
export function bonusTotalFromPaid(paid: Decimal, n: Decimal, m: Decimal): Decimal {
  if (!paid.gt(0) || !n.gt(0) || !m.gt(0)) return paid;
  return paid.plus(paid.dividedToIntegerBy(n).times(m));
}

/** A quantity as the engine splits it: floor(total / (N+M)) × M free, the rest charged. */
export function bonusSplit(
  total: Decimal,
  n: Decimal,
  m: Decimal,
): { paid: Decimal; free: Decimal } {
  if (!total.gt(0) || !n.gt(0) || !m.gt(0)) return { paid: total, free: ZERO };
  const free = total.dividedToIntegerBy(n.plus(m)).times(m);
  return { paid: total.minus(free), free };
}

/** «2+1», as the product badges name the program (`dealLabel`). */
export function bonusLabel(n: Decimal, m: Decimal): string {
  return dealLabel({
    kind: 'DISCOUNT',
    effect: 'BONUS',
    value: m,
    threshold: { qty: n, unitName: '' },
    perUnitName: null,
    lastDay: null,
  });
}

/** A quoted line's N+M, for display only: it prices nothing. */
export interface LineBonus {
  /** The program's N and M, in base units. */
  n: Decimal;
  m: Decimal;
  /** The line's share of the product's free units, and the rest, in the line's unit. */
  freeQty: Decimal;
  paidQty: Decimal;
  /** The line's free units in base units, exact (the share before it is put in the line's unit). */
  freeQtyBase: Decimal;
  /** What the N+M took off the line, whole MNT. */
  freeAmount: Decimal;
  /**
   * The till enters the line by its paid quantity: the line is the product's only line in the
   * cart and in its base unit, so `bonusTotalFromPaid` gives exactly what the engine charges.
   * Otherwise (a box line, the product on two lines) the line keeps its written quantity and
   * only shows its free units.
   */
  paidEntry: boolean;
}

/**
 * Each line's N+M after `resolveQuote`, as the engine counted it: the product's single PRODUCT
 * BONUS program that holds the line's unit (none, or two at once: null), unless a priority program
 * took the line alone (ADR-0159 #4). The product's free units, floor(product qty / (N+M)) × M in
 * base units, go to the lines holding the program in proportion to what the N+M took off each, as
 * the engine split its cut. A line keeps its bonus below one whole N+M (nothing free yet), so the
 * till knows N and M before the first free unit.
 */
export function lineBonuses(
  lines: readonly QuoteLineInput[],
  result: QuoteResult,
  programs: readonly QuoteProgram[],
  products: ReadonlyMap<number, QuoteProduct>,
): (LineBonus | null)[] {
  const priority = new Set(
    programs.filter((program) => program.priority === true).map((program) => program.id),
  );
  const productQty = new Map<number, Decimal>();
  const productLines = new Map<number, number>();
  for (const line of lines) {
    if (line.fixedBaseUnitPrice !== undefined) continue;
    productQty.set(line.productId, (productQty.get(line.productId) ?? ZERO).plus(line.qtyBase));
    productLines.set(line.productId, (productLines.get(line.productId) ?? 0) + 1);
  }
  const held = lines.map((line, index) => {
    if (line.fixedBaseUnitPrice !== undefined) return null;
    const own = programs.filter(
      (program) =>
        program.scope === 'PRODUCT' &&
        program.effect === 'BONUS' &&
        program.steps[0] !== undefined &&
        targetsProduct(program, line.productId) &&
        (program.productUnitId === null || program.productUnitId === line.unitId),
    );
    const [program] = own;
    const step = program?.steps[0];
    if (own.length !== 1 || !program || !step) return null;
    const priced = result.lines[index];
    const parts = priced?.priced ? priced.parts : [];
    const taken = parts.some((part) =>
      part.applied.some(
        (applied) => applied.programId !== program.id && priority.has(applied.programId),
      ),
    );
    if (taken) return null;
    const cut = parts.reduce(
      (sum, part) =>
        part.applied
          .filter((applied) => applied.programId === program.id && applied.effect === 'BONUS')
          .reduce((partSum, applied) => partSum.plus(applied.amount ?? ZERO), sum),
      ZERO,
    );
    return { program, n: step.threshold, m: step.value, cut };
  });

  const shares = new Map<number, Decimal>();
  const groups = new Map<string, number[]>();
  held.forEach((entry, index) => {
    const line = lines[index];
    if (!entry || !line) return;
    const key = `${entry.program.id}:${line.productId}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  for (const members of groups.values()) {
    const first = held[members[0] ?? -1];
    const line = lines[members[0] ?? -1];
    if (!first || !line) continue;
    const free = bonusSplit(productQty.get(line.productId) ?? ZERO, first.n, first.m).free;
    const split = shareOut(
      free,
      members.map((index) => held[index]?.cut ?? ZERO),
      members.map((index) => lines[index]?.qtyBase ?? ZERO),
    );
    members.forEach((index, at) => shares.set(index, split[at] ?? ZERO));
  }

  return lines.map((line, index) => {
    const entry = held[index];
    if (!entry) return null;
    const unit = products.get(line.productId)?.units.find((one) => one.unitId === line.unitId);
    const factor = unit?.factor ?? new Decimal(1);
    const freeBase = Decimal.min(line.qtyBase, shares.get(index) ?? ZERO);
    const freeQty = Decimal.min(
      line.qty,
      freeBase.div(factor).toDecimalPlaces(3, Decimal.ROUND_DOWN),
    );
    return {
      n: entry.n,
      m: entry.m,
      freeQty,
      paidQty: line.qty.minus(freeQty),
      freeQtyBase: freeBase,
      freeAmount: entry.cut,
      paidEntry: unit?.isBase === true && productLines.get(line.productId) === 1,
    };
  });
}

/**
 * Splits the free base units over the lines in proportion to what the N+M took off each (by
 * quantity when it took nothing): whole units by the largest remainder when both are whole, else
 * to three places with the last line taking the rest.
 */
function shareOut(free: Decimal, cuts: readonly Decimal[], qtys: readonly Decimal[]): Decimal[] {
  if (cuts.length <= 1) return [free];
  const weights = cuts.some((cut) => cut.gt(0)) ? cuts : qtys;
  if (free.isInteger() && weights.every((weight) => weight.isInteger())) {
    return allocate(free, weights);
  }
  const sum = weights.reduce((total, weight) => total.plus(weight), ZERO);
  if (sum.isZero()) return weights.map(() => ZERO);
  const out = weights.map((weight) =>
    free.times(weight).div(sum).toDecimalPlaces(3, Decimal.ROUND_DOWN),
  );
  const rest = free.minus(out.reduce((total, part) => total.plus(part), ZERO));
  out[out.length - 1] = (out[out.length - 1] ?? ZERO).plus(rest);
  return out;
}
