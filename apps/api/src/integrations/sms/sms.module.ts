import { Global, Module } from '@nestjs/common';
import { SmsGateway } from './sms.gateway';
import { SMS_FETCH } from './sms.tokens';
import type { SmsFetch } from './sms.types';

export { SMS_FETCH };

/**
 * Imported only by the composition roots (the api checks the key and reads the balance, the worker
 * sends); `*-flow.service.ts` files inject `SmsGateway` and call WeSend between transactions.
 * Tests replace SMS_FETCH with a scripted fetch: no test reaches WeSend.
 */
@Global()
@Module({
  providers: [
    { provide: SMS_FETCH, useValue: ((url, init) => fetch(url, init)) satisfies SmsFetch },
    SmsGateway,
  ],
  exports: [SmsGateway],
})
export class SmsIntegrationModule {}
