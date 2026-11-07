import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PartnersModule } from '../partners';
import { ExpiryController } from './controllers/expiry.controller';
import { ExpiryCarryService } from './services/expiry-carry.service';
import { ExpiryItemsService } from './services/expiry-items.service';
import { ExpiryQueryService } from './services/expiry-query.service';
import { ExpiryViewService } from './services/expiry-view.service';

/**
 * The register of expiry dates (docs/modules/expiry.md, ADR-0172): what someone saw on a shelf. It
 * reads the product's name, main supplier and home warehouse through their owners' public services;
 * it posts nothing and moves no stock, and nobody imports it.
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, InventoryModule],
  providers: [ExpiryViewService, ExpiryQueryService, ExpiryItemsService, ExpiryCarryService],
  controllers: [ExpiryController],
})
export class ExpiryHttpModule {}
