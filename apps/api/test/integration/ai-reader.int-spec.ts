import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import { businessDate } from '@tugeel/shared/time';
import { AppConfig } from '../../src/common/config/app-config';
import { EXAMPLES } from '../../src/modules/ai/semantic/prompt';
import {
  AiQueryError,
  AiReaderService,
  type AiRow,
} from '../../src/modules/ai/sql/ai-reader.service';
import { connectAs, createHttpApp, waitFor } from '../harness/apps';
import { catalogApi } from '../harness/catalog';
import { login, seedUser } from '../harness/identity';

const PRODUCTS = 30;

async function failure(promise: Promise<unknown>): Promise<AiQueryError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AiQueryError) return error;
    throw error;
  }
  throw new Error('expected an AiQueryError');
}

/** The read-only executor of the AI assistant (ADR-0045 #5) against real PostgreSQL. */
describe('AiReaderService', () => {
  let app: NestExpressApplication;
  let reader: AiReaderService;
  let admin: Client;

  beforeAll(async () => {
    app = await createHttpApp();
    reader = new AiReaderService(app.get(AppConfig));
    admin = await connectAs('admin');
    const token = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const catalog = catalogApi(app, token);
    const category = await catalog.category('Ундаа');
    const pcs = await catalog.uomId('PCS');
    for (let index = 1; index <= PRODUCTS; index += 1) {
      await catalog.product({
        sku: String(100 + index),
        name: `Бараа ${index}`,
        categoryId: category,
        baseUomId: pcs,
      });
    }
  });
  afterAll(async () => {
    await reader.onApplicationShutdown();
    await admin.end();
    await app.close();
  });

  it('runs a guarded query with typed columns and the database text', async () => {
    const result = await reader.run(
      `SELECT sku AS "Код", name, ready_for_sale, created_at::date AS day, 1.50::numeric AS n
         FROM products ORDER BY sku LIMIT 2`,
    );
    expect(result.columns).toEqual([
      { name: 'Код', kind: 'text' },
      { name: 'name', kind: 'text' },
      { name: 'ready_for_sale', kind: 'boolean' },
      { name: 'day', kind: 'date' },
      { name: 'n', kind: 'number' },
    ]);
    expect(result.rows).toEqual([
      ['101', 'Бараа 1', 'f', businessDate(), '1.50'],
      ['102', 'Бараа 2', 'f', businessDate(), '1.50'],
    ]);
    expect(result.truncated).toBe(false);
  });

  it('cuts at the limit and says so', async () => {
    const cut = await reader.run('SELECT id FROM products ORDER BY id', {
      maxRows: 5,
      timeoutMs: 5_000,
    });
    expect(cut.rows).toHaveLength(5);
    expect(cut.truncated).toBe(true);
    const whole = await reader.run('SELECT id FROM products', { maxRows: 100, timeoutMs: 5_000 });
    expect(whole.rows).toHaveLength(PRODUCTS);
    expect(whole.truncated).toBe(false);
    const none = await reader.run("SELECT id FROM products WHERE name = 'байхгүй'");
    expect(none).toEqual({ columns: [{ name: 'id', kind: 'number' }], rows: [], truncated: false });
  });

  it('streams an export in batches up to its limit', async () => {
    const batches: AiRow[][] = [];
    const outcome = await reader.stream(
      'SELECT sku FROM products ORDER BY sku',
      { maxRows: 25, timeoutMs: 5_000 },
      (_columns, rows) => {
        batches.push(rows);
      },
    );
    expect(outcome).toEqual({ rowCount: 25, truncated: true });
    expect(batches.flat()).toHaveLength(25);
  });

  it.each(Object.entries(EXAMPLES))(
    'runs the worked example %s of the prompt',
    async (_key, sql) => {
      await expect(reader.run(sql)).resolves.toMatchObject({ truncated: false });
    },
  );

  it('uses the Ulaanbaatar business date', async () => {
    const result = await reader.run('SELECT current_date::text AS today');
    expect(result.rows).toEqual([[businessDate()]]);
  });

  it('refuses before the database sees the query', async () => {
    const error = await failure(reader.run('SELECT * FROM users'));
    expect(error).toMatchObject({ source: 'GUARD', code: 'RELATION', repairable: true });
  });

  it('reports a mistake in the query as repairable', async () => {
    const error = await failure(reader.run('SELECT nope FROM products'));
    expect(error).toMatchObject({ source: 'DATABASE', code: '42703', repairable: true });
    expect(error.message).toContain('nope');
  });

  it('stops a slow query at its timeout and never asks for a repair', async () => {
    const error = await failure(
      reader.run(
        `SELECT count(*) FROM products a, products b, products c, products d, products e`,
        { maxRows: 10, timeoutMs: 300 },
      ),
    );
    expect(error).toMatchObject({ source: 'DATABASE', code: '57014', repairable: false });
  });

  it('leaves no connection behind', async () => {
    await reader.run('SELECT 1 AS one');
    await waitFor(async () => {
      const { rows } = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_stat_activity
          WHERE application_name = 'tugeel-ai' AND datname = current_database()`,
      );
      return rows[0]?.count === '0' ? true : undefined;
    }, 5_000);
  });
});
