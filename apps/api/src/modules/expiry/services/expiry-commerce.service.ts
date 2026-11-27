import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ModuleRef } from '@nestjs/core';
import {
  formatExpiryBarcode,
  parseExpiryBarcode,
  type ExpiryCommerceView,
  type ExpiryMarkdownView,
} from '@tugeel/shared/expiry';
import { Decimal, roundHalfUp } from '@tugeel/shared/money';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { CatalogService } from '../../catalog';
import {
  type Actor,
  type AuthContext,
  AuditService,
  ScopeService,
  UserNamesService,
} from '../../identity';
import { ReceiptsService } from '../../inventory';
import type { ExpiryMarkdownRequestDto, ExpirySourceRequestDto } from '../dto/expiry-commerce.dto';
import {
  EXPIRY_PAYROLL_SOURCE,
  type ExpiryPayrollSource,
  EXPIRY_SALE_CONTEXTS,
  type ExpirySaleContexts,
  type ExpirySaleInput,
  type ExpirySaleOffer,
  type ExpiryReturnInput,
} from '../ports';
import {
  expiryItems,
  expiryItemSources,
  expiryMarkdowns,
  expiryMarkdownStops,
  expiryMarkdownBalances,
  expirySaleAllocations,
  expiryReturnAllocations,
  expirySaleExceptions,
} from '../schema';
import { ExpiryItemsService } from './expiry-items.service';
import { ExpiryCommerceGate } from './expiry-commerce-gate.service';
import { expiryReturnShares, splitExpiryLoss, type ExpiryShare } from './expiry-money';

type Markdown = typeof expiryMarkdowns.$inferSelect;
const MONEY_RIGHTS = [
  'inventory.costs.manage',
  'expiry.liability.manage',
  'pricing.prices.manage',
] as const;
function finite(value: Decimal, field: string, positive = false): void {
  if (!value.isFinite() || (positive ? value.lte(0) : value.lt(0)))
    throw invalid(
      field,
      'finite',
      `${field} must be finite and ${positive ? 'positive' : 'nonnegative'}`,
    );
  const quantity = field === 'qtyBase';
  if (
    value.decimalPlaces() > (quantity ? 3 : 2) ||
    value.gte(new Decimal(10).pow(quantity ? 11 : 12))
  )
    throw invalid(field, 'precision', 'quantity or money exceeds supported precision');
}
function conflict(reason: string): AppError {
  return new AppError('CONFLICT', reason, { reason });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** The only owner of expiry commercial approvals and finalized sold allocations. No stock writes. */
@Injectable()
export class ExpiryCommerceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly moduleRef: ModuleRef,
    private readonly catalog: CatalogService,
    private readonly receipts: ReceiptsService,
    private readonly names: UserNamesService,
    private readonly items: ExpiryItemsService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly gate: ExpiryCommerceGate,
  ) {}

  /** First gate for any transaction that will post an expiry source sale/return. Call before
   * inventory/finance posting. It also serializes multi-source batches with approvals. */
  async lockInTx(tx: Tx): Promise<void> {
    await this.gate.lockInTx(tx);
  }

  private payroll(): ExpiryPayrollSource {
    return this.moduleRef.get<ExpiryPayrollSource>(EXPIRY_PAYROLL_SOURCE, { strict: false });
  }

  private contexts(): ExpirySaleContexts {
    return this.moduleRef.get<ExpirySaleContexts>(EXPIRY_SALE_CONTEXTS, { strict: false });
  }
  private async liabilitySnapshot(executor: Db | Tx, item: typeof expiryItems.$inferSelect) {
    const held = await this.items.liableOf(executor, item.id);
    const people =
      item.liabilityType === 'NONE'
        ? []
        : await this.names.activeLiableUsers(
            held.roleIds,
            held.userIds,
            item.liabilityType === 'ALL_STAFF',
            executor,
          );
    const fingerprint = createHash('sha256')
      .update(
        canonical({
          type: item.liabilityType,
          note: item.liabilityNote,
          ...held,
          people: people.map((user) => user.id),
        }),
      )
      .digest('hex');
    return { people, fingerprint };
  }
  async barcodeForPipeline(barcode: string, pipelineId: number): Promise<ExpirySaleOffer> {
    const id = parseExpiryBarcode(barcode);
    if (id === null) throw invalid('barcode', 'format', 'invalid expiry barcode');
    const [row] = await this.db.select().from(expiryMarkdowns).where(eq(expiryMarkdowns.id, id));
    if (!row) throw notFound('expiry markdown', id);
    const context = (await this.contexts().list(this.db)).find(
      (entry) =>
        entry.channel === 'WHOLESALE' &&
        entry.contextId === pipelineId &&
        entry.warehouseId === row.warehouseId,
    );
    if (!context) throw conflict('EXPIRY_CONTEXT_MISMATCH');
    return this.resolveInTx(this.db, {
      barcode,
      productId: row.productId,
      productUnitId: row.productUnitId,
      qtyBase: new Decimal(0.001),
      warehouseId: row.warehouseId,
      channel: 'WHOLESALE',
      contextId: pipelineId,
      at: new Date(),
    });
  }
  private assertMoney(ctx: AuthContext): void {
    if (MONEY_RIGHTS.some((right) => !ctx.permissions.has(right)))
      throw new AppError(
        'FORBIDDEN',
        'expiry commercial approval requires cost, liability and pricing rights',
      );
  }
  private async item(executor: Db | Tx, id: number, lock = false) {
    const query = executor.select().from(expiryItems).where(eq(expiryItems.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound('expiry item', id);
    return row;
  }
  async sources(id: number) {
    const item = await this.item(this.db, id);
    return { data: await this.receipts.expirySources(item.productId) };
  }
  async prices(id: number) {
    const item = await this.item(this.db, id);
    const product = await this.catalog.get(item.productId);
    const unit = product.units.find((row) => row.isBase);
    return {
      productUnitId: unit?.id ?? null,
      qty: '1',
      data: await Promise.all(
        (await this.contexts().list(this.db, item.productId)).map(async (context) => ({
          ...context,
          ...(await this.contexts().quote(this.db, item.productId, context)),
        })),
      ),
    };
  }
  async detail(id: number): Promise<ExpiryCommerceView> {
    const item = await this.item(this.db, id);
    const liability = await this.liabilitySnapshot(this.db, item);
    const [source] = await this.db
      .select()
      .from(expiryItemSources)
      .where(eq(expiryItemSources.itemId, id));
    const rows = await this.db
      .select()
      .from(expiryMarkdowns)
      .where(eq(expiryMarkdowns.itemId, id))
      .orderBy(desc(expiryMarkdowns.revision));
    const exceptions = await this.db
      .select({ exception: expirySaleExceptions })
      .from(expirySaleExceptions)
      .innerJoin(expiryMarkdowns, eq(expiryMarkdowns.id, expirySaleExceptions.markdownId))
      .where(eq(expiryMarkdowns.itemId, id))
      .orderBy(desc(expirySaleExceptions.id));
    return {
      itemVersion: item.editVersion,
      liabilityFingerprint: liability.fingerprint,
      liableUsers: liability.people,
      sourceVersion: source?.version ?? 0,
      sourceQtyBase: source?.qtyBase.toFixed() ?? null,
      source: source
        ? ((await this.receipts.expirySources(item.productId, this.db, source.receiptLineId))[0] ??
          null)
        : null,
      markdowns: await Promise.all(rows.map((row) => this.privateView(row, this.db))),
      exceptions: exceptions.map(({ exception: row }) => ({
        id: row.id,
        markdownId: row.markdownId,
        sourceKind: row.sourceKind,
        saleId: row.saleId,
        lineId: row.lineId,
        reason: row.reason,
        qtyBase: row.qtyBase.toFixed(),
        soldAt: row.soldAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        resolutionNote: row.resolutionNote,
      })),
    };
  }
  async detailFor(ctx: AuthContext, id: number): Promise<ExpiryCommerceView> {
    if (!ctx.permissions.has('inventory.costs.manage')) throw new AppError('FORBIDDEN');
    const detail = await this.detail(id);
    if (!ctx.permissions.has('expiry.liability.manage')) {
      detail.liabilityFingerprint = null;
      detail.liableUsers = [];
      detail.markdowns = detail.markdowns.map((row) => ({
        ...row,
        payrollMonth: null,
        liableUserIds: [],
      }));
    }
    return detail;
  }
  async setSource(
    ctx: AuthContext,
    id: number,
    input: ExpirySourceRequestDto,
  ): Promise<ExpiryCommerceView> {
    if (
      !ctx.permissions.has('inventory.costs.manage') ||
      !ctx.permissions.has('expiry.items.manage')
    )
      throw new AppError('FORBIDDEN');
    const qty = new Decimal(input.qtyBase);
    finite(qty, 'qtyBase', true);
    await inTransaction(this.db, async (tx) => {
      await this.lockInTx(tx);
      const item = await this.item(tx, id, true);
      if (item.status === 'ARCHIVED') throw conflict('EXPIRY_ITEM_ARCHIVED');
      const [before] = await tx
        .select()
        .from(expiryItemSources)
        .where(eq(expiryItemSources.itemId, id));
      if ((before?.version ?? 0) !== input.expectedVersion) throw conflict('EXPIRY_SOURCE_CHANGED');
      const [published] = await tx
        .select({ id: expiryMarkdowns.id })
        .from(expiryMarkdowns)
        .where(eq(expiryMarkdowns.itemId, id))
        .limit(1);
      if (published) throw conflict('EXPIRY_SOURCE_FROZEN');
      const [source] = await this.receipts.expirySources(
        item.productId,
        tx,
        input.receiptLineId,
        true,
      );
      if (!source || !source.current)
        throw invalid(
          'receiptLineId',
          'costed',
          'choose a posted, costed receipt line of this product',
        );
      if (qty.gt(item.qtyFloor.plus(item.qtyWarehouse)))
        throw invalid('qtyBase', 'recorded', 'source quantity exceeds observed quantity');
      const [reserved] = await tx
        .select({ qty: sql<string>`coalesce(sum(${expiryItemSources.qtyBase}),0)::text` })
        .from(expiryItemSources)
        .where(
          and(
            eq(expiryItemSources.receiptLineId, input.receiptLineId),
            ne(expiryItemSources.itemId, id),
          ),
        );
      if (qty.plus(reserved?.qty ?? 0).gt(source.qtyBase))
        throw invalid('qtyBase', 'receipt', 'receipt quantity already allocated');
      await tx
        .insert(expiryItemSources)
        .values({
          itemId: id,
          receiptLineId: input.receiptLineId,
          qtyBase: qty,
          updatedBy: ctx.userId,
        })
        .onConflictDoUpdate({
          target: expiryItemSources.itemId,
          set: {
            receiptLineId: input.receiptLineId,
            qtyBase: qty,
            version: (before?.version ?? 0) + 1,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          },
        });
      await tx
        .update(expiryItems)
        .set({ updatedBy: ctx.userId, updatedAt: new Date() })
        .where(eq(expiryItems.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'expiry_item_sources',
        entityId: id,
        after: { sourceChanged: true },
      });
    });
    return this.detailFor(ctx, id);
  }
  async publish(
    ctx: AuthContext,
    id: number,
    input: ExpiryMarkdownRequestDto,
  ): Promise<ExpiryCommerceView> {
    this.assertMoney(ctx);
    this.scope.assertCanWriteWarehouse(ctx, input.warehouseId);
    const qty = new Decimal(input.qtyBase),
      price = new Decimal(input.unitPrice);
    finite(qty, 'qtyBase', true);
    finite(price, 'unitPrice', true);
    await inTransaction(this.db, async (tx) => {
      await this.lockInTx(tx);
      const item = await this.item(tx, id, true);
      if (item.status === 'ARCHIVED') throw conflict('EXPIRY_ITEM_ARCHIVED');
      if (item.editVersion !== input.expectedVersion) throw conflict('EXPIRY_ITEM_CHANGED');
      const [linked] = await tx
        .select()
        .from(expiryItemSources)
        .where(eq(expiryItemSources.itemId, id));
      if (!linked)
        throw invalid('receiptLineId', 'source', 'save an explicit receipt source first');
      if (linked.version !== input.expectedSourceVersion) throw conflict('EXPIRY_SOURCE_CHANGED');
      if (linked.receiptLineId !== input.receiptLineId)
        throw invalid('receiptLineId', 'source', 'the saved source line must match the approval');
      const [source] = await this.receipts.expirySources(
        item.productId,
        tx,
        input.receiptLineId,
        true,
      );
      if (!source?.current)
        throw invalid('receiptLineId', 'costed', 'a costed receipt is required');
      if (source.current.version !== input.expectedCostingVersion)
        throw conflict('EXPIRY_COSTING_CHANGED');
      const contexts = await this.contexts().list(tx);
      const context = contexts.find(
        (row) =>
          row.warehouseId === input.warehouseId &&
          row.channel === input.channel &&
          row.contextId === input.contextId,
      );
      if (!context)
        throw invalid('contextId', 'warehouse', 'sale context does not serve this warehouse');
      const product = await this.catalog.get(item.productId, tx);
      const unit = product.units.find((row) => row.isBase);
      if (!unit) throw invalid('productId', 'baseUnit', 'product has no base unit');
      if (!unit.fractional && !qty.isInteger())
        throw invalid('qtyBase', 'whole', 'base unit requires whole quantity');
      const old = await tx
        .select()
        .from(expiryMarkdowns)
        .where(eq(expiryMarkdowns.itemId, id))
        .orderBy(desc(expiryMarkdowns.revision));
      let committed = new Decimal(0);
      for (const row of old) {
        const [stop] = await tx
          .select()
          .from(expiryMarkdownStops)
          .where(eq(expiryMarkdownStops.markdownId, row.id));
        const [balance] = await tx
          .select()
          .from(expiryMarkdownBalances)
          .where(eq(expiryMarkdownBalances.markdownId, row.id))
          .for('update');
        committed = committed.plus(stop ? (balance?.qtySold ?? 0) : row.qtyBudget);
      }
      if (
        committed.plus(qty).gt(linked.qtyBase) ||
        committed.plus(qty).gt(item.qtyFloor.plus(item.qtyWarehouse))
      )
        throw invalid(
          'qtyBase',
          'budget',
          'stop existing approval or reduce quantity; observed/source budget is exhausted',
        );
      const liability = await this.liabilitySnapshot(tx, item);
      if (liability.fingerprint !== input.expectedLiabilityFingerprint)
        throw conflict('EXPIRY_LIABILITY_CHANGED');
      const people = liability.people;
      const net = (await this.contexts().quote(tx, item.productId, context, price)).netUnitPrice;
      if (net === null)
        throw invalid('contextId', 'quote', 'this context cannot price the product');
      finite(new Decimal(net), 'netUnitPrice');
      const belowCost = new Decimal(net).mul(source.qtyBase).lt(source.current.accountingAmount);
      if (belowCost && (!people.length || !input.payrollMonth))
        throw invalid(
          'payrollMonth',
          'liability',
          'below-cost approval needs active liable employees and an explicit payroll month',
        );
      const [created] = await tx
        .insert(expiryMarkdowns)
        .values({
          itemId: id,
          revision: (old[0]?.revision ?? 0) + 1,
          productId: item.productId,
          expiryDate: item.expiryDate,
          productUnitId: unit.id,
          receiptLineId: source.receiptLineId,
          costingVersion: source.current.version,
          receiptQtyBase: new Decimal(source.qtyBase),
          accountingAmount: new Decimal(source.current.accountingAmount),
          warehouseId: input.warehouseId,
          channel: input.channel,
          contextId: input.contextId,
          qtyBudget: qty,
          unitPrice: price,
          payrollMonth: input.payrollMonth ?? null,
          liableUsers: people,
          createdBy: ctx.userId,
        })
        .returning();
      if (!created) throw new Error('expiry markdown insert returned nothing');
      await tx.insert(expiryMarkdownBalances).values({ markdownId: created.id });
      await tx
        .update(expiryItems)
        .set({ updatedBy: ctx.userId, updatedAt: new Date() })
        .where(eq(expiryItems.id, id));
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'expiry_markdowns',
        entityId: created.id,
        after: { itemId: id, revision: created.revision, published: true },
      });
    });
    return this.detailFor(ctx, id);
  }
  async stop(ctx: AuthContext, id: number): Promise<ExpiryCommerceView> {
    this.assertMoney(ctx);
    const [row] = await this.db.select().from(expiryMarkdowns).where(eq(expiryMarkdowns.id, id));
    if (!row) throw notFound('expiry markdown', id);
    this.scope.assertCanWriteWarehouse(ctx, row.warehouseId);
    await inTransaction(this.db, async (tx) => {
      await this.lockInTx(tx);
      await this.item(tx, row.itemId, true);
      const inserted = await tx
        .insert(expiryMarkdownStops)
        .values({ markdownId: id, stoppedBy: ctx.userId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length)
        await this.audit.record(tx, ctx, {
          action: 'UPDATE',
          entity: 'expiry_markdowns',
          entityId: id,
          after: { stopped: true },
        });
    });
    return this.detail(row.itemId);
  }
  /** Explicit disposition: no employee charge can be invented from an unallocated offline sale. */
  async resolveException(ctx: AuthContext, id: number, note: string): Promise<ExpiryCommerceView> {
    this.assertMoney(ctx);
    const itemId = await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select({ exception: expirySaleExceptions, markdown: expiryMarkdowns })
        .from(expirySaleExceptions)
        .innerJoin(expiryMarkdowns, eq(expiryMarkdowns.id, expirySaleExceptions.markdownId))
        .where(eq(expirySaleExceptions.id, id))
        .for('update', { of: expirySaleExceptions });
      if (!row) throw notFound('expiry sale exception', id);
      this.scope.assertCanWriteWarehouse(ctx, row.markdown.warehouseId);
      if (!note.trim() || note.trim().length > 500)
        throw invalid('note', 'length', 'a resolution reason of 1 to 500 characters is required');
      if (!row.exception.resolvedAt) {
        await tx
          .update(expirySaleExceptions)
          .set({ resolvedAt: new Date(), resolvedBy: ctx.userId, resolutionNote: note.trim() })
          .where(eq(expirySaleExceptions.id, id));
        await this.audit.record(tx, ctx, {
          action: 'UPDATE',
          entity: 'expiry_sale_exceptions',
          entityId: id,
          after: { resolvedWithoutCharge: true },
        });
      }
      return row.markdown.itemId;
    });
    return this.detail(itemId);
  }
  private async offer(row: Markdown, executor: Db | Tx): Promise<ExpirySaleOffer> {
    const [balance] = await executor
      .select()
      .from(expiryMarkdownBalances)
      .where(eq(expiryMarkdownBalances.markdownId, row.id));
    const [stop] = await executor
      .select()
      .from(expiryMarkdownStops)
      .where(eq(expiryMarkdownStops.markdownId, row.id));
    const item = await this.item(executor, row.itemId);
    const [source] = await executor
      .select()
      .from(expiryItemSources)
      .where(eq(expiryItemSources.itemId, row.itemId));
    const [sold] = await executor
      .select({ qty: sql<string>`coalesce(sum(${expiryMarkdownBalances.qtySold}),0)::text` })
      .from(expiryMarkdownBalances)
      .innerJoin(expiryMarkdowns, eq(expiryMarkdowns.id, expiryMarkdownBalances.markdownId))
      .where(eq(expiryMarkdowns.itemId, row.itemId));
    const globalRemaining = Decimal.min(
      source?.qtyBase ?? 0,
      item.qtyFloor.plus(item.qtyWarehouse),
    ).minus(sold?.qty ?? 0);
    return {
      id: row.id,
      itemId: row.itemId,
      barcode: formatExpiryBarcode(row.id),
      expiryDate: row.expiryDate,
      productId: row.productId,
      productUnitId: row.productUnitId,
      warehouseId: row.warehouseId,
      channel: row.channel,
      contextId: row.contextId,
      unitPrice: row.unitPrice.toFixed(),
      qtyAvailable: Decimal.max(
        0,
        Decimal.min(globalRemaining, row.qtyBudget.minus(balance?.qtySold ?? 0)),
      ).toFixed(),
      startsAt: row.startsAt.toISOString(),
      stoppedAt: stop?.stoppedAt.toISOString() ?? null,
    };
  }
  private async privateView(row: Markdown, executor: Db | Tx): Promise<ExpiryMarkdownView> {
    const offer = await this.offer(row, executor);
    const [balance] = await executor
      .select()
      .from(expiryMarkdownBalances)
      .where(eq(expiryMarkdownBalances.markdownId, row.id));
    return {
      ...offer,
      revision: row.revision,
      qtyBudget: row.qtyBudget.toFixed(),
      qtySold: balance?.qtySold.toFixed() ?? '0',
      receiptLineId: row.receiptLineId,
      costingVersion: row.costingVersion,
      accountingUnitCost: row.accountingAmount.div(row.receiptQtyBase).toFixed(8),
      payrollMonth: row.payrollMonth,
      liableUserIds: (row.liableUsers as { id: number }[]).map((user) => user.id),
    };
  }
  async snapshots(
    executor: Db | Tx = this.db,
    filter?: { warehouseId?: number; channel?: 'RETAIL' | 'WHOLESALE'; contextId?: number },
  ): Promise<ExpirySaleOffer[]> {
    const rows = await executor
      .select()
      .from(expiryMarkdowns)
      .where(
        and(
          filter?.warehouseId ? eq(expiryMarkdowns.warehouseId, filter.warehouseId) : undefined,
          filter?.channel ? eq(expiryMarkdowns.channel, filter.channel) : undefined,
          filter?.contextId ? eq(expiryMarkdowns.contextId, filter.contextId) : undefined,
        ),
      );
    return (await Promise.all(rows.map((row) => this.offer(row, executor)))).filter(
      (row) => !row.stoppedAt,
    );
  }
  async resolveInTx(
    tx: Db | Tx,
    input: {
      barcode: string;
      productId: number;
      productUnitId: number;
      qtyBase: Decimal;
      warehouseId: number;
      channel: 'RETAIL' | 'WHOLESALE';
      contextId: number;
      at: Date;
    },
    options?: { offline?: boolean },
  ): Promise<ExpirySaleOffer> {
    const id = parseExpiryBarcode(input.barcode);
    if (id === null) throw invalid('expiryBarcode', 'format', 'invalid expiry barcode');
    const [row] = await tx.select().from(expiryMarkdowns).where(eq(expiryMarkdowns.id, id));
    if (!row) throw notFound('expiry markdown', id);
    const offer = await this.offer(row, tx);
    finite(input.qtyBase, 'qtyBase', true);
    if (
      !Number.isFinite(input.at.getTime()) ||
      row.productId !== input.productId ||
      row.warehouseId !== input.warehouseId ||
      row.channel !== input.channel ||
      row.contextId !== input.contextId
    )
      throw conflict('EXPIRY_CONTEXT_MISMATCH');
    const product = await this.catalog.get(row.productId, tx);
    if (!product.units.some((unit) => unit.id === input.productUnitId))
      throw conflict('EXPIRY_UNIT_MISMATCH');
    if (input.at < row.startsAt || (offer.stoppedAt && input.at >= new Date(offer.stoppedAt)))
      throw conflict('EXPIRY_NOT_EFFECTIVE');
    if (!options?.offline && input.qtyBase.gt(offer.qtyAvailable))
      throw conflict('EXPIRY_BUDGET_EXCEEDED');
    return offer;
  }
  async recordSaleInTx(
    tx: Tx,
    actor: Actor,
    input: ExpirySaleInput,
  ): Promise<{ allocationId: number | null; allocated: boolean; reason?: string }> {
    await this.lockInTx(tx);
    for (const [name, value] of [
      ['qtyBase', input.qtyBase],
      ['grossAmount', input.grossAmount],
      ['revenueAmount', input.revenueAmount],
    ] as const)
      finite(value, name, name === 'qtyBase');
    if (input.revenueAmount.gt(input.grossAmount))
      throw invalid('revenueAmount', 'gross', 'net revenue exceeds gross amount');
    const id = parseExpiryBarcode(input.barcode);
    if (id === null) throw invalid('barcode', 'format', 'invalid expiry barcode');
    const sourceKey = `expiry:${input.sourceKind}:${input.saleId}:${input.lineId}:${id}`;
    if (sourceKey.length > 160) throw invalid('saleId', 'length', 'sale identity too long');
    const [approved] = await tx.select().from(expiryMarkdowns).where(eq(expiryMarkdowns.id, id));
    if (!approved) throw notFound('expiry markdown', id);
    // The item gate precedes every budget lock. Historical offline sales may consume remaining
    // proven units; every replacement offer then advertises the reduced shared capacity.
    await this.item(tx, approved.itemId, true);
    const [balance] = await tx
      .select()
      .from(expiryMarkdownBalances)
      .where(eq(expiryMarkdownBalances.markdownId, id))
      .for('update');
    if (!balance) throw notFound('expiry markdown', id);
    const identity = and(
      eq(expirySaleExceptions.sourceKind, input.sourceKind),
      eq(expirySaleExceptions.saleId, input.saleId),
      eq(expirySaleExceptions.lineId, input.lineId),
    );
    const serialized = {
      ...input,
      qtyBase: input.qtyBase.toFixed(),
      grossAmount: input.grossAmount.toFixed(),
      revenueAmount: input.revenueAmount.toFixed(),
      soldAt: input.soldAt.toISOString(),
    };
    const [exception] = await tx.select().from(expirySaleExceptions).where(identity);
    if (exception) {
      if (canonical(exception.input) !== canonical(serialized))
        throw conflict('EXPIRY_SALE_REPLAY_MISMATCH');
      return { allocationId: null, allocated: false, reason: exception.reason };
    }
    const unallocated = async (reason: string) => {
      const [created] = await tx
        .insert(expirySaleExceptions)
        .values({
          markdownId: id,
          sourceKind: input.sourceKind,
          saleId: input.saleId,
          lineId: input.lineId,
          reason,
          input: serialized,
          qtyBase: input.qtyBase,
          soldAt: input.soldAt,
        })
        .returning();
      if (created)
        await this.audit.record(tx, actor, {
          action: 'CREATE',
          entity: 'expiry_sale_exceptions',
          entityId: created.id,
          after: { markdownId: id, reason },
        });
      return { allocationId: null, allocated: false, reason };
    };
    const [previous] = await tx
      .select()
      .from(expirySaleAllocations)
      .where(
        and(
          eq(expirySaleAllocations.sourceKind, input.sourceKind),
          eq(expirySaleAllocations.saleId, input.saleId),
          eq(expirySaleAllocations.lineId, input.lineId),
        ),
      );
    if (previous) {
      if (previous.sourceKey !== sourceKey || canonical(previous.input) !== canonical(serialized))
        throw conflict('EXPIRY_SALE_REPLAY_MISMATCH');
      return { allocationId: previous.id, allocated: true };
    }
    let offer: ExpirySaleOffer;
    try {
      offer = await this.resolveInTx(
        tx,
        { ...input, at: input.soldAt },
        { offline: input.sourceKind === 'POS' },
      );
    } catch (error) {
      if (input.sourceKind === 'POS' && error instanceof AppError)
        return unallocated('EXPIRY_APPROVAL_INVALID');
      throw error;
    }
    const [row] = await tx.select().from(expiryMarkdowns).where(eq(expiryMarkdowns.id, id));
    if (!row) throw notFound('expiry markdown', id);
    if (
      !roundHalfUp(row.unitPrice.mul(input.qtyBase), input.sourceKind === 'POS' ? 2 : 0).eq(
        input.grossAmount,
      )
    ) {
      if (input.sourceKind === 'POS') return unallocated('EXPIRY_PRICE_MISMATCH');
      throw conflict('EXPIRY_PRICE_MISMATCH');
    }
    if (input.qtyBase.gt(offer.qtyAvailable)) {
      if (input.sourceKind === 'POS') return unallocated('EXPIRY_BUDGET_EXCEEDED');
      throw conflict('EXPIRY_BUDGET_EXCEEDED');
    }
    const cost = roundHalfUp(row.accountingAmount.mul(input.qtyBase).div(row.receiptQtyBase), 2);
    const loss = Decimal.max(0, cost.minus(input.revenueAmount));
    const shares = splitExpiryLoss(
      loss,
      (row.liableUsers as { id: number }[]).map((user) => user.id),
    );
    if (loss.gt(0) && !shares.length) {
      if (input.sourceKind === 'POS') return unallocated('EXPIRY_LIABILITY_UNAVAILABLE');
      throw conflict('EXPIRY_LIABILITY_UNAVAILABLE');
    }
    const [allocation] = await tx
      .insert(expirySaleAllocations)
      .values({
        markdownId: id,
        sourceKind: input.sourceKind,
        saleId: input.saleId,
        lineId: input.lineId,
        sourceKey,
        qtyBase: input.qtyBase,
        costAmount: cost,
        revenueAmount: input.revenueAmount,
        lossAmount: loss,
        shares,
        soldAt: input.soldAt,
        input: serialized,
      })
      .returning();
    if (!allocation) throw new Error('expiry sale allocation insert returned nothing');
    await tx
      .update(expiryMarkdownBalances)
      .set({ qtySold: balance.qtySold.plus(input.qtyBase) })
      .where(eq(expiryMarkdownBalances.markdownId, id));
    if (loss.gt(0))
      await this.payroll().recordInTx(tx, actor, {
        sourceKind: 'EXPIRY_SALE',
        sourceKey,
        sourceReference: `expiry:${row.itemId}/markdown:${id}`,
        requestedMonth: row.payrollMonth,
        allocations: shares,
      });
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'expiry_sale_allocations',
      entityId: allocation.id,
      after: {
        markdownId: id,
        sourceKind: input.sourceKind,
        saleId: input.saleId,
        lineId: input.lineId,
      },
    });
    return { allocationId: allocation.id, allocated: true };
  }
  async recordReturnInTx(tx: Tx, actor: Actor, input: ExpiryReturnInput): Promise<void> {
    await this.lockInTx(tx);
    finite(input.qtyBase, 'qtyBase', true);
    const [sale] = await tx
      .select()
      .from(expirySaleAllocations)
      .where(
        and(
          eq(expirySaleAllocations.sourceKind, input.sourceKind),
          eq(expirySaleAllocations.saleId, input.saleId),
          eq(expirySaleAllocations.lineId, input.lineId),
        ),
      );
    if (!sale) {
      if (input.sourceKind === 'POS' && input.expiryContext)
        throw conflict('EXPIRY_RETURN_SOURCE_MISSING');
      return;
    }
    const [markdown] = await tx
      .select()
      .from(expiryMarkdowns)
      .where(eq(expiryMarkdowns.id, sale.markdownId));
    if (!markdown) throw notFound('expiry markdown', sale.markdownId);
    await this.item(tx, markdown.itemId, true);
    const [balance] = await tx
      .select()
      .from(expiryMarkdownBalances)
      .where(eq(expiryMarkdownBalances.markdownId, sale.markdownId))
      .for('update');
    if (!balance) throw notFound('expiry markdown balance', markdown.id);
    const sourceKey = `expiry:return:${input.sourceKind}:${input.returnId}:${input.returnLineId}`;
    if (sourceKey.length > 160) throw invalid('returnId', 'length', 'return identity too long');
    const [previous] = await tx
      .select()
      .from(expiryReturnAllocations)
      .where(eq(expiryReturnAllocations.sourceKey, sourceKey));
    if (previous) {
      if (previous.saleAllocationId !== sale.id || !previous.qtyBase.eq(input.qtyBase))
        throw conflict('EXPIRY_RETURN_REPLAY_MISMATCH');
      return;
    }
    const rows = await tx
      .select()
      .from(expiryReturnAllocations)
      .where(eq(expiryReturnAllocations.saleAllocationId, sale.id));
    const before = rows.reduce((sum, row) => sum.plus(row.qtyBase), new Decimal(0));
    if (before.plus(input.qtyBase).gt(sale.qtyBase)) throw conflict('EXPIRY_RETURN_EXCEEDS_SALE');
    const shares = expiryReturnShares(
      sale.shares as ExpiryShare[],
      sale.qtyBase,
      before,
      input.qtyBase,
    );
    const loss = shares.reduce((sum, row) => sum.minus(row.amount), new Decimal(0));
    await tx.insert(expiryReturnAllocations).values({
      saleAllocationId: sale.id,
      sourceKey,
      qtyBase: input.qtyBase,
      lossAmount: loss,
      shares,
      returnedAt: input.returnedAt,
    });
    await tx
      .update(expiryMarkdownBalances)
      .set({ qtySold: sql`${expiryMarkdownBalances.qtySold} - ${input.qtyBase.toFixed()}` })
      .where(eq(expiryMarkdownBalances.markdownId, sale.markdownId));
    if (loss.gt(0))
      await this.payroll().recordInTx(tx, actor, {
        sourceKind: 'EXPIRY_RETURN',
        sourceKey,
        sourceReference: `expiry:return/${input.returnId}`,
        requestedMonth: null,
        reversesSourceKey: sale.sourceKey,
        allocations: shares,
      });
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'expiry_return_allocations',
      entityId: sale.id,
      after: { saleAllocationId: sale.id, returned: true },
    });
  }
}
