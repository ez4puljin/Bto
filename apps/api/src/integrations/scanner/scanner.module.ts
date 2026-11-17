import { Global, Module } from '@nestjs/common';
import { ScannerGateway } from './scanner.gateway';
import { SCANNER_FETCH } from './scanner.tokens';
import type { ScannerFetch } from './scanner.types';

export { SCANNER_FETCH };

/**
 * Imported only by the api's composition root, like LlmModule and PictureModule; `*-flow.service.ts`
 * files inject `ScannerGateway` and call the device between transactions. Tests replace
 * SCANNER_FETCH with a scripted fetch.
 */
@Global()
@Module({
  providers: [
    {
      provide: SCANNER_FETCH,
      useValue: ((url, init) => fetch(url, init)) satisfies ScannerFetch,
    },
    ScannerGateway,
  ],
  exports: [ScannerGateway],
})
export class ScannerModule {}
