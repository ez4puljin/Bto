import type { SegmentCondition } from '@tugeel/shared/segments';
import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
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
import { type SQL, and, asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn } from '../../../common/db/days';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { CatalogService, type UnitInfo, UnitConversionService } from '../../catalog';
import { type Actor, actorUserId, type AuditEntry, AuditService } from '../../identity';
import { productPrices } from '../schema';
import { assertLive, PriceProfilesService } from './price-profiles.service';
import { advisoryLock, applied, assertNotPast, inForceOn, inForceSql, LOCKS } from './support';
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

/** The rep app's prices of a product (ADR-0068): the unit table and one base unit in whole packs. */
export interface ShopPrices {
  /** The warehouse price per base unit, whole MNT, VAT included. */
  basePrice: Decimal;
  units: UnitPrices[];
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

/** What a bulk profile change did (ADR-0051 #1). */
export interface ProfileChangeResult {
  changed: number[];
  unchanged: number[];
  /** Products without terms on the day or after it. */
  skipped: { productId: number; reason: 'NO_TERMS' }[];
}

/** The terms in force on a date, for quotes and completion. */
export interface TermsInForce {
  warehousePrice: Decimal;
  profileId: number;
  wholeUomId: number | null;
}

/** A product's terms as plain values (an import keeps them for its revert, ADR-0054 #6). */
export interface TermsSnapshot {
  /** Whole MNT as text. */
  warehousePrice: string;
  profileId: number;
  wholeUomId: number | null;
}

/** What `setManyInTx` wrote for one product. */
export interface WrittenTerms {
  productId: number;
  /** The inserted row, its first day and the end it was given. */
  rowId: number;
  validFrom: string;
  validTo: string | null;
  /** The terms in force on `validFrom` before, closed that day; null without any. */
  before: TermsSnapshot | null;
}

/** An imported row to take back (`restoreManyInTx`). */
export type TermsRestore = WrittenTerms;

/** Rows per multi-row write: far below the bind-parameter limit of one statement. */
const WRITE_CHUNK = 1_000;

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
   * The unit table `view()` gives one product, for many products on a day (the rep app's shop,
   * ADR-0061 #7): one of each current unit on both lists, without discount programs. Products
   * without terms, or whose profile has no values that day, are left out.
   */
  async tablesOf(
    productIds: readonly number[],
    date: string = businessDate(),
    executor: Db | Tx = this.db,
  ): Promise<Map<number, UnitPrices[]>> {
    const prices = await this.shopPricesOf(productIds, date, executor);
    return new Map([...prices].map(([productId, own]) => [productId, own.units]));
  }

  /**
   * `tablesOf` with each product's warehouse price per base unit (whole MNT): what one base unit
   * costs in whole packs, the price the rep app's shop shows and sorts by (ADR-0068). The same
   * products are left out, so a product never shows a base price without its unit table.
   */
  async shopPricesOf(
    productIds: readonly number[],
    date: string = businessDate(),
    executor: Db | Tx = this.db,
  ): Promise<Map<number, ShopPrices>> {
    const terms = await this.inForce(productIds, date, executor);
    if (terms.size === 0) return new Map();
    const versions = await this.profiles.versionsInForce(
      [...terms.values()].map((own) => own.profileId),
      date,
      executor,
    );
    const units = await this.units.currentUnits([...terms.keys()], executor);
    const result = new Map<number, ShopPrices>();
    for (const [productId, own] of terms) {
      const profile = versions.get(own.profileId);
      if (!profile) continue;
      result.set(productId, {
        basePrice: own.warehousePrice,
        units: unitPriceTable(
          { warehousePrice: own.warehousePrice, wholeUomId: own.wholeUomId, profile },
          quoteUnitsOf(units.get(productId) ?? []),
        ),
      });
    }
    return result;
  }

  /**
   * These products ordered by their warehouse price per base unit on a day, then by id, one keyset
   * page of them (the rep app's price sorts, ADR-0068). A price counts as `shopPricesOf` counts
   * it — terms in force whose profile has values that day; products without one come last in
   * either direction. `after` is the last row of the previous page; the price is NUMERIC text.
   */
  async orderedByBasePrice(
    productIds: readonly number[],
    options: {
      direction: 'ASC' | 'DESC';
      after: { price: string | null; id: number } | null;
      limit: number;
      date: string;
    },
    executor: Db | Tx = this.db,
  ): Promise<{ productId: number; price: string | null }[]> {
    if (productIds.length === 0) return [];
    const { direction, after, limit, date } = options;
    const price = sql`pp.warehouse_price`;
    const up = direction === 'ASC';
    let keyset: SQL = sql`true`;
    if (after) {
      const next = up ? sql`>` : sql`<`;
      keyset =
        after.price === null
          ? sql`${price} IS NULL AND k.id ${next} ${after.id}`
          : sql`((${price}, k.id) ${next} (${after.price}::numeric, ${after.id}) OR ${price} IS NULL)`;
    }
    const { rows } = await executor.execute<{ id: string; price: string | null }>(sql`
      SELECT k.id::text AS id, ${price}::text AS price
        FROM unnest(${sql.param([...new Set(productIds)])}::bigint[]) AS k(id)
        LEFT JOIN product_prices pp
          ON pp.product_id = k.id
         AND ${inForceSql(sql`pp.valid_from`, sql`pp.valid_to`, date)}
         AND EXISTS (SELECT 1 FROM price_profile_versions v
                      WHERE v.profile_id = pp.profile_id
                        AND ${inForceSql(sql`v.valid_from`, sql`v.valid_to`, date)})
       WHERE ${keyset}
       ORDER BY ${up ? sql`${price} ASC NULLS LAST, k.id ASC` : sql`${price} DESC NULLS LAST, k.id DESC`}
       LIMIT ${limit}`);
    return rows.map((row) => ({ productId: Number.parseInt(row.id, 10), price: row.price }));
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
    const filters: SQL[] = [inForceSql(productPrices.validFrom, productPrices.validTo, date)];
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
          idIn(productPrices.productId, [...new Set(productIds)]),
          inForceSql(productPrices.validFrom, productPrices.validTo, date),
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
    await this.assertTerms(input, this.db);
    await inTransaction(this.db, (tx) => this.writeTermsInTx(tx, actor, input));
    return this.view(input.productId);
  }

  /**
   * `set` inside the caller's transaction (ADR-0099 #5: a goods receipt's posting puts its lines'
   * sale prices in force). The same checks and the same lock order.
   */
  async setInTx(tx: Tx, actor: Actor, input: SetTermsInput): Promise<void> {
    await this.assertTerms(input, tx);
    await this.writeTermsInTx(tx, actor, input);
  }

  /** A day not in the past, a known product and, for a product with packs, its whole pack. */
  private async assertTerms(input: SetTermsInput, executor: Db | Tx): Promise<void> {
    assertNotPast('validFrom', input.validFrom);
    const [product] = await this.catalog.getMany([input.productId], executor);
    if (!product) throw notFound('product', input.productId);
    const units =
      (await this.units.currentUnits([input.productId], executor)).get(input.productId) ?? [];
    const problem = wholeUnitProblem(packUnitsOf(units), input.wholeUomId);
    if (problem === 'NOT_CHOSEN') {
      throw invalid('wholeUomId', 'required', 'choose the pack counted as whole');
    }
    if (problem === 'GONE') {
      throw invalid('wholeUomId', 'packUnit', "not one of the product's pack units");
    }
  }

  private async writeTermsInTx(tx: Tx, actor: Actor, input: SetTermsInput): Promise<void> {
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
  }

  /**
   * Changes the price profile of ticked products from a day on (ADR-0051 #1): the terms in force
   * that day and every planned row after it are written again with the new profile, the same
   * warehouse price and the same whole unit, under the dated-row rules (a row is closed on the day
   * its copy starts, so history is never rewritten). The products' advisory locks are taken in id
   * order, then the profile's (the order of `set`). Rows that already name the profile change
   * nothing; a product without terms is skipped as NO_TERMS.
   */
  async setProfileMany(
    actor: Actor,
    input: { productIds: readonly number[]; profileId: number; validFrom: string },
  ): Promise<ProfileChangeResult> {
    assertNotPast('validFrom', input.validFrom);
    const ids = [...new Set(input.productIds)].sort((a, b) => a - b);
    const found = new Set((await this.catalog.getMany(ids)).map((product) => product.id));
    const missing = ids.find((id) => !found.has(id));
    if (missing !== undefined) throw notFound('product', missing);
    return inTransaction(this.db, async (tx) => {
      for (const id of ids) await advisoryLock(tx, LOCKS.productPrices, id);
      const profile = await this.profiles.lockForPricesInTx(tx, input.profileId);
      assertLive(profile);
      if (profile.firstFrom === null || profile.firstFrom > input.validFrom) {
        throw invalid('profileId', 'inForce', 'the price profile has no values on that day');
      }
      const byProduct = new Map<number, TermsRow[]>();
      for (const row of await tx
        .select()
        .from(productPrices)
        .where(idIn(productPrices.productId, ids))) {
        const list = byProduct.get(row.productId) ?? [];
        list.push(row);
        byProduct.set(row.productId, list);
      }
      const result: ProfileChangeResult = { changed: [], unchanged: [], skipped: [] };
      const audits: AuditEntry[] = [];
      for (const id of ids) {
        const targets = (byProduct.get(id) ?? [])
          .filter(applied)
          .filter((row) => inForceOn(row, input.validFrom) || row.validFrom > input.validFrom)
          .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
        if (targets.length === 0) {
          result.skipped.push({ productId: id, reason: 'NO_TERMS' });
          continue;
        }
        const changing = targets.filter((row) => row.profileId !== input.profileId);
        if (changing.length === 0) {
          result.unchanged.push(id);
          continue;
        }
        for (const row of changing) {
          const from = row.validFrom > input.validFrom ? row.validFrom : input.validFrom;
          await tx.update(productPrices).set({ validTo: from }).where(eq(productPrices.id, row.id));
          await tx.insert(productPrices).values({
            productId: id,
            warehousePrice: row.warehousePrice,
            profileId: input.profileId,
            wholeUomId: row.wholeUomId,
            validFrom: from,
            validTo: row.validTo,
            createdBy: actorUserId(actor),
          });
          audits.push({
            action: 'UPDATE',
            entity: 'product_prices',
            entityId: id,
            before: termsAudit(row),
            after: {
              validFrom: from,
              warehousePrice: row.warehousePrice.toFixed(0),
              profileId: input.profileId,
              wholeUomId: row.wholeUomId,
            },
          });
        }
        result.changed.push(id);
      }
      if (audits.length > 0) await this.audit.recordMany(tx, actor, audits);
      return result;
    });
  }

  /**
   * Sets many products' terms inside the caller's transaction (the price sheet import, ADR-0054 #4),
   * each by `set`'s rule: from its day on, terms equal to those in force that day change nothing.
   * Up to 20,000 products: instead of their advisory locks the table is locked SHARE ROW EXCLUSIVE
   * (single and bulk changes wait for it, or it for them), then the profiles FOR SHARE in id order.
   * The caller checked the rows; they are checked again here, as `set` would.
   */
  async setManyInTx(
    tx: Tx,
    actor: Actor,
    inputs: readonly SetTermsInput[],
  ): Promise<WrittenTerms[]> {
    if (inputs.length === 0) return [];
    const today = businessDate();
    const byProduct = new Map<number, SetTermsInput>();
    for (const input of inputs) {
      assertNotPast('validFrom', input.validFrom, today);
      if (byProduct.has(input.productId)) {
        throw invalid('productId', 'unique', 'one row per product');
      }
      byProduct.set(input.productId, input);
    }
    const ids = [...byProduct.keys()].sort((a, b) => a - b);
    await tx.execute(sql`LOCK TABLE product_prices IN SHARE ROW EXCLUSIVE MODE`);
    const earliest = new Map<number, string>();
    for (const input of inputs) {
      const day = earliest.get(input.profileId);
      if (day === undefined || input.validFrom < day)
        earliest.set(input.profileId, input.validFrom);
    }
    for (const [profileId, day] of [...earliest].sort(([a], [b]) => a - b)) {
      const profile = await this.profiles.lockForPricesInTx(tx, profileId);
      assertLive(profile);
      if (profile.firstFrom === null || profile.firstFrom > day) {
        throw invalid('profileId', 'inForce', 'the price profile has no values on that day');
      }
    }
    const units = await this.units.currentUnits(ids, tx);
    for (const id of ids) {
      const problem = wholeUnitProblem(
        packUnitsOf(units.get(id) ?? []),
        byProduct.get(id)?.wholeUomId ?? null,
      );
      if (problem) throw invalid('wholeUomId', 'packUnit', `product ${id}: ${problem}`);
    }
    const rowsOf = await this.rowsByProduct(tx, ids);
    const closes: { id: number; validTo: string }[] = [];
    const inserts: (typeof productPrices.$inferInsert)[] = [];
    const planned: Omit<WrittenTerms, 'rowId'>[] = [];
    const audits: AuditEntry[] = [];
    for (const id of ids) {
      const input = byProduct.get(id);
      if (!input) continue;
      const plan = planChange(
        rowsOf.get(id) ?? [],
        input.validFrom,
        (row) =>
          row.warehousePrice.eq(input.warehousePrice) &&
          row.profileId === input.profileId &&
          row.wholeUomId === input.wholeUomId,
      );
      if (!plan) continue;
      if (plan.close) closes.push({ id: plan.close.id, validTo: input.validFrom });
      inserts.push({
        productId: id,
        warehousePrice: input.warehousePrice,
        profileId: input.profileId,
        wholeUomId: input.wholeUomId,
        validFrom: input.validFrom,
        validTo: plan.validTo,
        createdBy: actorUserId(actor),
      });
      planned.push({
        productId: id,
        validFrom: input.validFrom,
        validTo: plan.validTo,
        before: plan.close ? snapshotOf(plan.close) : null,
      });
      audits.push({
        action: 'UPDATE',
        entity: 'product_prices',
        entityId: id,
        before: plan.close ? termsAudit(plan.close) : null,
        after: {
          validFrom: input.validFrom,
          warehousePrice: input.warehousePrice.toFixed(0),
          profileId: input.profileId,
          wholeUomId: input.wholeUomId,
        },
      });
    }
    await closeRows(tx, closes);
    const rowIds = await insertRows(tx, inserts);
    await this.audit.recordMany(tx, actor, audits);
    return planned.flatMap((row) => {
      const rowId = rowIds.get(row.productId);
      return rowId === undefined ? [] : [{ ...row, rowId }];
    });
  }

  /**
   * Takes imported terms back from today (ADR-0054 #6), inside the caller's transaction and under
   * the import's table lock. Rows are never deleted, so the revert writes forward: an imported row
   * that still holds (same end, not ended) is closed today, or on its first day when it has not
   * started (it never applies), and the terms it replaced continue from then up to its end. A row
   * changed since is left alone. Returns the products taken back.
   */
  async restoreManyInTx(tx: Tx, actor: Actor, entries: readonly TermsRestore[]): Promise<number[]> {
    if (entries.length === 0) return [];
    const today = businessDate();
    await tx.execute(sql`LOCK TABLE product_prices IN SHARE ROW EXCLUSIVE MODE`);
    const profileIds = [
      ...new Set(entries.flatMap((entry) => (entry.before ? [entry.before.profileId] : []))),
    ].sort((a, b) => a - b);
    for (const id of profileIds) await this.profiles.lockForPricesInTx(tx, id);
    const rowsOf = await this.rowsByProduct(
      tx,
      entries.map((entry) => entry.productId),
    );
    const closes: { id: number; validTo: string }[] = [];
    const inserts: (typeof productPrices.$inferInsert)[] = [];
    const audits: AuditEntry[] = [];
    const restored: number[] = [];
    for (const entry of entries) {
      const row = rowsOf.get(entry.productId)?.find((own) => own.id === entry.rowId);
      if (!row || !applied(row) || row.validTo !== entry.validTo) continue;
      if (row.validTo !== null && row.validTo <= today) continue;
      const from = row.validFrom > today ? row.validFrom : today;
      closes.push({ id: row.id, validTo: from });
      if (entry.before) {
        inserts.push({
          productId: entry.productId,
          warehousePrice: new Decimal(entry.before.warehousePrice),
          profileId: entry.before.profileId,
          wholeUomId: entry.before.wholeUomId,
          validFrom: from,
          validTo: row.validTo,
          createdBy: actorUserId(actor),
        });
      }
      audits.push({
        action: 'UPDATE',
        entity: 'product_prices',
        entityId: entry.productId,
        before: termsAudit(row),
        after: entry.before
          ? { validFrom: from, ...entry.before }
          : { validFrom: from, ended: true },
      });
      restored.push(entry.productId);
    }
    await closeRows(tx, closes);
    await insertRows(tx, inserts);
    await this.audit.recordMany(tx, actor, audits);
    return restored.sort((a, b) => a - b);
  }

  private async rowsByProduct(
    tx: Tx,
    productIds: readonly number[],
  ): Promise<Map<number, TermsRow[]>> {
    const byProduct = new Map<number, TermsRow[]>();
    if (productIds.length === 0) return byProduct;
    const rows = await tx
      .select()
      .from(productPrices)
      .where(idIn(productPrices.productId, [...new Set(productIds)]));
    for (const row of rows) {
      const list = byProduct.get(row.productId) ?? [];
      list.push(row);
      byProduct.set(row.productId, list);
    }
    return byProduct;
  }
}

/** Ends rows on given days, many per statement. */
async function closeRows(
  tx: Tx,
  closes: readonly { id: number; validTo: string }[],
): Promise<void> {
  for (let start = 0; start < closes.length; start += WRITE_CHUNK) {
    const chunk = closes.slice(start, start + WRITE_CHUNK);
    await tx.execute(sql`
      UPDATE product_prices SET valid_to = v.valid_to
      FROM unnest(${sql.param(chunk.map((row) => row.id))}::bigint[],
                  ${sql.param(chunk.map((row) => row.validTo))}::date[]) AS v(id, valid_to)
      WHERE product_prices.id = v.id`);
  }
}

/** Inserts terms rows, many per statement; product id → the new row's id (one row per product). */
async function insertRows(
  tx: Tx,
  rows: readonly (typeof productPrices.$inferInsert)[],
): Promise<Map<number, number>> {
  const ids = new Map<number, number>();
  for (let start = 0; start < rows.length; start += WRITE_CHUNK) {
    const inserted = await tx
      .insert(productPrices)
      .values(rows.slice(start, start + WRITE_CHUNK))
      .returning({ id: productPrices.id, productId: productPrices.productId });
    for (const row of inserted) ids.set(row.productId, row.id);
  }
  return ids;
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

function snapshotOf(row: TermsRow): TermsSnapshot {
  return {
    warehousePrice: row.warehousePrice.toFixed(0),
    profileId: row.profileId,
    wholeUomId: row.wholeUomId,
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
