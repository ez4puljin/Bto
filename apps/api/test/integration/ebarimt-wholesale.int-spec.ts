import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { RelayOperation } from '@tugeel/shared/mn';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { ebarimtReceipts } from '../../src/db/schema';
import { EDGE_DB, type EdgeDb } from '../../src/edge/db/edge-db';
import { edgeRelayOps } from '../../src/edge/db/schema';
import { WholesaleRelayService } from '../../src/edge/ebarimt/wholesale-relay.service';
import { CentralClient } from '../../src/edge/services/central.client';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { createHttpApp } from '../harness/apps';
import type { ProductJson } from '../harness/catalog';
import { createEdgeApp, edgeDatabase } from '../harness/edge';
import { FAKE_BUYER, FAKE_MERCHANT, FakePosapi } from '../harness/fake-posapi';
import { financeApi, type ProblemJson, salesFlow } from '../harness/finance';
import { bearer } from '../harness/identity';
import { expectReconciled } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { posActors, posStore } from '../harness/pos';

interface ReceiptJson {
  id: number;
  sourceDocId: string;
  docNumber: string;
  buyerName: string;
  receiptType: string;
  status: string;
  errorCode: string | null;
  message: string | null;
  customerTin: string | null;
  total: string;
  attempt: number;
  ddtd: string | null;
  posapiDate: string | null;
  cancelStatus: string | null;
  printable: boolean;
  merchantTin?: string | null;
  merchantName?: string | null;
  lines?: { classificationCode: string | null; total: string }[];
}

interface PrintJson {
  receipt: ReceiptJson;
  secrets: { lottery: string | null; qrData: string | null } | null;
  copy: boolean;
}

/**
 * The wholesale e-Barimt relay (ADR-0185) end to end: a centre that listens, the store edge with
 * the relay on and a fake PosAPI. A sale on a stage with «e-Barimt гаргах» prepares the invoice's
 * receipt; the edge pulls it, issues it once and reports; a refusal, PosAPI away, an unanswered
 * call, a restart in the middle of a call and a lost claim each end where ADR-0017 says; a voided
 * invoice cancels its receipt; a stage without the switch and a credit order get none; and the
 * lottery and QR data are in no table, no audit row and no log line. Synthetic data only; never a
 * real PosAPI.
 */
describe('wholesale e-Barimt through the store edge', () => {
  let central: NestExpressApplication;
  let edge: NestExpressApplication;
  let posapi: FakePosapi;
  let actors: Awaited<ReturnType<typeof posActors>>;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let plain: Awaited<ReturnType<typeof salesFlow>>;
  let cola: ProductJson;
  let tea: ProductJson;
  let person: CustomerJson;
  let company: CustomerJson;
  let relay: WholesaleRelayService;
  let client: CentralClient;
  let db: Db;
  let edgeDb: EdgeDb;
  const logged: unknown[][] = [];
  let logSpies: jest.SpiedFunction<(...args: unknown[]) => void>[] = [];

  const finance = () => financeApi(central, actors.accountant);
  const http = () => request(central.getHttpServer());
  const api = (token: string = actors.accountant) => ({
    receipt: async (id: number) =>
      (await http().get(`/api/v1/ebarimt/receipts/${id}`).set(bearer(token)).expect(200))
        .body as ReceiptJson,
    list: async (query: Record<string, unknown> = {}) =>
      (await http().get('/api/v1/ebarimt/receipts').query(query).set(bearer(token)).expect(200))
        .body as { data: ReceiptJson[] },
    print: (id: number) => http().post(`/api/v1/ebarimt/receipts/${id}/print`).set(bearer(token)),
    resolve: (id: number, body: object) =>
      http().post(`/api/v1/ebarimt/receipts/${id}/resolve`).set(bearer(token)).send(body),
    cancelResolve: (id: number, outcome: string) =>
      http()
        .post(`/api/v1/ebarimt/receipts/${id}/cancel-resolve`)
        .set(bearer(token))
        .send({ outcome }),
  });
  /** Sells `qty` of the cola on the ticked pipeline; the invoice with its receipt. */
  const sell = async (customerId: number, qty = '2', fields: Record<string, unknown> = {}) => {
    const draft = await flow.draft(customerId, [{ productUnitId: flow.pcs(cola), qty }], fields);
    const sold = await flow.sell(draft.id);
    expect(sold.status).toBe('INVOICED');
    const invoice = await finance().invoiceOfOrder(draft.id);
    if (!invoice) throw new Error('the sale issued no invoice');
    const receipt = (invoice as unknown as { ebarimt: ReceiptJson | null }).ebarimt;
    return { invoice, receipt };
  };
  const receiptOf = async (customerId: number, qty = '2', fields: Record<string, unknown> = {}) => {
    const { invoice, receipt } = await sell(customerId, qty, fields);
    if (!receipt) throw new Error('the invoice has no receipt');
    return { invoice, receipt };
  };

  beforeAll(async () => {
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      logSpies.push(
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          logged.push(args);
        }) as unknown as jest.SpiedFunction<(...args: unknown[]) => void>,
      );
    }
    posapi = new FakePosapi();
    await posapi.start();
    central = await createHttpApp();
    await central.listen(0, '127.0.0.1');
    const port = (central.getHttpServer().address() as AddressInfo).port;
    actors = await posActors(central);
    const store = await posStore(central, actors.admin, 'WB');
    await store.pos
      .setSettings({ ebarimtDistrictCode: '1234', ebarimtClassificationCode: '1234567' })
      .expect(200);
    flow = await salesFlow(central, actors.admin, 'WE', { ebarimt: true });
    plain = await salesFlow(central, actors.admin, 'WP');
    cola = await flow.product('9401', 'Кола бөөний', '1000', '500');
    tea = await plain.product('9402', 'Цай бөөний', '1000', '50');
    const partners = partnersApi(central, actors.admin);
    person = await partners.customer({ kind: 'INDIVIDUAL', name: 'Туршилтын иргэн' });
    company = await partners.customer({ name: FAKE_BUYER.name, tin: FAKE_BUYER.tin });
    edge = await createEdgeApp({
      databaseUrl: await edgeDatabase(),
      centralUrl: `http://127.0.0.1:${port}`,
      nodeToken: store.edgeToken,
      ebarimt: { posapiUrl: posapi.url, lookupUrl: posapi.url, timeoutMs: 1_500 },
      wholesaleRelay: true,
    });
    relay = edge.get(WholesaleRelayService);
    client = edge.get(CentralClient);
    db = central.get<Db>(DB);
    edgeDb = edge.get<EdgeDb>(EDGE_DB);
    // The store's district and default classification codes arrive with the snapshot.
    expect(await edge.get(SyncRunner).pullOnce()).toBe('changed');
  });
  afterAll(async () => {
    for (const spy of logSpies) spy.mockRestore();
    logSpies = [];
    await edge?.close();
    await posapi?.stop();
    await expectReconciled(central);
    await central?.close();
  });

  it('keeps the stage switch on a SALE stage only', () => {
    expect(flow.stage('Борлуулалт').ebarimt).toBe(true);
    expect(flow.stage('Бэлдэх').ebarimt).toBe(false);
    expect(plain.stage('Борлуулалт').ebarimt).toBe(false);
  });

  it('prepares a receipt at the sale, issues it through the edge once and prints the lottery once', async () => {
    const { invoice, receipt } = await receiptOf(person.id);
    expect(receipt).toMatchObject({
      sourceDocId: String(invoice.id),
      docNumber: invoice.number,
      receiptType: 'B2C',
      status: 'PENDING',
      total: '2000.00',
      attempt: 0,
    });
    expect(posapi.receiptPosts()).toHaveLength(0);

    expect(await relay.runOnce()).toBe('worked');
    const sent = posapi.receiptPosts();
    expect(sent).toHaveLength(1);
    // The store's own facts: PosAPI's merchant, the store's district and default classification.
    expect(sent[0]).toMatchObject({
      type: 'B2C_RECEIPT',
      merchantTin: FAKE_MERCHANT.tin,
      districtCode: '1234',
      branchNo: '01',
      posNo: '00000001',
      customerTin: null,
      totalAmount: 2000,
      totalVAT: 181.82,
      payments: [{ code: 'CASH', status: 'PAID', paidAmount: 2000 }],
    });
    const items = (sent[0]?.receipts as { items: Record<string, unknown>[] }[])[0]?.items;
    expect(items?.[0]).toMatchObject({
      name: 'Кола бөөний',
      classificationCode: '1234567',
      qty: 2,
    });

    const issued = await api().receipt(receipt.id);
    expect(issued).toMatchObject({
      status: 'CONFIRMED',
      attempt: 1,
      ddtd: expect.stringMatching(/^[0-9]{33}$/),
      posapiDate: expect.stringMatching(/^2026-10-26 10:00:\d\d$/),
      merchantTin: FAKE_MERCHANT.tin,
      merchantName: FAKE_MERCHANT.name,
      printable: true,
    });
    // The centre stores no classification of its own for a product without one.
    expect(issued.lines?.[0]).toMatchObject({ classificationCode: null, total: '2000.00' });
    expect((await finance().invoice(invoice.id)) as unknown).toMatchObject({
      ebarimt: { status: 'CONFIRMED', ddtd: issued.ddtd },
    });

    const first = (await api().print(receipt.id).expect(200)).body as PrintJson;
    expect(first.secrets).toEqual({ lottery: 'TEST-LOT-1', qrData: 'TEST-QR-1' });
    expect(first.copy).toBe(false);
    const second = (await api().print(receipt.id).expect(200)).body as PrintJson;
    expect(second).toMatchObject({ secrets: null, copy: true });
    expect(second.receipt).toMatchObject({ merchantTin: FAKE_MERCHANT.tin, printable: false });

    // Nothing is left to do, and nothing is sent twice.
    expect(await relay.runOnce()).toBe('idle');
    expect(posapi.receiptPosts()).toHaveLength(1);
  });

  it('issues a company’s receipt as B2B with its TIN and the transfer as BANK_TRANSFER', async () => {
    const { receipt } = await receiptOf(company.id, '3', { paymentMethod: 'BANK_TRANSFER' });
    expect(receipt).toMatchObject({
      receiptType: 'B2B',
      customerTin: FAKE_BUYER.tin,
      status: 'PENDING',
    });
    expect(await relay.runOnce()).toBe('worked');
    expect(posapi.receiptPosts().at(-1)).toMatchObject({
      type: 'B2B_RECEIPT',
      customerTin: FAKE_BUYER.tin,
      payments: [{ code: 'BANK_TRANSFER', status: 'PAID', paidAmount: 3000 }],
    });
    expect(await api().receipt(receipt.id)).toMatchObject({ status: 'CONFIRMED' });
  });

  it('never fails the sale for a company without a TIN: the receipt waits as ERROR and is prepared again', async () => {
    const pending = await partnersApi(central, actors.admin).customer({ name: 'ТТД-гүй ХХК' });
    const before = posapi.receiptPosts().length;
    const { invoice, receipt } = await receiptOf(pending.id);
    expect(receipt).toMatchObject({
      status: 'ERROR',
      errorCode: 'TIN_PENDING',
      receiptType: 'B2B',
    });
    expect(await relay.runOnce()).toBe('idle');
    expect(posapi.receiptPosts()).toHaveLength(before);
    expect((await api().list({ status: 'ERROR' })).data.map((row) => row.id)).toContain(receipt.id);

    // Still without a TIN: prepared again, still waiting.
    expect((await finance().prepareReceipt(invoice.id).expect(200)).body).toMatchObject({
      status: 'ERROR',
      errorCode: 'TIN_PENDING',
    });
    await http()
      .patch(`/api/v1/customers/${pending.id}`)
      .set(bearer(actors.admin))
      .send({ tin: '10000000002' })
      .expect(200);
    await http()
      .post(`/api/v1/invoices/${invoice.id}/ebarimt`)
      .set(bearer(actors.office))
      .send({})
      .expect(403);
    expect((await finance().prepareReceipt(invoice.id).expect(200)).body).toMatchObject({
      status: 'PENDING',
      errorCode: null,
      customerTin: '10000000002',
    });
    expect(await relay.runOnce()).toBe('worked');
    expect(await api().receipt(receipt.id)).toMatchObject({ status: 'CONFIRMED' });
    // A receipt that is not in ERROR is never prepared again.
    expect(
      ((await finance().prepareReceipt(invoice.id).expect(409)).body as ProblemJson).code,
    ).toBe('EBARIMT_RECEIPT_STATE_INVALID');
  });

  it('lists a receipt PosAPI refused and sends it again only when a person prepares it again', async () => {
    posapi.mode = 'error';
    const { invoice, receipt } = await receiptOf(person.id);
    expect(await relay.runOnce()).toBe('worked');
    const before = posapi.receiptPosts().length;
    expect(await api().receipt(receipt.id)).toMatchObject({
      status: 'ERROR',
      errorCode: 'POSAPI_REFUSED',
      message: 'TEST: the receipt was refused',
      ddtd: null,
    });
    expect(await relay.runOnce()).toBe('idle');
    expect(posapi.receiptPosts()).toHaveLength(before);
    posapi.mode = 'ok';
    expect(await relay.runOnce()).toBe('idle');
    await finance().prepareReceipt(invoice.id).expect(200);
    expect(await relay.runOnce()).toBe('worked');
    expect(await api().receipt(receipt.id)).toMatchObject({ status: 'CONFIRMED', attempt: 2 });
  });

  it('offers a receipt again after PosAPI was away before the request left', async () => {
    const { receipt } = await receiptOf(person.id);
    const before = posapi.receiptPosts().length;
    await posapi.stop();
    expect(await relay.runOnce()).toBe('worked');
    const waiting = await api().receipt(receipt.id);
    expect(waiting).toMatchObject({ status: 'PENDING', attempt: 1, ddtd: null });
    expect(waiting.message).toBeTruthy();
    // It waits for its next try; nothing is claimed meanwhile.
    expect(await relay.runOnce()).toBe('idle');
    await posapi.start();
    await db
      .update(ebarimtReceipts)
      .set({ nextAttemptAt: null })
      .where(eq(ebarimtReceipts.id, receipt.id));
    expect(await relay.runOnce()).toBe('worked');
    expect(await api().receipt(receipt.id)).toMatchObject({ status: 'CONFIRMED', attempt: 2 });
    expect(posapi.receiptPosts()).toHaveLength(before + 1);
  });

  it('never sends an unanswered receipt again until the accountant has looked it up', async () => {
    posapi.mode = 'hang';
    const first = await receiptOf(person.id);
    const second = await receiptOf(person.id);
    expect(await relay.runOnce()).toBe('worked');
    expect(await relay.runOnce()).toBe('worked');
    posapi.mode = 'ok';
    const posts = posapi.receiptPosts().length;
    for (const { receipt } of [first, second]) {
      expect(await api().receipt(receipt.id)).toMatchObject({
        status: 'INDETERMINATE',
        ddtd: null,
      });
    }
    expect(await relay.runOnce()).toBe('idle');
    expect(posapi.receiptPosts()).toHaveLength(posts);
    expect((await api().list({ status: 'INDETERMINATE' })).data).toHaveLength(2);

    // The office may not decide; a wrong ДДТД is refused.
    await api(actors.office).resolve(first.receipt.id, { outcome: 'NOT_ISSUED' }).expect(403);
    await api()
      .resolve(first.receipt.id, {
        outcome: 'ISSUED',
        ddtd: '123',
        posapiDate: '2026-11-11 10:00:00',
      })
      .expect(422);
    // «Гараагүй»: it waits for the edge again and is issued once.
    expect(
      (await api().resolve(first.receipt.id, { outcome: 'NOT_ISSUED' }).expect(200)).body,
    ).toMatchObject({ status: 'PENDING' });
    expect(await relay.runOnce()).toBe('worked');
    expect(await api().receipt(first.receipt.id)).toMatchObject({
      status: 'CONFIRMED',
      attempt: 2,
    });
    expect(posapi.receiptPosts()).toHaveLength(posts + 1);

    // «Гарсан»: the ДДТД and date ebarimt.mn shows; nothing is sent, the print is a copy.
    const typed = { ddtd: '9'.repeat(33), posapiDate: '2026-11-11 09:30:00' };
    expect(
      (
        await api()
          .resolve(second.receipt.id, { outcome: 'ISSUED', ...typed })
          .expect(200)
      ).body,
    ).toMatchObject({ status: 'CONFIRMED', ...typed });
    expect(await relay.runOnce()).toBe('idle');
    expect(posapi.receiptPosts()).toHaveLength(posts + 1);
    const printed = (await api().print(second.receipt.id).expect(200)).body as PrintJson;
    expect(printed).toMatchObject({ secrets: null, copy: true });
    expect(printed.receipt.merchantTin).toBe(FAKE_MERCHANT.tin);
    // Decided once.
    await api().resolve(second.receipt.id, { outcome: 'NOT_ISSUED' }).expect(409);
  });

  it('reports a call cut by a restart as INDETERMINATE and never makes it again', async () => {
    const { receipt } = await receiptOf(person.id);
    const before = posapi.receiptPosts().length;
    // The edge claimed it, stored it and was calling PosAPI when it stopped.
    const { operation } = (await client.ebarimtClaim()) as { operation: RelayOperation };
    expect(operation).toMatchObject({ op: 'ISSUE', receiptId: receipt.id, attempt: 1 });
    await edgeDb.insert(edgeRelayOps).values({
      receiptId: operation.receiptId,
      attempt: operation.attempt,
      op: operation.op,
      docNumber: operation.docNumber,
      request: operation,
      status: 'CALLING',
      calledAt: new Date(),
    });
    expect(await api().receipt(receipt.id)).toMatchObject({ status: 'SENDING' });
    await relay.onApplicationBootstrap();
    expect(await relay.runOnce()).toBe('worked');
    expect(posapi.receiptPosts()).toHaveLength(before);
    expect(await api().receipt(receipt.id)).toMatchObject({
      status: 'INDETERMINATE',
      message: 'the edge restarted during the call',
    });
    await api().resolve(receipt.id, { outcome: 'NOT_ISSUED' }).expect(200);
    expect(await relay.runOnce()).toBe('worked');
    expect(await api().receipt(receipt.id)).toMatchObject({ status: 'CONFIRMED', attempt: 2 });
  });

  it('hands a claim whose answer was lost to the same edge again, and issues it once', async () => {
    const { receipt } = await receiptOf(person.id);
    const before = posapi.receiptPosts().length;
    // The centre moved it to SENDING; the answer never reached the edge, which stored nothing.
    await client.ebarimtClaim();
    expect(await api().receipt(receipt.id)).toMatchObject({ status: 'SENDING', attempt: 1 });
    expect(await relay.runOnce()).toBe('worked');
    expect(await api().receipt(receipt.id)).toMatchObject({ status: 'CONFIRMED', attempt: 1 });
    expect(posapi.receiptPosts()).toHaveLength(before + 1);
    // A report repeated (its acknowledgement was lost) changes nothing.
    await edgeDb
      .update(edgeRelayOps)
      .set({ reportedAt: null })
      .where(eq(edgeRelayOps.receiptId, receipt.id));
    expect(await relay.runOnce()).toBe('worked');
    expect(await api().receipt(receipt.id)).toMatchObject({ status: 'CONFIRMED', attempt: 1 });
    expect(posapi.receiptPosts()).toHaveLength(before + 1);
  });

  it('reads a claim nobody answered for ten minutes as INDETERMINATE and stops offering it', async () => {
    const { receipt } = await receiptOf(person.id);
    await client.ebarimtClaim();
    await db
      .update(ebarimtReceipts)
      .set({ claimedAt: sql`now() - interval '11 minutes'` })
      .where(eq(ebarimtReceipts.id, receipt.id));
    expect(await api().receipt(receipt.id)).toMatchObject({ status: 'INDETERMINATE' });
    expect((await api().list({ status: 'INDETERMINATE' })).data.map((row) => row.id)).toContain(
      receipt.id,
    );
    const before = posapi.receiptPosts().length;
    expect(await relay.runOnce()).toBe('idle');
    expect(posapi.receiptPosts()).toHaveLength(before);
    const [row] = await db.select().from(ebarimtReceipts).where(eq(ebarimtReceipts.id, receipt.id));
    expect(row?.status).toBe('INDETERMINATE');
    // «Гарсан» closes it.
    await api()
      .resolve(receipt.id, {
        outcome: 'ISSUED',
        ddtd: '8'.repeat(33),
        posapiDate: '2026-11-11 11:00:00',
      })
      .expect(200);
  });

  it('cancels the receipt of a voided invoice at PosAPI, and one never issued without a call', async () => {
    const issued = await receiptOf(person.id);
    expect(await relay.runOnce()).toBe('worked');
    const confirmed = await api().receipt(issued.receipt.id);
    expect(confirmed.status).toBe('CONFIRMED');
    await finance().voidInvoice(issued.invoice.id, 'буруу бичсэн').expect(200);
    expect(await api().receipt(issued.receipt.id)).toMatchObject({
      status: 'CONFIRMED',
      cancelStatus: 'PENDING',
    });
    expect((await api().list({ cancelOpen: true })).data.map((row) => row.id)).toEqual([
      issued.receipt.id,
    ]);
    const deletes = posapi.deletes().length;
    expect(await relay.runOnce()).toBe('worked');
    expect(posapi.deletes()).toHaveLength(deletes + 1);
    expect(posapi.deletes().at(-1)).toEqual({ id: confirmed.ddtd, date: confirmed.posapiDate });
    expect(await api().receipt(issued.receipt.id)).toMatchObject({
      status: 'CANCELLED',
      cancelStatus: 'DONE',
      printable: false,
    });
    await api().print(issued.receipt.id).expect(409);

    // Voided before any edge took it: cancelled at once, PosAPI never hears of it.
    const waiting = await receiptOf(person.id);
    await finance().voidInvoice(waiting.invoice.id, 'буруу бичсэн').expect(200);
    expect(await api().receipt(waiting.receipt.id)).toMatchObject({
      status: 'CANCELLED',
      cancelStatus: 'DONE',
      ddtd: null,
    });
    const posts = posapi.receiptPosts().length;
    expect(await relay.runOnce()).toBe('idle');
    expect(posapi.receiptPosts()).toHaveLength(posts);
    expect(posapi.deletes()).toHaveLength(deletes + 1);
  });

  it('prepares nothing on a stage without the switch, nor for a credit order', async () => {
    const [{ n: before }] = (
      await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM ebarimt_receipts`)
    ).rows as [{ n: string }];
    const draft = await plain.draft(person.id, [{ productUnitId: plain.pcs(tea), qty: '1' }]);
    await plain.sell(draft.id);
    const off = await finance().invoiceOfOrder(draft.id);
    expect(off).toMatchObject({ status: 'ISSUED', ebarimt: null });

    const credit = await sell(person.id, '1', { paymentMethod: 'CREDIT' });
    expect(credit.invoice).toMatchObject({ paymentMethod: 'CREDIT', status: 'ISSUED' });
    expect(credit.receipt).toBeNull();
    // No receipt to prepare by hand either.
    await finance().prepareReceipt(credit.invoice.id).expect(409);
    const [{ n: after }] = (
      await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM ebarimt_receipts`)
    ).rows as [{ n: string }];
    expect(after).toBe(before);
    expect(await relay.runOnce()).toBe('idle');
  });

  it('refuses the relay’s routes without the edge’s token', async () => {
    await http().post('/api/v1/pos/sync/ebarimt/claim').send({}).expect(401);
    await http()
      .post('/api/v1/pos/sync/ebarimt/claim')
      .set(bearer(actors.admin))
      .send({})
      .expect(401);
  });

  it('keeps the lottery and the QR data in no table, no audit row and no log line', async () => {
    // Several receipts were issued above and one printed: the fake marks every secret.
    expect(posapi.receiptPosts().length).toBeGreaterThan(4);
    const secret = /TEST-(LOT|QR)-/;
    const scan = async (
      executor: Db | EdgeDb,
      pattern: string,
      only?: readonly string[],
    ): Promise<{ table: string; rows: string }[]> => {
      const tables = (
        await executor.execute<{ table_name: string }>(
          sql`SELECT table_name FROM information_schema.tables
              WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
        )
      ).rows.map((row) => row.table_name);
      const hits: { table: string; rows: string }[] = [];
      for (const table of only ?? tables) {
        const found = await executor.execute<{ n: string }>(
          sql`SELECT count(*) AS n FROM ${sql.identifier(table)} t
              WHERE to_jsonb(t)::text ~ ${pattern}`,
        );
        if (found.rows[0]?.n !== '0') hits.push({ table, rows: found.rows[0]?.n ?? '?' });
      }
      return hits;
    };
    // The values: nowhere in either database.
    expect(await scan(db, 'TEST-(LOT|QR)-')).toEqual([]);
    expect(await scan(edgeDb, 'TEST-(LOT|QR)-')).toEqual([]);
    // The keys: not in the receipt rows, the audit, the idempotency store or the edge's relay rows.
    expect(
      await scan(db, 'lottery|qrData', ['ebarimt_receipts', 'audit_log', 'idempotency_keys']),
    ).toEqual([]);
    expect(await scan(edgeDb, 'lottery|qrData', ['edge_relay_ops', 'edge_outbox'])).toEqual([]);
    // The audit did record the relay (so the scan above read real rows).
    const audited = await db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM audit_log WHERE entity = 'ebarimt_receipts' AND action = 'RESULT'`,
    );
    expect(Number.parseInt(audited.rows[0]?.n ?? '0', 10)).toBeGreaterThan(4);
    // The logs of both processes.
    const lines = logged.map((args) => JSON.stringify(args));
    expect(lines.filter((line) => secret.test(line) || /lottery|qrData/.test(line))).toEqual([]);
    expect(lines.some((line) => line.includes('went unanswered'))).toBe(true);
  });
});
