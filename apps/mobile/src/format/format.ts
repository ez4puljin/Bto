import { Decimal } from '@tugeel/shared/money';

/** Money for reading, thousands grouped with commas as on the web (1250000 → "1,250,000"). */
export function formatMnt(value: string): string {
  const [whole = '0', cents = '00'] = new Decimal(value).toFixed(2).split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const grouped = whole.slice(sign.length).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${cents === '00' ? '' : `.${cents}`}`;
}

/** A count with thousands grouped (6763 → "6,763"). */
export function formatCount(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Millions of MNT to one decimal place, HALF_UP ("2095200" → "2.1"), for a total that would not
 * fit a summary's cell; null under a million (the screen shows it whole).
 */
export function formatMillions(value: string): string | null {
  const amount = new Decimal(value);
  if (amount.abs().lt(1_000_000)) return null;
  return amount.dividedBy(1_000_000).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed();
}

/** Up to two initials of a name for an avatar ("Туршилтын Төлөөлөгч" → "ТТ"). */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => [...word][0]?.toUpperCase() ?? '')
    .join('');
}

/** A NUMERIC quantity without trailing zeros ("12.000" → "12", "2.500" → "2.5"). */
export function formatQty(value: string): string {
  return new Decimal(value).toFixed();
}

/**
 * Stock in base units told in packs and pieces, the largest pack first: 30 with a box of 12 is
 * 2 boxes and 6 pieces. Units are `{ factor, name }`; the base unit has factor 1.
 */
export function packsOf(
  baseQty: string,
  units: readonly { factor: string; name: string }[],
): { qty: string; name: string }[] {
  let rest = new Decimal(baseQty);
  if (rest.lte(0)) return [];
  const parts: { qty: string; name: string }[] = [];
  const sorted = [...units].sort((a, b) => new Decimal(b.factor).comparedTo(new Decimal(a.factor)));
  for (const unit of sorted) {
    const factor = new Decimal(unit.factor);
    if (factor.lte(0)) continue;
    const count = factor.eq(1) ? rest : rest.div(factor).floor();
    if (count.gt(0)) {
      parts.push({ qty: count.toFixed(), name: unit.name });
      rest = rest.minus(count.times(factor));
    }
  }
  return parts;
}
