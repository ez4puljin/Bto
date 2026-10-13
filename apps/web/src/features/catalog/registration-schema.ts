import { SKU_PATTERN, WEIGHT_PATTERN } from '@tugeel/shared/catalog';
import { Decimal } from '@tugeel/shared/money';
import { FACTOR_PATTERN, isExactFactor } from '@tugeel/shared/units';
import { z } from 'zod';
import type { RegistrationRequest, Uom } from './api';
import type { PendingPhoto } from './photo-uploads';

const unitSchema = z.object({
  uomId: z.string().min(1, 'validation.required'),
  factorToBase: z.string().trim().regex(FACTOR_PATTERN, 'validation.factor'),
  barcodes: z.array(z.string()),
});
export type RegistrationUnitValues = z.infer<typeof unitSchema>;

const baseSchema = z.object({
  categoryId: z.string().min(1, 'validation.required'),
  sku: z.string().trim().regex(SKU_PATTERN, 'validation.sku'),
  name: z.string().trim().min(1, 'validation.required').max(200, 'validation.tooLong'),
  baseUomId: z.string().min(1, 'validation.required'),
  boxFactor: z.string().trim().regex(FACTOR_PATTERN, 'validation.factor'),
  weightKg: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || (WEIGHT_PATTERN.test(value) && new Decimal(value).gt(0)),
      'validation.weight',
    ),
  baseBarcodes: z.array(z.string()),
  boxBarcodes: z.array(z.string()),
  units: z.array(unitSchema),
  supplier: z
    .object({ id: z.number(), code: z.string(), name: z.string() })
    .nullable()
    // Not a type guard: the form keeps null until a supplier is picked.
    .refine((value) => Boolean(value), 'validation.required'),
  homeWarehouseId: z.string().min(1, 'validation.required'),
  fixedBinCode: z.string().trim().max(40, 'validation.tooLong'),
});
export type RegistrationValues = z.infer<typeof baseSchema>;

/**
 * The registration form's schema (ADR-0044 #5): the box and every other unit convert exactly
 * (whole numbers for piece-based products, ADR-0008 #3), one unit per unit of measure.
 */
export function registrationSchema(uoms: readonly Uom[]) {
  const fractional = new Set(uoms.filter((uom) => uom.fractional).map((uom) => String(uom.id)));
  return baseSchema.superRefine((values, context) => {
    const baseFractional = fractional.has(values.baseUomId);
    // Refinements run after field checks fail too: test the pattern before parsing a Decimal.
    const box = values.boxFactor.trim();
    if (FACTOR_PATTERN.test(box) && !isExactFactor(box, baseFractional)) {
      context.addIssue({ code: 'custom', path: ['boxFactor'], message: 'validation.factor' });
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
      const factor = unit.factorToBase.trim();
      if (FACTOR_PATTERN.test(factor) && !isExactFactor(factor, baseFractional)) {
        context.addIssue({
          code: 'custom',
          path: ['units', index, 'factorToBase'],
          message: 'validation.factor',
        });
      }
    });
  });
}

/** What stays for the next product after a save (owner, 2026-10-13). */
export type StickyValues = Pick<
  RegistrationValues,
  'categoryId' | 'supplier' | 'homeWarehouseId' | 'baseUomId'
>;

export function emptyRegistration(sticky: StickyValues): RegistrationValues {
  return {
    ...sticky,
    sku: '',
    name: '',
    boxFactor: '',
    weightKg: '',
    baseBarcodes: [],
    boxBarcodes: [],
    units: [],
    fixedBinCode: '',
  };
}

const id = (value: string) => Number.parseInt(value, 10);

export function registrationBody(
  values: RegistrationValues,
  photos: readonly PendingPhoto[],
): RegistrationRequest {
  if (!values.supplier) throw new Error('the schema requires a supplier');
  return {
    sku: values.sku,
    name: values.name,
    categoryId: id(values.categoryId),
    baseUomId: id(values.baseUomId),
    weightKg: values.weightKg || null,
    baseBarcodes: values.baseBarcodes,
    boxFactor: values.boxFactor,
    boxBarcodes: values.boxBarcodes,
    units: values.units.map((unit) => ({
      uomId: id(unit.uomId),
      factorToBase: unit.factorToBase,
      barcodes: unit.barcodes,
    })),
    supplierId: values.supplier.id,
    homeWarehouseId: id(values.homeWarehouseId),
    fixedBinCode: values.fixedBinCode || null,
    images: photos.flatMap((photo) =>
      photo.status === 'ready' && photo.files ? [photo.files] : [],
    ),
  };
}
