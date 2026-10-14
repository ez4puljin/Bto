import { PRODUCT_STAGES } from '../catalog';
import { Decimal } from '../money';
import { CUSTOMER_KINDS } from '../taxpayer';
import { addDays, isIsoDate } from '../time';

/**
 * Segments (ADR-0049): saved conditions over one entity, combined in AND / OR groups and answered
 * by the module that owns each field's data. A list filter is the same tree, not saved. The api
 * (DTO checks, the evaluator, stored rows) and the web (the filter menu, the segment editor) check
 * a definition with `segmentIssue`; messages live in mn.json under `segments.issues`.
 */
export const SEGMENT_ENTITIES = ['PRODUCT', 'CUSTOMER', 'SUPPLIER'] as const;
export type SegmentEntity = (typeof SEGMENT_ENTITIES)[number];

/** ALL: every part holds (intersection); ANY: at least one does (union). */
export const SEGMENT_MATCHES = ['ALL', 'ANY'] as const;
export type SegmentMatch = (typeof SEGMENT_MATCHES)[number];

export const SEGMENT_OPERATORS = [
  'IN',
  'NOT_IN',
  'MAIN_IN',
  'ANY',
  'NONE',
  'IS',
  'YES',
  'NO',
  'BETWEEN',
  'LAST_DAYS',
  'CONTAINS',
  'IN_STOCK',
  'OUT_OF_STOCK',
  'AT_OR_BELOW_MIN',
] as const;
export type SegmentOperator = (typeof SEGMENT_OPERATORS)[number];

/** Operators that keep the records outside a positive set ("all except …"). */
export const NEGATIVE_OPERATORS: readonly SegmentOperator[] = ['NOT_IN', 'NONE', 'OUT_OF_STOCK'];

/** What a product may lack (`missing IS`); suppliers, homes and prices are their owners' NONE. */
export const PRODUCT_MISSING = [
  'BASE_BARCODE',
  'ANY_BARCODE',
  'PHOTO',
  'WEIGHT',
  'EBARIMT',
] as const;
export type ProductMissing = (typeof PRODUCT_MISSING)[number];

export const PARTNER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

/**
 * One condition: a field, an operator and only the slots that operator needs. Ids are positive
 * integers; dates are Ulaanbaatar days (YYYY-MM-DD, both ends included); money is whole MNT.
 */
export interface SegmentCondition {
  field: string;
  op: SegmentOperator;
  ids?: number[];
  values?: string[];
  from?: string;
  to?: string;
  days?: number;
  min?: string;
  max?: string;
  warehouseId?: number;
  text?: string;
}

export interface SegmentGroup {
  match: SegmentMatch;
  conditions: SegmentCondition[];
}

/** (A ∧ B) ∨ (C ∧ D) and (A ∨ B) ∧ (C ∨ D): a match over groups, each a match over conditions. */
export interface SegmentDefinition {
  match: SegmentMatch;
  groups: SegmentGroup[];
}

/** The stored shape's version; a breaking registry change bumps it with a migration. */
export const SEGMENT_DEFINITION_VERSION = 1;
export const MAX_SEGMENT_GROUPS = 10;
export const MAX_GROUP_CONDITIONS = 10;
export const MAX_SEGMENT_CONDITIONS = 30;
export const MAX_CONDITION_IDS = 200;
export const MAX_LAST_DAYS = 3650;
export const MAX_SEGMENT_TEXT = 100;
export const MAX_SEGMENT_NAME = 80;
export const MAX_SEGMENT_DESCRIPTION = 500;
/** Segments whose counts one request may ask for. */
export const MAX_SEGMENT_COUNTS = 50;

/** Which module answers a field (ADR-0049 #3). */
export type SegmentFieldOwner = 'catalog' | 'partners' | 'inventory' | 'pricing';

/** How a field's value is given; it decides the slots each operator needs. */
export type SegmentFieldInput = 'ids' | 'values' | 'dates' | 'money' | 'text' | 'flag' | 'stock';

export interface SegmentField {
  owner: SegmentFieldOwner;
  input: SegmentFieldInput;
  ops: readonly SegmentOperator[];
  /** The allowed `values` of a `values` field. */
  values?: readonly string[];
  /** `values` fields that take exactly one value (`missing IS …`). */
  single?: boolean;
}

const DATES = { input: 'dates', ops: ['BETWEEN', 'LAST_DAYS'] } as const;

export const SEGMENT_FIELDS: Record<SegmentEntity, Readonly<Record<string, SegmentField>>> = {
  PRODUCT: {
    search: { owner: 'catalog', input: 'text', ops: ['CONTAINS'] },
    category: { owner: 'catalog', input: 'ids', ops: ['IN', 'NOT_IN'] },
    stage: { owner: 'catalog', input: 'values', values: PRODUCT_STAGES, ops: ['IN', 'NOT_IN'] },
    createdAt: { owner: 'catalog', ...DATES },
    updatedAt: { owner: 'catalog', ...DATES },
    missing: {
      owner: 'catalog',
      input: 'values',
      values: PRODUCT_MISSING,
      single: true,
      ops: ['IS'],
    },
    supplier: {
      owner: 'partners',
      input: 'ids',
      ops: ['IN', 'MAIN_IN', 'NOT_IN', 'ANY', 'NONE'],
    },
    homeWarehouse: { owner: 'inventory', input: 'ids', ops: ['IN', 'NOT_IN', 'ANY', 'NONE'] },
    stock: {
      owner: 'inventory',
      input: 'stock',
      ops: ['IN_STOCK', 'OUT_OF_STOCK', 'AT_OR_BELOW_MIN'],
    },
    priceProfile: { owner: 'pricing', input: 'ids', ops: ['IN', 'NOT_IN', 'ANY', 'NONE'] },
    warehousePrice: { owner: 'pricing', input: 'money', ops: ['BETWEEN'] },
  },
  CUSTOMER: {
    search: { owner: 'partners', input: 'text', ops: ['CONTAINS'] },
    kind: { owner: 'partners', input: 'values', values: CUSTOMER_KINDS, ops: ['IN'] },
    status: { owner: 'partners', input: 'values', values: PARTNER_STATUSES, ops: ['IN'] },
    creditHold: { owner: 'partners', input: 'flag', ops: ['YES', 'NO'] },
    tinPending: { owner: 'partners', input: 'flag', ops: ['YES', 'NO'] },
    gpsMissing: { owner: 'partners', input: 'flag', ops: ['YES', 'NO'] },
    createdAt: { owner: 'partners', ...DATES },
  },
  SUPPLIER: {
    search: { owner: 'partners', input: 'text', ops: ['CONTAINS'] },
    status: { owner: 'partners', input: 'values', values: PARTNER_STATUSES, ops: ['IN'] },
    products: { owner: 'partners', input: 'flag', ops: ['ANY', 'NONE'] },
    createdAt: { owner: 'partners', ...DATES },
  },
};

export const SEGMENT_ISSUES = [
  'NOT_AN_OBJECT',
  'MATCH_INVALID',
  'NO_GROUPS',
  'TOO_MANY_GROUPS',
  'NO_CONDITIONS',
  'TOO_MANY_CONDITIONS',
  'FIELD_NOT_ALLOWED',
  'OPERATOR_NOT_ALLOWED',
  'VALUE_MISSING',
  'VALUE_NOT_ALLOWED',
  'IDS_INVALID',
  'TOO_MANY_VALUES',
  'VALUES_INVALID',
  'DATE_INVALID',
  'DATE_ORDER',
  'DAYS_RANGE',
  'MONEY_INVALID',
  'MONEY_ORDER',
  'TEXT_INVALID',
] as const;
export type SegmentIssue = (typeof SEGMENT_ISSUES)[number];

export interface SegmentProblem {
  issue: SegmentIssue;
  /** Dot path inside the definition, e.g. `groups.0.conditions.1.ids`. */
  path: string;
}

type Slot = 'ids' | 'values' | 'from' | 'to' | 'days' | 'min' | 'max' | 'warehouseId' | 'text';
const SLOTS: readonly Slot[] = [
  'ids',
  'values',
  'from',
  'to',
  'days',
  'min',
  'max',
  'warehouseId',
  'text',
];
const WHOLE_MNT = /^(0|[1-9]\d{0,11})$/;

/** The slots an operator takes for a field's input: required, and optional ones. */
export function operatorSlots(
  input: SegmentFieldInput,
  op: SegmentOperator,
): { required: readonly Slot[]; optional: readonly Slot[] } {
  if (input === 'ids' && (op === 'IN' || op === 'NOT_IN' || op === 'MAIN_IN')) {
    return { required: ['ids'], optional: [] };
  }
  if (input === 'values') return { required: ['values'], optional: [] };
  if (input === 'dates' && op === 'BETWEEN') return { required: [], optional: ['from', 'to'] };
  if (input === 'dates' && op === 'LAST_DAYS') return { required: ['days'], optional: [] };
  if (input === 'money') return { required: [], optional: ['min', 'max'] };
  if (input === 'text') return { required: ['text'], optional: [] };
  if (input === 'stock') return { required: [], optional: ['warehouseId'] };
  return { required: [], optional: [] };
}

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Why a definition cannot be used for an entity, with the path at fault, or null. It accepts any
 * value so a stored row can be checked again (`SEGMENT_INVALID`) as well as a request body.
 */
export function segmentIssue(entity: SegmentEntity, definition: unknown): SegmentProblem | null {
  if (!isObject(definition)) return { issue: 'NOT_AN_OBJECT', path: '' };
  if (!SEGMENT_MATCHES.some((match) => match === definition.match)) {
    return { issue: 'MATCH_INVALID', path: 'match' };
  }
  const groups = definition.groups;
  if (!Array.isArray(groups) || groups.length === 0) return { issue: 'NO_GROUPS', path: 'groups' };
  if (groups.length > MAX_SEGMENT_GROUPS) return { issue: 'TOO_MANY_GROUPS', path: 'groups' };
  let total = 0;
  for (const [g, group] of groups.entries()) {
    const at = `groups.${g}`;
    if (!isObject(group)) return { issue: 'NOT_AN_OBJECT', path: at };
    if (!SEGMENT_MATCHES.some((match) => match === group.match)) {
      return { issue: 'MATCH_INVALID', path: `${at}.match` };
    }
    const conditions = group.conditions;
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return { issue: 'NO_CONDITIONS', path: `${at}.conditions` };
    }
    if (conditions.length > MAX_GROUP_CONDITIONS) {
      return { issue: 'TOO_MANY_CONDITIONS', path: `${at}.conditions` };
    }
    total += conditions.length;
    if (total > MAX_SEGMENT_CONDITIONS) {
      return { issue: 'TOO_MANY_CONDITIONS', path: `${at}.conditions` };
    }
    for (const [c, condition] of conditions.entries()) {
      const problem = conditionIssue(entity, condition, `${at}.conditions.${c}`);
      if (problem) return problem;
    }
  }
  return null;
}

function conditionIssue(entity: SegmentEntity, raw: unknown, at: string): SegmentProblem | null {
  if (!isObject(raw)) return { issue: 'NOT_AN_OBJECT', path: at };
  const field = typeof raw.field === 'string' ? SEGMENT_FIELDS[entity][raw.field] : undefined;
  if (
    !field ||
    typeof raw.field !== 'string' ||
    !Object.hasOwn(SEGMENT_FIELDS[entity], raw.field)
  ) {
    return { issue: 'FIELD_NOT_ALLOWED', path: `${at}.field` };
  }
  const op = field.ops.find((candidate) => candidate === raw.op);
  if (!op) return { issue: 'OPERATOR_NOT_ALLOWED', path: `${at}.op` };
  const { required, optional } = operatorSlots(field.input, op);
  for (const slot of SLOTS) {
    const present = raw[slot] !== undefined && raw[slot] !== null;
    if (present && !required.includes(slot) && !optional.includes(slot)) {
      return { issue: 'VALUE_NOT_ALLOWED', path: `${at}.${slot}` };
    }
    if (!present && required.includes(slot)) {
      return { issue: 'VALUE_MISSING', path: `${at}.${slot}` };
    }
  }
  if (raw.ids !== undefined && raw.ids !== null) {
    const ids = raw.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isPositiveInt)) {
      return { issue: 'IDS_INVALID', path: `${at}.ids` };
    }
    if (ids.length > MAX_CONDITION_IDS) return { issue: 'TOO_MANY_VALUES', path: `${at}.ids` };
  }
  if (raw.values !== undefined && raw.values !== null) {
    const values = raw.values;
    const allowed = field.values ?? [];
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      !values.every((value) => typeof value === 'string' && allowed.includes(value)) ||
      new Set(values).size !== values.length
    ) {
      return { issue: 'VALUES_INVALID', path: `${at}.values` };
    }
    if (field.single && values.length !== 1) {
      return { issue: 'TOO_MANY_VALUES', path: `${at}.values` };
    }
  }
  if (field.input === 'dates' && op === 'BETWEEN') {
    const from = raw.from ?? undefined;
    const to = raw.to ?? undefined;
    if (from === undefined && to === undefined)
      return { issue: 'VALUE_MISSING', path: `${at}.from` };
    for (const [slot, value] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (value !== undefined && (typeof value !== 'string' || !isIsoDate(value))) {
        return { issue: 'DATE_INVALID', path: `${at}.${slot}` };
      }
    }
    if (typeof from === 'string' && typeof to === 'string' && from > to) {
      return { issue: 'DATE_ORDER', path: `${at}.to` };
    }
  }
  if (raw.days !== undefined && raw.days !== null) {
    if (!isPositiveInt(raw.days) || raw.days > MAX_LAST_DAYS) {
      return { issue: 'DAYS_RANGE', path: `${at}.days` };
    }
  }
  if (field.input === 'money') {
    const min = raw.min ?? undefined;
    const max = raw.max ?? undefined;
    if (min === undefined && max === undefined)
      return { issue: 'VALUE_MISSING', path: `${at}.min` };
    for (const [slot, value] of [
      ['min', min],
      ['max', max],
    ] as const) {
      if (value !== undefined && (typeof value !== 'string' || !WHOLE_MNT.test(value))) {
        return { issue: 'MONEY_INVALID', path: `${at}.${slot}` };
      }
    }
    if (typeof min === 'string' && typeof max === 'string' && new Decimal(min).gt(max)) {
      return { issue: 'MONEY_ORDER', path: `${at}.max` };
    }
  }
  if (
    raw.warehouseId !== undefined &&
    raw.warehouseId !== null &&
    !isPositiveInt(raw.warehouseId)
  ) {
    return { issue: 'IDS_INVALID', path: `${at}.warehouseId` };
  }
  if (raw.text !== undefined && raw.text !== null) {
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (text.length === 0 || text.length > MAX_SEGMENT_TEXT) {
      return { issue: 'TEXT_INVALID', path: `${at}.text` };
    }
  }
  return null;
}

/** Every condition of a definition, with its group's match (the evaluator's walk). */
export function segmentConditions(definition: SegmentDefinition): SegmentCondition[] {
  return definition.groups.flatMap((group) => group.conditions);
}

/** Whether a definition needs the universe of its entity (a negative operator somewhere). */
export function needsUniverse(definition: SegmentDefinition): boolean {
  return segmentConditions(definition).some((condition) =>
    NEGATIVE_OPERATORS.includes(condition.op),
  );
}

/**
 * A condition as a stable text key: the same condition written twice is evaluated once per
 * request (keys in a fixed order, ids sorted).
 */
export function conditionKey(condition: SegmentCondition): string {
  return JSON.stringify([
    condition.field,
    condition.op,
    condition.ids ? [...condition.ids].sort((a, b) => a - b) : null,
    condition.values ? [...condition.values].sort() : null,
    condition.from ?? null,
    condition.to ?? null,
    condition.days ?? null,
    condition.min ?? null,
    condition.max ?? null,
    condition.warehouseId ?? null,
    condition.text?.trim() ?? null,
  ]);
}

const POSITIVE: Partial<Record<SegmentOperator, SegmentOperator>> = {
  NOT_IN: 'IN',
  NONE: 'ANY',
  OUT_OF_STOCK: 'IN_STOCK',
};

/**
 * The positive form of a condition and whether the evaluator takes its complement (ADR-0049 #3):
 * owners answer only positive conditions; «аль нь ч биш», «байхгүй» and «дууссан» are the universe
 * minus the matching set.
 */
export function positiveCondition(condition: SegmentCondition): {
  condition: SegmentCondition;
  negated: boolean;
} {
  const op = POSITIVE[condition.op];
  return op ? { condition: { ...condition, op }, negated: true } : { condition, negated: false };
}

/**
 * The Ulaanbaatar days of a date condition, both ends included: BETWEEN as given, LAST_DAYS n as
 * today and the n − 1 days before it.
 */
export function conditionDays(
  condition: SegmentCondition,
  today: string,
): { from?: string; to?: string } {
  if (condition.op === 'LAST_DAYS' && condition.days !== undefined) {
    return { from: addDays(today, -(condition.days - 1)) };
  }
  return {
    ...(condition.from ? { from: condition.from } : {}),
    ...(condition.to ? { to: condition.to } : {}),
  };
}
