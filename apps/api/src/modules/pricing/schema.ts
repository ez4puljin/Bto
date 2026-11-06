import {
  DISCOUNT_EFFECTS,
  DISCOUNT_MEASURES,
  DISCOUNT_SCOPES,
  PRICE_ADJUSTS,
  PRICE_ROUNDINGS,
  PROGRAM_LISTS,
  PROGRAM_STATES,
  PROGRAM_TARGETS,
  STEP_RULES,
} from '@tugeel/shared/pricing';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { money, percent, qty } from '../../common/db/types';
import { categories, products, productUnits, uoms } from '../catalog/schema';
import { users } from '../identity/schema';

// Tables owned by the pricing module (docs/modules/pricing.md, ADR-0041, ADR-0048). Migrations
// 0013_pricing and 0019_price_profiles add by hand the EXCLUDE constraints that keep dated rows
// from overlapping, the trigger that keeps their history from being rewritten, and the REVOKEs
// that keep prices and profiles from being deleted.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id, { onDelete: 'set null' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const inList = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.join(
    values.map((value) => sql.raw(`'${value}'`)),
    sql`, `,
  )})`;

/**
 * A price profile (ADR-0048 #1): the named rules that derive a product's other prices from its
 * warehouse price. Its values live in dated versions; a live name never repeats (archived ones may).
 */
export const priceProfiles = pgTable(
  'price_profiles',
  {
    id: id(),
    name: text('name').notNull(),
    /** `nameKey(name)` from @tugeel/shared/text. */
    nameKey: text('name_key').notNull(),
    /** An archived profile cannot be chosen; prices already using it keep working. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Out of every list (ADR-0160); also archived, and old price terms keep their name. */
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    deletedBy: userRef('deleted_by'),
  },
  (t) => [
    uniqueIndex('price_profiles_live_name')
      .on(t.nameKey)
      .where(sql`${t.archivedAt} IS NULL`),
    check('price_profiles_name', sql`length(${t.name}) BETWEEN 1 AND 80`),
  ],
);

/**
 * A profile's values from `valid_from` up to (not including) `valid_to` (ADR-0048 #1): the loose
 * and supermarket markups, the optional supermarket bulk threshold and markup, and the rounding of
 * the derived prices. Changed like prices: the row in force is closed, a new one inserted.
 */
export const priceProfileVersions = pgTable(
  'price_profile_versions',
  {
    id: id(),
    profileId: ref('profile_id')
      .notNull()
      .references(() => priceProfiles.id),
    looseMarkupPct: percent('loose_markup_pct').notNull(),
    retailMarkupPct: percent('retail_markup_pct').notNull(),
    /** Base units of a product in a supermarket cart from which the bulk markup applies. */
    retailBulkMinQty: qty('retail_bulk_min_qty'),
    retailBulkMarkupPct: percent('retail_bulk_markup_pct'),
    rounding: text('rounding', { enum: PRICE_ROUNDINGS }).notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('price_profile_versions_profile_idx').on(t.profileId, t.validFrom),
    check('price_profile_versions_rounding', inList(t.rounding, PRICE_ROUNDINGS)),
    // The same rules as priceProfileIssue() in @tugeel/shared/pricing.
    check(
      'price_profile_versions_markups',
      sql`${t.looseMarkupPct} >= 0 AND ${t.retailMarkupPct} >= 0`,
    ),
    check(
      'price_profile_versions_bulk',
      sql`(${t.retailBulkMinQty} IS NULL) = (${t.retailBulkMarkupPct} IS NULL)
        AND (${t.retailBulkMinQty} IS NULL OR (${t.retailBulkMinQty} > 0
          AND ${t.retailBulkMarkupPct} >= 0 AND ${t.retailBulkMarkupPct} < ${t.retailMarkupPct}))`,
    ),
    check(
      'price_profile_versions_validity',
      sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`,
    ),
  ],
);

/**
 * A product's price terms from `valid_from` up to (not including) `valid_to` (ADR-0048 #2): the
 * warehouse price of one base unit (whole MNT, VAT included), the profile that derives the other
 * prices, and the unit of measure counted as a whole pack (null for a product without packs),
 * resolved to the product's current unit of it.
 */
export const productPrices = pgTable(
  'product_prices',
  {
    id: id(),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    warehousePrice: money('warehouse_price').notNull(),
    profileId: ref('profile_id')
      .notNull()
      .references(() => priceProfiles.id),
    wholeUomId: ref('whole_uom_id').references(() => uoms.id),
    /** Ulaanbaatar business dates. */
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('product_prices_product_idx').on(t.productId, t.validFrom),
    index('product_prices_profile_idx').on(t.profileId),
    check(
      'product_prices_price',
      sql`${t.warehousePrice} > 0 AND ${t.warehousePrice} = trunc(${t.warehousePrice})`,
    ),
    check('product_prices_validity', sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
  ],
);

/**
 * A discount program (ADR-0041 #2): what it discounts (a product, a category subtree, the order),
 * what its steps count (a quantity or an amount) and what a step does (a new unit price, a
 * percentage, tugriks off or N+M). A program may name a set of products instead of one product or
 * category (`target_kind` and its links), and the pipelines or tills it serves (ADR-0159). What is
 * in force applies, a priority program alone on its product; the resolver in @tugeel/shared/pricing
 * fixes the order. A person edits it, archives it or deletes it (`deleted_at`: the row stays).
 */
export const discountPrograms = pgTable(
  'discount_programs',
  {
    id: id(),
    name: text('name').notNull(),
    list: text('list', { enum: PROGRAM_LISTS }).notNull(),
    /** DRAFT and ARCHIVED never apply; ACTIVE applies by its dates. */
    state: text('state', { enum: PROGRAM_STATES }).notNull().default('ACTIVE'),
    /** Applies alone on a product (ADR-0159 #4). */
    priority: boolean('priority').notNull().default(false),
    scope: text('scope', { enum: DISCOUNT_SCOPES }).notNull(),
    measure: text('measure', { enum: DISCOUNT_MEASURES }).notNull(),
    effect: text('effect', { enum: DISCOUNT_EFFECTS }).notNull(),
    productId: ref('product_id').references(() => products.id),
    /** PRODUCT: the unit a PRICE or AMOUNT applies to; NULL = every unit (PERCENT only). */
    productUnitId: ref('product_unit_id').references(() => productUnits.id),
    /** PRODUCT: the unit the thresholds were typed in (they are stored in base units). */
    thresholdUnitId: ref('threshold_unit_id').references(() => productUnits.id),
    categoryId: ref('category_id').references(() => categories.id),
    /** CATEGORY QTY: the unit of measure counted (every box is one). */
    countUomId: ref('count_uom_id').references(() => uoms.id),
    /** What its TARGET links are; NULL: its one product, category or the order. */
    targetKind: text('target_kind', { enum: PROGRAM_TARGETS }),
    /** How the resulting unit price is rounded (ADR-0159 #7). */
    adjustKind: text('adjust_kind', { enum: PRICE_ADJUSTS }).notNull().default('NONE'),
    adjustFactor: integer('adjust_factor').notNull().default(1),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    deletedBy: userRef('deleted_by'),
  },
  (t) => [
    index('discount_programs_list_idx').on(t.list, t.validFrom),
    index('discount_programs_product_idx').on(t.productId),
    index('discount_programs_category_idx').on(t.categoryId),
    check('discount_programs_name', sql`length(${t.name}) BETWEEN 1 AND 120`),
    check('discount_programs_list', inList(t.list, PROGRAM_LISTS)),
    check('discount_programs_state', inList(t.state, PROGRAM_STATES)),
    check(
      'discount_programs_target_kind',
      sql`${t.targetKind} IS NULL OR ${inList(t.targetKind, PROGRAM_TARGETS)}`,
    ),
    check('discount_programs_adjust_kind', inList(t.adjustKind, PRICE_ADJUSTS)),
    check(
      'discount_programs_adjust',
      sql`${t.adjustFactor} >= 1
        AND (${t.adjustKind} = 'NONE' OR (${t.scope} = 'PRODUCT' AND ${t.effect} <> 'BONUS'))`,
    ),
    check('discount_programs_scope', inList(t.scope, DISCOUNT_SCOPES)),
    check('discount_programs_measure', inList(t.measure, DISCOUNT_MEASURES)),
    check('discount_programs_effect', inList(t.effect, DISCOUNT_EFFECTS)),
    // The same rules as discountShapeIssue() in @tugeel/shared/pricing.
    check(
      'discount_programs_shape',
      sql`(${t.scope} = 'PRODUCT' AND (${t.productId} IS NOT NULL) <> (${t.targetKind} IS NOT NULL)
          AND ${t.categoryId} IS NULL AND ${t.countUomId} IS NULL
          AND (${t.targetKind} IS NULL
            OR (${t.productUnitId} IS NULL AND ${t.thresholdUnitId} IS NULL))
          AND (${t.effect} IN ('PERCENT', 'BONUS') OR ${t.targetKind} IS NOT NULL
            OR ${t.productUnitId} IS NOT NULL)
          AND (${t.effect} <> 'BONUS' OR (${t.measure} = 'QTY' AND ${t.productUnitId} IS NULL)))
        OR (${t.scope} = 'CATEGORY' AND (${t.categoryId} IS NOT NULL) <> (${t.targetKind} IS NOT NULL)
          AND ${t.productId} IS NULL AND ${t.productUnitId} IS NULL AND ${t.thresholdUnitId} IS NULL
          AND ${t.effect} IN ('PERCENT', 'AMOUNT') AND NOT ${t.priority}
          AND (${t.measure} = 'QTY') = (${t.countUomId} IS NOT NULL))
        OR (${t.scope} = 'ORDER' AND ${t.targetKind} IS NULL AND ${t.productId} IS NULL
          AND ${t.productUnitId} IS NULL AND ${t.thresholdUnitId} IS NULL AND ${t.categoryId} IS NULL
          AND ${t.countUomId} IS NULL AND ${t.measure} = 'AMOUNT' AND NOT ${t.priority}
          AND ${t.effect} IN ('PERCENT', 'AMOUNT'))`,
    ),
    check(
      'discount_programs_validity',
      sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`,
    ),
  ],
);

/**
 * What a program's sets and places are made of (ADR-0159 #2, #5): TARGET, of its `target_kind`;
 * EXCLUDE_TARGET, of the same kind; EXCLUDE_PRODUCT; PIPELINE, TILL. No foreign key: `ref_id` points
 * at a table its role decides, some in modules that follow pricing.
 */
export const DISCOUNT_LINK_ROLES = [
  'TARGET',
  'EXCLUDE_TARGET',
  'EXCLUDE_PRODUCT',
  'PIPELINE',
  'TILL',
] as const;
export type DiscountLinkRole = (typeof DISCOUNT_LINK_ROLES)[number];

export const discountProgramLinks = pgTable(
  'discount_program_links',
  {
    programId: ref('program_id')
      .notNull()
      .references(() => discountPrograms.id, { onDelete: 'cascade' }),
    role: text('role', { enum: DISCOUNT_LINK_ROLES }).notNull(),
    refId: ref('ref_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.programId, t.role, t.refId] }),
    check('discount_program_links_role', inList(t.role, DISCOUNT_LINK_ROLES)),
  ],
);

/** A program's steps: `value` applies as `rule` says (ADR-0159 #6); the highest step met wins. */
export const discountSteps = pgTable(
  'discount_steps',
  {
    id: id(),
    programId: ref('program_id')
      .notNull()
      .references(() => discountPrograms.id, { onDelete: 'cascade' }),
    /** PRODUCT QTY: base units; CATEGORY QTY: counted units; AMOUNT: MNT. */
    threshold: qty('threshold').notNull(),
    /** PRICE and AMOUNT: whole MNT; PERCENT: a percentage; BONUS: M of N+M, N the threshold. */
    value: money('value').notNull(),
    rule: text('rule', { enum: STEP_RULES }).notNull().default('MINIMUM'),
  },
  (t) => [
    unique('discount_steps_program_threshold').on(t.programId, t.threshold),
    check('discount_steps_rule', inList(t.rule, STEP_RULES)),
    check('discount_steps_values', sql`${t.threshold} >= 0 AND ${t.value} > 0`),
  ],
);
