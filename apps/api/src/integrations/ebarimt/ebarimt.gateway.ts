import { Inject, Injectable } from '@nestjs/common';
import type { EbarimtApiEnvironment } from '@tugeel/shared/ebarimt-check';
import { EbarimtApiClient, EbarimtTokenCache } from './ebarimt-api.client';
import { EBARIMT_FETCH, EBARIMT_HOSTS } from './ebarimt.tokens';
import type { EbarimtApiAccount, EbarimtFetch, EbarimtHosts } from './ebarimt.types';

/**
 * e-Barimt's purchases service for one pull (ADR-0228): a fresh client per call, so a changed
 * connection works at once; the tokens are kept here until they end.
 */
@Injectable()
export class EbarimtApiGateway {
  private readonly tokens = new EbarimtTokenCache();

  constructor(
    @Inject(EBARIMT_FETCH) private readonly fetchFn: EbarimtFetch,
    @Inject(EBARIMT_HOSTS)
    private readonly hosts: Readonly<Record<EbarimtApiEnvironment, EbarimtHosts>>,
  ) {}

  clientFor(account: EbarimtApiAccount): EbarimtApiClient {
    return new EbarimtApiClient(
      account,
      this.hosts[account.environment],
      this.fetchFn,
      this.tokens,
    );
  }
}
