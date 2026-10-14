import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import type { PriceProfileValues } from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import type { Actor } from '../../src/modules/identity';
import { PriceProfilesService, ProductPricesService } from '../../src/modules/pricing';
import { idempotency } from './catalog';
import { bearer } from './identity';

/** Price profiles and terms (ADR-0048) through HTTP, so tests exercise the clerk's and admin's paths. */

/** Loose +15 %, supermarket +30 %, from 24 base units +20 %, whole tugriks. */
export const PROFILE_BODY = {
  looseMarkupPct: '15',
  retailMarkupPct: '30',
  retailBulkMinQty: '24',
  retailBulkMarkupPct: '20',
  rounding: 'WHOLE',
};

export const PROFILE_VALUES: PriceProfileValues = {
  looseMarkupPct: new Decimal(15),
  retailMarkupPct: new Decimal(30),
  retailBulkMinQty: new Decimal(24),
  retailBulkMarkupPct: new Decimal(20),
  rounding: 'WHOLE',
};

export function pricingApi(app: NestExpressApplication, token: string) {
  const http = () => request(app.getHttpServer());
  return {
    /** Creates a profile (values from PROFILE_BODY unless given) and returns its id. */
    async profile(name: string, fields: Record<string, unknown> = {}): Promise<number> {
      const res = await http()
        .post('/api/v1/price-profiles')
        .set(bearer(token))
        .set(idempotency())
        .send({ name, validFrom: businessDate(), ...PROFILE_BODY, ...fields })
        .expect(201);
      return (res.body as { id: number }).id;
    },
    /** Sets a product's terms from today (or the given day). */
    async terms(
      productId: number,
      warehousePrice: string,
      profileId: number,
      wholeUomId: number | null,
      validFrom = businessDate(),
    ): Promise<void> {
      await http()
        .post('/api/v1/product-prices')
        .set(bearer(token))
        .set(idempotency())
        .send({ productId, validFrom, warehousePrice, profileId, wholeUomId })
        .expect(200);
    },
  };
}

/** The same through the services, for integrity tests that run without HTTP. */
export function pricingServices(app: NestExpressApplication, actor: Actor) {
  return {
    async profile(name: string, values: PriceProfileValues = PROFILE_VALUES): Promise<number> {
      const profile = await app
        .get(PriceProfilesService)
        .create(actor, { name, validFrom: businessDate(), values });
      return profile.id;
    },
    async terms(
      productId: number,
      warehousePrice: string,
      profileId: number,
      wholeUomId: number | null,
    ): Promise<void> {
      await app.get(ProductPricesService).set(actor, {
        productId,
        validFrom: businessDate(),
        warehousePrice: new Decimal(warehousePrice),
        profileId,
        wholeUomId,
      });
    },
  };
}
