import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Decimal } from '@tugeel/shared/money';
import {
  defaultWholeUomId,
  type LocationPriceSettings,
  markedUpPrice,
  markedUpRatioPrice,
  PRICE_ROUNDINGS,
} from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, gt, lte, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { CatalogService, UnitConversionService } from '../../catalog';
import {
  type Actor,
  actorUserId,
  type AuthContext,
  AuditService,
  OrgService,
  ScopeService,
} from '../../identity';
import type { SupplierReceiptPricingFacts, SupplierReceiptPrices } from '../../inventory';
import { SuppliersService } from '../../partners';
import {
  type BasePriceEventDto,
  type BasePriceViewDto,
  type LocationPriceRuleDto,
  type LocationPriceRuleInputDto,
  type ManualBasePriceInputDto,
  type SupplierPriceRuleDto,
  type SupplierPriceRuleInputDto,
} from '../dto/supplier-pricing.dto';
import {
  basePriceEvents,
  basePriceStates,
  locationPriceRules,
  locationPriceRuleVersions,
  productPrices,
  supplierPriceRules,
} from '../schema';
import {
  type BasePriceObserver,
  PRICE_CHANGE_NOTIFIER,
  type PriceChangeNotifier,
  type ReceiptPriceChanges,
} from './base-price-ports';
import { PriceProfilesService } from './price-profiles.service';
import { ProductPricesService } from './product-prices.service';
import { inForceSql } from './support';

type RuleInput = SupplierPriceRuleInputDto;
type EventRow = typeof basePriceEvents.$inferSelect;
type SkipReason =
  'RULE_NOT_CONFIGURED' | 'PRINTED_PRICE_MISSING' | 'PRINTED_PRICE_CONFLICT' | 'PRICE_OUT_OF_RANGE';
const MAX_PRICE = new Decimal('999999999999');
const PRICING_GATE = 72_030_003;

/** Canonical base selling prices, derived from printed receipt facts, independent of stock cost. */
@Injectable()
export class SupplierPricingService
  implements SupplierReceiptPrices, BasePriceObserver, OnModuleInit
{
  private notifier: PriceChangeNotifier | null = null;
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
    private readonly suppliers: SuppliersService,
    private readonly org: OrgService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly prices: ProductPricesService,
    private readonly profiles: PriceProfilesService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.notifier = this.moduleRef.get<PriceChangeNotifier>(PRICE_CHANGE_NOTIFIER, {
        strict: false,
      });
    } catch {
      this.notifier = null;
    }
  }

  async lockInTx(tx: Tx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PRICING_GATE})`);
  }

  async isEnabledInTx(tx: Tx, supplierId: number): Promise<boolean> {
    const [rule] = await tx
      .select()
      .from(supplierPriceRules)
      .where(eq(supplierPriceRules.supplierId, supplierId));
    return rule?.enabled === true;
  }

  async supplierRules(): Promise<SupplierPriceRuleDto[]> {
    const rows = await this.db
      .select()
      .from(supplierPriceRules)
      .orderBy(asc(supplierPriceRules.supplierId));
    const names = new Map(
      (await this.suppliers.getMany(rows.map((r) => r.supplierId))).map((s) => [s.id, s.name]),
    );
    return rows.map((r) => ({
      ...r,
      supplierName: names.get(r.supplierId) ?? '',
      markupPct: r.markupPct.toFixed(),
      markupAmount: r.markupAmount.toFixed(0),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async setSupplierRule(
    ctx: AuthContext,
    supplierId: number,
    input: RuleInput,
  ): Promise<SupplierPriceRuleDto> {
    checkRule(input);
    await inTransaction(this.db, async (tx) => {
      await this.lockInTx(tx);
      await this.suppliers.get(supplierId, tx);
      const [current] = await tx
        .select()
        .from(supplierPriceRules)
        .where(eq(supplierPriceRules.supplierId, supplierId));
      if ((current?.version ?? 0) !== input.expectedVersion) throw stale();
      const values = {
        enabled: input.enabled,
        markupPct: new Decimal(input.markupPct),
        markupAmount: new Decimal(input.markupAmount),
        rounding: input.rounding,
        version: (current?.version ?? 0) + 1,
        updatedBy: ctx.userId,
        updatedAt: sql`clock_timestamp()`,
      };
      if (current)
        await tx
          .update(supplierPriceRules)
          .set(values)
          .where(eq(supplierPriceRules.supplierId, supplierId));
      else await tx.insert(supplierPriceRules).values({ supplierId, ...values });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'supplier_price_rules',
        entityId: supplierId,
        after: { enabled: input.enabled, version: values.version },
      });
    });
    const result = (await this.supplierRules()).find((r) => r.supplierId === supplierId);
    if (!result) throw new Error('supplier rule missing after save');
    return result;
  }

  async locationRules(): Promise<LocationPriceRuleDto[]> {
    const rows = await this.db
      .select()
      .from(locationPriceRules)
      .orderBy(asc(locationPriceRules.warehouseId));
    const names = await this.org.warehouseNames(rows.map((r) => r.warehouseId));
    return rows.map((r) => ({
      ...r,
      warehouseName: names.get(r.warehouseId) ?? '',
      markupPct: r.markupPct.toFixed(),
      markupAmount: r.markupAmount.toFixed(0),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async setLocationRule(
    ctx: AuthContext,
    warehouseId: number,
    input: LocationPriceRuleInputDto,
  ): Promise<LocationPriceRuleDto> {
    this.scope.assertCanWriteWarehouse(ctx, warehouseId);
    checkRule(input);
    if (
      input.priceType === 'BASE' &&
      (!new Decimal(input.markupPct).isZero() || !new Decimal(input.markupAmount).isZero())
    )
      throw invalid('priceType', 'base', 'base prices do not carry a location uplift');
    await inTransaction(this.db, async (tx) => {
      await this.lockInTx(tx);
      const warehouse = await this.org.getWarehouse(warehouseId, tx);
      if (warehouse.kind === 'TRANSIT')
        throw invalid('warehouseId', 'sellingLocation', 'transit is not a selling location');
      const [current] = await tx
        .select()
        .from(locationPriceRules)
        .where(eq(locationPriceRules.warehouseId, warehouseId));
      if ((current?.version ?? 0) !== input.expectedVersion) throw stale();
      const values = {
        enabled: input.enabled,
        priceType: input.priceType,
        markupPct: new Decimal(input.markupPct),
        markupAmount: new Decimal(input.markupAmount),
        rounding: input.rounding,
        version: (current?.version ?? 0) + 1,
        updatedBy: ctx.userId,
        updatedAt: sql`clock_timestamp()`,
      };
      if (current)
        await tx
          .update(locationPriceRules)
          .set(values)
          .where(eq(locationPriceRules.warehouseId, warehouseId));
      else await tx.insert(locationPriceRules).values({ warehouseId, ...values });
      await tx.insert(locationPriceRuleVersions).values({
        warehouseId,
        enabled: values.enabled,
        priceType: values.priceType,
        markupPct: values.markupPct,
        markupAmount: values.markupAmount,
        rounding: values.rounding,
        version: values.version,
        validFrom: businessDate(),
        createdBy: ctx.userId,
      });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'location_price_rules',
        entityId: warehouseId,
        after: { enabled: input.enabled, priceType: input.priceType, version: values.version },
      });
    });
    const result = (await this.locationRules()).find((r) => r.warehouseId === warehouseId);
    if (!result) throw new Error('location rule missing after save');
    return result;
  }

  async locationSettings(
    warehouseId: number,
    executor: Db | Tx = this.db,
    date = businessDate(),
  ): Promise<LocationPriceSettings | null> {
    const [row] = await executor
      .select()
      .from(locationPriceRuleVersions)
      .where(
        and(
          eq(locationPriceRuleVersions.warehouseId, warehouseId),
          lte(locationPriceRuleVersions.validFrom, date),
        ),
      )
      .orderBy(desc(locationPriceRuleVersions.validFrom), desc(locationPriceRuleVersions.id))
      .limit(1);
    return !row?.enabled
      ? null
      : {
          warehouseId,
          priceType: row.priceType,
          markupPct: row.markupPct.toFixed(),
          markupAmount: row.markupAmount.toFixed(0),
          rounding: row.rounding,
        };
  }

  async baseView(ctx: AuthContext, productId: number): Promise<BasePriceViewDto> {
    const [product] = await this.catalog.getMany([productId]);
    if (!product) throw notFound('product', productId);
    const current =
      (await this.prices.inForce([productId], businessDate())).get(productId)?.warehousePrice ??
      null;
    const [state] = await this.db
      .select()
      .from(basePriceStates)
      .where(eq(basePriceStates.productId, productId));
    const rows = await this.db
      .select()
      .from(basePriceEvents)
      .where(eq(basePriceEvents.productId, productId))
      .orderBy(desc(basePriceEvents.id))
      .limit(100);
    const latest = rows[0];
    const [applied] = await this.db
      .select()
      .from(basePriceEvents)
      .where(
        and(
          eq(basePriceEvents.productId, productId),
          sql`${basePriceEvents.kind} <> 'SKIPPED'`,
          lte(basePriceEvents.validFrom, businessDate()),
        ),
      )
      .orderBy(desc(basePriceEvents.id))
      .limit(1);
    const source =
      current === null
        ? null
        : applied?.newBasePrice && !current.eq(applied.newBasePrice)
          ? 'MANUAL'
          : applied
            ? applied.kind === 'MANUAL'
              ? 'MANUAL'
              : 'RECEIPT'
            : (state?.source ?? 'LEGACY');
    const base = (await this.units.currentUnits([productId])).get(productId)?.find((u) => u.isBase);
    return {
      productId,
      sku: product.sku,
      name: product.name,
      baseUomName: base?.uomName ?? '',
      basePrice: current?.toFixed(0) ?? null,
      source,
      lastEventId: state?.lastEventId ?? latest?.id ?? null,
      receiptId: applied?.receiptId ?? null,
      receiptNumber: applied?.receiptNumber ?? null,
      history: rows.map((row) => eventDto(row, product.sku, product.name, ctx)),
    };
  }

  async receiptChanges(ctx: AuthContext, receiptId: number): Promise<BasePriceEventDto[]> {
    const rows = await this.db
      .select()
      .from(basePriceEvents)
      .where(eq(basePriceEvents.receiptId, receiptId))
      .orderBy(asc(basePriceEvents.id));
    const products = new Map(
      (await this.catalog.getMany([...new Set(rows.map((r) => r.productId))])).map((p) => [
        p.id,
        p,
      ]),
    );
    return rows.map((row) =>
      eventDto(
        row,
        products.get(row.productId)?.sku ?? '',
        products.get(row.productId)?.name ?? '',
        ctx,
      ),
    );
  }

  async setManual(
    ctx: AuthContext,
    productId: number,
    input: ManualBasePriceInputDto,
  ): Promise<BasePriceViewDto> {
    const price = new Decimal(input.price);
    checkPrice(price);
    if (!input.reason.trim())
      throw invalid('reason', 'required', 'give a reason for a manual base price');
    await inTransaction(this.db, async (tx) => {
      await this.lockInTx(tx);
      const before =
        (await this.prices.inForce([productId], businessDate(), tx)).get(productId)
          ?.warehousePrice ?? null;
      const [state] = await tx
        .select()
        .from(basePriceStates)
        .where(eq(basePriceStates.productId, productId));
      if (
        (before?.toFixed(0) ?? null) !== input.expectedPrice ||
        (state?.lastEventId ?? null) !== input.expectedEventId
      )
        throw stale();
      await this.writeBaseInTx(tx, ctx, productId, price);
      await this.recordManual(tx, ctx, productId, before, price, input.reason.trim());
    });
    return this.baseView(ctx, productId);
  }

  /** Observes legacy price dialogs/imports as manual changes too, in their own transaction. */
  async manualInTx(
    tx: Tx,
    actor: Actor,
    productId: number,
    before: Decimal | null,
    after: Decimal | null,
    validFrom = businessDate(),
  ): Promise<void> {
    if (samePrice(before, after)) return;
    await this.recordManual(tx, actor, productId, before, after, null, validFrom);
  }

  private async recordManual(
    tx: Tx,
    actor: Actor,
    productId: number,
    before: Decimal | null,
    after: Decimal | null,
    reason: string | null,
    validFrom = businessDate(),
  ): Promise<void> {
    // A reverted import may remove current price terms. Keep the watermark blocked even then.
    const [event] = await tx
      .insert(basePriceEvents)
      .values({
        productId,
        kind: 'MANUAL',
        reason,
        oldBasePrice: before,
        newBasePrice: after,
        createdBy: actorUserId(actor),
        validFrom,
      })
      .returning();
    const [previous] = await tx
      .select()
      .from(basePriceStates)
      .where(eq(basePriceStates.productId, productId));
    const values = {
      source:
        validFrom > businessDate()
          ? (previous?.source ?? ('LEGACY' as const))
          : ('MANUAL' as const),
      manualAfterReceipt: true,
      ...(event ? { lastEventId: event.id } : {}),
    };
    await tx
      .insert(basePriceStates)
      .values({ productId, ...values })
      .onConflictDoUpdate({ target: basePriceStates.productId, set: values });
    await this.audit.record(tx, actor, {
      action: 'UPDATE',
      entity: 'base_price_events',
      entityId: productId,
      after: { eventId: event?.id ?? null, source: 'MANUAL' },
    });
  }

  async applyInTx(tx: Tx, actor: Actor, facts: SupplierReceiptPricingFacts): Promise<void> {
    await this.lockInTx(tx);
    const [currentRule] = await tx
      .select()
      .from(supplierPriceRules)
      .where(eq(supplierPriceRules.supplierId, facts.supplierId));
    const productIds = [
      ...new Set(facts.lines.filter((l) => l.qtyBase.gt(0)).map((l) => l.productId)),
    ].sort((a, b) => a - b);
    const products = new Map((await this.catalog.getMany(productIds, tx)).map((p) => [p.id, p]));
    const summary: {
      receiptId: number;
      receiptNumber: string;
      changes: ReceiptPriceChanges['changes'][number][];
      warnings: ReceiptPriceChanges['warnings'][number][];
    } = {
      receiptId: facts.receiptId,
      receiptNumber: facts.receiptNumber,
      changes: [],
      warnings: [],
    };
    for (const productId of productIds) {
      const [done] = await tx
        .select({ id: basePriceEvents.id })
        .from(basePriceEvents)
        .where(
          and(
            eq(basePriceEvents.productId, productId),
            eq(basePriceEvents.receiptId, facts.receiptId),
            eq(basePriceEvents.phase, facts.phase),
          ),
        )
        .limit(1);
      if (done) continue;
      const [previous] = await tx
        .select()
        .from(basePriceStates)
        .where(eq(basePriceStates.productId, productId));
      const before =
        (await this.prices.inForce([productId], businessDate(), tx)).get(productId)
          ?.warehousePrice ?? null;
      if (
        facts.phase === 'FIRST_PRICED' &&
        (!previous ||
          previous.lastReceiptId !== facts.receiptId ||
          previous.manualAfterReceipt ||
          !samePrice(before, previous.postingPrice))
      )
        continue;
      const rule =
        facts.phase === 'POST'
          ? currentRule?.enabled
            ? currentRule
            : null
          : previous &&
              previous.receiptMarkupPct !== null &&
              previous.receiptMarkupAmount !== null &&
              previous.receiptRounding
            ? {
                markupPct: previous.receiptMarkupPct,
                markupAmount: previous.receiptMarkupAmount,
                rounding: previous.receiptRounding,
                version: previous.receiptRuleVersion,
              }
            : null;
      const lines = facts.lines.filter((l) => l.productId === productId && l.qtyBase.gt(0));
      const known = lines.flatMap((l) =>
        l.printedUnitPriceBase === null ? [] : [l.printedUnitPriceBase],
      );
      let reason: SkipReason | null =
        rule === null
          ? 'RULE_NOT_CONFIGURED'
          : known.length !== lines.length
            ? 'PRINTED_PRICE_MISSING'
            : lines.some((line) => !samePrintedPrice(lines[0], line))
              ? 'PRINTED_PRICE_CONFLICT'
              : null;
      let next: Decimal | null = null;
      const printed = known[0] ?? null;
      if (reason === null && printed && rule) {
        const reference = lines[0];
        const candidate =
          reference?.printedPriceAmount != null && reference.printedPriceQtyBase != null
            ? markedUpRatioPrice(
                reference.printedPriceAmount,
                reference.printedPriceQtyBase,
                rule.markupPct,
                rule.markupAmount,
                rule.rounding,
              )
            : markedUpPrice(printed, rule.markupPct, rule.markupAmount, rule.rounding);
        if (!candidate.isFinite() || !candidate.gt(0) || candidate.gt(MAX_PRICE))
          reason = 'PRICE_OUT_OF_RANGE';
        else next = candidate;
      }
      const manual =
        previous?.source === 'MANUAL' ||
        previous?.manualAfterReceipt === true ||
        (previous !== undefined && !samePrice(before, previous.postingPrice));
      if (next) await this.writeBaseInTx(tx, actor, productId, next);
      const [event] = await tx
        .insert(basePriceEvents)
        .values({
          productId,
          kind: next ? 'RECEIPT' : 'SKIPPED',
          phase: facts.phase,
          reason,
          oldBasePrice: before,
          newBasePrice: next,
          printedUnitPriceBase: rule && printed ? printed.toFixed() : null,
          printedPriceAmount: rule ? (lines[0]?.printedPriceAmount ?? null) : null,
          printedPriceQtyBase: rule ? (lines[0]?.printedPriceQtyBase ?? null) : null,
          ruleSnapshot: rule
            ? {
                supplierId: facts.supplierId,
                version: rule.version,
                markupPct: rule.markupPct.toFixed(),
                markupAmount: rule.markupAmount.toFixed(0),
                rounding: rule.rounding,
              }
            : null,
          overrodeManual: next !== null && manual,
          receiptId: facts.receiptId,
          receiptNumber: facts.receiptNumber,
          createdBy: actorUserId(actor),
          validFrom: businessDate(),
        })
        .returning();
      if (!event) throw new Error('base price event insert returned no row');
      const watermark =
        facts.phase === 'POST'
          ? {
              lastReceiptId: facts.receiptId,
              lastReceiptPostedAt: facts.postedAt,
              manualAfterReceipt: false,
              receiptRuleVersion: rule?.version ?? null,
              receiptMarkupPct: rule?.markupPct ?? null,
              receiptMarkupAmount: rule?.markupAmount ?? null,
              receiptRounding: rule?.rounding ?? null,
            }
          : {};
      const values = {
        ...watermark,
        source: next ? ('RECEIPT' as const) : (previous?.source ?? ('LEGACY' as const)),
        lastEventId: event.id,
        postingPrice: next ?? before,
        receiptApplied: next !== null,
      };
      await tx
        .insert(basePriceStates)
        .values({ productId, ...values })
        .onConflictDoUpdate({ target: basePriceStates.productId, set: values });
      const product = products.get(productId);
      if (next && (!samePrice(before, next) || manual))
        summary.changes.push({
          eventId: event.id,
          productId,
          sku: product?.sku ?? '',
          name: product?.name ?? '',
          oldBasePrice: before?.toFixed(0) ?? null,
          newBasePrice: next.toFixed(0),
          overrodeManual: manual,
        });
      if (reason && reason !== 'RULE_NOT_CONFIGURED' && rule)
        summary.warnings.push({
          eventId: event.id,
          productId,
          sku: product?.sku ?? '',
          name: product?.name ?? '',
          reason,
        });
      await this.audit.record(tx, actor, {
        action: next ? 'UPDATE' : 'SKIP',
        entity: 'base_price_events',
        entityId: productId,
        after: { eventId: event.id, receiptId: facts.receiptId, phase: facts.phase, reason },
      });
    }
    if (summary.changes.length + summary.warnings.length > 0 && this.notifier)
      await this.notifier.notifyInTx(tx, actor, summary);
  }

  private async writeBaseInTx(
    tx: Tx,
    actor: Actor,
    productId: number,
    price: Decimal,
  ): Promise<void> {
    const today = businessDate();
    const current = (await this.prices.inForce([productId], today, tx)).get(productId);
    const [active] = await tx
      .select({ validTo: productPrices.validTo })
      .from(productPrices)
      .where(
        and(
          eq(productPrices.productId, productId),
          inForceSql(productPrices.validFrom, productPrices.validTo, today),
        ),
      )
      .limit(1);
    const profileId =
      current?.profileId ?? (await this.profiles.ensureNeutralInTx(tx, actor, today));
    const units = (await this.units.currentUnits([productId], tx)).get(productId) ?? [];
    const wholeUomId =
      current?.wholeUomId ??
      defaultWholeUomId(
        units.map((u) => ({ uomId: u.uomId, uomCode: u.uomCode, isBase: u.isBase })),
      ) ??
      units.find((u) => !u.isBase)?.uomId ??
      null;
    // Receipt-derived base owns the coming timeline until a later explicit change or receipt.
    await tx
      .update(productPrices)
      .set({ validTo: productPrices.validFrom })
      .where(
        and(
          eq(productPrices.productId, productId),
          gt(productPrices.validFrom, today),
          or(
            sql`${productPrices.validTo} IS NULL`,
            gt(productPrices.validTo, productPrices.validFrom),
          ),
        ),
      );
    await this.prices.setInTx(
      tx,
      actor,
      { productId, validFrom: today, warehousePrice: price, profileId, wholeUomId },
      'SUPPLIER',
      active?.validTo != null,
    );
  }
}

function checkRule(input: RuleInput): void {
  const pct = new Decimal(input.markupPct),
    amount = new Decimal(input.markupAmount);
  if (!pct.isFinite() || pct.lt(0) || pct.gt('999.99') || pct.decimalPlaces() > 2)
    throw invalid('markupPct', 'range', 'a percentage from zero to 999.99');
  if (!amount.isFinite() || amount.lt(0) || amount.gt(MAX_PRICE) || !amount.isInteger())
    throw invalid('markupAmount', 'wholeMnt', 'nonnegative whole MNT');
  if (!PRICE_ROUNDINGS.includes(input.rounding))
    throw invalid('rounding', 'enum', 'a supported price rounding');
}

function checkPrice(value: Decimal): void {
  if (!value.isFinite() || !value.gt(0) || value.gt(MAX_PRICE) || !value.isInteger())
    throw invalid('price', 'wholeMnt', 'positive whole MNT');
}

function samePrice(a: Decimal | null, b: Decimal | null): boolean {
  return a === null || b === null ? a === b : a.eq(b);
}

function samePrintedPrice(
  a: SupplierReceiptPricingFacts['lines'][number] | undefined,
  b: SupplierReceiptPricingFacts['lines'][number],
): boolean {
  if (!a) return false;
  if (
    a.printedPriceAmount != null &&
    a.printedPriceQtyBase != null &&
    b.printedPriceAmount != null &&
    b.printedPriceQtyBase != null
  ) {
    return a.printedPriceAmount
      .times(b.printedPriceQtyBase)
      .eq(b.printedPriceAmount.times(a.printedPriceQtyBase));
  }
  return samePrice(a.printedUnitPriceBase, b.printedUnitPriceBase);
}
function stale(): AppError {
  return new AppError('CONFLICT', 'pricing changed; review the current values before saving', {
    reason: 'PRICE_VERSION',
  });
}
function eventDto(row: EventRow, sku: string, name: string, ctx: AuthContext): BasePriceEventDto {
  return {
    id: row.id,
    productId: row.productId,
    sku,
    name,
    kind: row.kind,
    reason: row.reason,
    oldBasePrice: row.oldBasePrice?.toFixed(0) ?? null,
    newBasePrice: row.newBasePrice?.toFixed(0) ?? null,
    overrodeManual: row.overrodeManual,
    receiptId: row.receiptId,
    receiptNumber: row.receiptNumber,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    validFrom: row.validFrom,
    ...(ctx.permissions.has('inventory.costs.manage')
      ? { printedUnitPriceBase: row.printedUnitPriceBase }
      : {}),
  };
}
