import { Module } from '@nestjs/common';
import { CatalogModule, PRODUCT_SET_RESOLVER } from '../catalog';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PARTNER_SET_RESOLVER, PartnersModule } from '../partners';
import { PricingModule } from '../pricing';
import { SegmentsController } from './controllers/segments.controller';
import { SegmentEvaluator } from './services/segment-evaluator';
import { SegmentsService } from './services/segments.service';

/**
 * Segments (ADR-0049): saved conditions and their evaluator. It binds the resolver hooks catalog
 * and partners declare, so their lists narrow to a segment without importing this module.
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, InventoryModule, PricingModule],
  providers: [
    SegmentEvaluator,
    SegmentsService,
    { provide: PRODUCT_SET_RESOLVER, useExisting: SegmentEvaluator },
    { provide: PARTNER_SET_RESOLVER, useExisting: SegmentEvaluator },
  ],
  exports: [SegmentEvaluator, SegmentsService, PRODUCT_SET_RESOLVER, PARTNER_SET_RESOLVER],
})
export class SegmentsModule {}

/** The HTTP side of segments (api only). */
@Module({ imports: [SegmentsModule], controllers: [SegmentsController] })
export class SegmentsHttpModule {}
