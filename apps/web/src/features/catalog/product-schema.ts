import { Decimal } from '@tugeel/shared/money';
import { isExactFactor } from '@tugeel/shared/units';
import { z } from 'zod';
import type { ValidationMessage } from '@/lib/forms';
import type {
  ProductCreate,
  ProductDetail,
  ProductStatus,
  ProductUpdate,
  Uom,
  VatType,
} from './api';

/** The API's patterns (catalog DTOs); the API stays authoritative. */
export const SKU = /^[0-9]{1,20}$/;
export const FACTOR = /^\d{1,12}(\.\d{1,6})?$/;
const WEIGHT = /^\d{1,8}(\.\d{1,4})?$/;
export const CLASSIFICATION_CODE = /^[0-9]{7}$/;
export const TAX_PRODUCT_CODE = /^[0-9]{3}$/;

export const VAT_TYPES = ['VAT_ABLE', 'VAT_FREE', 'VAT_ZERO', 'NO_VAT'] as const;
export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
/** City tax is tri-state: undecided until the accountant answers (SPEC §11). */
export const CITY_TAX_CHOICES = ['unknown', 'yes', 'no'] as const;
export type CityTaxChoice = (typeof CITY_TAX_CHOICES)[number];

export function cityTaxChoice(value: boolean | null): CityTaxChoice {
  if (value === null) return 'unknown';
  return value ? 'yes' : 'no';
}

export function cityTaxValue(choice: CityTaxChoice): boolean | null {
  if (choice === 'unknown') return null;
  return choice === 'yes';
}

const optional = (pattern: RegExp, message: ValidationMessage) =>
  z
    .string()
    .trim()
    .refine((value) => value === '' || pattern.test(value), message);

const unitSchema = z.object({
  uomId: z.string().min(1, 'validation.required'),
  factorToBase: z.string().trim().regex(FACTOR, 'validation.factor'),
  isDefaultSales: z.boolean(),
  isDefaultPurchase: z.boolean(),
  barcodes: z.array(z.string()),
});
export type UnitFormValues = z.infer<typeof unitSchema>;

const baseSchema = z.object({
  sku: z.string().trim().regex(SKU, 'validation.sku'),
  name: z.string().trim().min(1, 'validation.required').max(200, 'validation.tooLong'),
  categoryId: z.string().min(1, 'validation.required'),
  brandId: z.string(),
  weightKg: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || (WEIGHT.test(value) && new Decimal(value).gt(0)),
      'validation.weight',
    ),
  vatType: z.enum(VAT_TYPES),
  cityTax: z.enum(CITY_TAX_CHOICES),
  classificationCode: optional(CLASSIFICATION_CODE, 'validation.classificationCode'),
  taxProductCode: optional(TAX_PRODUCT_CODE, 'validation.taxProductCode'),
  status: z.enum(PRODUCT_STATUSES),
  /** Create only: the base unit, its barcodes and the other units. */
  baseUomId: z.string(),
  baseBarcodes: z.array(z.string()),
  units: z.array(unitSchema),
});
export type ProductFormValues = z.infer<typeof baseSchema>;

/**
 * The product form's schema. Creating also checks the units: one per unit of measure, and factors
 * that convert exactly (whole numbers for piece-based products, ADR-0008 #3).
 */
export function productSchema(mode: 'create' | 'edit', uoms: readonly Uom[]) {
  const fractional = new Set(uoms.filter((uom) => uom.fractional).map((uom) => String(uom.id)));
  return baseSchema.superRefine((values, context) => {
    if (mode === 'edit') return;
    if (!values.baseUomId) {
      context.addIssue({ code: 'custom', path: ['baseUomId'], message: 'validation.required' });
      return;
    }
    const seen = new Set([values.baseUomId]);
    values.units.forEach((unit, index) => {
      if (seen.has(unit.uomId)) {
        context.addIssue({
          code: 'custom',
          path: ['units', index, 'uomId'],
          message: 'validation.unitRepeated',
        });
      }
      seen.add(unit.uomId);
      // Refinements run after field checks fail too: test the pattern before parsing a Decimal.
      const factor = unit.factorToBase.trim();
      if (FACTOR.test(factor) && !isExactFactor(factor, fractional.has(values.baseUomId))) {
        context.addIssue({
          code: 'custom',
          path: ['units', index, 'factorToBase'],
          message: 'validation.factor',
        });
      }
    });
  });
}

const id = (value: string) => Number.parseInt(value, 10);

export function emptyProduct(sku: string, baseUomId: string): ProductFormValues {
  return {
    sku,
    name: '',
    categoryId: '',
    brandId: '',
    weightKg: '',
    vatType: 'VAT_ABLE',
    cityTax: 'unknown',
    classificationCode: '',
    taxProductCode: '',
    status: 'ACTIVE',
    baseUomId,
    baseBarcodes: [],
    units: [],
  };
}

export function productValues(product: ProductDetail): ProductFormValues {
  return {
    sku: product.sku,
    name: product.name,
    categoryId: String(product.categoryId),
    brandId: product.brandId === null ? '' : String(product.brandId),
    weightKg: product.weightKg ?? '',
    vatType: product.vatType,
    cityTax: cityTaxChoice(product.cityTax),
    classificationCode: product.classificationCode ?? '',
    taxProductCode: product.taxProductCode ?? '',
    status: product.status,
    baseUomId: '',
    baseBarcodes: [],
    units: [],
  };
}

function common(values: ProductFormValues) {
  return {
    sku: values.sku,
    name: values.name,
    categoryId: id(values.categoryId),
    brandId: values.brandId ? id(values.brandId) : null,
    vatType: values.vatType satisfies VatType,
    cityTax: cityTaxValue(values.cityTax),
    classificationCode: values.classificationCode || null,
    taxProductCode: values.taxProductCode || null,
    weightKg: values.weightKg || null,
  };
}

export function createBody(values: ProductFormValues): ProductCreate {
  return {
    ...common(values),
    baseUomId: id(values.baseUomId),
    baseBarcodes: values.baseBarcodes,
    units: values.units.map((unit) => ({
      uomId: id(unit.uomId),
      factorToBase: unit.factorToBase,
      isDefaultSales: unit.isDefaultSales,
      isDefaultPurchase: unit.isDefaultPurchase,
      barcodes: unit.barcodes,
    })),
  };
}

export function updateBody(values: ProductFormValues): ProductUpdate {
  return { ...common(values), status: values.status satisfies ProductStatus };
}
