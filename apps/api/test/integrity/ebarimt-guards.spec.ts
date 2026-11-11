import type { NestExpressApplication } from '@nestjs/platform-express';
import type { RelayResultWire } from '@tugeel/shared/mn';
import { Decimal } from '@tugeel/shared/money';
import type { Client } from 'pg';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import {
  EbarimtReceiptsService,
  EbarimtRelayService,
  type PrepareRequest,
  ReceiptSecretsCache,
} from '../../src/modules/ebarimt';
import { systemActor } from '../../src/modules/identity';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';

/**
 * The guards of the wholesale e-Barimt receipts (ADR-0185, migration 0100): a receipt row is never
 * deleted, a confirmed one names its ДДТД, the stage switch lives on SALE stages only, the lottery
 * and QR data have no column to land in, and the relay hands a receipt to one edge and applies a
 * result once however the calls race. Synthetic data only.
 */
describe('ebarimt guards', () => {
  let app: NestExpressApplication;
  let asApp: Client;
  let migrator: Client;
  let db: Db;
  let receipts: EbarimtReceiptsService;
  let relay: EbarimtRelayService;
  const actor = systemActor('test');
  let docId = 0;

  const request = (): PrepareRequest => {
    docId += 1;
    return {
      source: {
        companyCode: 'BO',
        system: 'BTO',
        docType: 'SALES_INVOICE',
        docId: String(docId),
      },
      docNumber: `Н-TEST-${String(docId).padStart(4, '0')}`,
      orderNumber: null,
      buyerName: 'Туршилтын иргэн',
      buyer: { kind: 'INDIVIDUAL', tin: null, consumerNo: null },
      lines: [
        {
          name: 'Туршилтын бараа',
          barCode: null,
          barCodeType: 'UNDEFINED',
          classificationCode: null,
          taxType: 'VAT_ABLE',
          taxProductCode: null,
          measureUnit: 'ш',
          qty: '1.000',
          total: '1100.00',
          vat: '100.00',
          cityTax: '0.00',
        },
      ],
      payments: [{ code: 'CASH', amount: '1100.00' }],
      total: new Decimal('1100'),
      vatTotal: new Decimal('100'),
      cityTaxTotal: new Decimal('0'),
    };
  };
  const prepare = (input: PrepareRequest = request()) =>
    inTransaction(db, (tx) => receipts.prepareInTx(tx, actor, input));
  const issued = (receiptId: number, attempt: number, n: number): RelayResultWire => ({
    receiptId,
    attempt,
    op: 'ISSUE',
    outcome: 'ISSUED',
    ddtd: String(n).padStart(33, '0'),
    posapiDate: '2026-11-11 10:00:00',
    merchantTin: '20000000002',
    merchantName: 'Туршилтын худалдагч',
    errorCode: null,
    message: null,
    lottery: `TEST-LOT-${n}`,
    qrData: `TEST-QR-${n}`,
  });

  beforeAll(async () => {
    app = await createHttpApp();
    asApp = await connectAs('app');
    migrator = await connectAs('migrator');
    db = app.get<Db>(DB);
    receipts = app.get(EbarimtReceiptsService);
    relay = app.get(EbarimtRelayService);
  });
  afterAll(async () => {
    await asApp.end();
    await migrator.end();
    await app.close();
  });

  it('lets app neither delete nor truncate a receipt', async () => {
    const { id } = await prepare();
    expect(await sqlStateOf(asApp.query('DELETE FROM ebarimt_receipts WHERE id = $1', [id]))).toBe(
      '42501',
    );
    expect(await sqlStateOf(asApp.query('TRUNCATE ebarimt_receipts'))).toBe('42501');
  });

  it('refuses a confirmed receipt without its ДДТД, a malformed one and an unknown state', async () => {
    const { id } = await prepare();
    const set = (sql: string) =>
      sqlStateOf(asApp.query(`UPDATE ebarimt_receipts SET ${sql} WHERE id = $1`, [id]));
    expect(await set("status = 'CONFIRMED'")).toBe('23514');
    expect(
      await set("status = 'CONFIRMED', ddtd = 'abc', posapi_date = '2026-11-11 10:00:00'"),
    ).toBe('23514');
    expect(await set("status = 'SENDING'")).toBe('23514');
    expect(await set("status = 'DONE'")).toBe('23514');
    expect(await set("cancel_status = 'CANCELLED'")).toBe('23514');
    expect(await set('total = 0')).toBe('23514');
  });

  it('keeps one receipt per source document and revision', async () => {
    const input = request();
    const { id } = await prepare(input);
    // A second prepare of a receipt that is not in ERROR is refused by the service …
    await expect(prepare(input)).rejects.toMatchObject({ code: 'EBARIMT_RECEIPT_STATE_INVALID' });
    // … and a second row for the same key by the database.
    expect(
      await sqlStateOf(
        asApp.query(
          `INSERT INTO ebarimt_receipts (company_code, source_system, source_doc_type,
             source_doc_id, doc_number, buyer_name, receipt_type, lines, payments, total,
             vat_total, city_tax_total)
           SELECT company_code, source_system, source_doc_type, source_doc_id, doc_number,
             buyer_name, receipt_type, lines, payments, total, vat_total, city_tax_total
           FROM ebarimt_receipts WHERE id = $1`,
          [id],
        ),
      ),
    ).toBe('23505');
  });

  it('keeps the stage switch on SALE stages only, off by default', async () => {
    const column = await migrator.query<{ column_default: string; is_nullable: string }>(
      `SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_name = 'sales_stages' AND column_name = 'ebarimt'`,
    );
    expect(column.rows[0]).toEqual({ column_default: 'false', is_nullable: 'NO' });
    const check = await migrator.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'sales_stages_ebarimt'`,
    );
    expect(check.rows[0]?.def).toMatch(/NOT ebarimt.*action = 'SALE'/);
  });

  it('has no column a lottery or QR data could land in', async () => {
    const columns = await migrator.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ebarimt_receipts' AND column_name ~* 'lotter|qr'`,
    );
    expect(columns.rows).toEqual([]);
  });

  it('hands each receipt to one edge when many ask at once', async () => {
    await migrator.query(
      `UPDATE ebarimt_receipts SET status = 'CANCELLED' WHERE status = 'PENDING'`,
    );
    const ids = [(await prepare()).id, (await prepare()).id, (await prepare()).id];
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        relay.claim({ id: 100 + index, code: `E${index}` }, actor),
      ),
    );
    const handed = claims.flatMap((operation) => (operation ? [operation.receiptId] : []));
    expect([...handed].sort((a, b) => a - b)).toEqual(ids);
    const rows = await migrator.query<{ status: string; attempt: number }>(
      `SELECT status, attempt FROM ebarimt_receipts WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    expect(rows.rows).toEqual(ids.map(() => ({ status: 'SENDING', attempt: 1 })));
    // The edge that holds one is handed the same attempt again; another edge gets nothing.
    const holder = claims.findIndex((operation) => operation?.receiptId === ids[0]);
    const again = await relay.claim({ id: 100 + holder, code: `E${holder}` }, actor);
    expect(again).toMatchObject({ receiptId: ids[0], attempt: 1 });
    expect(await relay.claim({ id: 999, code: 'E999' }, actor)).toBeNull();
  });

  it('applies a result once when the edge repeats it at the same moment', async () => {
    const { id } = await prepare();
    await migrator.query(
      `UPDATE ebarimt_receipts SET status = 'CANCELLED' WHERE status = 'PENDING' AND id <> $1`,
      [id],
    );
    const node = { id: 500, code: 'E500' };
    const operation = await relay.claim(node, actor);
    expect(operation).toMatchObject({ receiptId: id, attempt: 1 });
    const applied = await Promise.all(
      Array.from({ length: 6 }, () => relay.result(node, actor, issued(id, 1, 7))),
    );
    expect(applied.filter(Boolean)).toHaveLength(1);
    const row = await migrator.query<{ status: string; ddtd: string }>(
      `SELECT status, ddtd FROM ebarimt_receipts WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ status: 'CONFIRMED', ddtd: '7'.padStart(33, '0') });
    const audit = await migrator.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log
       WHERE entity = 'ebarimt_receipts' AND entity_id = $1 AND action = 'RESULT'`,
      [String(id)],
    );
    expect(audit.rows[0]?.n).toBe('1');
    // A report of an attempt the centre never made changes nothing and is noted for a person.
    expect(await relay.result(node, actor, issued(id, 9, 8))).toBe(false);
    const noted = await migrator.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log
       WHERE entity = 'ebarimt_receipts' AND entity_id = $1 AND action = 'UNEXPECTED_RECEIPT'`,
      [String(id)],
    );
    expect(noted.rows[0]?.n).toBe('1');
    // The secrets went to memory only: one print, and no row holds them.
    const cache = app.get(ReceiptSecretsCache);
    expect(cache.take(id)).toEqual({ lottery: 'TEST-LOT-7', qrData: 'TEST-QR-7' });
    expect(cache.take(id)).toBeNull();
    const leaked = await migrator.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM ebarimt_receipts t WHERE to_jsonb(t)::text ~ 'TEST-(LOT|QR)-|lottery|qrData')
            + (SELECT count(*) FROM audit_log t WHERE to_jsonb(t)::text ~ 'TEST-(LOT|QR)-|lottery|qrData') AS n`,
    );
    expect(leaked.rows[0]?.n).toBe('0');
  });
});
