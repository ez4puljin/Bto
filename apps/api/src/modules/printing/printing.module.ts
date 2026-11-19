import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { PosModule } from '../pos';
import { PricingModule } from '../pricing';
import {
  PriceLabelsController,
  PrintBridgeController,
  PrintStationsController,
} from './controllers/printing.controller';
import { PriceLabelsService } from './services/price-labels.service';
import { PrintJobsService } from './services/print-jobs.service';
import { PrintStationsService } from './services/print-stations.service';
import { TillPricesService } from './services/till-prices.service';

/**
 * Price labels on 80 mm receipt printers (docs/modules/printing.md, ADR-0226): a till's prices
 * (pricing, catalog) for a staff member a till names (pos), drawn on the server and sent to the
 * phone, to a LAN printer or to a Windows PC's bridge. Nobody imports it.
 */
@Module({
  imports: [IdentityModule, CatalogModule, PricingModule, PosModule],
  providers: [TillPricesService, PrintStationsService, PrintJobsService, PriceLabelsService],
  exports: [TillPricesService, PrintStationsService, PrintJobsService, PriceLabelsService],
})
export class PrintingModule {}

/** The HTTP side (api only). */
@Module({
  imports: [PrintingModule],
  controllers: [PriceLabelsController, PrintStationsController, PrintBridgeController],
})
export class PrintingHttpModule {}
