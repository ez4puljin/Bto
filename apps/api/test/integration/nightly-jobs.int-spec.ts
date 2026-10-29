import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, addMonths, businessDate, businessMonthStart } from '@tugeel/shared/time';
import type { Client } from 'pg';
import type { PgBoss } from 'pg-boss';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import type { JobName } from '../../src/common/jobs/job-registry';
import { PG_BOSS } from '../../src/common/jobs/pg-boss.provider';
import { StorageService } from '../../src/modules/identity';
import { HousekeepingService } from '../../src/modules/identity/services/housekeeping.service';
import { ImportsHousekeepingService } from '../../src/modules/imports/services/imports-housekeeping.service';
import { StockPostingService } from '../../src/modules/inventory';
import { connectAs, createHttpApp, createWorker, sqlStateOf, waitFor } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import {
  expectReconciled,
  inventoryApi,
  postReceipt,
  type WarehouseJson,
} from '../harness/inventory';
import { partnersApi } from '../harness/partners';

const DENIED = '42501';
const PARENTS = ['stock_snapshot_daily', 'stock_snapshot_bin_monthly'] as const;
const NIGHTLY: readonly JobName[] = [
  'inventory.reconcile',
  'inventory.snapshotMonthly',
  'imports.housekeeping',
  'identity.housekeeping',
  'finance.reconcile',
];

/** `stock_snapshot_daily_p2026_10` for 2026-10-01. */
const partitionOf = (parent: string, month: string) =>
  `${parent}_p${month.slice(0, 4)}_${month.slice(5, 7)}`;

/**
 * The nightly jobs (ADR-0040, SPEC §8.2 #5–#6): the monthly bin snapshot and the snapshot
 * partitions, identity's and imports' housekeeping, and the worker that schedules and runs them.
 */
describe('nightly jobs', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let migrator: Client;
  let posting: StockPostingService;
  let admin: string;
  let adminId: number;
  let wh: WarehouseJson;
  let cola: ProductJson;
  const bins: Record<string, number> = {};
  /** Ulaanbaatar dates by the database clock. */
  let today: string;
  let thisMonth: string;
  const root = process.env.STORAGE_LOCAL_DIR ?? '';
  const http = () => request(app.getHttpServer());

  const binId = (code: string) => {
    const id = bins[code];
    if (id === undefined) throw new Error(`no bin ${code}`);
    return id;
  };
  const binSnapshot = async (date: string) =>
    (
      await sql.query<{ bin_id: string; on_hand: string }>(
        `SELECT bin_id::text, on_hand::text FROM stock_snapshot_bin_monthly
          WHERE snapshot_date = $1 ORDER BY stock_snapshot_bin_monthly.bin_id`,
        [date],
      )
    ).rows;
  const partitionsOf = async (parent: string) =>
    (
      await sql.query<{ name: string }>(
        `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = $1::regclass ORDER BY 1`,
        [parent],
      )
    ).rows.map((row) => row.name);
  const exists = (path: string) =>
    access(path).then(
      () => true,
      () => false,
    );

  /** A files row as the upload flow leaves it, with bytes on disk when it was uploaded. */
  async function storedFile(options: {
    status: 'PENDING' | 'READY' | 'DELETED';
    uploaded: boolean;
    age: string;
    kind?: 'imports.source' | 'catalog.product_image';
  }): Promise<{ id: string; path: string }> {
    const kind = options.kind ?? 'imports.source';
    const [extension, contentType, visibility] =
      kind === 'imports.source'
        ? ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'private']
        : ['jpg', 'image/jpeg', 'public'];
    const key = `${randomUUID()}.${extension}`;
    const { rows } = await sql.query<{ id: string }>(
      `INSERT INTO files (key, kind, content_type, size_bytes, sha256, status, owner_id, uploaded_at,
                          created_at, updated_at)
       VALUES ($1, $2, $3, 5, $4, $5, $6, $7, now() - $8::interval, now() - $8::interval)
       RETURNING id::text`,
      [
        key,
        kind,
        contentType,
        options.uploaded ? 'a'.repeat(64) : null,
        options.status,
        adminId,
        options.uploaded ? new Date(Date.now() - 60_000) : null,
        options.age,
      ],
    );
    const path = join(root, visibility, key);
    if (options.uploaded) {
      await mkdir(join(root, visibility), { recursive: true });
      await writeFile(path, 'bytes');
    }
    const id = rows[0]?.id;
    if (!id) throw new Error('file insert returned no row');
    return { id, path };
  }

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    migrator = await connectAs('migrator');
    posting = app.get(StockPostingService);
    const user = await seedUser(app, { roles: ['ADMIN'] });
    adminId = user.id;
    admin = (await login(app, user)).accessToken;
    const inventory = inventoryApi(app, admin);
    wh = await inventory.warehouse('WH1');
    for (const code of ['A-01-01', 'A-01-02']) bins[code] = (await inventory.bin(wh.id, code)).id;
    const catalog = catalogApi(app, admin);
    cola = await catalog.product({
      sku: '10',
      name: 'Кока кола',
      categoryId: await catalog.category('Ундаа'),
      baseUomId: await catalog.uomId('PCS'),
      units: [{ uomId: await catalog.uomId('BOX'), factorToBase: '24' }],
    });
    await inventory.homeShelf(cola.id, wh.id, binId('A-01-01'));
    const supplierId = (await partnersApi(app, admin).supplier({ name: 'МСМ ХХК' })).id;
    const receipt = await http()
      .post('/api/v1/receipts')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        supplierId,
        lines: [{ productUnitId: unitOf(cola, 'BOX').id, enteredQty: '2' }],
      })
      .expect(201);
    await postReceipt(app, admin, (receipt.body as { id: number }).id);
    const { rows } = await sql.query<{ now: Date }>('SELECT now() AS now');
    const now = rows[0]?.now ?? new Date();
    today = businessDate(now);
    thisMonth = businessMonthStart(now);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await migrator.end();
    await sql.end();
    await app.close();
  });

  it('takes a month bin snapshot from the ledger, exact however late it runs', async () => {
    const nextMonth = addMonths(thisMonth, 1);
    expect(await posting.snapshotBins(nextMonth)).toEqual({ snapshotDate: nextMonth, rows: 1 });
    expect(await binSnapshot(nextMonth)).toEqual([
      { bin_id: String(binId('A-01-01')), on_hand: '48.000' },
    ]);
    // Today's movements are dated on or after this month's first day, so they are left out.
    expect(await posting.snapshotBins()).toEqual({ snapshotDate: thisMonth, rows: 0 });

    await http()
      .post('/api/v1/bin-moves')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId: wh.id,
        lines: [
          {
            productUnitId: unitOf(cola, 'PCS').id,
            enteredQty: '48',
            fromBinId: binId('A-01-01'),
            toBinId: binId('A-01-02'),
          },
        ],
      })
      .expect(201);
    // Running the month again rewrites it; the emptied shelf reads 0, not its old balance.
    expect(await posting.snapshotBins(nextMonth)).toEqual({ snapshotDate: nextMonth, rows: 2 });
    expect(await binSnapshot(nextMonth)).toEqual([
      { bin_id: String(binId('A-01-01')), on_hand: '0.000' },
      { bin_id: String(binId('A-01-02')), on_hand: '48.000' },
    ]);
    const { rows: cache } = await sql.query<{ bin_id: string; on_hand: string }>(
      `SELECT bin_id::text, on_hand::text FROM bin_stock WHERE on_hand <> 0 ORDER BY bin_stock.bin_id`,
    );
    expect(cache).toEqual((await binSnapshot(nextMonth)).filter((row) => row.on_hand !== '0.000'));
    await expect(posting.snapshotBins(addDays(nextMonth, 1))).rejects.toThrow('first day');
  });

  it('keeps the snapshot partitions 24 months ahead and 13 back, out of reach of app', async () => {
    const tooOld = addMonths(thisMonth, -14);
    const oldestKept = addMonths(thisMonth, -13);
    for (const parent of PARENTS) {
      for (const month of [tooOld, oldestKept]) {
        await migrator.query(
          `CREATE TABLE IF NOT EXISTS ${partitionOf(parent, month)} PARTITION OF ${parent}
             FOR VALUES FROM ('${month}') TO ('${addMonths(month, 1)}')`,
        );
      }
    }
    const first = await posting.maintainSnapshotPartitions();
    expect(first.dropped).toBeGreaterThanOrEqual(2);
    for (const parent of PARENTS) {
      const names = await partitionsOf(parent);
      for (let ahead = 0; ahead <= 24; ahead += 1) {
        expect(names).toContain(partitionOf(parent, addMonths(thisMonth, ahead)));
      }
      expect(names).toContain(partitionOf(parent, oldestKept));
      expect(names).not.toContain(partitionOf(parent, tooOld));
    }
    expect(await posting.maintainSnapshotPartitions()).toEqual({ created: 0, dropped: 0 });

    // A partition the function made refuses app DELETE and TRUNCATE like those of the migration.
    const newest = partitionOf('stock_snapshot_daily', addMonths(thisMonth, 24));
    const { rows } = await sql.query<Record<string, boolean>>(
      `SELECT has_table_privilege($1, 'SELECT') AS read, has_table_privilege($1, 'INSERT') AS write,
              has_table_privilege($1, 'DELETE') AS remove, has_table_privilege($1, 'TRUNCATE') AS wipe`,
      [newest],
    );
    expect(rows[0]).toEqual({ read: true, write: true, remove: false, wipe: false });
    // app can neither make nor drop a partition itself.
    expect(
      await sqlStateOf(
        sql.query(
          `CREATE TABLE stock_snapshot_daily_p2099_01 PARTITION OF stock_snapshot_daily
             FOR VALUES FROM ('2099-01-01') TO ('2099-02-01')`,
        ),
      ),
    ).toBe(DENIED);
    expect(await sqlStateOf(sql.query(`DROP TABLE ${newest}`))).toBe(DENIED);
  });

  it('deletes old sessions, codes, idempotency keys and abandoned files; keeps the rest', async () => {
    await sql.query(
      `INSERT INTO auth_sessions (user_id, token_hash, created_at, last_used_at, expires_at,
                                  revoked_at, revoked_reason)
       VALUES ($1, 'expired-100d', now() - interval '107 days', now() - interval '107 days',
               now() - interval '100 days', NULL, NULL),
              ($1, 'revoked-95d', now() - interval '96 days', now() - interval '96 days',
               now() + interval '1 day', now() - interval '95 days', 'LOGOUT'),
              ($1, 'expired-80d', now() - interval '87 days', now() - interval '87 days',
               now() - interval '80 days', NULL, NULL),
              ($1, 'revoked-10d', now() - interval '11 days', now() - interval '11 days',
               now() + interval '1 day', now() - interval '10 days', 'LOGOUT')`,
      [adminId],
    );
    await sql.query(
      `INSERT INTO password_resets (user_id, code_hash, created_at, expires_at, revoked_at)
       VALUES ($1, 'code-40d', now() - interval '41 days', now() - interval '40 days',
               now() - interval '40 days'),
              ($1, 'code-10d', now() - interval '11 days', now() - interval '10 days',
               now() - interval '10 days')`,
      [adminId],
    );
    await sql.query(
      `INSERT INTO idempotency_keys (actor_kind, actor_id, key, method, path, request_hash, status,
                                     response_status, response_body, created_at, completed_at)
       VALUES ('STAFF', $1, gen_random_uuid(), 'POST', '/api/v1/old', 'h', 'COMPLETED', 201, '{}',
               now() - interval '8 days', now() - interval '8 days'),
              ('STAFF', $1, gen_random_uuid(), 'POST', '/api/v1/stuck', 'h', 'IN_PROGRESS', NULL, NULL,
               now() - interval '8 days', NULL),
              ('STAFF', $1, gen_random_uuid(), 'POST', '/api/v1/recent', 'h', 'COMPLETED', 201, '{}',
               now() - interval '1 day', now() - interval '1 day')`,
      [adminId],
    );
    const neverUploaded = await storedFile({ status: 'PENDING', uploaded: false, age: '2 days' });
    const notAttached = await storedFile({ status: 'PENDING', uploaded: true, age: '2 days' });
    const inFlight = await storedFile({ status: 'PENDING', uploaded: false, age: '1 hour' });
    const removed = await storedFile({
      status: 'DELETED',
      uploaded: true,
      age: '3 days',
      kind: 'catalog.product_image',
    });
    const kept = await storedFile({ status: 'READY', uploaded: true, age: '3 days' });

    const housekeeping = new HousekeepingService(app.get<Db>(DB), app.get(StorageService));
    expect(await housekeeping.run()).toEqual({
      sessions: 2,
      passwordCodes: 1,
      idempotencyKeys: 2,
      filesRemoved: 1,
      filesAbandoned: 1,
      filesPurged: 2,
    });
    const sessions = await sql.query<{ token_hash: string }>(
      `SELECT token_hash FROM auth_sessions WHERE token_hash IN
         ('expired-100d', 'revoked-95d', 'expired-80d', 'revoked-10d') ORDER BY 1`,
    );
    expect(sessions.rows.map((row) => row.token_hash)).toEqual(['expired-80d', 'revoked-10d']);
    const codes = await sql.query<{ code_hash: string }>(`SELECT code_hash FROM password_resets`);
    expect(codes.rows.map((row) => row.code_hash)).toEqual(['code-10d']);
    const keys = await sql.query<{ path: string }>(
      `SELECT path FROM idempotency_keys WHERE path IN ('/api/v1/old', '/api/v1/stuck', '/api/v1/recent')`,
    );
    expect(keys.rows.map((row) => row.path)).toEqual(['/api/v1/recent']);
    const files = await sql.query<{ id: string; status: string; purged: boolean }>(
      `SELECT id::text, status, purged_at IS NOT NULL AS purged FROM files ORDER BY files.id`,
    );
    expect(files.rows).toEqual([
      { id: notAttached.id, status: 'DELETED', purged: true },
      { id: inFlight.id, status: 'PENDING', purged: false },
      { id: removed.id, status: 'DELETED', purged: true },
      { id: kept.id, status: 'READY', purged: false },
    ]);
    expect(files.rows.map((row) => row.id)).not.toContain(neverUploaded.id);
    expect(await exists(notAttached.path)).toBe(false);
    expect(await exists(removed.path)).toBe(false);
    expect(await exists(kept.path)).toBe(true);
    // A second night finds nothing left to do.
    expect(await housekeeping.run()).toEqual({
      sessions: 0,
      passwordCodes: 0,
      idempotencyKeys: 0,
      filesRemoved: 0,
      filesAbandoned: 0,
      filesPurged: 0,
    });
  });

  it('prunes the rows of old unsuccessful imports and lets year-old sheets go', async () => {
    const job = async (
      status: string,
      age: string,
      rows: number,
      extra: Record<string, string> = {},
    ) => {
      const file = await storedFile({ status: 'READY', uploaded: true, age });
      const committed = ['COMMITTED', 'REVERTED'].includes(status);
      const { rows: inserted } = await sql.query<{ id: string }>(
        `INSERT INTO import_jobs (kind, file_id, file_name, status, summary, created_by, created_at,
                                  updated_at, committed_at, committed_by, reverted_at, reverted_by)
         VALUES ('PRODUCTS', $1, 'бараа.xlsx', $2, $3, $4, now() - $5::interval, now() - $5::interval,
                 CASE WHEN $6 THEN now() - $5::interval END, CASE WHEN $6 THEN $4::bigint END,
                 CASE WHEN $2 = 'REVERTED' THEN now() - $5::interval END,
                 CASE WHEN $2 = 'REVERTED' THEN $4::bigint END)
         RETURNING id::text`,
        [file.id, status, { actions: { CREATE: rows }, ...extra }, adminId, age, committed],
      );
      const id = inserted[0]?.id ?? '';
      for (let rowNo = 2; rowNo < rows + 2; rowNo += 1) {
        await sql.query(`INSERT INTO import_rows (job_id, row_no, raw) VALUES ($1, $2, '{}')`, [
          id,
          rowNo,
        ]);
      }
      return { id, file };
    };
    const invalidOld = await job('INVALID', '100 days', 2);
    const revertedOld = await job('REVERTED', '100 days', 2);
    const committedOld = await job('COMMITTED', '100 days', 2);
    const invalidRecent = await job('INVALID', '10 days', 2);
    const yearOld = await job('COMMITTED', '400 days', 1);
    const stillUploading = await job('UPLOADED', '400 days', 0);

    const housekeeping = new ImportsHousekeepingService(app.get<Db>(DB), app.get(StorageService));
    expect(await housekeeping.run()).toEqual({ jobsPruned: 2, rowsDeleted: 4, sheetsDeleted: 1 });
    const { rows: left } = await sql.query<{ job_id: string; count: string }>(
      `SELECT job_id::text, count(*)::text AS count FROM import_rows
        GROUP BY import_rows.job_id ORDER BY import_rows.job_id`,
    );
    expect(left).toEqual([
      { job_id: committedOld.id, count: '2' },
      { job_id: invalidRecent.id, count: '2' },
      { job_id: yearOld.id, count: '1' },
    ]);
    const { rows: files } = await sql.query<{ id: string; status: string }>(
      `SELECT id::text, status FROM files WHERE id = ANY($1::bigint[]) ORDER BY files.id`,
      [[yearOld.file.id, stillUploading.file.id, invalidOld.file.id]],
    );
    expect(files).toEqual([
      { id: invalidOld.file.id, status: 'READY' },
      { id: yearOld.file.id, status: 'DELETED' },
      { id: stillUploading.file.id, status: 'READY' },
    ]);

    // The import pages say what went; the summary keeps what it said before.
    const shown = await http()
      .get(`/api/v1/imports/${invalidOld.id}`)
      .set(bearer(admin))
      .expect(200);
    expect(shown.body.summary).toEqual({ actions: { CREATE: 2 }, rowsPruned: true });
    const rows = await http()
      .get(`/api/v1/imports/${invalidOld.id}/rows`)
      .query({ filter: 'ALL' })
      .set(bearer(admin))
      .expect(200);
    expect(rows.body.data).toEqual([]);
    const sheet = await http().get(`/api/v1/imports/${yearOld.id}`).set(bearer(admin)).expect(200);
    expect(sheet.body.summary).toMatchObject({ sheetDeleted: true });
    expect(
      (await http().get(`/api/v1/imports/${revertedOld.id}`).set(bearer(admin))).body,
    ).toMatchObject({ status: 'REVERTED', summary: { rowsPruned: true } });

    // identity's housekeeping removes the sheet's bytes the same night.
    expect(await exists(yearOld.file.path)).toBe(true);
    const identity = new HousekeepingService(app.get<Db>(DB), app.get(StorageService));
    expect(await identity.run()).toMatchObject({ filesPurged: 1 });
    expect(await exists(yearOld.file.path)).toBe(false);
    expect(await housekeeping.run()).toEqual({ jobsPruned: 0, rowsDeleted: 0, sheetsDeleted: 0 });
  });

  describe('worker', () => {
    let worker: INestApplicationContext;
    const sent = new Map<JobName, string>();

    beforeAll(async () => {
      // Sent before the worker starts, so its first fetch takes them at once (it polls every 10 s).
      const boss = app.get<PgBoss>(PG_BOSS);
      for (const name of NIGHTLY) {
        const id = await boss.send(name, null);
        if (id) sent.set(name, id);
      }
      worker = await createWorker();
    });
    afterAll(async () => {
      await worker.close();
    });

    it('schedules the nightly jobs in Ulaanbaatar time, catching up once after a gap', async () => {
      const schedules = await worker.get<PgBoss>(PG_BOSS).getSchedules();
      expect(
        schedules
          .map((schedule) => ({
            name: schedule.name,
            cron: schedule.cron,
            timezone: schedule.timezone,
            missed: schedule.options?.missed,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ).toEqual([
        {
          name: 'finance.reconcile',
          cron: '15 3 * * *',
          timezone: 'Asia/Ulaanbaatar',
          missed: 'once',
        },
        {
          name: 'identity.housekeeping',
          cron: '30 4 * * *',
          timezone: 'Asia/Ulaanbaatar',
          missed: 'once',
        },
        {
          name: 'imports.housekeeping',
          cron: '0 4 * * *',
          timezone: 'Asia/Ulaanbaatar',
          missed: 'once',
        },
        {
          name: 'inventory.reconcile',
          cron: '0 3 * * *',
          timezone: 'Asia/Ulaanbaatar',
          missed: 'once',
        },
        {
          name: 'inventory.snapshotMonthly',
          cron: '30 3 1 * *',
          timezone: 'Asia/Ulaanbaatar',
          missed: 'once',
        },
        // The customer app's invoice reminders (ADR-0079 #8): a morning, not a night.
        {
          name: 'notifications.invoiceReminders',
          cron: '0 9 * * *',
          timezone: 'Asia/Ulaanbaatar',
          missed: 'once',
        },
        // The management reports' daily totals (ADR-0108 #6): every 15 minutes, day and night.
        {
          name: 'reporting.refresh',
          cron: '*/15 * * * *',
          timezone: 'Asia/Ulaanbaatar',
          missed: 'once',
        },
      ]);
    });

    it('runs every nightly job to completion', async () => {
      const boss = worker.get<PgBoss>(PG_BOSS);
      const outputs = new Map<JobName, unknown>();
      for (const name of NIGHTLY) {
        const id = sent.get(name) ?? '';
        const job = await waitFor(async () => {
          const [found] = await boss.findJobs(name, { id });
          return found?.state === 'completed' ? found : undefined;
        });
        outputs.set(name, job.output);
      }
      expect(outputs.get('inventory.reconcile')).toMatchObject({
        status: 'OK',
        diffCount: 0,
        snapshotDate: today,
      });
      expect(outputs.get('inventory.snapshotMonthly')).toEqual({
        created: 0,
        dropped: 0,
        snapshotDate: thisMonth,
        rows: 0,
      });
      expect(outputs.get('imports.housekeeping')).toEqual({
        jobsPruned: 0,
        rowsDeleted: 0,
        sheetsDeleted: 0,
      });
      expect(outputs.get('identity.housekeeping')).toMatchObject({ sessions: 0, filesPurged: 0 });
      // The receivables cache of an empty ledger: nothing to check, nothing drifted (ADR-0060 #4).
      expect(outputs.get('finance.reconcile')).toMatchObject({
        status: 'OK',
        checked: 0,
        drifted: 0,
      });
      const { rows } = await sql.query<{ triggered_by: string; on_hand: string }>(
        `SELECT r.triggered_by, d.on_hand::text
           FROM reconciliation_runs r
           JOIN stock_snapshot_daily d ON d.snapshot_date = $1 AND d.product_id = $2
          ORDER BY r.id DESC LIMIT 1`,
        [today, cola.id],
      );
      expect(rows).toEqual([{ triggered_by: 'NIGHTLY', on_hand: '48.000' }]);
    });
  });
});
