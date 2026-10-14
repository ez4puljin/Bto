// MAX_SEGMENT_NAME (80) and MAX_SEGMENT_DESCRIPTION (500) of @tugeel/shared/segments.
import {
  SEGMENT_DEFINITION_VERSION,
  SEGMENT_ENTITIES,
  SEGMENT_KINDS,
} from '@tugeel/shared/segments';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { jsonValue } from '../../common/db/types';
import { products } from '../catalog/schema';
import { users } from '../identity/schema';

// The tables owned by the segments module (docs/modules/segments.md, ADR-0049, ADR-0052).
// Migration 0020_segments adds by hand the REVOKE that keeps segments from being deleted: they are
// archived, because discounts and messages will refer to them. 0021_segment_lists keeps a list's
// members from being updated or truncated: they are inserted and deleted.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const userRef = (name: string) =>
  bigint(name, { mode: 'number' }).references(() => users.id, { onDelete: 'set null' });

/**
 * A segment over one entity. RULES (ADR-0049 #1): saved AND/OR conditions, checked by
 * `segmentIssue` of `@tugeel/shared/segments`, whose members follow the data. LIST (ADR-0052 #1):
 * hand-picked products in `segment_products`, no definition. A live name never repeats within an
 * entity, whatever the kind (archived ones may).
 */
export const segments = pgTable(
  'segments',
  {
    id: id(),
    entity: text('entity', { enum: SEGMENT_ENTITIES }).notNull(),
    kind: text('kind', { enum: SEGMENT_KINDS }).notNull().default('RULES'),
    name: text('name').notNull(),
    /** `nameKey(name)` from @tugeel/shared/text. */
    nameKey: text('name_key').notNull(),
    description: text('description'),
    /** RULES: a `SegmentDefinition` `{ match, groups: [{ match, conditions }] }`; LIST: null. */
    definition: jsonValue('definition'),
    definitionVersion: smallint('definition_version').notNull().default(SEGMENT_DEFINITION_VERSION),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: userRef('created_by'),
    updatedBy: userRef('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('segments_live_name')
      .on(t.entity, t.nameKey)
      .where(sql`${t.archivedAt} IS NULL`),
    index('segments_entity_idx').on(t.entity, t.id),
    check('segments_entity', sql`${t.entity} IN ('PRODUCT', 'CUSTOMER', 'SUPPLIER')`),
    check('segments_kind', sql`${t.kind} IN ('RULES', 'LIST')`),
    check('segments_name', sql`length(${t.name}) BETWEEN 1 AND 80`),
    check(
      'segments_description',
      sql`${t.description} IS NULL OR length(${t.description}) BETWEEN 1 AND 500`,
    ),
    check(
      'segments_kind_definition',
      sql`(${t.kind} = 'RULES' AND ${t.definition} IS NOT NULL AND jsonb_typeof(${t.definition}) = 'object')
        OR (${t.kind} = 'LIST' AND ${t.definition} IS NULL AND ${t.entity} = 'PRODUCT')`,
    ),
  ],
);

/**
 * The members of a LIST segment (ADR-0052 #1): exactly the products put in. Written only by
 * `SegmentListsService` under the segment row's lock, in ascending product order (the foreign key
 * takes `FOR KEY SHARE` on each product, architecture §5.3); never updated.
 */
export const segmentProducts = pgTable(
  'segment_products',
  {
    segmentId: bigint('segment_id', { mode: 'number' })
      .notNull()
      .references(() => segments.id),
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => products.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.segmentId, t.productId] })],
);
