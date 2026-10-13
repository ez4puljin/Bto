import {
  DISCOUNT_EFFECTS,
  DISCOUNT_MEASURES,
  DISCOUNT_SCOPES,
  PRICE_LISTS,
} from '@tugeel/shared/pricing';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { money, qty } from '../../common/db/types';
import { categories, products, productUnits, uoms } from '../catalog/schema';
import { users } from '../identity/schema';

// Tables owned by the pricing module (docs/modules/pricing.md, ADR-0041). Migration 0013_pricing
// adds by hand the EXCLUDE constraints that keep dated rows from overlapping, the trigger that
// keeps a price's history from being rewritten, and the REVOKE that keeps prices from being
// deleted.

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
 * The price of a product unit in a list from `valid_from` up to (not including) `valid_to`, whole
 * MNT and VAT included (ADR-0010, ADR-0041 #1). A change closes the row in force and inserts the
 * next one; a row's `valid_to` only ever moves earlier, and a row closed on its first day
 * (`valid_to = valid_from`) never applied. A unit without a price in force takes its base unit's
 * price × its factor.
 */
export const unitPrices = pgTable(
  'unit_prices',
  {
    id: id(),
    list: text('list', { enum: PRICE_LISTS }).notNull(),
    productUnitId: ref('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    price: money('price').notNull(),
    /** Ulaanbaatar business dates. */
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('unit_prices_unit_idx').on(t.productUnitId, t.list, t.validFrom),
    check('unit_prices_list', inList(t.list, PRICE_LISTS)),
    check('unit_prices_price', sql`${t.price} > 0 AND ${t.price} = trunc(${t.price})`),
    check('unit_prices_validity', sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
  ],
);

/**
 * A discount program (ADR-0041 #2): what it discounts (a product, a category subtree, the order),
 * what its steps count (a quantity or an amount) and what a step does (a new unit price, a
 * percentage or tugriks off). Every program in force applies; the resolver in
 * @tugeel/shared/pricing fixes the order. A program is edited or deleted only before it starts;
 * after that it is only stopped (`valid_to`).
 */
export const discountPrograms = pgTable(
  'discount_programs',
  {
    id: id(),
    name: text('name').notNull(),
    list: text('list', { enum: PRICE_LISTS }).notNull(),
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
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('discount_programs_list_idx').on(t.list, t.validFrom),
    index('discount_programs_product_idx').on(t.productId),
    index('discount_programs_category_idx').on(t.categoryId),
    check('discount_programs_name', sql`length(${t.name}) BETWEEN 1 AND 120`),
    check('discount_programs_list', inList(t.list, PRICE_LISTS)),
    check('discount_programs_scope', inList(t.scope, DISCOUNT_SCOPES)),
    check('discount_programs_measure', inList(t.measure, DISCOUNT_MEASURES)),
    check('discount_programs_effect', inList(t.effect, DISCOUNT_EFFECTS)),
    // The same rules as discountShapeIssue() in @tugeel/shared/pricing.
    check(
      'discount_programs_shape',
      sql`(${t.scope} = 'PRODUCT' AND ${t.productId} IS NOT NULL AND ${t.categoryId} IS NULL
          AND ${t.countUomId} IS NULL AND ${t.measure} = 'QTY'
          AND (${t.effect} = 'PERCENT' OR ${t.productUnitId} IS NOT NULL))
        OR (${t.scope} = 'CATEGORY' AND ${t.categoryId} IS NOT NULL AND ${t.productId} IS NULL
          AND ${t.productUnitId} IS NULL AND ${t.thresholdUnitId} IS NULL AND ${t.effect} <> 'PRICE'
          AND (${t.measure} = 'QTY') = (${t.countUomId} IS NOT NULL))
        OR (${t.scope} = 'ORDER' AND ${t.productId} IS NULL AND ${t.productUnitId} IS NULL
          AND ${t.thresholdUnitId} IS NULL AND ${t.categoryId} IS NULL AND ${t.countUomId} IS NULL
          AND ${t.measure} = 'AMOUNT' AND ${t.effect} <> 'PRICE')`,
    ),
    check(
      'discount_programs_validity',
      sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`,
    ),
  ],
);

/** A program's steps: from `threshold` on, `value` applies (the highest step reached wins). */
export const discountSteps = pgTable(
  'discount_steps',
  {
    id: id(),
    programId: ref('program_id')
      .notNull()
      .references(() => discountPrograms.id, { onDelete: 'cascade' }),
    /** PRODUCT QTY: base units; CATEGORY QTY: counted units; AMOUNT: MNT. */
    threshold: qty('threshold').notNull(),
    /** PRICE and AMOUNT: whole MNT; PERCENT: a percentage. */
    value: money('value').notNull(),
  },
  (t) => [
    unique('discount_steps_program_threshold').on(t.programId, t.threshold),
    check('discount_steps_values', sql`${t.threshold} >= 0 AND ${t.value} > 0`),
  ],
);
