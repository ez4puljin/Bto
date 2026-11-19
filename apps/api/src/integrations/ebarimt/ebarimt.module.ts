import { Global, Module } from '@nestjs/common';
import { EbarimtApiGateway } from './ebarimt.gateway';
import { EBARIMT_FETCH, EBARIMT_HOSTS } from './ebarimt.tokens';
import { EBARIMT_DEFAULT_HOSTS, type EbarimtFetch } from './ebarimt.types';

/**
 * Imported only by the composition roots (the api pulls on «Одоо татах», the worker every night);
 * `*-flow.service.ts` files inject `EbarimtApiGateway` and call e-Barimt between transactions.
 * Tests replace EBARIMT_HOSTS with a fake server's address: no test reaches the tax authority.
 */
@Global()
@Module({
  providers: [
    {
      provide: EBARIMT_FETCH,
      useValue: ((url, init) => fetch(url, init)) satisfies EbarimtFetch,
    },
    { provide: EBARIMT_HOSTS, useValue: EBARIMT_DEFAULT_HOSTS },
    EbarimtApiGateway,
  ],
  exports: [EbarimtApiGateway],
})
export class EbarimtIntegrationModule {}
