import { Inject, Injectable } from '@nestjs/common';
import mn from '@tugeel/shared/i18n/mn.json';
import {
  BIN_TYPES,
  BinRangeError,
  type BinCodeRange,
  type BinType,
  binCodeRange,
  isBinCode,
  normalizeBinCode,
  type UserBinType,
} from '@tugeel/shared/inventory';
import { and, asc, eq, gt, inArray, isNull, like, or, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { escapeLike } from '../../../common/db/like';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import {
  type Actor,
  type AuthContext,
  AuditService,
  OrgService,
  ScopeService,
  type Warehouse,
} from '../../identity';
import { binStock, bins, productLocations } from '../schema';
import { optionalText } from './support';

type BinRow = typeof bins.$inferSelect;
export type Bin = BinRow;

export interface BinQuery {
  warehouseId: number;
  /** The start of a code, as typed or scanned. */
  q?: string;
  type?: BinType;
  /** Archived bins too. */
  archived?: boolean;
  cursor?: string;
  limit?: number;
}

export interface BinInput {
  warehouseId: number;
  code: string;
  type: UserBinType;
  name?: string | null;
  pickSequence?: number | null;
}

export interface BinPatch {
  name?: string | null;
  pickSequence?: number | null;
}

export interface BinRangeInput extends BinCodeRange {
  warehouseId: number;
  type: UserBinType;
  /** Only report which codes would be created. */
  dryRun?: boolean;
}

export interface BinRangeResult {
  codes: string[];
  /** Codes that already existed in the warehouse (left as they are). */
  existing: string[];
  created: number;
}

/** Shelves are made in wholesale warehouses and the store; vehicles and TRANSIT hold only system bins. */
const SHELF_WAREHOUSE_KINDS: readonly Warehouse['kind'][] = ['WHOLESALE', 'STORE'];
const RESERVED_CODES: ReadonlySet<string> = new Set(BIN_TYPES);
/** Code of the shelf opening stock without a shelf goes to (ADR-0036 #5). */
export const NO_SHELF_CODE = 'NOSHELF';

/**
 * Bins (architecture §5.1, owner 2026-10-11): shelves are numbered like their labels (A-01-03) and
 * created one by one or as a block; system bins come from SystemBinsService. A used bin is archived
 * (only when empty), a never-used one may be deleted. Archiving locks the bin row, so it serialises
 * with postings, which hold their bins FOR SHARE (ADR-0034).
 */
@Injectable()
export class BinsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly org: OrgService,
    private readonly scope: ScopeService,
  ) {}

  async get(id: number, executor: Db | Tx = this.db): Promise<Bin> {
    const [row] = await executor.select().from(bins).where(eq(bins.id, id));
    if (!row) throw notFound('bin', id);
    return row;
  }

  async getMany(ids: readonly number[], executor: Db | Tx = this.db): Promise<Bin[]> {
    if (ids.length === 0) return [];
    return executor
      .select()
      .from(bins)
      .where(inArray(bins.id, [...ids]));
  }

  /** The bin of a scanned label in a warehouse (404 when the warehouse has no such code). */
  async lookup(warehouseId: number, code: string, executor: Db | Tx = this.db): Promise<Bin> {
    const normalised = normalizeBinCode(code);
    const [row] = await executor
      .select()
      .from(bins)
      .where(and(eq(bins.warehouseId, warehouseId), eq(bins.code, normalised)));
    if (!row) throw new AppError('NOT_FOUND', `no bin ${normalised}`, { code: normalised });
    return row;
  }

  /** Every bin of these warehouses, archived ones included (imports match codes in bulk). */
  async ofWarehouses(warehouseIds: readonly number[], executor: Db | Tx = this.db): Promise<Bin[]> {
    if (warehouseIds.length === 0) return [];
    return executor
      .select()
      .from(bins)
      .where(inArray(bins.warehouseId, [...new Set(warehouseIds)]))
      .orderBy(asc(bins.warehouseId), asc(bins.code));
  }

  /**
   * The warehouse's «Тавиургүй» storage shelf (code NOSHELF, ADR-0036 #5) for opening stock
   * without a shelf; created on first use in the caller's transaction.
   */
  async ensureNoShelfInTx(tx: Tx, actor: Actor, warehouseId: number): Promise<Bin> {
    const created = await tx
      .insert(bins)
      .values({
        warehouseId,
        code: NO_SHELF_CODE,
        name: mn.inventory.bins.noShelf,
        type: 'STORAGE',
      })
      .onConflictDoNothing({ target: [bins.warehouseId, bins.code] })
      .returning();
    const [row] = created.length
      ? created
      : await tx
          .select()
          .from(bins)
          .where(and(eq(bins.warehouseId, warehouseId), eq(bins.code, NO_SHELF_CODE)));
    if (!row) throw new Error(`warehouse ${warehouseId} has no ${NO_SHELF_CODE} bin`);
    if (created.length) {
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'bins',
        entityId: row.id,
        after: row,
      });
    }
    return row;
  }

  /** The warehouse's bin of a system type (RECEIVING, DAMAGED, …). */
  async systemBin(warehouseId: number, type: BinType, executor: Db | Tx = this.db): Promise<Bin> {
    const [row] = await executor
      .select()
      .from(bins)
      .where(and(eq(bins.warehouseId, warehouseId), eq(bins.type, type), eq(bins.isSystem, true)));
    if (!row) throw new Error(`warehouse ${warehouseId} has no ${type} bin`);
    return row;
  }

  async list(query: BinQuery): Promise<{ data: Bin[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [eq(bins.warehouseId, query.warehouseId)];
    if (!query.archived) filters.push(isNull(bins.archivedAt));
    if (query.type) filters.push(eq(bins.type, query.type));
    const prefix = query.q ? normalizeBinCode(query.q) : '';
    if (prefix) filters.push(like(bins.code, `${escapeLike(prefix)}%`));
    const after = decodeCursor(query.cursor);
    if (typeof after?.code === 'string' && typeof after.id === 'number') {
      const keyset = or(
        gt(bins.code, after.code),
        and(eq(bins.code, after.code), gt(bins.id, after.id)),
      );
      if (keyset) filters.push(keyset);
    }
    const rows = await this.db
      .select()
      .from(bins)
      .where(and(...filters))
      .orderBy(asc(bins.code), asc(bins.id))
      .limit(limit + 1);
    return toPage(rows, limit, (row) => ({ code: row.code, id: row.id }));
  }

  async create(ctx: AuthContext, input: BinInput): Promise<Bin> {
    this.scope.assertCanWriteWarehouse(ctx, input.warehouseId);
    return inTransaction(this.db, async (tx) => {
      await this.shelfWarehouse(input.warehouseId, tx);
      const [row] = await tx
        .insert(bins)
        .values({
          warehouseId: input.warehouseId,
          code: shelfCode(input.code),
          type: input.type,
          name: optionalText(input.name) ?? null,
          pickSequence: input.pickSequence ?? null,
        })
        .returning();
      if (!row) throw new Error('bin insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'bins',
        entityId: row.id,
        after: row,
      });
      return row;
    });
  }

  /** A block of shelves (rows × racks × levels); existing codes are kept, never duplicated. */
  async createRange(ctx: AuthContext, input: BinRangeInput): Promise<BinRangeResult> {
    this.scope.assertCanWriteWarehouse(ctx, input.warehouseId);
    let codes: string[];
    try {
      codes = binCodeRange(input);
    } catch (error) {
      if (error instanceof BinRangeError) throw invalid('rows', 'range', error.message);
      throw error;
    }
    return inTransaction(this.db, async (tx) => {
      await this.shelfWarehouse(input.warehouseId, tx);
      const found = await tx
        .select({ code: bins.code })
        .from(bins)
        .where(and(eq(bins.warehouseId, input.warehouseId), inArray(bins.code, codes)));
      const existing = new Set(found.map((row) => row.code));
      const missing = codes.filter((code) => !existing.has(code));
      if (input.dryRun || missing.length === 0) {
        return { codes, existing: [...existing].sort(), created: 0 };
      }
      const inserted = await tx
        .insert(bins)
        .values(missing.map((code) => ({ warehouseId: input.warehouseId, code, type: input.type })))
        .onConflictDoNothing({ target: [bins.warehouseId, bins.code] })
        .returning({ id: bins.id, code: bins.code });
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'bins',
        entityId: `${input.warehouseId}:${missing[0] ?? ''}…${missing.at(-1) ?? ''}`,
        after: {
          warehouseId: input.warehouseId,
          type: input.type,
          codes: inserted.map((row) => row.code),
        },
      });
      return { codes, existing: [...existing].sort(), created: inserted.length };
    });
  }

  update(ctx: AuthContext, id: number, patch: BinPatch): Promise<Bin> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.lockBin(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, before.warehouseId);
      const [after] = await tx
        .update(bins)
        .set({
          ...(patch.name === undefined ? {} : { name: optionalText(patch.name) ?? null }),
          ...(patch.pickSequence === undefined ? {} : { pickSequence: patch.pickSequence }),
          updatedAt: sql`now()`,
        })
        .where(eq(bins.id, id))
        .returning();
      if (!after) throw notFound('bin', id);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'bins',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  /**
   * Retires an empty shelf: postings refuse it from now on and products whose fixed bin it was lose
   * that default. System bins and bins being counted stay.
   */
  archive(ctx: AuthContext, id: number): Promise<Bin> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.lockBin(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, before.warehouseId);
      if (before.isSystem) throw invalid('id', 'system', 'system bins are never archived');
      if (before.status === 'COUNTING') {
        throw new AppError('BIN_LOCKED_FOR_COUNT', `bin ${id} is being counted`, {
          code: before.code,
        });
      }
      if (before.archivedAt) return before;
      const [stocked] = await tx
        .select({ id: binStock.id })
        .from(binStock)
        .where(and(eq(binStock.binId, id), gt(binStock.onHand, sql`0`)))
        .limit(1);
      if (stocked)
        throw new AppError('BIN_NOT_EMPTY', `bin ${id} holds stock`, { code: before.code });
      await tx
        .update(productLocations)
        .set({ defaultBinId: null, updatedAt: sql`now()` })
        .where(eq(productLocations.defaultBinId, id));
      const [after] = await tx
        .update(bins)
        .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(bins.id, id))
        .returning();
      if (!after) throw notFound('bin', id);
      await this.audit.record(tx, ctx, {
        action: 'ARCHIVE',
        entity: 'bins',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  /** Brings an archived shelf back into use. */
  restore(ctx: AuthContext, id: number): Promise<Bin> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.lockBin(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, before.warehouseId);
      if (!before.archivedAt) return before;
      const [after] = await tx
        .update(bins)
        .set({ archivedAt: null, updatedAt: sql`now()` })
        .where(eq(bins.id, id))
        .returning();
      if (!after) throw notFound('bin', id);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'bins',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  /** Deletes a bin nothing ever referred to (a mistyped label); a used bin is IN_USE. */
  remove(ctx: AuthContext, id: number): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.lockBin(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, before.warehouseId);
      if (before.isSystem) throw invalid('id', 'system', 'system bins are never deleted');
      try {
        await tx.delete(bins).where(eq(bins.id, id));
      } catch (error) {
        if (databaseErrorOf(error)?.code === '23503') {
          throw new AppError('IN_USE', `bin ${id} is in use`, { resource: 'bins' });
        }
        throw error;
      }
      await this.audit.record(tx, ctx, { action: 'DELETE', entity: 'bins', entityId: id, before });
    });
  }

  private async lockBin(tx: Tx, id: number): Promise<Bin> {
    const [row] = await tx.select().from(bins).where(eq(bins.id, id)).for('update');
    if (!row) throw notFound('bin', id);
    return row;
  }

  private async shelfWarehouse(id: number, tx: Tx): Promise<Warehouse> {
    const warehouse = await this.org.getWarehouse(id, tx);
    if (!SHELF_WAREHOUSE_KINDS.includes(warehouse.kind)) {
      throw new AppError(
        'WAREHOUSE_KIND_NOT_ALLOWED',
        `no shelves in a ${warehouse.kind} warehouse`,
        {
          kind: warehouse.kind,
        },
      );
    }
    return warehouse;
  }
}

/** A shelf code as stored: the label text, normalised; system type names are reserved. */
function shelfCode(input: string): string {
  const code = normalizeBinCode(input);
  if (!isBinCode(code)) throw invalid('code', 'format', 'Latin capitals, digits and . _ / -');
  if (RESERVED_CODES.has(code)) throw invalid('code', 'reserved', 'the name of a system bin');
  return code;
}
