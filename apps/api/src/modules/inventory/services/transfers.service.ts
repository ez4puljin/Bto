import { Inject, Injectable } from '@nestjs/common';
import {
  formatDocNumber,
  SELLABLE_BIN_TYPES,
  type TransferOrigin,
  transferReceiveLegs,
  type TransferStatus,
} from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { businessYear } from '@tugeel/shared/time';
import { and, desc, eq, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CatalogService, type UnitInfo, UnitConversionService } from '../../catalog';
import {
  actorUserId,
  type AuthContext,
  AuditService,
  NumberingService,
  OrgService,
  ScopeService,
  type Warehouse,
} from '../../identity';
import { binStock, bins, transferLines, transfers } from '../schema';
import { BinsService } from './bins.service';
import { ProductLocationsService } from './product-locations.service';
import { type Movement, StockPostingService } from './stock-posting.service';
import { optionalText } from './support';

type TransferRow = typeof transfers.$inferSelect;
type TransferLineRow = typeof transferLines.$inferSelect;

/** Warehouses that send and receive transfers (ADR-0035 #1). */
const TRANSFER_KINDS: readonly Warehouse['kind'][] = ['WHOLESALE', 'STORE'];
/** Lines per transfer: a receive with a surplus on every line still fits one posting. */
export const MAX_TRANSFER_LINES = 3_000;
const ZERO = new Decimal(0);
const CHUNK = 1_000;

export interface TransferLineInput {
  /** The unit asked for; the quantity is in it. */
  productUnitId: number;
  qty: Decimal;
}

export interface TransferInput {
  origin: TransferOrigin;
  sourceWarehouseId: number;
  destWarehouseId: number;
  note?: string | null;
  lines?: readonly TransferLineInput[];
}

/**
 * A line as counted when shipping or receiving. Omitted lines and fields take the defaults: the
 * requested (shipping) or shipped (receiving) quantity and the suggested bin.
 */
export interface TransferCount {
  lineId: number;
  /** A current unit of the line's product; default the line's unit. */
  productUnitId?: number;
  /** In that unit; zero ships or receives nothing of the line. */
  qty?: Decimal;
  /** The source shelf (shipping) or the destination bin (receiving), as scanned. */
  binId?: number;
}

export interface TransferLine {
  id: number;
  productId: number;
  productSku: string;
  productName: string;
  requestUnitId: number;
  unitName: string;
  /** Base units per request unit, frozen when the line was added. */
  requestFactor: Decimal;
  requestedQty: Decimal;
  baseUnitId: number;
  baseUnitName: string;
  shippedQtyBase: Decimal | null;
  receivedQtyBase: Decimal | null;
  /** The source bin: chosen when shipped; until then the suggested one (null: to be scanned). */
  fromBinId: number | null;
  fromBinCode: string | null;
  /** The destination bin: chosen when received; while in transit the suggested one. */
  toBinId: number | null;
  toBinCode: string | null;
}

export interface TransferDetail {
  id: number;
  number: string | null;
  origin: TransferOrigin;
  status: TransferStatus;
  sourceWarehouseId: number;
  destWarehouseId: number;
  note: string | null;
  requestedAt: Date | null;
  shippedAt: Date | null;
  shipDate: string | null;
  receivedAt: Date | null;
  receiveDate: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines: TransferLine[];
}

export interface TransferSummary {
  id: number;
  number: string | null;
  origin: TransferOrigin;
  status: TransferStatus;
  sourceWarehouseId: number;
  destWarehouseId: number;
  lineCount: number;
  requestedAt: Date | null;
  shippedAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
}

export interface TransferQuery {
  /**
   * INCOMING = received by, OUTGOING = sent by `warehouseId`, or without it by the warehouses the
   * caller writes for (every warehouse for an unscoped caller). Without a direction: either side.
   */
  direction?: 'INCOMING' | 'OUTGOING';
  warehouseId?: number;
  status?: TransferStatus;
  cursor?: string;
  limit?: number;
}

interface LineUpdate {
  id: number;
  qtyBase: Decimal;
  binId: number | null;
}

/**
 * Transfers (TR-, ADR-0035): the receiving warehouse requests goods and the sender ships them into
 * TRANSIT, or the sender pushes them on its own (supermarket returns); the receiver counts what
 * arrived. A shortfall goes back to the sender's shelf and a surplus comes out of the sender's
 * stock, so TRANSIT returns to zero on every line. All ledger legs are in base units.
 */
@Injectable()
export class TransfersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly bins: BinsService,
    private readonly catalog: CatalogService,
    private readonly locations: ProductLocationsService,
    private readonly numbering: NumberingService,
    private readonly org: OrgService,
    private readonly posting: StockPostingService,
    private readonly scope: ScopeService,
    private readonly units: UnitConversionService,
  ) {}

  async create(ctx: AuthContext, input: TransferInput): Promise<TransferDetail> {
    this.scope.assertCanWriteWarehouse(ctx, ownerSide(input));
    if (input.sourceWarehouseId === input.destWarehouseId) {
      throw invalid('destWarehouseId', 'different', 'the destination differs from the source');
    }
    if ((input.lines?.length ?? 0) > MAX_TRANSFER_LINES) {
      throw invalid('lines', 'max', `at most ${MAX_TRANSFER_LINES} lines`);
    }
    return inTransaction(this.db, async (tx) => {
      for (const warehouseId of [input.sourceWarehouseId, input.destWarehouseId]) {
        const warehouse = await this.org.getWarehouse(warehouseId, tx);
        if (!TRANSFER_KINDS.includes(warehouse.kind)) {
          throw new AppError(
            'WAREHOUSE_KIND_NOT_ALLOWED',
            `no transfers with a ${warehouse.kind} warehouse`,
            { kind: warehouse.kind },
          );
        }
      }
      const [header] = await tx
        .insert(transfers)
        .values({
          origin: input.origin,
          sourceWarehouseId: input.sourceWarehouseId,
          destWarehouseId: input.destWarehouseId,
          note: optionalText(input.note) ?? null,
          createdBy: actorUserId(ctx),
        })
        .returning();
      if (!header) throw new Error('transfer insert returned no row');
      for (const line of input.lines ?? []) await this.insertLine(tx, header, line);
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'transfers',
        entityId: header.id,
        after: header,
      });
      return this.get(header.id, tx);
    });
  }

  update(ctx: AuthContext, id: number, patch: { note?: string | null }): Promise<TransferDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, id);
      await tx
        .update(transfers)
        .set({
          ...(patch.note === undefined ? {} : { note: optionalText(patch.note) ?? null }),
          updatedAt: sql`now()`,
        })
        .where(eq(transfers.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'transfers',
        entityId: id,
        before: header,
        after: patch,
      });
      return this.get(id, tx);
    });
  }

  addLine(ctx: AuthContext, id: number, line: TransferLineInput): Promise<TransferDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, id);
      const [count] = await tx
        .select({ count: sql<string>`count(*)` })
        .from(transferLines)
        .where(eq(transferLines.transferId, id));
      if (Number.parseInt(count?.count ?? '0', 10) >= MAX_TRANSFER_LINES) {
        throw invalid('lines', 'max', `at most ${MAX_TRANSFER_LINES} lines`);
      }
      await this.insertLine(tx, header, line);
      await this.touch(tx, id);
      return this.get(id, tx);
    });
  }

  updateLine(
    ctx: AuthContext,
    lineId: number,
    patch: { productUnitId?: number; qty?: Decimal },
  ): Promise<TransferDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header, line } = await this.lockLine(tx, ctx, lineId);
      const unitId = patch.productUnitId ?? line.requestUnitId;
      const qty = patch.qty ?? line.requestedQty;
      if (!qty.gt(0)) throw invalid('qty', 'min', 'a positive quantity');
      const converted = await this.units.toBase(unitId, qty, tx);
      if (converted.productId !== line.productId) {
        throw invalid('productUnitId', 'product', 'a unit of the line’s product');
      }
      await tx
        .update(transferLines)
        .set({
          requestUnitId: unitId,
          requestFactor: converted.factorSnapshot,
          requestedQty: qty,
          updatedAt: sql`now()`,
        })
        .where(eq(transferLines.id, lineId));
      await this.touch(tx, header.id);
      return this.get(header.id, tx);
    });
  }

  removeLine(ctx: AuthContext, lineId: number): Promise<TransferDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header } = await this.lockLine(tx, ctx, lineId);
      await tx.delete(transferLines).where(eq(transferLines.id, lineId));
      await this.touch(tx, header.id);
      return this.get(header.id, tx);
    });
  }

  /** DRAFT → REQUESTED by the destination: the request gets its number (ADR-0035 #3). */
  request(ctx: AuthContext, id: number): Promise<TransferDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, id);
      if (header.origin !== 'REQUEST') {
        throw invalid('origin', 'request', 'a push is shipped by its sender, not requested');
      }
      const lines = await this.linesOf(tx, id);
      if (lines.length === 0) throw invalid('lines', 'empty', 'a transfer needs at least one line');
      await this.locations.assertMayReceive(
        tx,
        header.destWarehouseId,
        lines.map((line) => line.productId),
      );
      // A request taken back for editing is sent again under its number (ADR-0046).
      const number = header.number ?? (await this.allocateNumber(tx));
      await tx
        .update(transfers)
        .set({
          number,
          status: 'REQUESTED',
          requestedAt: sql`now()`,
          requestedBy: actorUserId(ctx),
          updatedAt: sql`now()`,
        })
        .where(eq(transfers.id, id));
      await this.audit.record(tx, ctx, {
        action: 'REQUEST',
        entity: 'transfers',
        entityId: id,
        before: header,
        after: { number },
      });
      return this.get(id, tx);
    });
  }

  /**
   * REQUESTED → DRAFT by the destination, which edits the request and sends it again under the same
   * number (ADR-0046). The header lock is the one shipping takes first, so of a shipment and a
   * take-back exactly one wins; pressed twice, the draft is answered as it is.
   */
  reopen(ctx: AuthContext, id: number): Promise<TransferDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, ownerSide(header));
      if (header.status === 'DRAFT' && header.number !== null) return this.get(id, tx);
      if (header.origin !== 'REQUEST' || header.status !== 'REQUESTED') {
        throw new AppError('DOC_STATE_INVALID', `transfer ${id} is ${header.status}`, {
          status: header.status,
        });
      }
      await tx
        .update(transfers)
        .set({ status: 'DRAFT', requestedAt: null, requestedBy: null, updatedAt: sql`now()` })
        .where(eq(transfers.id, id));
      await this.audit.record(tx, ctx, {
        action: 'RETURN',
        entity: 'transfers',
        entityId: id,
        before: header,
        after: { status: 'DRAFT', number: header.number },
      });
      return this.get(id, tx);
    });
  }

  /**
   * The source ships a request (REQUESTED) or its own push (DRAFT): every shipped line leaves its
   * shelf for TRANSIT (legs 1 and 2). A push is numbered here.
   */
  ship(
    ctx: AuthContext,
    id: number,
    counts: readonly TransferCount[] = [],
  ): Promise<TransferDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.sourceWarehouseId);
      const expected: TransferStatus = header.origin === 'REQUEST' ? 'REQUESTED' : 'DRAFT';
      assertStatus(header, expected, ['SHIPPED', 'RECEIVED']);
      const lines = await this.linesOf(tx, id);
      if (lines.length === 0) throw invalid('lines', 'empty', 'a transfer needs at least one line');
      const byLine = countsByLine(lines, counts);
      const source = await this.org.getWarehouse(header.sourceWarehouseId, tx);
      const suggested = await this.sourceBins(tx, source, lines);

      const plan: LineUpdate[] = [];
      for (const line of lines) {
        const count = byLine.get(line.id);
        const qtyBase =
          count?.qty === undefined
            ? line.requestedQty.times(line.requestFactor)
            : await this.countToBase(tx, line, count);
        const binId = count?.binId ?? suggested.get(line.productId) ?? null;
        if (qtyBase.gt(0) && binId === null) {
          throw invalid(`lines.${line.id}.binId`, 'required', 'scan the shelf the goods leave');
        }
        plan.push({ id: line.id, qtyBase, binId: qtyBase.gt(0) ? binId : null });
      }
      const shipped = plan.filter((entry) => entry.qtyBase.gt(0));
      if (shipped.length === 0) {
        throw new AppError('TRANSFER_NOTHING_SHIPPED', `transfer ${id} ships nothing`);
      }
      await this.assertBinsIn(
        tx,
        source.id,
        shipped.map((entry) => entry.binId),
      );
      const lineById = new Map(lines.map((line) => [line.id, line]));
      const productIds = shipped.map((entry) => lineOf(lineById, entry.id).productId);
      await this.locations.assertMayReceive(tx, header.destWarehouseId, productIds);

      const transit = await this.org.getTransitWarehouse(tx);
      const transitBin = await this.bins.systemBin(transit.id, 'TRANSIT', tx);
      const baseUnits = await this.baseUnitsOf(tx, productIds);
      await this.updateLines(tx, plan, 'ship');
      const movements = shipped.flatMap((entry): Movement[] => {
        const line = lineOf(lineById, entry.id);
        const unit = baseUnitOf(baseUnits, line.productId);
        return [
          legOf(
            header,
            line,
            unit,
            'TRANSFER_OUT',
            1,
            source.id,
            entry.binId,
            entry.qtyBase.negated(),
          ),
          legOf(header, line, unit, 'TRANSFER_IN', 2, transit.id, transitBin.id, entry.qtyBase),
        ];
      });
      const result = await this.posting.post(tx, ctx, {
        docs: [
          {
            docType: 'TR',
            docId: id,
            expectedStatus: expected,
            nextStatus: 'SHIPPED',
            allocateNumber: header.number === null,
          },
        ],
        movements,
      });
      await this.audit.record(tx, ctx, {
        action: 'SHIP',
        entity: 'transfers',
        entityId: id,
        before: { status: header.status, number: header.number },
        after: {
          number: result.numbers.get(id) ?? header.number,
          lines: plan.map((entry) => ({
            id: entry.id,
            shippedQtyBase: entry.qtyBase.toFixed(),
            fromBinId: entry.binId,
          })),
        },
      });
      return this.get(id, tx);
    });
  }

  /**
   * The destination receives a shipped transfer: TRANSIT empties (leg 3), the goods arrive
   * (leg 4), a shortfall returns to the sender's shelf (leg 6) and a surplus leaves the sender's
   * stock for the destination (legs 5 and 6). The home rule is never checked here (ADR-0035 #6).
   */
  receive(
    ctx: AuthContext,
    id: number,
    counts: readonly TransferCount[] = [],
  ): Promise<TransferDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.destWarehouseId);
      assertStatus(header, 'SHIPPED', ['RECEIVED']);
      const lines = await this.linesOf(tx, id);
      const byLine = countsByLine(lines, counts);
      const dest = await this.org.getWarehouse(header.destWarehouseId, tx);
      const suggested = await this.destinationBins(tx, dest, lines);

      const plan: LineUpdate[] = [];
      for (const line of lines) {
        const count = byLine.get(line.id);
        const shipped = line.shippedQtyBase ?? ZERO;
        const qtyBase =
          count?.qty === undefined ? shipped : await this.countToBase(tx, line, count);
        const binId = count?.binId ?? suggested.get(line.productId) ?? null;
        plan.push({ id: line.id, qtyBase, binId: qtyBase.gt(0) ? binId : null });
      }
      await this.assertBinsIn(
        tx,
        dest.id,
        plan.flatMap((entry) => (entry.qtyBase.gt(0) ? [entry.binId] : [])),
      );

      const lineById = new Map(lines.map((line) => [line.id, line]));
      const transit = await this.org.getTransitWarehouse(tx);
      const transitBin = await this.bins.systemBin(transit.id, 'TRANSIT', tx);
      const returnBins = await this.returnBins(tx, header.sourceWarehouseId, lines);
      const surplus = plan.flatMap((entry) => {
        const line = lineOf(lineById, entry.id);
        const extra = entry.qtyBase.minus(line.shippedQtyBase ?? ZERO);
        return extra.gt(0) ? [{ line, extra }] : [];
      });
      const surplusBins = await this.surplusBins(tx, header.sourceWarehouseId, surplus);
      const baseUnits = await this.baseUnitsOf(
        tx,
        lines.map((line) => line.productId),
      );

      const movements: Movement[] = [];
      for (const entry of plan) {
        const line = lineOf(lineById, entry.id);
        const unit = baseUnitOf(baseUnits, line.productId);
        for (const leg of transferReceiveLegs(line.shippedQtyBase ?? ZERO, entry.qtyBase)) {
          const [warehouseId, binId] =
            leg.place === 'TRANSIT'
              ? [transit.id, transitBin.id]
              : leg.place === 'DESTINATION'
                ? [dest.id, entry.binId]
                : [
                    header.sourceWarehouseId,
                    leg.movementType === 'TRANSFER_IN'
                      ? returnBins.get(line.id)
                      : surplusBins.get(line.id),
                  ];
          movements.push(
            legOf(
              header,
              line,
              unit,
              leg.movementType,
              leg.leg,
              warehouseId,
              binId ?? null,
              leg.qty,
            ),
          );
        }
      }
      await this.updateLines(tx, plan, 'receive');
      await this.posting.post(tx, ctx, {
        docs: [
          {
            docType: 'TR',
            docId: id,
            expectedStatus: 'SHIPPED',
            nextStatus: 'RECEIVED',
            allocateNumber: false,
          },
        ],
        movements,
      });
      await this.audit.record(tx, ctx, {
        action: 'RECEIVE',
        entity: 'transfers',
        entityId: id,
        before: { status: header.status },
        after: {
          lines: plan.map((entry) => ({
            id: entry.id,
            receivedQtyBase: entry.qtyBase.toFixed(),
            toBinId: entry.binId,
          })),
        },
      });
      return this.get(id, tx);
    });
  }

  /**
   * A draft is cancelled by the side that created it; a request is withdrawn by the destination or
   * declined by the source, with a reason. A shipped transfer is never cancelled.
   */
  cancel(ctx: AuthContext, id: number, reason?: string | null): Promise<TransferDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      if (header.status === 'CANCELLED') return this.get(id, tx);
      if (header.status === 'DRAFT') {
        this.scope.assertCanWriteWarehouse(ctx, ownerSide(header));
      } else if (header.status === 'REQUESTED') {
        const destination = this.scope.canWriteWarehouse(ctx, header.destWarehouseId);
        if (!destination) {
          this.scope.assertCanWriteWarehouse(ctx, header.sourceWarehouseId);
          if (!optionalText(reason)) {
            throw invalid('reason', 'required', 'a declined request needs a reason');
          }
        }
      } else {
        throw new AppError('DOC_STATE_INVALID', `transfer ${id} is ${header.status}`, {
          status: header.status,
        });
      }
      await tx
        .update(transfers)
        .set({
          status: 'CANCELLED',
          cancelledAt: sql`now()`,
          cancelledBy: actorUserId(ctx),
          cancelReason: optionalText(reason) ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(transfers.id, id));
      await this.audit.record(tx, ctx, {
        action: 'CANCEL',
        entity: 'transfers',
        entityId: id,
        before: header,
        after: { reason: optionalText(reason) ?? null },
      });
      return this.get(id, tx);
    });
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<TransferDetail> {
    const [header] = await executor.select().from(transfers).where(eq(transfers.id, id));
    if (!header) throw notFound('transfer', id);
    const lines = await this.linesOf(executor, id);
    return { ...headerView(header), lines: await this.describe(executor, header, lines) };
  }

  async list(
    ctx: AuthContext,
    query: TransferQuery,
  ): Promise<{ data: TransferSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.warehouseId === undefined && query.direction && ctx.writableWarehouseIds !== null) {
      // A direction alone: the warehouses the caller writes for (ADR-0047 #7).
      const mine = [...ctx.writableWarehouseIds];
      const side =
        query.direction === 'INCOMING' ? transfers.destWarehouseId : transfers.sourceWarehouseId;
      filters.push(mine.length > 0 ? inArray(side, mine) : sql`false`);
    }
    if (query.warehouseId !== undefined) {
      const side =
        query.direction === 'INCOMING'
          ? eq(transfers.destWarehouseId, query.warehouseId)
          : query.direction === 'OUTGOING'
            ? eq(transfers.sourceWarehouseId, query.warehouseId)
            : or(
                eq(transfers.destWarehouseId, query.warehouseId),
                eq(transfers.sourceWarehouseId, query.warehouseId),
              );
      if (side) filters.push(side);
    }
    if (query.status) filters.push(eq(transfers.status, query.status));
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(transfers.id, after.id));
    const rows = await this.db
      .select({
        id: transfers.id,
        number: transfers.number,
        origin: transfers.origin,
        status: transfers.status,
        sourceWarehouseId: transfers.sourceWarehouseId,
        destWarehouseId: transfers.destWarehouseId,
        requestedAt: transfers.requestedAt,
        shippedAt: transfers.shippedAt,
        receivedAt: transfers.receivedAt,
        createdAt: transfers.createdAt,
        // Spelled out: a single-table select leaves columns unqualified (see ReceiptsService.list).
        lineCount: sql<string>`(SELECT count(*) FROM transfer_lines l WHERE l.transfer_id = transfers.id)`,
      })
      .from(transfers)
      .where(and(...filters))
      .orderBy(desc(transfers.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return {
      data: page.data.map((row) => ({ ...row, lineCount: Number.parseInt(row.lineCount, 10) })),
      nextCursor: page.nextCursor,
    };
  }

  // -------------------------------------------------------------------------------------------

  private async insertLine(tx: Tx, header: TransferRow, input: TransferLineInput): Promise<void> {
    if (!input.qty.gt(0)) throw invalid('qty', 'min', 'a positive quantity');
    const converted = await this.units.toBase(input.productUnitId, input.qty, tx);
    await this.locations.assertMayReceive(tx, header.destWarehouseId, [converted.productId]);
    const [existing] = await tx
      .select({ id: transferLines.id })
      .from(transferLines)
      .where(
        and(
          eq(transferLines.transferId, header.id),
          eq(transferLines.productId, converted.productId),
          isNull(transferLines.lotId),
        ),
      );
    if (existing) {
      throw invalid('productUnitId', 'duplicate', 'the product is already on the transfer');
    }
    await tx.insert(transferLines).values({
      transferId: header.id,
      productId: converted.productId,
      requestUnitId: converted.unitId,
      requestFactor: converted.factorSnapshot,
      requestedQty: input.qty,
    });
  }

  /** A counted quantity in base units: exact in its unit, and a unit of the line's product. */
  private async countToBase(tx: Tx, line: TransferLineRow, count: TransferCount): Promise<Decimal> {
    const qty = count.qty ?? ZERO;
    if (qty.isNegative()) throw invalid(`lines.${line.id}.qty`, 'min', 'never negative');
    if (qty.isZero()) return ZERO;
    const converted = await this.units.toBase(count.productUnitId ?? line.requestUnitId, qty, tx);
    if (converted.productId !== line.productId) {
      throw invalid(`lines.${line.id}.productUnitId`, 'product', 'a unit of the line’s product');
    }
    return converted.qtyBase;
  }

  /** The shelf a product leaves from: its fixed shelf, else the store's sales floor. */
  private async sourceBins(
    executor: Db | Tx,
    warehouse: Warehouse,
    lines: readonly TransferLineRow[],
  ): Promise<Map<number, number>> {
    const productIds = lines.map((line) => line.productId);
    const fixed = await this.locations.defaultBinOf(warehouse.id, productIds, executor);
    if (warehouse.kind !== 'STORE') return fixed;
    const floor = await this.bins.systemBin(warehouse.id, 'SALESFLOOR', executor);
    return new Map(productIds.map((id) => [id, fixed.get(id) ?? floor.id]));
  }

  /** Where goods arrive: the store's sales floor, else the fixed shelf, else RECEIVING. */
  private async destinationBins(
    executor: Db | Tx,
    warehouse: Warehouse,
    lines: readonly TransferLineRow[],
  ): Promise<Map<number, number>> {
    const productIds = lines.map((line) => line.productId);
    if (warehouse.kind === 'STORE') {
      const floor = await this.bins.systemBin(warehouse.id, 'SALESFLOOR', executor);
      return new Map(productIds.map((id) => [id, floor.id]));
    }
    const fixed = await this.locations.defaultBinOf(warehouse.id, productIds, executor);
    const receiving = await this.bins.systemBin(warehouse.id, 'RECEIVING', executor);
    return new Map(productIds.map((id) => [id, fixed.get(id) ?? receiving.id]));
  }

  /** A shortfall returns to the line's source shelf, or to RECEIVING if that shelf was archived. */
  private async returnBins(
    tx: Tx,
    sourceWarehouseId: number,
    lines: readonly TransferLineRow[],
  ): Promise<Map<number, number>> {
    const fromIds = [
      ...new Set(lines.flatMap((line) => (line.fromBinId === null ? [] : [line.fromBinId]))),
    ];
    const archived = new Set(
      (await this.bins.getMany(fromIds, tx)).filter((bin) => bin.archivedAt).map((bin) => bin.id),
    );
    const receiving = await this.bins.systemBin(sourceWarehouseId, 'RECEIVING', tx);
    return new Map(
      lines.map((line) => [
        line.id,
        line.fromBinId === null || archived.has(line.fromBinId) ? receiving.id : line.fromBinId,
      ]),
    );
  }

  /**
   * A surplus leaves the line's source shelf when it holds enough, else the sender's sellable bin
   * holding the most; when none holds enough the posting refuses with STOCK_INSUFFICIENT.
   */
  private async surplusBins(
    tx: Tx,
    sourceWarehouseId: number,
    surplus: readonly { line: TransferLineRow; extra: Decimal }[],
  ): Promise<Map<number, number>> {
    if (surplus.length === 0) return new Map();
    const stock = await tx
      .select({ binId: binStock.binId, productId: binStock.productId, onHand: binStock.onHand })
      .from(binStock)
      .innerJoin(bins, eq(bins.id, binStock.binId))
      .where(
        and(
          eq(binStock.warehouseId, sourceWarehouseId),
          inArray(binStock.productId, [...new Set(surplus.map(({ line }) => line.productId))]),
          isNull(binStock.lotId),
          isNull(bins.archivedAt),
          eq(bins.status, 'ACTIVE'),
          inArray(bins.type, [...SELLABLE_BIN_TYPES]),
        ),
      );
    const receiving = await this.bins.systemBin(sourceWarehouseId, 'RECEIVING', tx);
    const chosen = new Map<number, number>();
    for (const { line, extra } of surplus) {
      const held = stock.filter((row) => row.productId === line.productId);
      const own = held.find((row) => row.binId === line.fromBinId);
      const most = held.reduce<(typeof held)[number] | undefined>(
        (best, row) => (best === undefined || row.onHand.gt(best.onHand) ? row : best),
        undefined,
      );
      const binId =
        own && own.onHand.gte(extra)
          ? own.binId
          : most && most.onHand.gte(extra)
            ? most.binId
            : (line.fromBinId ?? most?.binId ?? receiving.id);
      chosen.set(line.id, binId);
    }
    return chosen;
  }

  /** Every bin must exist in the warehouse; archived and counted bins are refused by the posting. */
  private async assertBinsIn(
    tx: Tx,
    warehouseId: number,
    binIds: readonly (number | null)[],
  ): Promise<void> {
    const ids = [...new Set(binIds.filter((id): id is number => id !== null))];
    const found = new Map((await this.bins.getMany(ids, tx)).map((bin) => [bin.id, bin]));
    for (const id of ids) {
      const bin = found.get(id);
      if (!bin || bin.warehouseId !== warehouseId) {
        throw invalid('lines.binId', 'warehouse', 'a bin of the transfer’s warehouse');
      }
      if (bin.type === 'TRANSIT' || bin.type === 'CARGO') {
        throw invalid('lines.binId', 'type', 'a bin of the warehouse itself');
      }
    }
  }

  private async baseUnitsOf(tx: Tx, productIds: readonly number[]): Promise<Map<number, UnitInfo>> {
    return this.units.baseUnits([...new Set(productIds)], tx);
  }

  /** Writes shipped or received quantities and bins, a chunk of lines per statement. */
  private async updateLines(
    tx: Tx,
    plan: readonly LineUpdate[],
    step: 'ship' | 'receive',
  ): Promise<void> {
    for (let start = 0; start < plan.length; start += CHUNK) {
      const rows = sql.join(
        plan
          .slice(start, start + CHUNK)
          .map(
            (entry) =>
              sql`(${entry.id}::bigint, ${entry.qtyBase.toFixed()}::numeric, ${entry.binId}::bigint)`,
          ),
        sql`, `,
      );
      await tx.execute(
        step === 'ship'
          ? sql`UPDATE transfer_lines l SET shipped_qty_base = v.qty, from_bin_id = v.bin_id, updated_at = now()
                  FROM (VALUES ${rows}) AS v (id, qty, bin_id) WHERE l.id = v.id`
          : sql`UPDATE transfer_lines l SET received_qty_base = v.qty, to_bin_id = v.bin_id, updated_at = now()
                  FROM (VALUES ${rows}) AS v (id, qty, bin_id) WHERE l.id = v.id`,
      );
    }
  }

  private async allocateNumber(tx: Tx): Promise<string> {
    const { rows } = await tx.execute<{ now: string | Date }>(sql`SELECT now() AS now`);
    const now = rows[0]?.now;
    const year = businessYear(now instanceof Date ? now : new Date(now ?? Date.now()));
    return formatDocNumber('TR', year, await this.numbering.next(tx, 'TR', year));
  }

  private async describe(
    executor: Db | Tx,
    header: TransferRow,
    lines: readonly TransferLineRow[],
  ): Promise<TransferLine[]> {
    if (lines.length === 0) return [];
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const products = new Map(
      (await this.catalog.getMany(productIds, executor)).map((product) => [product.id, product]),
    );
    const units = await this.units.describe(
      [...new Set(lines.map((line) => line.requestUnitId))],
      executor,
    );
    const baseUnits = await this.units.baseUnits(productIds, executor);
    const suggestedFrom =
      header.status === 'DRAFT' || header.status === 'REQUESTED'
        ? await this.sourceBins(
            executor,
            await this.org.getWarehouse(header.sourceWarehouseId, executor),
            lines,
          )
        : new Map<number, number>();
    const suggestedTo =
      header.status === 'SHIPPED'
        ? await this.destinationBins(
            executor,
            await this.org.getWarehouse(header.destWarehouseId, executor),
            lines,
          )
        : new Map<number, number>();
    const fromOf = (line: TransferLineRow) =>
      line.shippedQtyBase === null ? (suggestedFrom.get(line.productId) ?? null) : line.fromBinId;
    const toOf = (line: TransferLineRow) =>
      line.receivedQtyBase === null ? (suggestedTo.get(line.productId) ?? null) : line.toBinId;
    const binIds = [
      ...new Set(lines.flatMap((line) => [fromOf(line), toOf(line)]).filter((id) => id !== null)),
    ];
    const codes = new Map(
      (await this.bins.getMany(binIds, executor)).map((bin) => [bin.id, bin.code]),
    );
    return lines.map((line) => {
      const fromBinId = fromOf(line);
      const toBinId = toOf(line);
      const base = baseUnits.get(line.productId);
      return {
        id: line.id,
        productId: line.productId,
        productSku: products.get(line.productId)?.sku ?? '',
        productName: products.get(line.productId)?.name ?? '',
        requestUnitId: line.requestUnitId,
        unitName: units.get(line.requestUnitId)?.uomName ?? '',
        requestFactor: line.requestFactor,
        requestedQty: line.requestedQty,
        baseUnitId: base?.unitId ?? line.requestUnitId,
        baseUnitName: base?.uomName ?? '',
        shippedQtyBase: line.shippedQtyBase,
        receivedQtyBase: line.receivedQtyBase,
        fromBinId,
        fromBinCode: fromBinId === null ? null : (codes.get(fromBinId) ?? null),
        toBinId,
        toBinCode: toBinId === null ? null : (codes.get(toBinId) ?? null),
      };
    });
  }

  private async linesOf(executor: Db | Tx, id: number): Promise<TransferLineRow[]> {
    return executor
      .select()
      .from(transferLines)
      .where(eq(transferLines.transferId, id))
      .orderBy(transferLines.id);
  }

  private async lockHeader(tx: Tx, id: number): Promise<TransferRow> {
    const [row] = await tx.select().from(transfers).where(eq(transfers.id, id)).for('update');
    if (!row) throw notFound('transfer', id);
    return row;
  }

  /** A draft, locked, for the side that created it. */
  private async lockDraft(tx: Tx, ctx: AuthContext, id: number): Promise<TransferRow> {
    const header = await this.lockHeader(tx, id);
    this.scope.assertCanWriteWarehouse(ctx, ownerSide(header));
    assertStatus(header, 'DRAFT', []);
    return header;
  }

  private async lockLine(
    tx: Tx,
    ctx: AuthContext,
    lineId: number,
  ): Promise<{ header: TransferRow; line: TransferLineRow }> {
    const [peek] = await tx
      .select({ transferId: transferLines.transferId })
      .from(transferLines)
      .where(eq(transferLines.id, lineId));
    if (!peek) throw notFound('transfer line', lineId);
    const header = await this.lockDraft(tx, ctx, peek.transferId);
    const [line] = await tx.select().from(transferLines).where(eq(transferLines.id, lineId));
    if (!line) throw notFound('transfer line', lineId);
    return { header, line };
  }

  private async touch(tx: Tx, id: number): Promise<void> {
    await tx
      .update(transfers)
      .set({ updatedAt: sql`now()` })
      .where(eq(transfers.id, id));
  }
}

/** The side that creates and edits the draft: the destination asks, the source pushes. */
function ownerSide(transfer: {
  origin: TransferOrigin;
  sourceWarehouseId: number;
  destWarehouseId: number;
}): number {
  return transfer.origin === 'REQUEST' ? transfer.destWarehouseId : transfer.sourceWarehouseId;
}

/** DOC_ALREADY_POSTED for a step already taken, DOC_STATE_INVALID for any other wrong state. */
function assertStatus(
  header: TransferRow,
  expected: TransferStatus,
  done: readonly TransferStatus[],
): void {
  if (done.includes(header.status)) {
    throw new AppError('DOC_ALREADY_POSTED', `transfer ${header.id} is ${header.status}`, {
      status: header.status,
    });
  }
  if (header.status !== expected) {
    throw new AppError('DOC_STATE_INVALID', `transfer ${header.id} is ${header.status}`, {
      status: header.status,
    });
  }
}

function countsByLine(
  lines: readonly TransferLineRow[],
  counts: readonly TransferCount[],
): Map<number, TransferCount> {
  const own = new Set(lines.map((line) => line.id));
  const byLine = new Map<number, TransferCount>();
  for (const count of counts) {
    if (!own.has(count.lineId)) throw invalid('lines', 'line', 'lines of this transfer');
    if (byLine.has(count.lineId)) throw invalid('lines', 'duplicate', 'each line once');
    byLine.set(count.lineId, count);
  }
  return byLine;
}

function lineOf(lines: ReadonlyMap<number, TransferLineRow>, id: number): TransferLineRow {
  const line = lines.get(id);
  if (!line) throw new Error(`transfer line ${id} vanished`);
  return line;
}

function baseUnitOf(units: ReadonlyMap<number, UnitInfo>, productId: number): UnitInfo {
  const unit = units.get(productId);
  if (!unit || !unit.factorToBase.equals(1)) {
    throw new Error(`product ${productId} has no base unit of factor 1`);
  }
  return unit;
}

/** One ledger leg of a line, in base units (ADR-0035 #4). */
function legOf(
  header: TransferRow,
  line: TransferLineRow,
  unit: UnitInfo,
  movementType: 'TRANSFER_OUT' | 'TRANSFER_IN',
  leg: number,
  warehouseId: number,
  binId: number | null,
  qtyBase: Decimal,
): Movement {
  if (binId === null) throw new Error(`transfer line ${line.id} has no bin for leg ${leg}`);
  return {
    docType: 'TR',
    docId: header.id,
    docLineId: line.id,
    movementType,
    leg,
    warehouseId,
    binId,
    productId: line.productId,
    lotId: line.lotId,
    qtyBase,
    enteredQty: qtyBase.abs(),
    productUnitId: unit.unitId,
    factorSnapshot: unit.factorToBase,
  };
}

function headerView(row: TransferRow): Omit<TransferDetail, 'lines'> {
  return {
    id: row.id,
    number: row.number,
    origin: row.origin,
    status: row.status,
    sourceWarehouseId: row.sourceWarehouseId,
    destWarehouseId: row.destWarehouseId,
    note: row.note,
    requestedAt: row.requestedAt,
    shippedAt: row.shippedAt,
    shipDate: row.shipDate,
    receivedAt: row.receivedAt,
    receiveDate: row.receiveDate,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
