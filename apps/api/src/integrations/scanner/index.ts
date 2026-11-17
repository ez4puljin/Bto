// A network scanner over eSCL (ADR-0210, docs/architecture.md §9.7).
export { EsclClient, MAX_FEEDER_PAGES, SCANNER_TIMEOUT_MS } from './escl.client';
export { ScannerGateway } from './scanner.gateway';
export { SCANNER_FETCH, ScannerModule } from './scanner.module';
export {
  SCAN_SOURCES,
  type ScannedPage,
  SCANNER_ERROR_REASONS,
  ScannerError,
  type ScannerErrorReason,
  type ScannerFacts,
  type ScannerFetch,
  type ScanSource,
} from './scanner.types';
