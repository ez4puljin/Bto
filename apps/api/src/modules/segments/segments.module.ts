import { Module } from '@nestjs/common';
import { CatalogModule, PRODUCT_SEGMENT_DIRECTORY, PRODUCT_SET_RESOLVER } from '../catalog';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PARTNER_SET_RESOLVER, PartnersModule } from '../partners';
import { PricingModule } from '../pricing';
import { ExportsController } from './controllers/exports.controller';
import { SegmentsController } from './controllers/segments.controller';
import { ProductExportService } from './services/product-export.service';
import { SegmentEvaluator } from './services/segment-evaluator';
import { SegmentListsService } from './services/segment-lists.service';
import { SegmentsService } from './services/segments.service';

/**
 * Segments (ADR-0049): saved conditions, hand-picked product lists (ADR-0052), their evaluator and
 * the product export. It binds the resolver hooks catalog and partners declare, so their lists
 * narrow to a segment without importing this module, and catalog's segment directory, through which
 * the customer app reads the product segments it shows (ADR-0093).
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, InventoryModule, PricingModule],
  providers: [
    SegmentEvaluator,
    SegmentsService,
    SegmentListsService,
    ProductExportService,
    { provide: PRODUCT_SET_RESOLVER, useExisting: SegmentEvaluator },
    { provide: PARTNER_SET_RESOLVER, useExisting: SegmentEvaluator },
    // «Bto300»'s home reads the shown product segments through catalog (ADR-0093).
    { provide: PRODUCT_SEGMENT_DIRECTORY, useExisting: SegmentsService },
  ],
  exports: [
    SegmentEvaluator,
    SegmentsService,
    SegmentListsService,
    ProductExportService,
    PRODUCT_SET_RESOLVER,
    PARTNER_SET_RESOLVER,
    PRODUCT_SEGMENT_DIRECTORY,
  ],
})
export class SegmentsModule {}

/** The HTTP side of segments (api only). */
@Module({ imports: [SegmentsModule], controllers: [SegmentsController, ExportsController] })
export class SegmentsHttpModule {}
