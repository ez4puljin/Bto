import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PartnersModule } from '../partners';
import { ProcurementModule } from '../procurement';
import { EbarimtCheckController } from './controllers/ebarimt-check.controller';
import { EbarimtDataService } from './services/ebarimt-data.service';
import { EbarimtEditsService } from './services/ebarimt-edits.service';
import { EbarimtFilesService } from './services/ebarimt-files.service';
import { EbarimtHistoryService } from './services/ebarimt-history.service';
import { EbarimtReportService } from './services/ebarimt-report.service';
import { EbarimtSettingsService } from './services/ebarimt-settings.service';

/**
 * «Ebarimt» (docs/modules/ebarimt-check.md, ADR-0168): a month's purchases from the posted goods
 * receipts against e-Barimt's file, by supplier. It reads the other modules and attaches its file
 * through identity's storage; nobody imports it, and it posts nothing and moves no stock or money.
 */
@Module({
  imports: [IdentityModule, PartnersModule, InventoryModule, ProcurementModule],
  providers: [
    EbarimtDataService,
    EbarimtHistoryService,
    EbarimtSettingsService,
    EbarimtFilesService,
    EbarimtEditsService,
    EbarimtReportService,
  ],
  controllers: [EbarimtCheckController],
})
export class EbarimtCheckHttpModule {}
