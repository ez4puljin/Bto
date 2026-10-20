import { BARCODE_TYPES } from '@tugeel/shared/gtin';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgSequence,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { factor, weight } from '../../common/db/types';
import { files } from '../identity/schema';

// Tables owned by the catalog module (docs/architecture.md §4, docs/modules/catalog.md; ADR-0008,
// ADR-0028, ADR-0029). Migration 0003_catalog adds by hand what drizzle-kit cannot express: the
// product_units guard trigger, the deferred "one base unit" constraint trigger and the REVOKEs that
// keep products and units from being deleted. System units of measure are synced by the api at boot.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** Units every installation starts with; their names come from mn.json `uoms.system.<code>`. */
export const SYSTEM_UOMS = [
  { code: 'PCS', fractional: false },
  { code: 'BLOCK', fractional: false },
  { code: 'BOX', fractional: false },
  { code: 'KG', fractional: true },
] as const;
export type SystemUomCode = (typeof SYSTEM_UOMS)[number]['code'];

/** Units of measure: piece, block, box, kg … System units carry a code, custom ones a name only. */
export const uoms = pgTable(
  'uoms',
  {
    id: id(),
    code: text('code'),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    /** Quantities in base units of this kind may have decimals (kg, l). */
    fractional: boolean('fractional').notNull().default(false),
    /** Default e-Barimt measure unit of product units in this unit (allowed values: SPEC §11 #17). */
    measureUnit: text('measure_unit'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('uoms_code_key').on(t.code),
    unique('uoms_name_key_key').on(t.nameKey),
    check('uoms_code_format', sql`${t.code} IS NULL OR ${t.code} ~ '^[A-Z]{2,12}$'`),
    check('uoms_name', sql`length(${t.name}) BETWEEN 1 AND 40`),
    check(
      'uoms_measure_unit',
      sql`${t.measureUnit} IS NULL OR length(${t.measureUnit}) BETWEEN 1 AND 50`,
    ),
  ],
);

/** The category tree; a name repeats only under different parents. */
export const categories = pgTable(
  'categories',
  {
    id: id(),
    parentId: ref('parent_id').references((): AnyPgColumn => categories.id),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    /** БҮНА code the e-Barimt bulk-assign tool gives products of this subtree (ADR-0015 #3). */
    defaultClassificationCode: text('default_classification_code'),
    /**
     * The category's block of product codes (ADR-0044 #1), both or neither; subcategories without
     * one use the nearest ancestor's. The laminar rule (nested only down the tree) is checked in
     * CategoriesService with @tugeel/shared/catalog.
     */
    skuFrom: numeric('sku_from', { precision: 20, scale: 0 }),
    skuTo: numeric('sku_to', { precision: 20, scale: 0 }),
    /**
     * A top category's picture in «Bto300»'s category grid (ADR-0092 #6), a file owned by identity;
     * only a category without a parent has one (moving it under a parent drops the picture).
     */
    imageFileId: ref('image_file_id').references(() => files.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('categories_sibling_name').on(sql`coalesce(${t.parentId}, 0)`, t.nameKey),
    index('categories_parent_idx').on(t.parentId),
    check('categories_not_own_parent', sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
    check('categories_name', sql`length(${t.name}) BETWEEN 1 AND 100`),
    check(
      'categories_classification_code',
      sql`${t.defaultClassificationCode} IS NULL OR ${t.defaultClassificationCode} ~ '^[0-9]{7}$'`,
    ),
    check('categories_sku_range_pair', sql`(${t.skuFrom} IS NULL) = (${t.skuTo} IS NULL)`),
    check(
      'categories_sku_range',
      sql`${t.skuFrom} IS NULL OR (${t.skuFrom} >= 0 AND ${t.skuFrom} <= ${t.skuTo})`,
    ),
    unique('categories_image_file_key').on(t.imageFileId),
    check('categories_image_top_level', sql`${t.imageFileId} IS NULL OR ${t.parentId} IS NULL`),
  ],
);

export const VAT_TYPES = ['VAT_ABLE', 'VAT_FREE', 'VAT_ZERO', 'NO_VAT'] as const;
export type VatType = (typeof VAT_TYPES)[number];
export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

/** Products (SKUs). Never deleted: INACTIVE hides them (the REVOKE is in the migration). */
export const products = pgTable(
  'products',
  {
    id: id(),
    /** The owner's numeric product code ("системийн код"). */
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    /** Search keys from @tugeel/shared/text, written by the catalog service only (ADR-0028). */
    searchText: text('search_text').notNull(),
    searchPhonetic: text('search_phonetic').notNull(),
    searchVersion: smallint('search_version').notNull(),
    categoryId: ref('category_id')
      .notNull()
      .references(() => categories.id),
    vatType: text('vat_type', { enum: VAT_TYPES }).notNull().default('VAT_ABLE'),
    /** City tax (НХАТ); NULL = not decided yet (SPEC §11 #3a), so receipts refuse the product. */
    cityTax: boolean('city_tax'),
    /** e-Barimt attributes, optional in delivery 1 (SPEC §5.2, ADR-0015 #3). */
    classificationCode: text('classification_code'),
    taxProductCode: text('tax_product_code'),
    status: text('status', { enum: PRODUCT_STATUSES }).notNull().default('ACTIVE'),
    /**
     * When the price clerk completed the product (ADR-0044); NULL = «Үнэ хүлээгдэж буй»: usable in
     * the warehouse, not yet on orders. New products start NULL; an import revert clears it.
     */
    saleReadyAt: timestamp('sale_ready_at', { withTimezone: true }),
    tracksLots: boolean('tracks_lots').notNull().default(false),
    /** Net weight of one base unit in kilograms (the Excel "хувийн жин"). */
    weightKg: weight('weight_kg'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('products_sku_key').on(t.sku),
    index('products_name_idx').on(t.name, t.id),
    index('products_category_idx').on(t.categoryId),
    index('products_search_text_idx').using('gin', t.searchText.op('gin_trgm_ops')),
    index('products_search_phonetic_idx').using('gin', t.searchPhonetic.op('gin_trgm_ops')),
    check('products_sku_format', sql`${t.sku} ~ '^[0-9]{1,20}$'`),
    check('products_name', sql`length(${t.name}) BETWEEN 1 AND 200`),
    check('products_vat_type', sql`${t.vatType} IN ('VAT_ABLE', 'VAT_FREE', 'VAT_ZERO', 'NO_VAT')`),
    check('products_status', sql`${t.status} IN ('ACTIVE', 'INACTIVE')`),
    check(
      'products_classification_code',
      sql`${t.classificationCode} IS NULL OR ${t.classificationCode} ~ '^[0-9]{7}$'`,
    ),
    check(
      'products_tax_product_code',
      sql`${t.taxProductCode} IS NULL OR ${t.taxProductCode} ~ '^[0-9]{3}$'`,
    ),
    check('products_weight', sql`${t.weightKg} IS NULL OR ${t.weightKg} > 0`),
  ],
);

/**
 * Units of a product with their factor to the base unit (ADR-0008). A factor never changes: a new
 * factor supersedes the row (`superseded_by`); a unit that is no longer used is retired
 * (`superseded_at` without a successor). The guard trigger is in the migration.
 */
export const productUnits = pgTable(
  'product_units',
  {
    id: id(),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    uomId: ref('uom_id')
      .notNull()
      .references(() => uoms.id),
    factorToBase: factor('factor_to_base').notNull(),
    isBase: boolean('is_base').notNull().default(false),
    isDefaultSales: boolean('is_default_sales').notNull().default(false),
    isDefaultPurchase: boolean('is_default_purchase').notNull().default(false),
    /** e-Barimt measure unit; NULL = the default of its unit of measure. */
    measureUnit: text('measure_unit'),
    supersededBy: ref('superseded_by').references((): AnyPgColumn => productUnits.id),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('product_units_product_idx').on(t.productId),
    uniqueIndex('product_units_one_base')
      .on(t.productId)
      .where(sql`${t.isBase}`),
    uniqueIndex('product_units_current_uom')
      .on(t.productId, t.uomId)
      .where(sql`${t.supersededAt} IS NULL`),
    uniqueIndex('product_units_default_sales')
      .on(t.productId)
      .where(sql`${t.isDefaultSales}`),
    uniqueIndex('product_units_default_purchase')
      .on(t.productId)
      .where(sql`${t.isDefaultPurchase}`),
    check('product_units_factor', sql`${t.factorToBase} > 0`),
    check('product_units_base_factor', sql`NOT ${t.isBase} OR ${t.factorToBase} = 1`),
    check('product_units_base_current', sql`NOT ${t.isBase} OR ${t.supersededAt} IS NULL`),
    check(
      'product_units_successor',
      sql`${t.supersededBy} IS NULL OR ${t.supersededAt} IS NOT NULL`,
    ),
    check(
      'product_units_retired_flags',
      sql`${t.supersededAt} IS NULL OR NOT (${t.isDefaultSales} OR ${t.isDefaultPurchase})`,
    ),
    check(
      'product_units_measure_unit',
      sql`${t.measureUnit} IS NULL OR length(${t.measureUnit}) BETWEEN 1 AND 50`,
    ),
  ],
);

/** Barcodes of units; one lookup key across the whole table (ADR-0029). */
export const productBarcodes = pgTable(
  'product_barcodes',
  {
    id: id(),
    productUnitId: ref('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    /** As printed or typed, whitespace removed. */
    code: text('code').notNull(),
    gtin14: text('gtin14'),
    lookupKey: text('lookup_key').notNull(),
    barcodeType: text('barcode_type', { enum: BARCODE_TYPES }).notNull(),
    /** The barcode e-Barimt lines carry for this unit. */
    isPrimary: boolean('is_primary').notNull().default(false),
    /** Issued by the system (EAN-13 prefix 20). */
    isInternal: boolean('is_internal').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique('product_barcodes_lookup_key_key').on(t.lookupKey),
    index('product_barcodes_unit_idx').on(t.productUnitId),
    uniqueIndex('product_barcodes_one_primary')
      .on(t.productUnitId)
      .where(sql`${t.isPrimary}`),
    uniqueIndex('product_barcodes_one_internal')
      .on(t.productUnitId)
      .where(sql`${t.isInternal}`),
    check('product_barcodes_code', sql`${t.code} ~ '^[!-~]{1,48}$'`),
    check('product_barcodes_gtin14', sql`${t.gtin14} IS NULL OR ${t.gtin14} ~ '^[0-9]{14}$'`),
    check(
      'product_barcodes_lookup_key',
      sql`${t.lookupKey} = coalesce(${t.gtin14}, upper(${t.code}))`,
    ),
    check('product_barcodes_type', sql`${t.barcodeType} IN ('GS1', 'ISBN', 'UNDEFINED')`),
    check(
      'product_barcodes_internal_type',
      sql`NOT ${t.isInternal} OR ${t.barcodeType} = 'UNDEFINED'`,
    ),
  ],
);

/** Product photos: a full image and its thumbnail, both files owned by identity (ADR-0030). */
export const productImages = pgTable(
  'product_images',
  {
    id: id(),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    imageFileId: ref('image_file_id')
      .notNull()
      .references(() => files.id),
    thumbFileId: ref('thumb_file_id')
      .notNull()
      .references(() => files.id),
    sortOrder: integer('sort_order').notNull().default(0),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique('product_images_image_file_key').on(t.imageFileId),
    unique('product_images_thumb_file_key').on(t.thumbFileId),
    index('product_images_product_idx').on(t.productId, t.sortOrder),
    uniqueIndex('product_images_one_primary')
      .on(t.productId)
      .where(sql`${t.isPrimary}`),
    check('product_images_two_files', sql`${t.imageFileId} <> ${t.thumbFileId}`),
  ],
);

/** Numbers of internal EAN-13 barcodes; gaps do not matter (ADR-0029 #4). */
export const internalBarcodeSeq = pgSequence('catalog_internal_barcode_seq', {
  startWith: 1,
  minValue: 1,
  maxValue: 9_999_999_999,
});
