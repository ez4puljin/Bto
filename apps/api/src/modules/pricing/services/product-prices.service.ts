import type { SegmentCondition } from '@tugeel/shared/segments';
import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import {
  type PackUnit,
  type PriceProfileValues,
  type QuoteUnit,
  type UnitPrices,
  unitPriceTable,
  type WholeUnitProblem,
  wholeUnitOf,
  wholeUnitProblem,
} from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
import { type SQL, and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn } from '../../../common/db/days';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { CatalogService, type UnitInfo, UnitConversionService } from '../../catalog';
import { type Actor, actorUserId, AuditService } from '../../identity';
import { productPrices } from '../schema';
import { assertLive, PriceProfilesService } from './price-profiles.service';
import { advisoryLock, applied, assertNotPast, inForceOn, LOCKS } from './support';
import { planChange } from './timeline';

type TermsRow = typeof productPrices.$inferSelect;

/** How many ended price terms a product shows. */
const HISTORY = 10;

/** A product's price terms from `validFrom` up to (not including) `validTo`. */
export interface PriceTerms {
  id: number;
  /** Per base unit, whole MNT, VAT included. */
  warehousePrice: Decimal;
  profileId: number;
  profileName: string;
  /** The unit of measure counted as a whole pack; null for a product without packs. */
  wholeUomId: number | null;
  validFrom: string;
  validTo: string | null;
}

/** A product's current unit, as the price card and dialog need it. */
export interface PricedUnit {
  productUnitId: number;
  uomId: number;
  uomCode: string | null;
  uomName: string;
  factorToBase: Decimal;
  isBase: boolean;
}

/**
 * Why a product cannot be priced today: NO_TERMS, no warehouse price; NO_PROFILE_VERSION, its
 * profile has no values today; NOT_CHOSEN and GONE, its whole unit (ADR-0048 #2).
 */
export type PriceProblem = 'NO_TERMS' | 'NO_PROFILE_VERSION' | WholeUnitProblem;

export interface ProductPriceView {
  productId: number;
  /** The Ulaanbaatar business date the view is for. */
  today: string;
  units: PricedUnit[];
  current: PriceTerms | null;
  /** The current terms' profile with its values in force today. */
  profile: {
    id: number;
    name: string;
    archived: boolean;
    values: PriceProfileValues | null;
  } | null;
  /** The product's current unit counted as whole today; null without one. */
  wholeUnitId: number | null;
  problems: PriceProblem[];
  /** One of each current unit on both channels today; empty when the product cannot be priced. */
  table: UnitPrices[];
  /** Terms starting after today, earliest first. */
  scheduled: PriceTerms[];
  /** Ended terms, latest first. */
  history: PriceTerms[];
}

/** Today's terms of a product, for list columns. */
export interface CurrentTerms {
  productId: number;
  warehousePrice: Decimal;
  profileId: number;
  profileName: string;
  wholeUomId: number | null;
}

/** The terms in force on a date, for quotes and completion. */
export interface TermsInForce {
  warehousePrice: Decimal;
  profileId: number;
  wholeUomId: number | null;
}

export interface SetTermsInput {
  productId: number;
  /** From this Ulaanbaatar day on; today or later. */
  validFrom: string;
  warehousePrice: Decimal;
  profileId: number;
  wholeUomId: number | null;
}

/**
 * A product's price terms (ADR-0048 #2): one warehouse price per base unit, a price profile and the
 * pack counted as whole, dated like every price (a change from a day closes the terms in force and
 * inserts the next up to the next planned change). The price clerk (`pricing.prices.manage`) sets
 * them; the other prices come from the profile through @tugeel/shared/pricing.
 */
@Injectable()
export class ProductPricesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
    private readonly profiles: PriceProfilesService,
  ) {}

  async view(productId: number, executor: Db | Tx = this.db): Promise<ProductPriceView> {
    const [product] = await this.catalog.getMany([productId], executor);
    if (!product) throw notFound('product', productId);
    const units = (await this.units.currentUnits([productId], executor)).get(productId) ?? [];
    const rows = (
      await executor
        .select()
        .from(productPrices)
        .where(eq(productPrices.productId, productId))
        .orderBy(asc(productPrices.validFrom), asc(productPrices.id))
    ).filter(applied);
    const names = await this.profiles.namesOf(
      rows.map((row) => row.profileId),
      executor,
    );
    const termsOf = (row: TermsRow): PriceTerms => ({
      id: row.id,
      warehousePrice: row.warehousePrice,
      profileId: row.profileId,
      profileName: names.get(row.profileId) ?? '',
      wholeUomId: row.wholeUomId,
      validFrom: row.validFrom,
      validTo: row.validTo,
    });
    const today = businessDate();
    const currentRow = rows.find((row) => inForceOn(row, today)) ?? null;
    const quoteUnits = quoteUnitsOf(units);
    let profile: ProductPriceView['profile'] = null;
    const problems: PriceProblem[] = [];
    let table: UnitPrices[] = [];
    if (!currentRow) {
      problems.push('NO_TERMS');
    } else {
      const own = await this.profiles.get(currentRow.profileId, executor);
      const values = own.current ? valuesOnly(own.current) : null;
      profile = { id: own.id, name: own.name, archived: own.archivedAt !== null, values };
      if (!values) problems.push('NO_PROFILE_VERSION');
      const whole = wholeUnitProblem(packUnitsOf(units), currentRow.wholeUomId);
      if (whole) problems.push(whole);
      if (values) {
        table = unitPriceTable(
          {
            warehousePrice: currentRow.warehousePrice,
            wholeUomId: currentRow.wholeUomId,
            profile: values,
          },
          quoteUnits,
        );
      }
    }
    return {
      productId,
      today,
      units: units.map((unit) => ({
        productUnitId: unit.unitId,
        uomId: unit.uomId,
        uomCode: unit.uomCode,
        uomName: unit.uomName,
        factorToBase: unit.factorToBase,
        isBase: unit.isBase,
      })),
      current: currentRow ? termsOf(currentRow) : null,
      profile,
      wholeUnitId: currentRow
        ? (wholeUnitOf(quoteUnits, currentRow.wholeUomId)?.unitId ?? null)
        : null,
      problems,
      table,
      scheduled: rows.filter((row) => row.validFrom > today).map(termsOf),
      history: rows
        .filter((row) => row.validTo !== null && row.validTo <= today)
        .reverse()
        .slice(0, HISTORY)
        .map(termsOf),
    };
  }

  /**
   * Today's terms of each product (products without any are left out), for list columns and the
   * product export.
   */
  async currentOf(
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<CurrentTerms[]> {
    const inForce = await this.inForce(productIds, businessDate(), executor);
    const names = await this.profiles.namesOf(
      [...inForce.values()].map((t) => t.profileId),
      executor,
    );
    return [...inForce.entries()]
      .sort(([a], [b]) => a - b)
      .map(([productId, terms]) => ({
        productId,
        ...terms,
        profileName: names.get(terms.profileId) ?? '',
      }));
  }

  /**
   * The products one segment condition on prices keeps, ascending (ADR-0049 #3), by the terms in
   * force on a day: using these profiles (`IN`) or any (`ANY`), or a warehouse price within
   * whole-MNT bounds, both included (`BETWEEN`).
   */
  async productIdsWhere(
    condition: SegmentCondition,
    date: string,
    executor: Db | Tx = this.db,
  ): Promise<number[]> {
    const filters: SQL[] = [
      lte(productPrices.validFrom, date),
      or(isNull(productPrices.validTo), gt(productPrices.validTo, sql`${date}::date`)) ?? sql`true`,
    ];
    if (condition.field === 'priceProfile') {
      if (condition.op === 'IN') {
        if (!condition.ids?.length) return [];
        filters.push(idIn(productPrices.profileId, condition.ids));
      } else if (condition.op !== 'ANY') {
        return [];
      }
    } else if (condition.field === 'warehousePrice') {
      if (condition.min !== undefined) {
        filters.push(sql`${productPrices.warehousePrice} >= ${condition.min}::numeric`);
      }
      if (condition.max !== undefined) {
        filters.push(sql`${productPrices.warehousePrice} <= ${condition.max}::numeric`);
      }
    } else {
      return [];
    }
    const rows = await executor
      .selectDistinct({ productId: productPrices.productId })
      .from(productPrices)
      .where(and(...filters))
      .orderBy(asc(productPrices.productId));
    return rows.map((row) => row.productId);
  }

  /** The terms in force on a date, by product. */
  async inForce(
    productIds: readonly number[],
    date: string,
    executor: Db | Tx = this.db,
  ): Promise<Map<number, TermsInForce>> {
    if (productIds.length === 0) return new Map();
    const rows = await executor
      .select({
        productId: productPrices.productId,
        warehousePrice: productPrices.warehousePrice,
        profileId: productPrices.profileId,
        wholeUomId: productPrices.wholeUomId,
      })
      .from(productPrices)
      .where(
        and(
          inArray(productPrices.productId, [...new Set(productIds)]),
          lte(productPrices.validFrom, date),
          or(isNull(productPrices.validTo), gt(productPrices.validTo, sql`${date}::date`)),
        ),
      );
    return new Map(rows.map(({ productId, ...terms }) => [productId, terms]));
  }

  /**
   * Sets a product's terms from a day on (today or later), in one transaction (ADR-0048 #2). The
   * profile must be live and have values from that day; a product with pack units must name the
   * one counted as whole. Terms equal to those in force that day change nothing.
   */
  async set(actor: Actor, input: SetTermsInput): Promise<ProductPriceView> {
    assertNotPast('validFrom', input.validFrom);
    const [product] = await this.catalog.getMany([input.productId]);
    if (!product) throw notFound('product', input.productId);
    const units = (await this.units.currentUnits([input.productId])).get(input.productId) ?? [];
    const problem = wholeUnitProblem(packUnitsOf(units), input.wholeUomId);
    if (problem === 'NOT_CHOSEN') {
      throw invalid('wholeUomId', 'required', 'choose the pack counted as whole');
    }
    if (problem === 'GONE') {
      throw invalid('wholeUomId', 'packUnit', "not one of the product's pack units");
    }
    await inTransaction(this.db, async (tx) => {
      // One lock order everywhere: the product's advisory lock, then its profile (ADR-0048 #2).
      await advisoryLock(tx, LOCKS.productPrices, input.productId);
      const profile = await this.profiles.lockForPricesInTx(tx, input.profileId);
      assertLive(profile);
      if (profile.firstFrom === null || profile.firstFrom > input.validFrom) {
        throw invalid('profileId', 'inForce', 'the price profile has no values on that day');
      }
      const rows = await tx
        .select()
        .from(productPrices)
        .where(eq(productPrices.productId, input.productId));
      const plan = planChange(
        rows,
        input.validFrom,
        (row) =>
          row.warehousePrice.eq(input.warehousePrice) &&
          row.profileId === input.profileId &&
          row.wholeUomId === input.wholeUomId,
      );
      if (!plan) return;
      if (plan.close) {
        await tx
          .update(productPrices)
          .set({ validTo: input.validFrom })
          .where(eq(productPrices.id, plan.close.id));
      }
      await tx.insert(productPrices).values({
        productId: input.productId,
        warehousePrice: input.warehousePrice,
        profileId: input.profileId,
        wholeUomId: input.wholeUomId,
        validFrom: input.validFrom,
        validTo: plan.validTo,
        createdBy: actorUserId(actor),
      });
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'product_prices',
        entityId: input.productId,
        before: plan.close ? termsAudit(plan.close) : null,
        after: {
          validFrom: input.validFrom,
          warehousePrice: input.warehousePrice.toFixed(0),
          profileId: input.profileId,
          wholeUomId: input.wholeUomId,
        },
      });
    });
    return this.view(input.productId);
  }
}

/** A product's current units as the shared pricing functions take them. */
export function quoteUnitsOf(units: readonly UnitInfo[]): QuoteUnit[] {
  return units.map((unit) => ({
    unitId: unit.unitId,
    uomId: unit.uomId,
    factor: unit.factorToBase,
    isBase: unit.isBase,
  }));
}

/** A product's current units as the whole-unit rules take them. */
export function packUnitsOf(units: readonly UnitInfo[]): PackUnit[] {
  return units.map((unit) => ({ uomId: unit.uomId, uomCode: unit.uomCode, isBase: unit.isBase }));
}

function valuesOnly(version: PriceProfileValues): PriceProfileValues {
  return {
    looseMarkupPct: version.looseMarkupPct,
    retailMarkupPct: version.retailMarkupPct,
    retailBulkMinQty: version.retailBulkMinQty,
    retailBulkMarkupPct: version.retailBulkMarkupPct,
    rounding: version.rounding,
  };
}

function termsAudit(row: TermsRow): Record<string, unknown> {
  return {
    warehousePrice: row.warehousePrice.toFixed(0),
    profileId: row.profileId,
    wholeUomId: row.wholeUomId,
    validFrom: row.validFrom,
    validTo: row.validTo,
  };
}
