// MAX_SEGMENT_NAME (80) and MAX_SEGMENT_DESCRIPTION (500) of @tugeel/shared/segments.
import { SEGMENT_DEFINITION_VERSION, SEGMENT_ENTITIES } from '@tugeel/shared/segments';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { jsonValue } from '../../common/db/types';
import { users } from '../identity/schema';

// The table owned by the segments module (docs/modules/segments.md, ADR-0049). Migration
// 0020_segments adds by hand the REVOKE that keeps segments from being deleted: they are archived,
// because discounts and messages will refer to them.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const userRef = (name: string) =>
  bigint(name, { mode: 'number' }).references(() => users.id, { onDelete: 'set null' });

/**
 * A segment (ADR-0049 #1): saved AND/OR conditions over one entity, checked by `segmentIssue` of
 * `@tugeel/shared/segments`; its members follow the data. A live name never repeats within an
 * entity (archived ones may).
 */
export const segments = pgTable(
  'segments',
  {
    id: id(),
    entity: text('entity', { enum: SEGMENT_ENTITIES }).notNull(),
    name: text('name').notNull(),
    /** `nameKey(name)` from @tugeel/shared/text. */
    nameKey: text('name_key').notNull(),
    description: text('description'),
    /** A `SegmentDefinition`: `{ match, groups: [{ match, conditions }] }`. */
    definition: jsonValue('definition').notNull(),
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
    check('segments_name', sql`length(${t.name}) BETWEEN 1 AND 80`),
    check(
      'segments_description',
      sql`${t.description} IS NULL OR length(${t.description}) BETWEEN 1 AND 500`,
    ),
    check('segments_definition', sql`jsonb_typeof(${t.definition}) = 'object'`),
  ],
);
