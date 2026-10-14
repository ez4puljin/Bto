import { Module } from '@nestjs/common';
import { CatalogModule, PRODUCT_SET_RESOLVER } from '../catalog';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PARTNER_SET_RESOLVER, PartnersModule } from '../partners';
import { PricingModule } from '../pricing';
import { ExportsController } from './controllers/exports.controller';
import { SegmentsController } from './controllers/segments.controller';
import { ProductExportService } from './services/product-export.service';
import { SegmentEvaluator } from './services/segment-evaluator';
import { SegmentsService } from './services/segments.service';

/**
 * Segments (ADR-0049): saved conditions, their evaluator and the product export. It binds the
 * resolver hooks catalog and partners declare, so their lists narrow to a segment without
 * importing this module.
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, InventoryModule, PricingModule],
  providers: [
    SegmentEvaluator,
    SegmentsService,
    ProductExportService,
    { provide: PRODUCT_SET_RESOLVER, useExisting: SegmentEvaluator },
    { provide: PARTNER_SET_RESOLVER, useExisting: SegmentEvaluator },
  ],
  exports: [
    SegmentEvaluator,
    SegmentsService,
    ProductExportService,
    PRODUCT_SET_RESOLVER,
    PARTNER_SET_RESOLVER,
  ],
})
export class SegmentsModule {}

/** The HTTP side of segments (api only). */
@Module({ imports: [SegmentsModule], controllers: [SegmentsController, ExportsController] })
export class SegmentsHttpModule {}
