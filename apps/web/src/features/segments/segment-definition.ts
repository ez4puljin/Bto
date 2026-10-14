import { PRODUCT_STAGES } from '@tugeel/shared/catalog';
import {
  MAX_SEGMENT_TEXT,
  operatorSlots,
  SEGMENT_ENTITIES,
  SEGMENT_FIELDS,
  type SegmentCondition,
  type SegmentDefinition,
  type SegmentEntity,
  type SegmentGroup,
  type SegmentOperator,
} from '@tugeel/shared/segments';
import { readFilters, whereOf } from '@/features/catalog/product-filters';

/** Where each entity's list lives; a segment opens it filtered (`?segment=7`). */
export const ENTITY_LISTS: Record<SegmentEntity, string> = {
  PRODUCT: '/catalog/products',
  CUSTOMER: '/partners/customers',
  SUPPLIER: '/partners/suppliers',
};

export const isSegmentEntity = (value: string | null): value is SegmentEntity =>
  SEGMENT_ENTITIES.some((entity) => entity === value);

/** The fields an entity's conditions may use, in the registry's order. */
export const fieldsOf = (entity: SegmentEntity): string[] => Object.keys(SEGMENT_FIELDS[entity]);

/** A new condition on a field: its first operator, no value yet. */
export function newCondition(entity: SegmentEntity, field?: string): SegmentCondition {
  const name = field ?? fieldsOf(entity)[0] ?? 'search';
  return { field: name, op: SEGMENT_FIELDS[entity][name]?.ops[0] ?? 'IN' };
}

/** The condition under another operator, keeping only the values that operator takes. */
export function withOperator(
  entity: SegmentEntity,
  condition: SegmentCondition,
  op: SegmentOperator,
): SegmentCondition {
  const spec = SEGMENT_FIELDS[entity][condition.field];
  if (!spec) return { field: condition.field, op };
  const { required, optional } = operatorSlots(spec.input, op);
  const slots = new Set<string>([...required, ...optional]);
  const kept = Object.entries(condition).filter(([key]) => slots.has(key));
  return { ...Object.fromEntries(kept), field: condition.field, op };
}

/** One group with one new condition: where the editor starts. */
export const newDefinition = (entity: SegmentEntity): SegmentDefinition => ({
  match: 'ALL',
  groups: [{ match: 'ALL', conditions: [newCondition(entity)] }],
});

const ID = /^[1-9]\d{0,14}$/;

/**
 * The product list's filters as a definition («Сегмент болгох», ADR-0049): the search, category
 * and status join the first group of the filters' own conditions. A segment filter is left out:
 * segments do not nest.
 */
export function definitionFromProductList(params: URLSearchParams): SegmentDefinition {
  const base: SegmentCondition[] = [];
  const q = params.get('q')?.trim();
  if (q) base.push({ field: 'search', op: 'CONTAINS', text: q.slice(0, MAX_SEGMENT_TEXT) });
  const category = params.get('category');
  if (category && ID.test(category)) {
    base.push({ field: 'category', op: 'IN', ids: [Number.parseInt(category, 10)] });
  }
  const status = params.get('status');
  if (status && PRODUCT_STAGES.some((stage) => stage === status)) {
    base.push({ field: 'stage', op: 'IN', values: [status] });
  }
  const where = whereOf(readFilters(params));
  const groups: SegmentGroup[] = (where?.groups ?? []).map((group) => ({
    ...group,
    conditions: [...group.conditions],
  }));
  const all = groups.find((group) => group.match === 'ALL');
  if (all) all.conditions.unshift(...base);
  else if (base.length > 0) groups.unshift({ match: 'ALL', conditions: base });
  return groups.length > 0 ? { match: 'ALL', groups } : newDefinition('PRODUCT');
}

/** A segment id from the URL (`segment=7`), or undefined. */
export function segmentParam(params: URLSearchParams): number | undefined {
  const id = Number.parseInt(params.get('segment') ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
