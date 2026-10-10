// Public API of the catalog module (docs/modules/catalog.md). Other modules import only this file;
// named exports only (ESLint G2 rejects `export *`).
export { CatalogHttpModule, CatalogModule } from './catalog.module';
export { UNIT_SUPERSEDED_HOOK, type UnitSupersededHook } from './hooks';
export { BarcodeService, type ResolvedBarcode } from './services/barcode.service';
export { CatalogService } from './services/catalog.service';
export type { ProductDetail, ProductSummary, UnitView } from './services/products.service';
export { type ConvertedQty, UnitConversionService } from './services/unit-conversion.service';
export { UnitsService } from './services/units.service';
