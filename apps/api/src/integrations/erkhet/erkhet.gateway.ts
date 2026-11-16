import { Inject, Injectable } from '@nestjs/common';
import { ErkhetClient } from './erkhet.client';
import { ERKHET_FETCH } from './erkhet.tokens';
import type { ErkhetAccount, ErkhetFetch } from './erkhet.types';

/**
 * Erkhet for one check (ADR-0203): a fresh client per call, so a changed sign-in works at once and
 * no session is shared between checks.
 */
@Injectable()
export class ErkhetGateway {
  constructor(@Inject(ERKHET_FETCH) private readonly fetchFn: ErkhetFetch) {}

  clientFor(account: ErkhetAccount): ErkhetClient {
    return new ErkhetClient(account, this.fetchFn);
  }
}
