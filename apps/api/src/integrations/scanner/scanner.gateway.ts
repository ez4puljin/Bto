import { Inject, Injectable } from '@nestjs/common';
import { EsclClient } from './escl.client';
import { SCANNER_FETCH } from './scanner.tokens';
import type { ScannerFetch } from './scanner.types';

/**
 * The api's way to a scanner on the building's network (ADR-0210). The address comes from the
 * caller, who keeps the list of scanners and checks that an address is one of the building's.
 */
@Injectable()
export class ScannerGateway {
  constructor(@Inject(SCANNER_FETCH) private readonly fetchFn: ScannerFetch) {}

  at(baseUrl: string): EsclClient {
    return new EsclClient(baseUrl, this.fetchFn);
  }
}
