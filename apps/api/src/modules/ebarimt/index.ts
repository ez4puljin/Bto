// Public API of the ebarimt module (docs/modules/ebarimt.md, ADR-0185). finance prepares and
// cancels receipts through it; pos lends the store edge's channel to the relay. Named exports only
// (ESLint G2 rejects `export *`).
export { EbarimtHttpModule, EbarimtModule } from './ebarimt.module';
export {
  EbarimtRelayResultDto,
  EbarimtRelayResultResponseDto,
  EbarimtReceiptDto,
} from './dto/ebarimt.dto';
export { toReceiptDto } from './controllers/ebarimt-receipts.controller';
export {
  EbarimtReceiptsService,
  type PrepareRequest,
  type PrintableReceipt,
  type ReceiptDetail,
  type ReceiptSourceKey,
  type ReceiptView,
} from './services/ebarimt-receipts.service';
export { EbarimtRelayService, type RelayNode } from './services/ebarimt-relay.service';
export {
  type ReceiptSecrets,
  ReceiptSecretsCache,
  SECRETS_TTL_MS,
} from './services/receipt-secrets.cache';
