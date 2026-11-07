import {
  EXPIRY_QTY_PATTERN,
  type ExpiryStatus,
  type ExpiryUrgency,
  isExpiryDateInRange,
} from '@tugeel/shared/expiry';
import { Decimal } from '@tugeel/shared/money';
import { isIsoDate } from '@tugeel/shared/time';
import { formatQty } from '../format/format';
import { colors } from '../theme/tokens';

// «Хугацаа илрүүлэлт» (ADR-0172 #9): what the staff app decides by itself. «Today» is always the
// server's (the summary's `today`, a row's `daysLeft`), and the server has the last word on every
// rule here; these only stop a save that would be refused and say why at once.

const DAY_MS = 24 * 3600 * 1000;
/** The longest whole part `EXPIRY_QTY_PATTERN` takes. */
const QTY_MAX_DIGITS = 11;
const QTY_MAX_DECIMALS = 3;

/** The list's chips, in the summary's words. */
export const EXPIRY_CHIPS = ['ACTIVE', 'EXPIRED', 'URGENT', 'SOON', 'ARCHIVED'] as const;
export type ExpiryChip = (typeof EXPIRY_CHIPS)[number];

export interface ExpiryCounts {
  active: number;
  expired: number;
  urgent: number;
  soon: number;
  archived: number;
}

export function chipCount(counts: ExpiryCounts, chip: ExpiryChip): number {
  switch (chip) {
    case 'ACTIVE':
      return counts.active;
    case 'EXPIRED':
      return counts.expired;
    case 'URGENT':
      return counts.urgent;
    case 'SOON':
      return counts.soon;
    case 'ARCHIVED':
      return counts.archived;
  }
}

export interface ExpiryTone {
  background: string;
  text: string;
}

export const URGENCY_TONES: Record<ExpiryUrgency, ExpiryTone> = {
  EXPIRED: { background: colors.destructiveSoft, text: colors.destructive },
  URGENT: { background: colors.warningSoft, text: colors.warning },
  SOON: { background: colors.secondary, text: colors.secondaryForeground },
  OK: { background: colors.successSoft, text: colors.success },
};

export const STATUS_TONES: Record<ExpiryStatus, ExpiryTone> = {
  REVIEW: { background: colors.secondary, text: colors.secondaryForeground },
  CITY_RETURN: { background: colors.violetSoft, text: colors.violet },
  INTERNAL_SALE: { background: colors.warningSoft, text: colors.warningText },
  ARCHIVED: { background: colors.fill, text: colors.muted },
};

/** The statuses a person chooses between on an open record; archiving has its own button. */
export const OPEN_STATUSES = ['REVIEW', 'CITY_RETURN', 'INTERNAL_SALE'] as const;

/** `2026-11-07` as a list shows it, `2026/11/07`. */
export function displayDate(date: string): string {
  return date.replace(/-/g, '/');
}

const utcDay = (date: string): number => {
  const [year = 0, month = 1, day = 1] = date.split('-').map((part) => Number.parseInt(part, 10));
  return Date.UTC(year, month - 1, day);
};

/** Whole days from the server's `today` to `date`, both `YYYY-MM-DD`; negative when past. */
export function daysLeftOf(date: string, today: string): number {
  return Math.round((utcDay(date) - utcDay(today)) / DAY_MS);
}

/** The days in words (`expiry.days.*`): «3 хоног өнгөрсөн», «Өнөөдөр дуусна», «12 хоног үлдсэн». */
export function daysWords(daysLeft: number) {
  if (daysLeft < 0) return { key: 'expiry.days.past', n: -daysLeft } as const;
  if (daysLeft === 0) return { key: 'expiry.days.today', n: 0 } as const;
  return { key: 'expiry.days.left', n: daysLeft } as const;
}

/**
 * What a count's field keeps of the typed text: digits, and for a fractional unit one separator (a
 * comma counts) with three decimals. A whole unit keeps what stands before a separator.
 */
export function cleanQty(text: string, fractional: boolean): string {
  const [whole = '', ...rest] = text
    .replace(/,/g, '.')
    .replace(/[^\d.]/g, '')
    .split('.');
  const digits = whole.slice(0, QTY_MAX_DIGITS);
  if (!fractional || rest.length === 0) return digits;
  return `${digits === '' ? '0' : digits}.${rest.join('').slice(0, QTY_MAX_DECIMALS)}`;
}

const asQty = (text: string): string => (text === '' ? '0' : text);

/** Two counts as the same number; text that is not a count differs from everything. */
function sameQty(a: string, b: string): boolean {
  const left = asQty(a);
  const right = asQty(b);
  if (!EXPIRY_QTY_PATTERN.test(left) || !EXPIRY_QTY_PATTERN.test(right)) return left === right;
  return new Decimal(left).eq(new Decimal(right));
}

/** A count as it is sent: an empty field is 0, no leading or trailing zeros. */
function normalQty(text: string): string {
  const value = asQty(text);
  return EXPIRY_QTY_PATTERN.test(value) ? new Decimal(value).toFixed() : value;
}

export type DateProblem = 'date' | 'range';
export type QtyProblem = 'qty' | 'whole';

export interface FormProblems {
  date: DateProblem | null;
  floor: QtyProblem | null;
  warehouse: QtyProblem | null;
  /** A new record with nothing counted (ADR-0172 #2). */
  counts: boolean;
}

/** Null `today`: the summary did not load, so only the server can check how far the date lies. */
function dateProblem(date: string, today: string | null): DateProblem | null {
  if (!isIsoDate(date)) return 'date';
  return today !== null && !isExpiryDateInRange(date, today) ? 'range' : null;
}

/** `fractional` null: not known (yet), so a count must be whole, which is what most goods are. */
function qtyProblem(text: string, fractional: boolean | null): QtyProblem | null {
  const value = asQty(text);
  if (!EXPIRY_QTY_PATTERN.test(value)) return 'qty';
  return fractional !== true && !new Decimal(value).isInteger() ? 'whole' : null;
}

export function hasProblems(problems: FormProblems): boolean {
  return (
    problems.date !== null ||
    problems.floor !== null ||
    problems.warehouse !== null ||
    problems.counts
  );
}

export interface ExpiryForm {
  date: string;
  floor: string;
  warehouse: string;
  note: string;
}

export const EMPTY_EXPIRY_FORM: ExpiryForm = { date: '', floor: '', warehouse: '', note: '' };

/**
 * Whether leaving a new record would lose typing: a product is chosen and a field holds something,
 * a typed 0 too. Without a product the form is off the screen, and there is nothing to ask about.
 */
export function isNewRecordTyped(productChosen: boolean, form: ExpiryForm): boolean {
  return (
    productChosen &&
    [form.date, form.floor, form.warehouse, form.note].some((value) => value.trim() !== '')
  );
}

/** A new record: a real date in range, counts that are numbers, at least one above zero. */
export function problemsOfNew(
  form: ExpiryForm,
  today: string | null,
  fractional: boolean | null,
): FormProblems {
  const floor = qtyProblem(form.floor, fractional);
  const warehouse = qtyProblem(form.warehouse, fractional);
  return {
    date: dateProblem(form.date, today),
    floor,
    warehouse,
    counts:
      floor === null &&
      warehouse === null &&
      new Decimal(asQty(form.floor)).isZero() &&
      new Decimal(asQty(form.warehouse)).isZero(),
  };
}

export function createBodyOf(
  productId: number,
  form: ExpiryForm,
  allowDuplicate: boolean,
): {
  productId: number;
  expiryDate: string;
  qtyFloor: string;
  qtyWarehouse: string;
  note?: string;
  allowDuplicate?: boolean;
} {
  const note = form.note.trim();
  return {
    productId,
    expiryDate: form.date,
    qtyFloor: normalQty(form.floor),
    qtyWarehouse: normalQty(form.warehouse),
    ...(note === '' ? {} : { note }),
    ...(allowDuplicate ? { allowDuplicate: true } : {}),
  };
}

/**
 * What «Шинээр нэмэх» said yes to: the product, the date and the counts as they are sent. The yes
 * stands while these do, so a retry after a lost answer sends the body its key already holds and the
 * server replays the record instead of asking again (ADR-0172 #5); the note is free to change.
 */
export function duplicateChoiceOf(productId: number, form: ExpiryForm): string {
  const { expiryDate, qtyFloor, qtyWarehouse } = createBodyOf(productId, form, false);
  return [productId, expiryDate, qtyFloor, qtyWarehouse].join(' ');
}

/**
 * Whether an empty list is still waiting for its answer: its first read, or an earlier empty answer
 * kept in its place while the next chip's or search's read runs. Until then a screen must not say
 * there is nothing.
 */
export function isAwaitingRows(
  query: { isLoading: boolean; isPlaceholderData: boolean },
  rows: number,
): boolean {
  return rows === 0 && (query.isLoading || query.isPlaceholderData);
}

/** What a record holds of the correctable fields. */
export interface ExpiryStanding {
  expiryDate: string;
  qtyFloor: string;
  qtyWarehouse: string;
  note: string | null;
}

/**
 * What the person typed over a record; a field never touched is absent and follows the server, so
 * a reload brings another person's change there and leaves the typed fields alone (ADR-0172 #6).
 */
export type ExpiryEdits = Partial<ExpiryForm>;

/** The form's values: the typed ones over what stands. */
export function formOf(standing: ExpiryStanding, edits: ExpiryEdits): ExpiryForm {
  return {
    date: edits.date ?? standing.expiryDate,
    floor: edits.floor ?? standing.qtyFloor,
    warehouse: edits.warehouse ?? standing.qtyWarehouse,
    note: edits.note ?? standing.note ?? '',
  };
}

/**
 * A correction checks only what changes (the server's rule): a carried record outside today's rules
 * can still be corrected, and a later edit may bring both counts to zero (ADR-0172 #2).
 */
export function problemsOfEdit(
  standing: ExpiryStanding,
  edits: ExpiryEdits,
  today: string | null,
  fractional: boolean | null,
): FormProblems {
  const { date, floor, warehouse } = formOf(standing, edits);
  return {
    date: date === standing.expiryDate ? null : dateProblem(date, today),
    floor: sameQty(floor, standing.qtyFloor) ? null : qtyProblem(floor, fractional),
    warehouse: sameQty(warehouse, standing.qtyWarehouse) ? null : qtyProblem(warehouse, fractional),
    counts: false,
  };
}

export interface ExpiryPatch {
  expectedVersion: number;
  expiryDate?: string;
  qtyFloor?: string;
  qtyWarehouse?: string;
  note?: string;
}

/**
 * What the person typed that differs from what stands; a field that matches, or was never touched,
 * is absent. Counts compare as numbers and an empty one is 0; the note is trimmed.
 */
export function typedChanges(standing: ExpiryStanding, edits: ExpiryEdits): ExpiryEdits {
  const { date, floor, warehouse, note } = formOf(standing, edits);
  const typedNote = note.trim();
  return {
    ...(date === standing.expiryDate ? {} : { date }),
    ...(sameQty(floor, standing.qtyFloor) ? {} : { floor: asQty(floor) }),
    ...(sameQty(warehouse, standing.qtyWarehouse) ? {} : { warehouse: asQty(warehouse) }),
    ...(typedNote === (standing.note ?? '') ? {} : { note: typedNote }),
  };
}

/** The `PATCH` of a correction: only the fields that differ from what stands; null when none do. */
export function patchOf(
  standing: ExpiryStanding,
  edits: ExpiryEdits,
  expectedVersion: number,
): ExpiryPatch | null {
  const typed = typedChanges(standing, edits);
  if (Object.keys(typed).length === 0) return null;
  return {
    expectedVersion,
    ...(typed.date === undefined ? {} : { expiryDate: typed.date }),
    ...(typed.floor === undefined ? {} : { qtyFloor: normalQty(typed.floor) }),
    ...(typed.warehouse === undefined ? {} : { qtyWarehouse: normalQty(typed.warehouse) }),
    ...(typed.note === undefined ? {} : { note: typed.note }),
  };
}

/**
 * After a refusal, what stands now beside each typed field that differs from it, so a second save
 * overwrites only what the person has seen (ADR-0172 #6). Counts as a list shows them; an empty
 * string is a note that stands empty.
 */
export function standingBeside(standing: ExpiryStanding, edits: ExpiryEdits): ExpiryEdits {
  const typed = typedChanges(standing, edits);
  return {
    ...(typed.date === undefined ? {} : { date: standing.expiryDate }),
    ...(typed.floor === undefined ? {} : { floor: formatQty(standing.qtyFloor) }),
    ...(typed.warehouse === undefined ? {} : { warehouse: formatQty(standing.qtyWarehouse) }),
    ...(typed.note === undefined ? {} : { note: standing.note ?? '' }),
  };
}

/**
 * What of the typing stays on the screen, read-only, when an archive reaches the record: the fields
 * that differ, since nothing else holds them (ADR-0172 #9). Null when nothing was typed, and when
 * the person archived it themselves, having been told that the typed values go.
 */
export function keptByArchive(
  standing: ExpiryStanding,
  edits: ExpiryEdits,
  ownArchive: boolean,
): ExpiryEdits | null {
  if (ownArchive) return null;
  const typed = typedChanges(standing, edits);
  return Object.keys(typed).length === 0 ? null : typed;
}

export interface QtyMove {
  from: string;
  to: string;
}

/** What a history row moved: the floor's and the warehouse's count, each null when it stood still. */
export function movesOf(change: {
  qtyFloorOld: string;
  qtyFloorNew: string;
  qtyWarehouseOld: string;
  qtyWarehouseNew: string;
}): { floor: QtyMove | null; warehouse: QtyMove | null } {
  const move = (from: string, to: string) =>
    sameQty(from, to) ? null : { from: formatQty(from), to: formatQty(to) };
  return {
    floor: move(change.qtyFloorOld, change.qtyFloorNew),
    warehouse: move(change.qtyWarehouseOld, change.qtyWarehouseNew),
  };
}

/**
 * Whose answer still counts when answers can overtake each other: each request takes a turn, and so
 * does whatever makes a waiting answer pointless (a product chosen by hand). Only the latest turn
 * may act on its answer, so a slow lookup never swaps the product under values typed for another.
 */
export function createTurns() {
  let latest = 0;
  return {
    take: (): number => {
      latest += 1;
      return latest;
    },
    isLatest: (turn: number): boolean => turn === latest,
  };
}

/** The product a record is being written for. */
export interface ChosenProduct {
  id: number;
  sku: string;
  name: string;
  baseUnit: string;
  /** When a box's barcode was read: «1 хайрцаг = 24 ш», since counts are in the base unit. */
  pack: { unit: string; n: string } | null;
}

interface ProductFacts {
  id: number;
  sku: string;
  name: string;
  baseUnit: { uomName: string };
}

export function chosenFromLookup(product: ProductFacts): ChosenProduct {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    baseUnit: product.baseUnit.uomName,
    pack: null,
  };
}

export function chosenFromBarcode(found: {
  product: ProductFacts;
  unit: { uomName: string; factorToBase: string; isBase: boolean };
}): ChosenProduct {
  return {
    ...chosenFromLookup(found.product),
    pack: found.unit.isBase
      ? null
      : { unit: found.unit.uomName, n: formatQty(found.unit.factorToBase) },
  };
}
