import { Inject, Injectable } from '@nestjs/common';
import type { RangedCategory } from '@tugeel/shared/catalog';
import {
  erkhetApplyChoices,
  erkhetIssueAppliable,
  type ErkhetResolution,
  type ErkhetSyncIssue,
  type ErkhetSyncKind,
} from '@tugeel/shared/erkhet';
import { classifyBarcode, lookupCandidates } from '@tugeel/shared/gtin';
import type { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import { CatalogImportService, type CatalogReference, CategoriesService } from '../../catalog';
import type { AuthContext } from '../../identity';
import { CustomersService } from '../../partners';
import { PriceProfilesService, ProductPricesService, SaleReadinessService } from '../../pricing';
import { customerPlanOf, erkhetSyncItems, productPlanOf } from '../schema';
import { erkhetCodeFree, nextCodeOf, packQtyOf, uomOf, weightOf } from './erkhet-new-product';
import { splitBarcodes } from './erkhet-sheets';
import { ErkhetSyncService } from './erkhet-sync.service';

type ItemRow = typeof erkhetSyncItems.$inferSelect;

export interface ErkhetApplyInput {
  /** Chosen rows; or every open row of one issue. */
  itemIds?: number[];
  kind?: ErkhetSyncKind;
  issue?: ErkhetSyncIssue;
  /** The category of the products added from Erkhet (ADR-0222). */
  categoryId?: number;
  /** The price profile of the prices taken from Erkhet for new and unpriced products (ADR-0222). */
  profileId?: number;
}

/** What the person chose for the rows, checked once for the request. */
interface Choices {
  categoryId: number | null;
  profileId: number | null;
}

/**
 * What adding products needs beyond a row, read once for the request: the units of measure, the
 * categories' code ranges and every product code as a number. Codes taken by this request's own
 * products are added as each is committed, so the next product takes the next code.
 */
interface NewProducts {
  uoms: CatalogReference['uoms'];
  pcs: CatalogReference['uoms'][number];
  box: CatalogReference['uoms'][number];
  categories: RangedCategory[];
  taken: Set<bigint>;
}

export interface ErkhetApplyResult {
  /** Bto now says what Erkhet says. */
  applied: number;
  /** Bto had changed since the check: left alone, check again. */
  stale: number;
  /** A rule of Bto refused the change. */
  refused: number;
  /** Rows that were already looked at, or that nothing can be done for. */
  skipped: number;
}

/** A row's change did not go through, and why it is not an error of the request. */
class Outcome extends Error {
  constructor(readonly resolution: Exclude<ErkhetResolution, 'APPLIED'>) {
    super(resolution);
  }
}

/**
 * «Bto-д тааруулах» (ADR-0203 #6): brings Bto to what Erkhet says, one row and one transaction at
 * a time, through the services that own the data, so every change is audited and follows the same
 * rules as a change made by hand. Only rows of the latest finished check are taken, and each is
 * checked again first: where Bto changed since the check, the row is marked STALE and left alone.
 * Nothing is ever written to Erkhet.
 */
@Injectable()
export class ErkhetApplyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sync: ErkhetSyncService,
    private readonly customers: CustomersService,
    private readonly prices: ProductPricesService,
    private readonly catalog: CatalogImportService,
    private readonly categories: CategoriesService,
    private readonly profiles: PriceProfilesService,
    private readonly readiness: SaleReadinessService,
  ) {}

  async apply(actor: AuthContext, input: ErkhetApplyInput): Promise<ErkhetApplyResult> {
    const run = await this.sync.latestDone();
    if (!run) throw new AppError('ERKHET_RUN_SUPERSEDED', 'no finished check');
    let rows: ItemRow[];
    if (input.itemIds && input.itemIds.length > 0) {
      rows = await this.sync.itemsByIds(input.itemIds);
      if (rows.length !== new Set(input.itemIds).size) {
        throw invalid('itemIds', 'exists', 'unknown rows');
      }
    } else if (input.kind && input.issue) {
      rows = await this.sync.openItems(run.id, input.kind, input.issue);
    } else {
      throw invalid('itemIds', 'required', 'rows, or a kind and an issue');
    }
    if (rows.some((row) => row.runId !== run.id)) {
      throw new AppError('ERKHET_RUN_SUPERSEDED', 'the rows belong to an older check', {
        runId: run.id,
      });
    }
    const open = rows.filter(
      (row) => row.resolution === null && erkhetIssueAppliable(row.kind, row.issue),
    );
    const choices = await this.choices(input, open);
    const adding = open.some((row) => row.kind === 'PRODUCT' && row.issue === 'MISSING_IN_BTO');
    const newProducts = adding ? await this.newProducts() : null;
    const result: ErkhetApplyResult = { applied: 0, stale: 0, refused: 0, skipped: 0 };
    for (const row of rows) {
      if (row.resolution !== null || !erkhetIssueAppliable(row.kind, row.issue)) {
        result.skipped += 1;
        continue;
      }
      // A new product's code is chosen before its transaction, which then only uses it.
      const sku = newProducts ? this.codeFor(row, choices, newProducts) : null;
      const resolution = await this.applyOne(actor, row, choices, newProducts, sku);
      if (resolution === 'APPLIED' && sku !== null) newProducts?.taken.add(BigInt(sku));
      if (resolution === null) result.skipped += 1;
      else if (resolution === 'APPLIED') result.applied += 1;
      else if (resolution === 'STALE') result.stale += 1;
      else result.refused += 1;
    }
    return result;
  }

  /**
   * The choices the rows need (ADR-0222): a category for new products, a price profile for new and
   * unpriced products. A missing or unusable choice refuses the whole request, before any row.
   */
  private async choices(input: ErkhetApplyInput, rows: readonly ItemRow[]): Promise<Choices> {
    const needed = new Set(rows.flatMap((row) => erkhetApplyChoices(row.kind, row.issue)));
    const choices: Choices = { categoryId: null, profileId: null };
    if (needed.has('categoryId')) {
      if (input.categoryId === undefined) {
        throw invalid('categoryId', 'required', 'choose the category of the new products');
      }
      const categories = await this.categories.list();
      if (!categories.some((category) => category.id === input.categoryId)) {
        throw invalid('categoryId', 'exists', 'unknown category');
      }
      choices.categoryId = input.categoryId;
    }
    if (needed.has('profileId')) {
      if (input.profileId === undefined) {
        throw invalid('profileId', 'required', 'choose the price profile');
      }
      const profile = (await this.profiles.forImport()).find((one) => one.id === input.profileId);
      if (!profile) throw invalid('profileId', 'exists', 'unknown price profile');
      // Prices are set from today: the profile must be live and hold values today.
      if (profile.archived || profile.current === null) {
        throw invalid('profileId', 'inForce', 'the price profile has no values today');
      }
      choices.profileId = input.profileId;
    }
    return choices;
  }

  private async newProducts(): Promise<NewProducts> {
    const reference = await this.catalog.reference();
    const pcs = reference.uoms.find((uom) => uom.code === 'PCS');
    const box = reference.uoms.find((uom) => uom.code === 'BOX');
    if (!pcs || !box) throw new Error('the PCS and BOX units of measure are missing');
    const categories = (await this.categories.list()).map((category) => ({
      id: category.id,
      parentId: category.parentId,
      name: category.name,
      skuFrom: category.skuFrom,
      skuTo: category.skuTo,
    }));
    const taken = new Set((await this.catalog.directory()).map((product) => BigInt(product.sku)));
    return { uoms: reference.uoms, pcs, box, categories, taken };
  }

  /**
   * A new product's code (ADR-0222): Erkhet's own when it is digits only and no Bto product has
   * that number (an import may use any code, ADR-0044 #1), else the next free code of the chosen
   * category. Null for a row that adds no product, or when the category's range is full.
   */
  private codeFor(row: ItemRow, choices: Choices, context: NewProducts): string | null {
    if (row.kind !== 'PRODUCT' || row.issue !== 'MISSING_IN_BTO') return null;
    if (row.erkhetCode && erkhetCodeFree(row.erkhetCode, context.taken)) return row.erkhetCode;
    if (choices.categoryId === null) return null;
    return nextCodeOf(context.categories, choices.categoryId, context.taken);
  }

  /** null: another request settled the row first. */
  private async applyOne(
    actor: AuthContext,
    row: ItemRow,
    choices: Choices,
    newProducts: NewProducts | null,
    sku: string | null,
  ): Promise<ErkhetResolution | null> {
    try {
      return await inTransaction(this.db, async (tx) => {
        // The row is claimed first: of two requests for it, the second finds it settled.
        const claimed = await this.mark(tx, actor, row.id, 'APPLIED');
        if (!claimed) return null;
        await this.change(tx, actor, row, choices, newProducts, sku);
        return 'APPLIED' as const;
      });
    } catch (error: unknown) {
      // The transaction is gone with the claim; the reason is written on its own.
      const resolution =
        error instanceof Outcome
          ? error.resolution
          : error instanceof AppError || isConstraintViolation(error)
            ? 'REFUSED'
            : null;
      if (resolution === null) throw error;
      const marked = await this.mark(this.db, actor, row.id, resolution);
      return marked ? resolution : null;
    }
  }

  private async change(
    tx: Tx,
    actor: AuthContext,
    row: ItemRow,
    choices: Choices,
    newProducts: NewProducts | null,
    sku: string | null,
  ): Promise<void> {
    if (row.kind === 'CUSTOMER' && row.issue === 'MISSING_IN_BTO') {
      const plan = customerPlanOf(row);
      if (!row.erkhetCode || !row.erkhetName || !plan) throw new Outcome('REFUSED');
      const taken = await this.customers.findByCodes([row.erkhetCode], tx);
      if (taken.length > 0) throw new Outcome('STALE');
      await this.customers.createInTx(tx, actor, {
        code: row.erkhetCode,
        name: row.erkhetName,
        kind: plan.kind,
        phone: plan.phone,
        categoryId: plan.categoryId,
        settlementGroup: plan.settlementGroup,
      });
      return;
    }
    if (row.kind === 'CUSTOMER' && row.issue === 'NAME_DIFFERS') {
      if (row.btoId === null || !row.erkhetName) throw new Outcome('REFUSED');
      const [customer] = await this.customers.findByIds([row.btoId], tx);
      if (!customer || customer.name !== row.btoName || customer.code !== row.erkhetCode) {
        throw new Outcome('STALE');
      }
      await this.customers.updateInTx(tx, actor, row.btoId, { name: row.erkhetName });
      return;
    }
    if (row.kind === 'PRODUCT' && row.issue === 'PRICE_DIFFERS') {
      if (row.btoId === null || row.erkhetPrice === null || row.btoPrice === null) {
        throw new Outcome('REFUSED');
      }
      // Bto's prices are whole tugriks (ADR-0048); a price with a fraction is for a person.
      if (!row.erkhetPrice.isInteger() || !row.erkhetPrice.gt(0)) throw new Outcome('REFUSED');
      const today = businessDate();
      const terms = (await this.prices.inForce([row.btoId], today, tx)).get(row.btoId);
      if (!terms || !terms.warehousePrice.eq(row.btoPrice)) throw new Outcome('STALE');
      await this.prices.setInTx(tx, actor, {
        productId: row.btoId,
        validFrom: today,
        warehousePrice: row.erkhetPrice,
        profileId: terms.profileId,
        wholeUomId: terms.wholeUomId,
      });
      return;
    }
    if (row.kind === 'PRODUCT' && row.issue === 'MISSING_IN_BTO') {
      await this.addProduct(tx, actor, row, choices, newProducts, sku);
      return;
    }
    if (row.kind === 'PRODUCT' && row.issue === 'NO_BTO_PRICE') {
      await this.priceProduct(tx, actor, row, choices);
      return;
    }
    throw new Outcome('REFUSED');
  }

  /**
   * «Bto-д нэмэх» for a product (ADR-0222): Erkhet's name, barcodes on the base unit, its unit, a
   * box when Erkhet has one and its weight, through the catalog's bulk create (audited, waiting for
   * prices); then Erkhet's price as the warehouse price from today, the box counted whole, and the
   * product completed. A row of a check before ADR-0222 carries none of Erkhet's units: refused.
   */
  private async addProduct(
    tx: Tx,
    actor: AuthContext,
    row: ItemRow,
    choices: Choices,
    context: NewProducts | null,
    sku: string | null,
  ): Promise<void> {
    const plan = productPlanOf(row);
    const { categoryId, profileId } = choices;
    if (!row.erkhetName || !plan || !context || categoryId === null || profileId === null) {
      throw new Outcome('REFUSED');
    }
    if (sku === null) throw new Outcome('REFUSED');
    const barcodes = new Map<string, string>();
    for (const code of splitBarcodes(row.erkhetBarcodes ?? '')) {
      const classified = classifyBarcode(code);
      // An unreadable code would be refused by hand too.
      if (!classified.ok) throw new Outcome('REFUSED');
      if (!barcodes.has(classified.value.lookupKey)) {
        barcodes.set(classified.value.lookupKey, classified.value.code);
      }
    }
    if (barcodes.size === 0) throw new Outcome('REFUSED');
    // A barcode Bto has taken since the check: the item may be in Bto now.
    const keys = [...barcodes.values()].flatMap((code) => lookupCandidates(code));
    if ((await this.catalog.barcodeOwners(keys, tx)).size > 0) throw new Outcome('STALE');

    const base = uomOf(context.uoms, plan.unitCode, plan.unitName) ?? context.pcs;
    const packQty = packQtyOf(plan.packRatio);
    // A product whose base unit is the box has no box beside it.
    const box = packQty !== null && base.id !== context.box.id ? packQty : null;
    const created = await this.catalog.createManyInTx(tx, actor, [
      {
        sku,
        name: row.erkhetName,
        categoryId,
        vatType: 'VAT_ABLE',
        weightKg: weightOf(plan.weight),
        baseUomId: base.id,
        baseBarcodes: [...barcodes.values()],
        box: box === null ? null : { uomId: context.box.id, factorToBase: box, barcodes: [] },
      },
    ]);
    const productId = created.get(sku)?.productId;
    if (productId === undefined) throw new Error(`product ${sku} was not created`);
    // Without a whole price from Erkhet the product waits for its price like any new one.
    if (!wholePrice(row.erkhetPrice)) return;
    await this.prices.setInTx(tx, actor, {
      productId,
      validFrom: businessDate(),
      warehousePrice: row.erkhetPrice,
      profileId,
      wholeUomId: box === null ? null : context.box.id,
    });
    await this.readiness.completeManyInTx(tx, actor, [productId]);
  }

  /**
   * «Үнийг тааруулах» for a product without a price today (ADR-0222): Erkhet's price as the
   * warehouse price from today with the chosen profile, its largest pack counted whole, and the
   * product completed. Refused without a whole price in Erkhet; stale when Bto priced it since.
   */
  private async priceProduct(
    tx: Tx,
    actor: AuthContext,
    row: ItemRow,
    choices: Choices,
  ): Promise<void> {
    if (row.btoId === null || choices.profileId === null || !wholePrice(row.erkhetPrice)) {
      throw new Outcome('REFUSED');
    }
    const [product] = await this.catalog.productsByIds([row.btoId], tx);
    if (!product || product.status !== 'ACTIVE') throw new Outcome('STALE');
    const today = businessDate();
    if ((await this.prices.inForce([row.btoId], today, tx)).has(row.btoId)) {
      throw new Outcome('STALE');
    }
    const [largest] = product.units
      .filter((unit) => !unit.isBase)
      .sort((a, b) => b.factorToBase.comparedTo(a.factorToBase));
    await this.prices.setInTx(tx, actor, {
      productId: row.btoId,
      validFrom: today,
      warehousePrice: row.erkhetPrice,
      profileId: choices.profileId,
      wholeUomId: largest?.uomId ?? null,
    });
    await this.readiness.completeManyInTx(tx, actor, [row.btoId]);
  }

  /** Writes how an open row ended; false when it was not open any more. */
  private async mark(
    executor: Db | Tx,
    actor: AuthContext,
    id: number,
    resolution: ErkhetResolution,
  ): Promise<boolean> {
    const rows = await executor
      .update(erkhetSyncItems)
      .set({ resolution, resolvedBy: actor.userId, resolvedAt: sql`now()` })
      .where(and(eq(erkhetSyncItems.id, id), isNull(erkhetSyncItems.resolution)))
      .returning({ id: erkhetSyncItems.id });
    return rows.length > 0;
  }
}

/** Bto's prices are whole tugriks above nothing (ADR-0048); Erkhet's may be anything. */
function wholePrice(price: Decimal | null): price is Decimal {
  return price !== null && price.isInteger() && price.gt(0);
}

/** A unique or CHECK constraint of the table refused the row: Bto's rule, not a fault. */
function isConstraintViolation(error: unknown): boolean {
  const code = databaseErrorOf(error)?.code;
  return code === '23505' || code === '23514';
}
