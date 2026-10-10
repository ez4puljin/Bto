import type {
  BarcodeDto,
  ProductDetailDto,
  ProductSummaryDto,
  ProductUnitDto,
} from '../dto/products.dto';
import type { CategoryDto, UomDto } from '../dto/masters.dto';
import type { Barcode } from '../services/barcode.service';
import type { CategoryView } from '../services/categories.service';
import type { ProductDetail, ProductSummary, UnitView } from '../services/products.service';
import type { Uom } from '../services/uoms.service';

export const toUomDto = (row: Uom): UomDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  fractional: row.fractional,
  measureUnit: row.measureUnit,
});

export const toCategoryDto = (row: CategoryView): CategoryDto => ({
  id: row.id,
  parentId: row.parentId,
  name: row.name,
  defaultClassificationCode: row.defaultClassificationCode,
  productCount: row.productCount,
  childCount: row.childCount,
});

export const toBarcodeDto = (row: Barcode): BarcodeDto => ({
  id: row.id,
  code: row.code,
  gtin14: row.gtin14,
  barcodeType: row.barcodeType,
  isPrimary: row.isPrimary,
  isInternal: row.isInternal,
});

export const toUnitDto = (row: UnitView): ProductUnitDto => ({
  id: row.id,
  uomId: row.uomId,
  uomName: row.uomName,
  uomCode: row.uomCode,
  fractional: row.fractional,
  factorToBase: row.factorToBase.toString(),
  isBase: row.isBase,
  isDefaultSales: row.isDefaultSales,
  isDefaultPurchase: row.isDefaultPurchase,
  measureUnit: row.measureUnit,
  effectiveMeasureUnit: row.effectiveMeasureUnit,
  supersededBy: row.supersededBy,
  supersededAt: row.supersededAt?.toISOString() ?? null,
  barcodes: row.barcodes.map(toBarcodeDto),
});

export const toProductDetailDto = (row: ProductDetail): ProductDetailDto => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  categoryId: row.categoryId,
  brandId: row.brandId,
  vatType: row.vatType,
  cityTax: row.cityTax,
  classificationCode: row.classificationCode,
  taxProductCode: row.taxProductCode,
  status: row.status,
  tracksLots: row.tracksLots,
  weightKg: row.weightKg?.toString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  units: row.units.map(toUnitDto),
  images: row.images,
});

export const toProductSummaryDto = (row: ProductSummary): ProductSummaryDto => ({ ...row });
