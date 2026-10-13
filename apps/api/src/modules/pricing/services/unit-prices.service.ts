import { Inject, Injectable } from '@nestjs/common';
import { type Decimal, roundHalfUp } from '@tugeel/shared/money';
import { PRICE_LISTS, type PriceList, type PriceSource } from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { CatalogService, type UnitInfo, UnitConversionService } from '../../catalog';
import { type Actor, actorUserId, AuditService } from '../../identity';
import { unitPrices } from '../schema';
import { advisoryLock, applied, assertNotPast, inForceOn, LOCKS } from './support';

type PriceRow = typeof unitPrices.$inferSelect;

/** How many ended prices a unit shows. */
const HISTORY = 10;
export const MAX_PRICE_ENTRIES = 20;

/** A dated price of a unit in a list. */
export interface PricePeriod {
  id: number;
  price: Decimal;
  validFrom: string;
  validTo: string | null;
}

/** One current unit of a product in one list: today's price, planned changes and past prices. */
export interface UnitPriceView {
  productUnitId: number;
  uomName: string;
  factorToBase: Decimal;
  isBase: boolean;
  /** UNIT: the unit's own price; DERIVED: the base unit's price × factor; null: no price. */
  current: { price: Decimal; source: PriceSource; period: PricePeriod | null } | null;
  /** Prices starting after today, earliest first. */
  scheduled: PricePeriod[];
  /** Ended prices, latest first. */
  history: PricePeriod[];
}

export interface ProductPrices {
  productId: number;
  today: string;
  lists: Record<PriceList, UnitPriceView[]>;
}

export interface PriceEntry {
  list: PriceList;
  productUnitId: number;
  /** null: the unit goes back to its base unit's price × factor (not for the base unit). */
  price: Decimal | null;
}

export interface SetPricesInput {
  productId: number;
  /** From this Ulaanbaatar day on; today or later. */
  validFrom: string;
  entries: PriceEntry[];
}

/** A base unit's own price today, for list columns. */
export interface CurrentPrice {
  productId: number;
  list: PriceList;
  productUnitId: number;
  price: Decimal;
}

interface PriceChange {
  list: PriceList;
  productUnitId: number;
  before: Decimal | null;
  price: Decimal | null;
}

/**
 * Unit prices (ADR-0041 #1): per list and product unit, whole MNT, dated. A change from a day on
 * closes the price in force that day and inserts the new one up to the next planned change, so
 * the history is never rewritten; a unit without its own price takes its base unit's.
 */
@Injectable()
export class UnitPricesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
  ) {}

  /** Every current unit of a product in both lists. */
  async view(productId: number, executor: Db | Tx = this.db): Promise<ProductPrices> {
    const [product] = await this.catalog.getMany([productId], executor);
    if (!product) throw notFound('product', productId);
    const units = (await this.units.currentUnits([productId], executor)).get(productId) ?? [];
    const rows = await this.rowsOf(
      units.map((unit) => unit.unitId),
      executor,
    );
    const today = businessDate();
    const lists = Object.fromEntries(
      PRICE_LISTS.map((list) => [list, this.listView(list, units, rows, today)]),
    ) as Record<PriceList, UnitPriceView[]>;
    return { productId, today, lists };
  }

  /** Each product's base unit price today in both lists (units without one are left out). */
  async currentOf(productIds: readonly number[]): Promise<CurrentPrice[]> {
    const bases = await this.units.baseUnits(productIds);
    const unitIds = [...bases.values()].map((unit) => unit.unitId);
    if (unitIds.length === 0) return [];
    const today = businessDate();
    const rows = await this.db
      .select()
      .from(unitPrices)
      .where(and(inArray(unitPrices.productUnitId, unitIds), inForce(today)))
      .orderBy(asc(unitPrices.productUnitId), asc(unitPrices.list));
    const productOf = new Map([...bases.values()].map((unit) => [unit.unitId, unit.productId]));
    return rows.map((row) => ({
      productId: productOf.get(row.productUnitId) ?? 0,
      list: row.list,
      productUnitId: row.productUnitId,
      price: row.price,
    }));
  }

  /** The units' own prices in force on a date in a list (the resolver derives the rest). */
  async inForce(
    list: PriceList,
    unitIds: readonly number[],
    date: string,
    executor: Db | Tx = this.db,
  ): Promise<Map<number, Decimal>> {
    if (unitIds.length === 0) return new Map();
    const rows = await executor
      .select({ productUnitId: unitPrices.productUnitId, price: unitPrices.price })
      .from(unitPrices)
      .where(
        and(
          eq(unitPrices.list, list),
          inArray(unitPrices.productUnitId, [...unitIds]),
          inForce(date),
        ),
      );
    return new Map(rows.map((row) => [row.productUnitId, row.price]));
  }

  /**
   * Sets prices of one product's units from a day on (today or later), in one transaction. An
   * entry equal to the price in force that day changes nothing; a null price takes a unit back to
   * its base unit's price. One audit row lists what changed.
   */
  async set(actor: Actor, input: SetPricesInput): Promise<ProductPrices> {
    assertNotPast('validFrom', input.validFrom);
    if (input.entries.length === 0 || input.entries.length > MAX_PRICE_ENTRIES) {
      throw invalid('entries', 'count', `1 to ${MAX_PRICE_ENTRIES} prices at a time`);
    }
    const seen = new Set<string>();
    for (const [index, entry] of input.entries.entries()) {
      const key = `${entry.list}:${entry.productUnitId}`;
      if (seen.has(key)) throw invalid(`entries.${index}`, 'unique', 'a unit appears twice');
      seen.add(key);
    }
    const units = await this.units.describe(input.entries.map((entry) => entry.productUnitId));
    for (const [index, entry] of input.entries.entries()) {
      const unit = units.get(entry.productUnitId);
      if (!unit || unit.productId !== input.productId) {
        throw notFound('product unit', entry.productUnitId);
      }
      if (!unit.current) {
        throw new AppError('UNIT_SUPERSEDED', `unit ${unit.unitId} is no longer current`, {
          id: unit.unitId,
        });
      }
      if (entry.price === null && unit.isBase) {
        throw invalid(`entries.${index}.price`, 'required', 'the base unit always has a price');
      }
    }
    await inTransaction(this.db, async (tx) => {
      const changes: PriceChange[] = [];
      const ordered = [...input.entries].sort(
        (a, b) => a.productUnitId - b.productUnitId || a.list.localeCompare(b.list),
      );
      for (const entry of ordered) {
        await advisoryLock(tx, LOCKS.unitPrice, entry.productUnitId);
        const change = await this.apply(tx, actor, entry, input.validFrom);
        if (change) changes.push(change);
      }
      if (changes.length === 0) return;
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'unit_prices',
        entityId: input.productId,
        after: {
          validFrom: input.validFrom,
          changes: changes.map((change) => ({
            list: change.list,
            productUnitId: change.productUnitId,
            before: change.before?.toFixed(0) ?? null,
            price: change.price?.toFixed(0) ?? null,
          })),
        },
      });
    });
    return this.view(input.productId);
  }

  /**
   * A superseded unit (ADR-0041 #6): its prices end today and planned ones are voided; the new
   * unit takes its base unit's price until it gets its own.
   */
  async closeUnitInTx(tx: Tx, actor: Actor, unitId: number, today: string): Promise<number> {
    await advisoryLock(tx, LOCKS.unitPrice, unitId);
    const open = await tx
      .select()
      .from(unitPrices)
      .where(
        and(
          eq(unitPrices.productUnitId, unitId),
          or(isNull(unitPrices.validTo), gt(unitPrices.validTo, today)),
          or(isNull(unitPrices.validTo), gt(unitPrices.validTo, unitPrices.validFrom)),
        ),
      );
    for (const row of open) {
      await tx
        .update(unitPrices)
        .set({ validTo: row.validFrom > today ? row.validFrom : today })
        .where(eq(unitPrices.id, row.id));
    }
    if (open.length > 0) {
      await this.audit.record(tx, actor, {
        action: 'CLOSE',
        entity: 'unit_prices',
        entityId: unitId,
        before: open.map((row) => ({
          id: row.id,
          list: row.list,
          price: row.price.toFixed(0),
          validFrom: row.validFrom,
          validTo: row.validTo,
        })),
      });
    }
    return open.length;
  }

  /** One unit in one list from `date`: close the price in force and insert the next one. */
  private async apply(
    tx: Tx,
    actor: Actor,
    entry: PriceEntry,
    date: string,
  ): Promise<PriceChange | null> {
    const rows = (
      await tx
        .select()
        .from(unitPrices)
        .where(
          and(eq(unitPrices.list, entry.list), eq(unitPrices.productUnitId, entry.productUnitId)),
        )
        .orderBy(asc(unitPrices.validFrom))
    ).filter(applied);
    const covering = rows.find((row) => inForceOn(row, date));
    const next = rows.find((row) => row.validFrom > date);
    if (entry.price === null ? !covering : covering?.price.eq(entry.price)) return null;
    const until = covering ? covering.validTo : (next?.validFrom ?? null);
    if (covering) {
      await tx.update(unitPrices).set({ validTo: date }).where(eq(unitPrices.id, covering.id));
    }
    if (entry.price !== null) {
      await tx.insert(unitPrices).values({
        list: entry.list,
        productUnitId: entry.productUnitId,
        price: entry.price,
        validFrom: date,
        validTo: until,
        createdBy: actorUserId(actor),
      });
    }
    return {
      list: entry.list,
      productUnitId: entry.productUnitId,
      before: covering?.price ?? null,
      price: entry.price,
    };
  }

  private rowsOf(unitIds: readonly number[], executor: Db | Tx): Promise<PriceRow[]> {
    if (unitIds.length === 0) return Promise.resolve([]);
    return executor
      .select()
      .from(unitPrices)
      .where(
        and(
          inArray(unitPrices.productUnitId, [...unitIds]),
          or(isNull(unitPrices.validTo), gt(unitPrices.validTo, unitPrices.validFrom)),
        ),
      )
      .orderBy(asc(unitPrices.validFrom), asc(unitPrices.id));
  }

  private listView(
    list: PriceList,
    units: readonly UnitInfo[],
    rows: readonly PriceRow[],
    today: string,
  ): UnitPriceView[] {
    const periodsOf = (unitId: number) =>
      rows.filter((row) => row.list === list && row.productUnitId === unitId);
    const base = units.find((unit) => unit.isBase);
    const baseToday = base ? periodsOf(base.unitId).find((row) => inForceOn(row, today)) : null;
    return units.map((unit) => {
      const periods = periodsOf(unit.unitId);
      const own = periods.find((row) => inForceOn(row, today));
      let current: UnitPriceView['current'] = null;
      if (own) {
        current = { price: own.price, source: 'UNIT', period: periodOf(own) };
      } else if (baseToday && !unit.isBase) {
        current = {
          price: roundHalfUp(baseToday.price.times(unit.factorToBase), 0),
          source: 'DERIVED',
          period: null,
        };
      }
      return {
        productUnitId: unit.unitId,
        uomName: unit.uomName,
        factorToBase: unit.factorToBase,
        isBase: unit.isBase,
        current,
        scheduled: periods.filter((row) => row.validFrom > today).map(periodOf),
        history: periods
          .filter((row) => row.validTo !== null && row.validTo <= today)
          .reverse()
          .slice(0, HISTORY)
          .map(periodOf),
      };
    });
  }
}

/** Rows in force on a date (a row closed on its first day never is). */
function inForce(date: string) {
  return and(
    lte(unitPrices.validFrom, date),
    or(isNull(unitPrices.validTo), gt(unitPrices.validTo, sql`${date}::date`)),
  );
}

function periodOf(row: PriceRow): PricePeriod {
  return { id: row.id, price: row.price, validFrom: row.validFrom, validTo: row.validTo };
}
