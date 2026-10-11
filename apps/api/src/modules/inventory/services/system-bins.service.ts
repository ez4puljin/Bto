import { Inject, Injectable } from '@nestjs/common';
import { systemBinTypes } from '@tugeel/shared/inventory';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { OrgService, type Warehouse, type WarehouseCreatedHook } from '../../identity';
import { advisoryLock, LOCKS } from './support';

/**
 * The system bins of a warehouse (architecture §5.1): RECEIVING, STAGING, SHIP, DAMAGED and RETURNS
 * everywhere, SALESFLOOR in the store, CARGO on a vehicle, only TRANSIT in the TRANSIT warehouse.
 * Bound as identity's WAREHOUSE_CREATED_HOOK, so they appear in the transaction that creates the
 * warehouse; `backfill` covers warehouses created before inventory existed. Their codes are the type
 * names, which shelves may not use.
 */
@Injectable()
export class SystemBinsService implements WarehouseCreatedHook {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly org: OrgService,
  ) {}

  async onWarehouseCreated(tx: Tx, warehouse: Warehouse): Promise<void> {
    await this.ensure(tx, [warehouse]);
  }

  /** Inserts the missing system bins of these warehouses; returns how many were created. */
  async ensure(tx: Tx, list: readonly Pick<Warehouse, 'id' | 'kind'>[]): Promise<number> {
    const rows = list.flatMap((warehouse) =>
      systemBinTypes(warehouse.kind).map((type) => sql`(${warehouse.id}::bigint, ${type}::text)`),
    );
    if (rows.length === 0) return 0;
    const result = await tx.execute(sql`
      INSERT INTO bins (warehouse_id, code, type, is_system)
      SELECT v.warehouse_id, v.type, v.type, true
        FROM (VALUES ${sql.join(rows, sql`, `)}) AS v (warehouse_id, type)
       ORDER BY v.warehouse_id, v.type
      ON CONFLICT (warehouse_id, type) WHERE is_system DO NOTHING`);
    return result.rowCount ?? 0;
  }

  /** Every warehouse's system bins, once per boot and process (idempotent, serialised). */
  async backfill(): Promise<number> {
    const warehouses = await this.org.listWarehouses();
    return inTransaction(this.db, async (tx) => {
      await advisoryLock(tx, LOCKS.systemBins);
      return this.ensure(tx, warehouses);
    });
  }
}
