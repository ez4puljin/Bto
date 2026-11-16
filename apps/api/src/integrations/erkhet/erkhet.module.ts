import { Global, Module } from '@nestjs/common';
import { ErkhetGateway } from './erkhet.gateway';
import { ERKHET_FETCH } from './erkhet.tokens';
import type { ErkhetFetch } from './erkhet.types';

export { ERKHET_FETCH };

/**
 * Imported only by the composition roots (the api checks a typed sign-in, the worker runs the
 * checks); `*-flow.service.ts` files inject `ErkhetGateway` and call Erkhet between transactions.
 * Tests replace ERKHET_FETCH with a scripted fetch.
 */
@Global()
@Module({
  providers: [
    {
      provide: ERKHET_FETCH,
      useValue: ((url, init) => fetch(url, init)) satisfies ErkhetFetch,
    },
    ErkhetGateway,
  ],
  exports: [ErkhetGateway],
})
export class ErkhetIntegrationModule {}
