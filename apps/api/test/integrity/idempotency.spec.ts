import { Controller, Inject, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import {
  Authenticated,
  Idempotent,
  IdentityModule,
  NumberingService,
} from '../../src/modules/identity';
import { connectAs, createHttpApp } from '../harness/apps';
import { bearer, login, seedUser } from '../harness/identity';

@Controller('probe-documents')
class SlowDocumentProbe {
  constructor(
    private readonly numbering: NumberingService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Post()
  @Authenticated()
  @Idempotent()
  async create() {
    const value = await inTransaction(this.db, (tx) => this.numbering.next(tx, 'IDEM', '2026'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { value };
  }
}

/** Concurrent retries with one Idempotency-Key create exactly one document (ADR-0002 #6). */
describe('integrity: idempotent document creation', () => {
  let app: NestExpressApplication;
  let sql: Client;

  beforeAll(async () => {
    app = await createHttpApp({ controllers: [SlowDocumentProbe], imports: [IdentityModule] });
    await app.listen(0, '127.0.0.1');
    sql = await connectAs('app');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('runs the handler once for five concurrent requests with the same key', async () => {
    const token = (await login(app, await seedUser(app))).accessToken;
    const key = crypto.randomUUID();
    const server = app.getHttpServer();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(server)
          .post('/api/v1/probe-documents')
          .set(bearer(token))
          .set('Idempotency-Key', key)
          .send({}),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
    for (const response of responses.filter((r) => r.status === 409)) {
      expect(response.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_IN_PROGRESS' });
    }
    const { rows } = await sql.query<{ last_value: string }>(
      `SELECT last_value::text FROM number_sequences WHERE scope_key = 'IDEM'`,
    );
    expect(rows).toEqual([{ last_value: '1' }]);
    const replay = await request(server)
      .post('/api/v1/probe-documents')
      .set(bearer(token))
      .set('Idempotency-Key', key)
      .send({})
      .expect(201);
    expect(replay.body).toEqual({ value: 1 });
  });
});
