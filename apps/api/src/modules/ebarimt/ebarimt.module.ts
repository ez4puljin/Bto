import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { EbarimtReceiptsController } from './controllers/ebarimt-receipts.controller';
import { EbarimtReceiptsService } from './services/ebarimt-receipts.service';
import { EbarimtRelayService } from './services/ebarimt-relay.service';
import { ReceiptSecretsCache } from './services/receipt-secrets.cache';

const SERVICES = [ReceiptSecretsCache, EbarimtReceiptsService, EbarimtRelayService];

/**
 * The wholesale e-Barimt receipts (docs/modules/ebarimt.md, ADR-0185, ADR-0074): keyed by the
 * source document, issued by the store PC's PosAPI through the store edge that pulls them. It
 * reads no business table: finance hands it receipt requests by value in its own transactions,
 * pos lends its edge channel for the relay. Depends on identity only (audit, rights).
 */
@Module({
  imports: [IdentityModule],
  providers: SERVICES,
  exports: SERVICES,
})
export class EbarimtModule {}

/** The HTTP side (api only): the accountant's list, decisions and print. */
@Module({
  imports: [EbarimtModule],
  controllers: [EbarimtReceiptsController],
})
export class EbarimtHttpModule {}
