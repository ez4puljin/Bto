import { Decimal } from '../money';
import { searchKeys, tokenize } from '../text';

/**
 * «Төстэй бараа» on the stock list (ADR-0231): the pure half. The api gathers candidates from the
 * catalogue (the source's words and its category); this pre-filter keeps those of the same kind and
 * the same pack size, ranks them, and is the answer itself when no model is connected or it fails.
 * A pack size is read from the name («3кг», «500 гр», «0,5л») or else from the product's weight.
 */

/** Candidates the model is shown at most; the pre-filter's answer is cut to the same. */
export const SIMILAR_MAX_CANDIDATES = 30;
/** Two weights are one size when they differ by at most this share of the source's (5 %). */
const WEIGHT_TOLERANCE = new Decimal('0.05');
/** A name's words count as one kind from this trigram likeness (pg_trgm's `similarity`). */
const KIND_LIKENESS = 0.4;
/** A word of the same category that is this alike is kept for the model to judge. */
const CATEGORY_LIKENESS = 0.2;

/** A pack size: grams for a mass, millilitres for a volume. */
export interface PackSize {
  measure: 'MASS' | 'VOLUME';
  amount: Decimal;
}

/** Unit words of a name, as `tokenize` lower-cases them, with their factor to g or ml. */
const MASS_UNITS: Readonly<Record<string, number>> = {
  кг: 1000,
  kg: 1000,
  гр: 1,
  г: 1,
  gr: 1,
  g: 1,
};
const VOLUME_UNITS: Readonly<Record<string, number>> = {
  л: 1000,
  l: 1000,
  литр: 1000,
  мл: 1,
  ml: 1,
};
const UNIT_WORDS = new Set([
  ...Object.keys(MASS_UNITS),
  ...Object.keys(VOLUME_UNITS),
  'ш',
  'ширхэг',
  'pcs',
  'x',
  'х',
]);

/** The first «number unit» of a name («Лапша 3кг» → 3000 g), or null when it names none. */
export function packSizeOf(name: string): PackSize | null {
  const words = tokenize(name);
  for (let at = 0; at + 1 < words.length; at += 1) {
    const number = words[at] ?? '';
    const unit = words[at + 1] ?? '';
    if (!/^\d+(\.\d+)?$/.test(number)) continue;
    const mass = MASS_UNITS[unit];
    if (mass !== undefined) return { measure: 'MASS', amount: new Decimal(number).times(mass) };
    const volume = VOLUME_UNITS[unit];
    if (volume !== undefined) {
      return { measure: 'VOLUME', amount: new Decimal(number).times(volume) };
    }
  }
  return null;
}

/** A product as the pre-filter reads it. */
export interface SimilarCandidate {
  id: number;
  name: string;
  categoryId: number;
  /** Net weight of one base unit in kilograms, as a decimal string or Decimal; null unknown. */
  weightKg: Decimal | string | null;
}

/** A kept candidate with why it was kept. */
export interface RankedCandidate<T extends SimilarCandidate = SimilarCandidate> {
  product: T;
  /** Trigram likeness of the two names without their sizes, 0 … 1. */
  likeness: number;
  /** Shares a word of three letters or more with the source (sizes left out). */
  sameKind: boolean;
  /** Same pack size; null when either size is unknown. */
  sameSize: boolean | null;
  sameCategory: boolean;
}

/** A name's words without numbers and unit words, look-alike Latin letters folded (strict key). */
export function kindWords(name: string): string[] {
  return searchKeys(name)
    .strict.split(' ')
    .filter((word) => word !== '' && !/\d/.test(word) && !UNIT_WORDS.has(word));
}

/** The source's words worth searching the catalogue for: three letters or more, at most three. */
export function searchWordsOf(name: string): string[] {
  return [...new Set(kindWords(name).filter((word) => [...word].length >= 3))].slice(0, 3);
}

/** pg_trgm's trigrams of a word list: each word padded with two spaces before and one after. */
function trigrams(words: readonly string[]): Set<string> {
  const result = new Set<string>();
  for (const word of words) {
    const letters = [...`  ${word} `];
    for (let at = 0; at + 3 <= letters.length; at += 1) {
      result.add(letters.slice(at, at + 3).join(''));
    }
  }
  return result;
}

/** pg_trgm's `similarity` of two word lists: shared trigrams over all trigrams. */
export function likenessOf(a: readonly string[], b: readonly string[]): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

const decimalOf = (value: Decimal | string | null): Decimal | null => {
  if (value === null) return null;
  const decimal = new Decimal(value);
  return decimal.gt(0) ? decimal : null;
};

/** Whether two weights in one unit are one size: within 5 % of the first. */
function closeTo(source: Decimal, other: Decimal): boolean {
  return source.minus(other).abs().lte(source.times(WEIGHT_TOLERANCE));
}

/** One product's size as grams (a name's mass or the weight) or millilitres; null unknown. */
function sizeOf(product: SimilarCandidate): PackSize | null {
  const named = packSizeOf(product.name);
  if (named) return named;
  const kg = decimalOf(product.weightKg);
  return kg ? { measure: 'MASS', amount: kg.times(1000) } : null;
}

/** Whether two products are one pack size; null when either size is unknown. */
export function sameSizeOf(source: SimilarCandidate, other: SimilarCandidate): boolean | null {
  const left = sizeOf(source);
  const right = sizeOf(other);
  if (!left || !right) return null;
  if (left.measure !== right.measure) {
    // A name in litres and a weight in kilograms: the weights still compare.
    const a = decimalOf(source.weightKg);
    const b = decimalOf(other.weightKg);
    return a && b ? closeTo(a, b) : null;
  }
  return left.amount.eq(right.amount) || closeTo(left.amount, right.amount);
}

/**
 * The candidates worth showing the model, best first: the same kind (a shared word, or names alike)
 * or alike in the same category, never of another size when both sizes are known. The source and
 * repeats are left out; at most SIMILAR_MAX_CANDIDATES.
 */
export function prefilterSimilar<T extends SimilarCandidate>(
  source: SimilarCandidate,
  candidates: readonly T[],
): RankedCandidate<T>[] {
  const sourceWords = kindWords(source.name);
  const searchWords = new Set(searchWordsOf(source.name));
  const seen = new Set<number>([source.id]);
  const kept: RankedCandidate<T>[] = [];
  for (const product of candidates) {
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    const words = kindWords(product.name);
    const likeness = likenessOf(sourceWords, words);
    const sameKind = words.some((word) => searchWords.has(word)) || likeness >= KIND_LIKENESS;
    const sameCategory = product.categoryId === source.categoryId;
    if (!sameKind && !(sameCategory && likeness >= CATEGORY_LIKENESS)) continue;
    const sameSize = sameSizeOf(source, product);
    if (sameSize === false) continue;
    kept.push({ product, likeness, sameKind, sameSize, sameCategory });
  }
  kept.sort(
    (a, b) =>
      rank(b.sameSize === true) - rank(a.sameSize === true) ||
      rank(b.sameKind) - rank(a.sameKind) ||
      b.likeness - a.likeness ||
      a.product.name.localeCompare(b.product.name, 'mn') ||
      a.product.id - b.product.id,
  );
  return kept.slice(0, SIMILAR_MAX_CANDIDATES);
}

const rank = (value: boolean) => (value ? 1 : 0);

/**
 * The answer without the model: the pre-filter's candidates of the same kind and the same size.
 * When the source's own size is unknown, the same kind alone.
 */
export function fallbackSimilar<T extends SimilarCandidate>(
  source: SimilarCandidate,
  ranked: readonly RankedCandidate<T>[],
): T[] {
  const sized = sizeOf(source) !== null;
  return ranked
    .filter((entry) => entry.sameKind && (sized ? entry.sameSize === true : true))
    .map((entry) => entry.product);
}
