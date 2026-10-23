import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { FinanceModule } from '../finance';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PricingModule } from '../pricing';
import {
  PosCashiersController,
  PosEdgeNodesController,
  PosQuickButtonsController,
  PosSettingsController,
  PosTillsController,
} from './controllers/pos-admin.controller';
import { PosDevController } from './controllers/pos-dev.controller';
import {
  PosAttentionController,
  PosRejectionsController,
  PosSalesController,
  PosShiftsController,
  PosShortfallsController,
  PosVoidsController,
} from './controllers/pos-records.controller';
import { PosSyncController } from './controllers/pos-sync.controller';
import { EdgeTokenGuard } from './guards/edge-token.guard';
import { PinHasher } from './pin-hasher';
import { PosAcceptService } from './services/pos-accept.service';
import { PosCashiersService } from './services/pos-cashiers.service';
import { PosDevService } from './services/pos-dev.service';
import { PosEdgeNodesService } from './services/pos-edge-nodes.service';
import { PosQueryService } from './services/pos-query.service';
import { PosQuickButtonsService } from './services/pos-quick-buttons.service';
import { PosReplayService } from './services/pos-replay.service';
import { PosSettingsService } from './services/pos-settings.service';
import { PosShiftsService } from './services/pos-shifts.service';
import { PosSnapshotService } from './services/pos-snapshot.service';
import { PosTillsService } from './services/pos-tills.service';
import { PosVoidsService } from './services/pos-voids.service';

const SERVICES = [
  PinHasher,
  PosSettingsService,
  PosEdgeNodesService,
  PosTillsService,
  PosCashiersService,
  PosShiftsService,
  PosVoidsService,
  PosQuickButtonsService,
  PosAcceptService,
  PosReplayService,
  PosQueryService,
  PosDevService,
  PosSnapshotService,
];

/**
 * The supermarket POS on the centre (docs/modules/pos.md, ADR-0063, ADR-0064): the store's edge
 * replays its documents here; stock goes through inventory, money through finance.
 */
@Module({
  imports: [IdentityModule, CatalogModule, PricingModule, InventoryModule, FinanceModule],
  providers: [...SERVICES, EdgeTokenGuard],
  exports: SERVICES,
})
export class PosModule {}

/** The HTTP side (api only): the admin routes, the edge's sync routes and the test till. */
@Module({
  imports: [PosModule],
  controllers: [
    PosSettingsController,
    PosEdgeNodesController,
    PosTillsController,
    PosCashiersController,
    PosShiftsController,
    PosSalesController,
    PosShortfallsController,
    PosRejectionsController,
    PosVoidsController,
    PosQuickButtonsController,
    PosAttentionController,
    PosSyncController,
    PosDevController,
  ],
})
export class PosHttpModule {}
