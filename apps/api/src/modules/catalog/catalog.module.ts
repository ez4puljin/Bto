import { Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { DB } from '../../common/db/db.tokens';
import type { Db } from '../../common/db/db.types';
import { inTransaction } from '../../common/db/transaction';
import { IdentityModule } from '../identity';
import { BarcodesController } from './controllers/barcodes.controller';
import {
  BrandsController,
  CategoriesController,
  UomsController,
} from './controllers/masters.controller';
import { ProductsController, ProductUnitsController } from './controllers/products.controller';
import { ProductImagesController, ReadinessController } from './controllers/readiness.controller';
import { syncSystemUoms } from './reference-data';
import { BarcodeService } from './services/barcode.service';
import { BrandsService } from './services/brands.service';
import { CatalogImportService } from './services/catalog-import.service';
import { CatalogService } from './services/catalog.service';
import { CategoriesService } from './services/categories.service';
import { EbarimtReadinessService } from './services/ebarimt-readiness.service';
import { ProductImagesService } from './services/product-images.service';
import { ProductsService } from './services/products.service';
import { TaxService } from './services/tax.service';
import { UnitConversionService } from './services/unit-conversion.service';
import { UnitsService } from './services/units.service';
import { UomsService } from './services/uoms.service';

const CORE_SERVICES = [
  BarcodeService,
  BrandsService,
  CatalogImportService,
  CatalogService,
  CategoriesService,
  EbarimtReadinessService,
  ProductImagesService,
  ProductsService,
  TaxService,
  UnitConversionService,
  UnitsService,
  UomsService,
];

/** Catalog services every process may use (api, worker jobs, imports). */
@Module({ imports: [IdentityModule], providers: CORE_SERVICES, exports: CORE_SERVICES })
export class CatalogModule {}

/** Syncs the system units of measure before the api serves requests. */
@Injectable()
export class CatalogBootstrap implements OnApplicationBootstrap {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationBootstrap(): Promise<void> {
    await inTransaction(this.db, (tx) => syncSystemUoms(tx));
  }
}

/** The HTTP side of the catalog (api only): admin and lookup routes, the boot-time sync. */
@Module({
  imports: [CatalogModule],
  controllers: [
    UomsController,
    CategoriesController,
    BrandsController,
    ProductsController,
    ProductUnitsController,
    BarcodesController,
    ProductImagesController,
    ReadinessController,
  ],
  providers: [CatalogBootstrap],
})
export class CatalogHttpModule {}
