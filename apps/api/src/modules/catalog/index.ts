// Public API of the catalog module (docs/modules/catalog.md). Other modules import only this file;
// named exports only (ESLint G2 rejects `export *`).
export { CatalogHttpModule, CatalogModule } from './catalog.module';
export {
  PRODUCT_SET_RESOLVER,
  type ProductSetFilter,
  type ProductSetResolver,
  UNIT_SUPERSEDED_HOOK,
  type UnitSupersededHook,
} from './hooks';
export { BarcodeService, type ResolvedBarcode } from './services/barcode.service';
export {
  type BulkProductInput,
  type CatalogReference,
  CatalogImportService,
  type CreatedProduct,
  type ImportProduct,
} from './services/catalog-import.service';
export {
  type CatalogRegistration,
  CatalogRegistrationService,
  type RegisteredProduct,
} from './services/catalog-registration.service';
export { CatalogService } from './services/catalog.service';
export { type Category, CategoriesService } from './services/categories.service';
export { type ImageFiles, MAX_PRODUCT_IMAGES } from './services/product-images.service';
export { ProductFiltersService } from './services/product-filters.service';
export {
  ProductLifecycleService,
  type SaleReadyCandidate,
} from './services/product-lifecycle.service';
export { type ProductListQuery, ProductQueryService } from './services/product-query.service';
export type {
  NewUnitInput,
  ProductDetail,
  ProductListItem,
  ProductPatch,
  ProductSummary,
  UnitView,
} from './services/products.service';
export { VAT_TYPES, type VatType } from './schema';
export { type ProductTaxRates, TaxService } from './services/tax.service';
export {
  type ConvertedQty,
  type UnitInfo,
  UnitConversionService,
} from './services/unit-conversion.service';
export { UnitsService } from './services/units.service';
export { type Uom, UomsService } from './services/uoms.service';
