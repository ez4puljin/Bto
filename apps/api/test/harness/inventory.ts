import { randomInt } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { StockPostingService } from '../../src/modules/inventory';
import { bearer } from './identity';

export interface BinJson {
  id: number;
  warehouseId: number;
  code: string;
  name: string | null;
  type: string;
  sellable: boolean;
  status: 'ACTIVE' | 'COUNTING';
  isSystem: boolean;
  archivedAt: string | null;
}

export interface WarehouseJson {
  id: number;
  code: string;
  name: string;
  kind: string;
}

/** HTTP helpers for inventory tests, acting as the user behind `token` (an admin by default). */
export function inventoryApi(app: NestExpressApplication, token: string) {
  const http = () => request(app.getHttpServer());
  const auth = bearer(token);
  let branchId: number | undefined;

  async function branch(): Promise<number> {
    if (branchId !== undefined) return branchId;
    const response = await http()
      .post('/api/v1/branches')
      .set(auth)
      .send({
        code: `B${Date.now().toString(36).toUpperCase()}${randomInt(1000, 9999)}`,
        name: 'Төв салбар',
      })
      .expect(201);
    branchId = (response.body as { id: number }).id;
    return branchId;
  }

  return {
    http,
    auth,
    async warehouse(
      code: string,
      kind: 'WHOLESALE' | 'STORE' = 'WHOLESALE',
    ): Promise<WarehouseJson> {
      // Resolve the branch first: a supertest request listens until it ends, and a nested one would
      // close the shared server under it.
      const branchId = await branch();
      const response = await http()
        .post('/api/v1/warehouses')
        .set(auth)
        .send({ code, name: `Агуулах ${code}`, kind, branchId })
        .expect(201);
      return response.body as WarehouseJson;
    },
    async bins(warehouseId: number, query: Record<string, string> = {}): Promise<BinJson[]> {
      const response = await http()
        .get('/api/v1/bins')
        .query({ warehouseId, limit: 200, ...query })
        .set(auth)
        .expect(200);
      return (response.body as { data: BinJson[] }).data;
    },
    async bin(warehouseId: number, code: string, type = 'STORAGE'): Promise<BinJson> {
      const response = await http()
        .post('/api/v1/bins')
        .set(auth)
        .send({ warehouseId, code, type })
        .expect(201);
      return response.body as BinJson;
    },
    async systemBin(warehouseId: number, type: string): Promise<BinJson> {
      const found = (await this.bins(warehouseId, { type })).find((bin) => bin.isSystem);
      if (!found) throw new Error(`no ${type} bin in warehouse ${warehouseId}`);
      return found;
    },
    async setHome(productId: number, warehouseId: number | null): Promise<void> {
      await http()
        .put('/api/v1/product-locations/home')
        .set(auth)
        .send({ productId, warehouseId })
        .expect(200);
    },
  };
}

/** Fails the test unless the ledger and both balance caches agree (run after every inventory file). */
export async function expectReconciled(app: INestApplicationContext): Promise<void> {
  const run = await app.get(StockPostingService).reconcile('TEST');
  expect(run.diffs).toEqual([]);
}
