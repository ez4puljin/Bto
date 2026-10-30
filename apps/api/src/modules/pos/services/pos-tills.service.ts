import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { isTillCode, normalizeTillCode, POS_LIMITS, type PosStatus } from '@tugeel/shared/pos';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { CategoriesService } from '../../catalog';
import { AuditService, type AuthContext, OrgService } from '../../identity';
import { posCashiers, posTillCategories, posTills, posTillUsers } from '../schema';
import { PosEdgeNodesService } from './pos-edge-nodes.service';

export interface Till {
  id: number;
  edgeNodeId: number;
  /** The STORE warehouse it sells from (ADR-0123). */
  warehouseId: number;
  warehouseName: string | null;
  /** ADR-0124: the users who may sign in / approve at it (empty: everyone the store admits). */
  cashierUserIds: number[];
  supervisorUserIds: number[];
  /** ADR-0124: the categories it sells, with everything under them (empty: everything). */
  categoryIds: number[];
  code: string;
  name: string;
  printerHost: string | null;
  printerPort: number;
  /** ADR-0111: the till PC's printer as the admin noted it (information only). */
  printerName: string | null;
  drawerKick: boolean;
  status: PosStatus;
  lastSaleAt: Date | null;
  pairingExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TillInput {
  edgeNodeId: number;
  /** The edge's warehouse when absent. */
  warehouseId?: number | null;
  code: string;
  name: string;
  printerHost: string | null;
  printerPort?: number;
  printerName?: string | null;
  drawerKick?: boolean;
}

export interface TillPatch {
  name?: string;
  warehouseId?: number;
  printerHost?: string | null;
  printerPort?: number;
  printerName?: string | null;
  drawerKick?: boolean;
  status?: PosStatus;
}

type TillRow = typeof posTills.$inferSelect;

export interface TillAccessInput {
  cashierUserIds: readonly number[];
  supervisorUserIds: readonly number[];
  categoryIds: readonly number[];
}

/** What the accept path checks a document against (ADR-0124); null = no restriction. */
export interface TillAccess {
  cashiers: ReadonlySet<number> | null;
  supervisors: ReadonlySet<number> | null;
  /** Every category id the till sells, the subtrees expanded. */
  categories: ReadonlySet<number> | null;
}

/** The tills of the store (owner 2026-10-16: eight, each with its printer and drawer). */
@Injectable()
export class PosTillsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly nodes: PosEdgeNodesService,
    private readonly org: OrgService,
    private readonly categories: CategoriesService,
  ) {}

  async list(filter: { edgeNodeId?: number } = {}): Promise<Till[]> {
    const rows = await this.db
      .select()
      .from(posTills)
      .where(filter.edgeNodeId ? eq(posTills.edgeNodeId, filter.edgeNodeId) : undefined)
      .orderBy(asc(posTills.edgeNodeId), asc(posTills.code));
    return this.views(rows);
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<Till> {
    const [row] = await executor.select().from(posTills).where(eq(posTills.id, id));
    if (!row) throw notFound('pos_till', id);
    return this.viewOne(row, executor);
  }

  /** A node's till by the code its receipts carry; `POS_TILL_INACTIVE` unless it is active. */
  async activeByCode(edgeNodeId: number, code: string, executor: Db | Tx = this.db): Promise<Till> {
    const [row] = await executor
      .select()
      .from(posTills)
      .where(and(eq(posTills.edgeNodeId, edgeNodeId), eq(posTills.code, normalizeTillCode(code))));
    if (!row) {
      throw new AppError('POS_TILL_INACTIVE', `no till ${code} on edge ${edgeNodeId}`, { code });
    }
    if (row.status !== 'ACTIVE') {
      throw new AppError('POS_TILL_INACTIVE', `till ${code} is inactive`, { code });
    }
    return this.viewOne(row, executor);
  }

  async create(ctx: AuthContext, input: TillInput): Promise<Till> {
    const code = normalizeTillCode(input.code);
    if (!isTillCode(code)) throw invalid('code', 'pattern', 'capitals, digits and dashes, 1–8');
    const name = cleanName(input.name);
    const printerHost = cleanHost(input.printerHost);
    const id = await inTransaction(this.db, async (tx) => {
      const node = await this.nodes.get(input.edgeNodeId, tx);
      const warehouseId = input.warehouseId ?? node.warehouseId;
      await this.assertStore(warehouseId, node.warehouseId, tx);
      const [row] = await tx
        .insert(posTills)
        .values({
          edgeNodeId: input.edgeNodeId,
          warehouseId,
          code,
          name,
          printerHost,
          printerPort: input.printerPort ?? 9100,
          printerName: input.printerName?.trim() || null,
          drawerKick: input.drawerKick ?? true,
        })
        .onConflictDoNothing({ target: [posTills.edgeNodeId, posTills.code] })
        .returning({ id: posTills.id });
      if (!row) throw new AppError('DUPLICATE_VALUE', `till ${code} exists on this edge`, { code });
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'pos_tills',
        entityId: row.id,
        after: { edgeNodeId: input.edgeNodeId, warehouseId, code, name, printerHost },
      });
      return row.id;
    });
    return this.get(id);
  }

  async update(ctx: AuthContext, id: number, patch: TillPatch): Promise<Till> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.get(id, tx);
      if (patch.warehouseId !== undefined && patch.warehouseId !== before.warehouseId) {
        const node = await this.nodes.get(before.edgeNodeId, tx);
        await this.assertStore(patch.warehouseId, node.warehouseId, tx);
      }
      const set = {
        ...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}),
        ...(patch.warehouseId !== undefined ? { warehouseId: patch.warehouseId } : {}),
        ...(patch.printerHost !== undefined ? { printerHost: cleanHost(patch.printerHost) } : {}),
        ...(patch.printerPort !== undefined ? { printerPort: patch.printerPort } : {}),
        ...(patch.printerName !== undefined
          ? { printerName: patch.printerName?.trim() || null }
          : {}),
        ...(patch.drawerKick !== undefined ? { drawerKick: patch.drawerKick } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      };
      await tx
        .update(posTills)
        .set({ ...set, updatedAt: sql`now()` })
        .where(eq(posTills.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'pos_tills',
        entityId: id,
        before: {
          name: before.name,
          warehouseId: before.warehouseId,
          printerHost: before.printerHost,
          printerPort: before.printerPort,
          printerName: before.printerName,
          drawerKick: before.drawerKick,
          status: before.status,
        },
        after: set,
      });
    });
    return this.get(id);
  }

  /** A six-digit code a manager types on a browser to make it this till (S2); shown once. */
  async issuePairingCode(ctx: AuthContext, id: number): Promise<{ code: string; expiresAt: Date }> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + POS_LIMITS.pairingCodeMinutes * 60_000);
    await inTransaction(this.db, async (tx) => {
      await this.get(id, tx);
      await tx
        .update(posTills)
        .set({
          pairingCodeHash: createHash('sha256').update(`${id}:${code}`).digest('hex'),
          pairingExpiresAt: expiresAt,
          updatedAt: sql`now()`,
        })
        .where(eq(posTills.id, id));
      await this.audit.record(tx, ctx, {
        action: 'PAIRING_CODE',
        entity: 'pos_tills',
        entityId: id,
        after: { expiresAt },
      });
    });
    return { code, expiresAt };
  }

  private async views(rows: TillRow[], executor: Db | Tx = this.db): Promise<Till[]> {
    const names = await this.org.warehouseNames(
      [...new Set(rows.map((row) => row.warehouseId))],
      executor,
    );
    const ids = rows.map((row) => row.id);
    const users = ids.length
      ? await executor.select().from(posTillUsers).where(inArray(posTillUsers.tillId, ids))
      : [];
    const cats = ids.length
      ? await executor
          .select()
          .from(posTillCategories)
          .where(inArray(posTillCategories.tillId, ids))
      : [];
    return rows.map((row) =>
      view(row, names.get(row.warehouseId) ?? null, {
        cashierUserIds: users
          .filter((u) => u.tillId === row.id && u.role === 'CASHIER')
          .map((u) => u.userId),
        supervisorUserIds: users
          .filter((u) => u.tillId === row.id && u.role === 'SUPERVISOR')
          .map((u) => u.userId),
        categoryIds: cats.filter((c) => c.tillId === row.id).map((c) => c.categoryId),
      }),
    );
  }

  /**
   * Sets who works the till and what it sells (ADR-0124): the lists replace the old ones; every
   * user must be a cashier of the store, every category must exist.
   */
  async setAccess(ctx: AuthContext, id: number, input: TillAccessInput): Promise<Till> {
    const cashierIds = [...new Set(input.cashierUserIds)];
    const supervisorIds = [...new Set(input.supervisorUserIds)];
    const categoryIds = [...new Set(input.categoryIds)];
    await inTransaction(this.db, async (tx) => {
      const before = await this.get(id, tx);
      const wanted = [...new Set([...cashierIds, ...supervisorIds])];
      if (wanted.length > 0) {
        const known = new Set(
          (
            await tx
              .select({ userId: posCashiers.userId })
              .from(posCashiers)
              .where(inArray(posCashiers.userId, wanted))
          ).map((row) => row.userId),
        );
        const missing = wanted.find((userId) => !known.has(userId));
        if (missing !== undefined) {
          throw invalid('cashierUserIds', 'cashier', `user ${missing} is not a cashier`);
        }
      }
      for (const categoryId of categoryIds) await this.categories.get(categoryId, tx);
      await tx.delete(posTillUsers).where(eq(posTillUsers.tillId, id));
      await tx.delete(posTillCategories).where(eq(posTillCategories.tillId, id));
      const userRows = [
        ...cashierIds.map((userId) => ({ tillId: id, userId, role: 'CASHIER' as const })),
        ...supervisorIds.map((userId) => ({ tillId: id, userId, role: 'SUPERVISOR' as const })),
      ];
      if (userRows.length) await tx.insert(posTillUsers).values(userRows);
      if (categoryIds.length) {
        await tx
          .insert(posTillCategories)
          .values(categoryIds.map((categoryId) => ({ tillId: id, categoryId })));
      }
      await this.audit.record(tx, ctx, {
        action: 'ACCESS',
        entity: 'pos_tills',
        entityId: id,
        before: {
          cashierUserIds: before.cashierUserIds,
          supervisorUserIds: before.supervisorUserIds,
          categoryIds: before.categoryIds,
        },
        after: { cashierUserIds: cashierIds, supervisorUserIds: supervisorIds, categoryIds },
      });
    });
    return this.get(id);
  }

  /** The till's restrictions with the category subtrees expanded (ADR-0124). */
  async accessOf(tillId: number, executor: Db | Tx = this.db): Promise<TillAccess> {
    const users = await executor.select().from(posTillUsers).where(eq(posTillUsers.tillId, tillId));
    const cats = await executor
      .select({ categoryId: posTillCategories.categoryId })
      .from(posTillCategories)
      .where(eq(posTillCategories.tillId, tillId));
    const cashiers = users.filter((u) => u.role === 'CASHIER').map((u) => u.userId);
    const supervisors = users.filter((u) => u.role === 'SUPERVISOR').map((u) => u.userId);
    const expanded = new Set<number>();
    for (const row of cats) {
      for (const id of await this.categories.subtreeIds(row.categoryId, executor)) expanded.add(id);
    }
    return {
      cashiers: cashiers.length ? new Set(cashiers) : null,
      supervisors: supervisors.length ? new Set(supervisors) : null,
      categories: cats.length ? expanded : null,
    };
  }

  private async viewOne(row: TillRow, executor: Db | Tx = this.db): Promise<Till> {
    const [till] = await this.views([row], executor);
    if (!till) throw new Error('till view returned nothing');
    return till;
  }

  /** A till's warehouse is a STORE of the edge's branch (ADR-0123). */
  private async assertStore(warehouseId: number, edgeWarehouseId: number, tx: Tx): Promise<void> {
    const warehouse = await this.org.getWarehouse(warehouseId, tx);
    if (warehouse.kind !== 'STORE') {
      throw new AppError('WAREHOUSE_KIND_NOT_ALLOWED', 'a till sells from a STORE warehouse', {
        kind: warehouse.kind,
      });
    }
    if (warehouseId !== edgeWarehouseId) {
      const own = await this.org.getWarehouse(edgeWarehouseId, tx);
      if (own.branchId !== warehouse.branchId) {
        throw new AppError(
          'WAREHOUSE_KIND_NOT_ALLOWED',
          "a till's warehouse is in its edge's branch",
          {
            kind: warehouse.kind,
          },
        );
      }
    }
  }

  async touchSale(tillId: number, soldAt: Date, tx: Tx): Promise<void> {
    await tx
      .update(posTills)
      .set({ lastSaleAt: sql`greatest(coalesce(${posTills.lastSaleAt}, ${soldAt}), ${soldAt})` })
      .where(eq(posTills.id, tillId));
  }
}

function cleanName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > POS_LIMITS.maxName) {
    throw invalid('name', 'length', `1 to ${POS_LIMITS.maxName} characters`);
  }
  return name;
}

function cleanHost(value: string | null | undefined): string | null {
  const host = value?.trim() ?? '';
  if (host.length === 0) return null;
  if (host.length > 253 || /\s/.test(host)) throw invalid('printerHost', 'host', 'a host or IP');
  return host;
}

function view(
  row: TillRow,
  warehouseName: string | null = null,
  access: Pick<Till, 'cashierUserIds' | 'supervisorUserIds' | 'categoryIds'> = {
    cashierUserIds: [],
    supervisorUserIds: [],
    categoryIds: [],
  },
): Till {
  return {
    id: row.id,
    edgeNodeId: row.edgeNodeId,
    warehouseId: row.warehouseId,
    warehouseName,
    ...access,
    code: row.code,
    name: row.name,
    printerHost: row.printerHost,
    printerPort: row.printerPort,
    printerName: row.printerName,
    drawerKick: row.drawerKick,
    status: row.status,
    lastSaleAt: row.lastSaleAt,
    pairingExpiresAt: row.pairingExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
