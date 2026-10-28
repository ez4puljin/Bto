import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { posActors, posStore, saleDoc, saleEvent } from '../harness/pos';

/**
 * The database guards of the POS (ADR-0063, migration 0027): documents are never deleted, the
 * tenders and the void log (ADR-0104) are never changed by app or by the owner, and a lottery or a
 * QR has no column to land in.
 */
describe('pos guards', () => {
  let app: NestExpressApplication;
  let asApp: Client;
  let migrator: Client;
  let saleId: number;
  let shiftId: number;

  beforeAll(async () => {
    app = await createHttpApp();
    asApp = await connectAs('app');
    migrator = await connectAs('migrator');
    const actors = await posActors(app);
    const store = await posStore(app, actors.admin, 'PG');
    const cola = await store.product('9301', 'Кола', '1000', '5');
    const { clientId, shift } = await store.openShift('1000');
    shiftId = shift.id;
    const doc = saleDoc(
      [{ product: cola, qty: '1' }],
      {
        tillCode: store.till.code,
        shiftClientId: clientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    const [outcome] = await store.replay([saleEvent(doc)]);
    if (!outcome?.id) throw new Error('no sale');
    saleId = outcome.id;
  });
  afterAll(async () => {
    await asApp.end();
    await migrator.end();
    await app.close();
  });

  it('lets app neither delete a document nor change a tender', async () => {
    expect(await sqlStateOf(asApp.query('DELETE FROM pos_sales WHERE id = $1', [saleId]))).toBe(
      '42501',
    );
    expect(
      await sqlStateOf(asApp.query('DELETE FROM pos_sale_lines WHERE sale_id = $1', [saleId])),
    ).toBe('42501');
    expect(
      await sqlStateOf(
        asApp.query('UPDATE pos_tenders SET amount = amount WHERE sale_id = $1', [saleId]),
      ),
    ).toBe('42501');
    expect(await sqlStateOf(asApp.query('DELETE FROM pos_shifts WHERE id = $1', [shiftId]))).toBe(
      '42501',
    );
    expect(await sqlStateOf(asApp.query('DELETE FROM pos_cashiers'))).toBe('42501');
    expect(await sqlStateOf(asApp.query('TRUNCATE pos_sync_rejections'))).toBe('42501');
  });

  it('stops even the owner from rewriting a tender', async () => {
    expect(
      await sqlStateOf(
        migrator.query('UPDATE pos_tenders SET amount = amount + 1 WHERE sale_id = $1', [saleId]),
      ),
    ).toBe('23001');
    expect(
      await sqlStateOf(migrator.query('DELETE FROM pos_tenders WHERE sale_id = $1', [saleId])),
    ).toBe('23001');
  });

  it('keeps the void log append-only for app and owner (ADR-0104, migration 0043)', async () => {
    for (const table of ['pos_voids', 'pos_void_lines']) {
      expect(await sqlStateOf(asApp.query(`DELETE FROM ${table}`))).toBe('42501');
      expect(await sqlStateOf(asApp.query(`UPDATE ${table} SET total = total`))).toBe('42501');
      expect(await sqlStateOf(asApp.query(`TRUNCATE ${table}`))).toBe('42501');
    }
    expect(await sqlStateOf(asApp.query('TRUNCATE pos_quick_groups CASCADE'))).toBe('42501');
    const [tenderTriggers, voidTriggers] = await Promise.all(
      ['pos_tenders', 'pos_voids'].map(
        async (table) =>
          (
            await migrator.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM pg_trigger
              WHERE tgrelid = $1::regclass AND NOT tgisinternal`,
              [table],
            )
          ).rows[0]?.count,
      ),
    );
    expect(voidTriggers).toBe(tenderTriggers);
  });

  it('never deletes a voucher batch, a code or a use (ADR-0110, migration 0049)', async () => {
    for (const table of ['pos_voucher_batches', 'pos_vouchers', 'pos_sale_vouchers']) {
      expect(await sqlStateOf(asApp.query(`DELETE FROM ${table}`))).toBe('42501');
      expect(await sqlStateOf(asApp.query(`TRUNCATE ${table} CASCADE`))).toBe('42501');
    }
    // A code has the shape the tills scan; a VOUCHER tender names its code.
    expect(
      await sqlStateOf(
        migrator.query(
          `INSERT INTO pos_vouchers (batch_id, seq, code) VALUES (1, 1, '4607001771234')`,
        ),
      ),
    ).toBe('23514');
    expect(
      await sqlStateOf(
        migrator.query(
          `INSERT INTO pos_tenders (sale_id, tender_no, kind, amount) VALUES ($1, 9, 'VOUCHER', 1)`,
          [saleId],
        ),
      ),
    ).toBe('23514');
  });

  it('has no column for a lottery or a QR', async () => {
    const columns = await migrator.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name LIKE 'pos_%'`,
    );
    const names = columns.rows.map((row) => row.column_name.toLowerCase());
    expect(names.some((name) => name.includes('lottery') || name.includes('qr'))).toBe(false);
  });
});
