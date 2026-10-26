import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { configurePgTypeParsers } from '../../common/db/pg-types';
import { EdgeConfig } from '../config/edge-env';
import {
  edgeDevices,
  edgeOutbox,
  edgePinAttempts,
  edgeReceipts,
  edgeSales,
  edgeSequences,
  edgeShifts,
  edgeState,
} from './schema';

/** Every edge table (named: ESLint G2 forbids namespace imports of schema files). */
const schema = {
  edgeState,
  edgeDevices,
  edgeSequences,
  edgeShifts,
  edgeSales,
  edgeOutbox,
  edgePinAttempts,
  edgeReceipts,
};

export const EDGE_DB = Symbol('EDGE_DB');
export const EDGE_DB_POOL = Symbol('EDGE_DB_POOL');

export type EdgeDb = NodePgDatabase<typeof schema> & { $client: Pool };
export type EdgeTx = Parameters<Parameters<EdgeDb['transaction']>[0]>[0];

/** The edge's Drizzle database over its own pool (never the centre's). */
export function createEdgeDb(pool: Pool): EdgeDb {
  return drizzle({ client: pool, schema });
}

/** Runs `work` in one READ COMMITTED transaction; never call the centre inside it (TX_GUARD). */
export function inEdgeTransaction<T>(db: EdgeDb, work: (tx: EdgeTx) => Promise<T>): Promise<T> {
  return db.transaction(work, { isolationLevel: 'read committed' });
}

@Injectable()
class EdgeDbLifecycle implements OnApplicationShutdown {
  private ended = false;

  constructor(@Inject(EDGE_DB_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: EDGE_DB_POOL,
      inject: [EdgeConfig],
      useFactory: (config: EdgeConfig): Pool => {
        configurePgTypeParsers();
        return new Pool({
          connectionString: config.get('EDGE_DATABASE_URL'),
          max: config.get('EDGE_DB_POOL_MAX'),
          application_name: 'tugeel-edge',
          connectionTimeoutMillis: 5_000,
          idleTimeoutMillis: 30_000,
        });
      },
    },
    { provide: EDGE_DB, inject: [EDGE_DB_POOL], useFactory: createEdgeDb },
    EdgeDbLifecycle,
  ],
  exports: [EDGE_DB, EDGE_DB_POOL],
})
export class EdgeDbModule {}
