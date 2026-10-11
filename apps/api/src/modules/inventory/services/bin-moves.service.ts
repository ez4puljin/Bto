import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import { and, desc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CatalogService, UnitConversionService } from '../../catalog';
import {
  type Actor,
  actorUserId,
  type AuthContext,
  AuditService,
  OrgService,
  ScopeService,
} from '../../identity';
import { binMoveLines, binMoves, bins } from '../schema';
import { StockPostingService } from './stock-posting.service';
import { optionalText } from './support';

type MoveRow = typeof binMoves.$inferSelect;
type MoveLineRow = typeof binMoveLines.$inferSelect;

export interface BinMoveLineInput {
  productUnitId: number;
  enteredQty: Decimal;
  fromBinId: number;
  toBinId: number;
}

export interface BinMoveInput {
  warehouseId: number;
  note?: string | null;
  lines: readonly BinMoveLineInput[];
}

export interface BinMoveLine {
  id: number;
  productId: number;
  productSku: string;
  productName: string;
  productUnitId: number;
  unitName: string;
  enteredQty: Decimal;
  qtyBase: Decimal;
  fromBinId: number;
  fromBinCode: string;
  toBinId: number;
  toBinCode: string;
}

export interface BinMoveDetail {
  id: number;
  number: string | null;
  warehouseId: number;
  status: 'DRAFT' | 'POSTED';
  note: string | null;
  effectiveDate: string | null;
  postedAt: Date | null;
  createdAt: Date;
  lines: BinMoveLine[];
}

export interface BinMoveSummary {
  id: number;
  number: string | null;
  warehouseId: number;
  note: string | null;
  lineCount: number;
  effectiveDate: string | null;
  postedAt: Date | null;
}

/** Warehouses with shelves; vehicles move stock only through trips (delivery 5). */
const MOVE_WAREHOUSE_KINDS = ['WHOLESALE', 'STORE'];

/**
 * Bin moves (BM-, §5.3): put-away from RECEIVING and any shelf-to-shelf move, including into DAMAGED
 * for quarantine. A move is created and posted in one request, so a repeated click never moves twice
 * (the route is idempotent) and warehouse totals never change.
 */
@Injectable()
export class BinMovesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly org: OrgService,
    private readonly posting: StockPostingService,
    private readonly scope: ScopeService,
    private readonly units: UnitConversionService,
  ) {}

  async create(ctx: AuthContext, input: BinMoveInput): Promise<BinMoveDetail> {
    this.scope.assertCanWriteWarehouse(ctx, input.warehouseId);
    return inTransaction(this.db, async (tx) => {
      const id = await this.createInTx(tx, ctx, input);
      return this.get(id, tx);
    });
  }

  async createInTx(tx: Tx, actor: Actor, input: BinMoveInput): Promise<number> {
    const warehouse = await this.org.getWarehouse(input.warehouseId, tx);
    if (!MOVE_WAREHOUSE_KINDS.includes(warehouse.kind)) {
      throw new AppError(
        'WAREHOUSE_KIND_NOT_ALLOWED',
        `no bin moves in a ${warehouse.kind} warehouse`,
        {
          kind: warehouse.kind,
        },
      );
    }
    if (input.lines.length === 0) throw invalid('lines', 'empty', 'a move needs at least one line');
    const binIds = [...new Set(input.lines.flatMap((line) => [line.fromBinId, line.toBinId]))];
    const binRows = new Map(
      (await tx.select().from(bins).where(inArray(bins.id, binIds))).map((bin) => [bin.id, bin]),
    );
    for (const line of input.lines) {
      if (line.fromBinId === line.toBinId)
        throw invalid('lines', 'bins', 'from and to bins differ');
      for (const binId of [line.fromBinId, line.toBinId]) {
        if (binRows.get(binId)?.warehouseId !== input.warehouseId) {
          throw invalid('lines', 'warehouse', 'bins of the move’s warehouse');
        }
      }
    }
    const [header] = await tx
      .insert(binMoves)
      .values({
        warehouseId: input.warehouseId,
        note: optionalText(input.note) ?? null,
        createdBy: actorUserId(actor),
      })
      .returning();
    if (!header) throw new Error('bin move insert returned no row');
    const lines: MoveLineRow[] = [];
    for (const line of input.lines) {
      const converted = await this.units.toBase(line.productUnitId, line.enteredQty, tx);
      const [row] = await tx
        .insert(binMoveLines)
        .values({
          moveId: header.id,
          productId: converted.productId,
          productUnitId: converted.unitId,
          enteredQty: line.enteredQty,
          factorSnapshot: converted.factorSnapshot,
          qtyBase: converted.qtyBase,
          fromBinId: line.fromBinId,
          toBinId: line.toBinId,
        })
        .returning();
      if (!row) throw new Error('bin move line insert returned no row');
      lines.push(row);
    }
    const result = await this.posting.post(tx, actor, {
      docs: [{ docType: 'BM', docId: header.id, expectedStatus: 'DRAFT', nextStatus: 'POSTED' }],
      movements: lines.flatMap((line) => {
        const putaway = binRows.get(line.fromBinId)?.type === 'RECEIVING';
        const common = {
          docType: 'BM' as const,
          docId: header.id,
          docLineId: line.id,
          warehouseId: input.warehouseId,
          productId: line.productId,
          lotId: line.lotId,
          enteredQty: line.enteredQty,
          productUnitId: line.productUnitId,
          factorSnapshot: line.factorSnapshot,
        };
        return [
          {
            ...common,
            movementType: putaway ? ('PUTAWAY_OUT' as const) : ('BIN_MOVE_OUT' as const),
            leg: 1,
            binId: line.fromBinId,
            qtyBase: line.qtyBase.negated(),
          },
          {
            ...common,
            movementType: putaway ? ('PUTAWAY_IN' as const) : ('BIN_MOVE_IN' as const),
            leg: 2,
            binId: line.toBinId,
            qtyBase: line.qtyBase,
          },
        ];
      }),
    });
    await this.audit.record(tx, actor, {
      action: 'POST',
      entity: 'bin_moves',
      entityId: header.id,
      after: { number: result.numbers.get(header.id), warehouseId: input.warehouseId, lines },
    });
    return header.id;
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<BinMoveDetail> {
    const [header] = await executor.select().from(binMoves).where(eq(binMoves.id, id));
    if (!header) throw notFound('bin move', id);
    const lines = await executor
      .select()
      .from(binMoveLines)
      .where(eq(binMoveLines.moveId, id))
      .orderBy(binMoveLines.id);
    return { ...headerView(header), lines: await this.describe(executor, lines) };
  }

  async list(query: {
    warehouseId?: number;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: BinMoveSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [eq(binMoves.status, 'POSTED')];
    if (query.warehouseId) filters.push(eq(binMoves.warehouseId, query.warehouseId));
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(binMoves.id, after.id));
    const rows = await this.db
      .select({
        id: binMoves.id,
        number: binMoves.number,
        warehouseId: binMoves.warehouseId,
        note: binMoves.note,
        effectiveDate: binMoves.effectiveDate,
        postedAt: binMoves.postedAt,
        // Spelled out: a single-table select leaves columns unqualified (see ReceiptsService.list).
        lineCount: sql<string>`(SELECT count(*) FROM bin_move_lines l WHERE l.move_id = bin_moves.id)`,
      })
      .from(binMoves)
      .where(and(...filters))
      .orderBy(desc(binMoves.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return {
      data: page.data.map((row) => ({ ...row, lineCount: Number.parseInt(row.lineCount, 10) })),
      nextCursor: page.nextCursor,
    };
  }

  private async describe(executor: Db | Tx, lines: readonly MoveLineRow[]): Promise<BinMoveLine[]> {
    const products = new Map(
      (await this.catalog.getMany([...new Set(lines.map((line) => line.productId))], executor)).map(
        (product) => [product.id, product],
      ),
    );
    const units = await this.units.describe(
      [...new Set(lines.map((line) => line.productUnitId))],
      executor,
    );
    const binIds = [...new Set(lines.flatMap((line) => [line.fromBinId, line.toBinId]))];
    const codes = new Map(
      binIds.length === 0
        ? []
        : (
            await executor
              .select({ id: bins.id, code: bins.code })
              .from(bins)
              .where(inArray(bins.id, binIds))
          ).map((bin) => [bin.id, bin.code]),
    );
    return lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productSku: products.get(line.productId)?.sku ?? '',
      productName: products.get(line.productId)?.name ?? '',
      productUnitId: line.productUnitId,
      unitName: units.get(line.productUnitId)?.uomName ?? '',
      enteredQty: line.enteredQty,
      qtyBase: line.qtyBase,
      fromBinId: line.fromBinId,
      fromBinCode: codes.get(line.fromBinId) ?? '',
      toBinId: line.toBinId,
      toBinCode: codes.get(line.toBinId) ?? '',
    }));
  }
}

function headerView(row: MoveRow): Omit<BinMoveDetail, 'lines'> {
  return {
    id: row.id,
    number: row.number,
    warehouseId: row.warehouseId,
    status: row.status,
    note: row.note,
    effectiveDate: row.effectiveDate,
    postedAt: row.postedAt,
    createdAt: row.createdAt,
  };
}
