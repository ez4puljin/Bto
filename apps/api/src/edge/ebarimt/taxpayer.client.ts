import { Injectable } from '@nestjs/common';
import type { EdgeTaxpayer } from '@tugeel/shared/pos';
import { cleanTaxNumber, TIN_PATTERN } from '@tugeel/shared/taxpayer';
import { AppError } from '../../common/errors/app-error';
import { EdgeConfig } from '../config/edge-env';

const TIMEOUT_MS = 5_000;
/** A company found once is not looked up again for this long (the sale checks it again). */
const CACHE_MS = 10 * 60_000;
const COMPANY_REG_NO = /^[0-9]{7}$/;

/**
 * A company's name for its B2B receipt (ADR-0065): the tax office's public lookup, reachable only
 * from Mongolian addresses (the store's line). A 7-digit registration number is turned into the
 * TIN first. Offline the till makes no company receipts (owner 2026-10-26): the lookup refuses
 * with `EBARIMT_LOOKUP_UNAVAILABLE` and the sale is a citizen's.
 */
@Injectable()
export class TaxpayerClient {
  private readonly cache = new Map<string, { at: number; taxpayer: EdgeTaxpayer }>();

  constructor(private readonly config: EdgeConfig) {}

  /** By a 7-digit registration number or an 11–14 digit TIN. */
  async lookup(input: string): Promise<EdgeTaxpayer> {
    const number = cleanTaxNumber(input);
    if (!COMPANY_REG_NO.test(number) && !TIN_PATTERN.test(number)) {
      throw new AppError('VALIDATION_FAILED', 'a registration number (7 digits) or a TIN', {
        field: 'no',
      });
    }
    const cached = this.cache.get(number);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.taxpayer;
    const tin = COMPANY_REG_NO.test(number) ? await this.tinOf(number) : number;
    const data = await this.get(`/api/info/check/getInfo?tin=${encodeURIComponent(tin)}`);
    const found = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const name = typeof found?.name === 'string' ? found.name.trim() : '';
    if (!found || !name || found.found === false) {
      throw new AppError('EBARIMT_TAXPAYER_NOT_FOUND', `no taxpayer ${tin}`, { no: number });
    }
    const taxpayer: EdgeTaxpayer = { tin, name, vatPayer: found.vatPayer === true };
    const at = Date.now();
    this.cache.set(number, { at, taxpayer });
    this.cache.set(tin, { at, taxpayer });
    return taxpayer;
  }

  private async tinOf(regNo: string): Promise<string> {
    const data = await this.get(`/api/info/check/getTinInfo?regNo=${encodeURIComponent(regNo)}`);
    const tin = typeof data === 'number' || typeof data === 'string' ? String(data) : '';
    if (!TIN_PATTERN.test(tin)) {
      throw new AppError('EBARIMT_TAXPAYER_NOT_FOUND', `no taxpayer ${regNo}`, { no: regNo });
    }
    return tin;
  }

  /** The lookup's `data`; null when it says it found nothing. */
  private async get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.config.get('EBARIMT_LOOKUP_URL')), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new AppError('EBARIMT_LOOKUP_UNAVAILABLE', 'the taxpayer lookup cannot be reached', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
    if (response.status >= 500) {
      throw new AppError('EBARIMT_LOOKUP_UNAVAILABLE', `the lookup answered ${response.status}`);
    }
    const body: unknown = await response.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new AppError('EBARIMT_LOOKUP_UNAVAILABLE', `the lookup answered ${response.status}`);
    }
    return (body as { data?: unknown }).data ?? null;
  }
}
