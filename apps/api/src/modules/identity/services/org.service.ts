import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import type { Actor } from '../auth-context';
import { branches, warehouses, type WarehouseKind } from '../schema';
import { AuditService } from './audit.service';

export type Branch = typeof branches.$inferSelect;
export type Warehouse = typeof warehouses.$inferSelect;

export interface BranchInput {
  code: string;
  name: string;
  branchNo?: string | null;
  districtCode?: string | null;
  address?: string | null;
}
export type BranchPatch = Partial<BranchInput> & { status?: Branch['status'] };

export interface WarehouseInput {
  code: string;
  name: string;
  kind: WarehouseKind;
  branchId: number;
}
export interface WarehousePatch {
  code?: string;
  name?: string;
  branchId?: number;
  status?: Warehouse['status'];
}

/** Kinds an admin may create or edit through the API; VEHICLE comes with vehicles (delivery 5). */
const ADMIN_KINDS: readonly WarehouseKind[] = ['WHOLESALE', 'STORE'];
export const TRANSIT_CODE = 'TRANSIT';

/**
 * Called inside the transaction that creates a warehouse. The inventory module provides it in
 * week 3 to create the system bins (SPEC §5.1); until then no provider exists.
 */
export interface WarehouseCreatedHook {
  onWarehouseCreated(tx: Tx, warehouse: Warehouse): Promise<void>;
}
export const WAREHOUSE_CREATED_HOOK = Symbol('WAREHOUSE_CREATED_HOOK');

/** Branches and warehouses (SPEC §5.1, docs/architecture.md §5.1). */
@Injectable()
export class OrgService implements OnModuleInit {
  private hook: WarehouseCreatedHook | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.hook = this.moduleRef.get<WarehouseCreatedHook>(WAREHOUSE_CREATED_HOOK, {
        strict: false,
      });
    } catch {
      this.hook = null;
    }
  }

  listBranches(): Promise<Branch[]> {
    return this.db.select().from(branches).orderBy(asc(branches.code));
  }

  async getBranch(id: number, executor: Db | Tx = this.db): Promise<Branch> {
    const [row] = await executor.select().from(branches).where(eq(branches.id, id));
    if (!row) throw new AppError('NOT_FOUND', `branch ${id} not found`, { id });
    return row;
  }

  createBranch(actor: Actor, input: BranchInput): Promise<Branch> {
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx.insert(branches).values(input).returning();
      if (!row) throw new Error('branch insert returned no row');
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'branches',
        entityId: row.id,
        after: row,
      });
      return row;
    });
  }

  updateBranch(actor: Actor, id: number, patch: BranchPatch): Promise<Branch> {
    return inTransaction(this.db, async (tx) => {
      const [before] = await tx.select().from(branches).where(eq(branches.id, id)).for('update');
      if (!before) throw new AppError('NOT_FOUND', `branch ${id} not found`, { id });
      const [after] = await tx
        .update(branches)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(branches.id, id))
        .returning();
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'branches',
        entityId: id,
        before,
        after,
      });
      if (!after) throw new Error('branch update returned no row');
      return after;
    });
  }

  listWarehouses(filter: { kind?: WarehouseKind; branchId?: number } = {}): Promise<Warehouse[]> {
    const conditions: SQL[] = [];
    if (filter.kind) conditions.push(eq(warehouses.kind, filter.kind));
    if (filter.branchId !== undefined) conditions.push(eq(warehouses.branchId, filter.branchId));
    return this.db
      .select()
      .from(warehouses)
      .where(and(...conditions))
      .orderBy(asc(warehouses.code));
  }

  async getWarehouse(id: number, executor: Db | Tx = this.db): Promise<Warehouse> {
    const [row] = await executor.select().from(warehouses).where(eq(warehouses.id, id));
    if (!row) throw new AppError('NOT_FOUND', `warehouse ${id} not found`, { id });
    return row;
  }

  /** The single system warehouse goods pass through between warehouses (SPEC §6.5). */
  async getTransitWarehouse(executor: Db | Tx = this.db): Promise<Warehouse> {
    const [row] = await executor.select().from(warehouses).where(eq(warehouses.kind, 'TRANSIT'));
    if (!row) throw new Error('the TRANSIT warehouse is missing (synced at api boot)');
    return row;
  }

  /** Admin path: only WHOLESALE and STORE warehouses (422 WAREHOUSE_KIND_NOT_ALLOWED otherwise). */
  async createWarehouse(actor: Actor, input: WarehouseInput): Promise<Warehouse> {
    if (!ADMIN_KINDS.includes(input.kind)) {
      throw new AppError('WAREHOUSE_KIND_NOT_ALLOWED', `cannot create ${input.kind} here`, {
        kind: input.kind,
      });
    }
    return await inTransaction(this.db, (tx) => this.insertWarehouse(tx, actor, input));
  }

  /** Inside an existing transaction (the delivery module creates VEHICLE warehouses this way). */
  async insertWarehouse(tx: Tx, actor: Actor, input: WarehouseInput): Promise<Warehouse> {
    if (input.kind === 'TRANSIT' || input.code === TRANSIT_CODE) {
      throw new AppError('WAREHOUSE_KIND_NOT_ALLOWED', 'TRANSIT is a system warehouse', {
        kind: input.kind,
      });
    }
    const [row] = await tx.insert(warehouses).values(input).returning();
    if (!row) throw new Error('warehouse insert returned no row');
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'warehouses',
      entityId: row.id,
      after: row,
    });
    await this.notifyWarehouseCreated(tx, row);
    return row;
  }

  updateWarehouse(actor: Actor, id: number, patch: WarehousePatch): Promise<Warehouse> {
    return inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(warehouses)
        .where(eq(warehouses.id, id))
        .for('update');
      if (!before) throw new AppError('NOT_FOUND', `warehouse ${id} not found`, { id });
      if (!ADMIN_KINDS.includes(before.kind) || patch.code === TRANSIT_CODE) {
        throw new AppError(
          'WAREHOUSE_KIND_NOT_ALLOWED',
          `cannot edit a ${before.kind} warehouse here`,
          {
            kind: before.kind,
          },
        );
      }
      const [after] = await tx
        .update(warehouses)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(warehouses.id, id))
        .returning();
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'warehouses',
        entityId: id,
        before,
        after,
      });
      if (!after) throw new Error('warehouse update returned no row');
      return after;
    });
  }

  async notifyWarehouseCreated(tx: Tx, warehouse: Warehouse): Promise<void> {
    if (this.hook) await this.hook.onWarehouseCreated(tx, warehouse);
  }
}
