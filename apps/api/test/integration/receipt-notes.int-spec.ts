import type { NestExpressApplication } from '@nestjs/platform-express';
import { gtinCheckDigit } from '@tugeel/shared/gtin';
import type { Client } from 'pg';
import sharp from 'sharp';
import request from 'supertest';
import { LLM_CLIENT, LlmError, type LlmContentPart } from '../../src/integrations/llm';
import { SCANNER_FETCH, type ScannerFetch } from '../../src/integrations/scanner';
import { FakeLlm } from '../harness/ai';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

const ean = (body: string) => `${body}${gtinCheckDigit(body)}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const REG_NO = '2075385';

interface ReadingJson {
  id: number;
  status: string;
  stale: boolean;
  supplier: { id: number; name: string } | null;
  pages: { fileId: number; contentType: string }[];
  failure: { reason: string; status: number | null; providerCode: string | null } | null;
  receiptId: number | null;
  receiptNumber: string | null;
  proposal: {
    docNo: string | null;
    docDate: string | null;
    totalAmount: string | null;
    vat: string;
    lines: {
      index: number;
      name: string;
      qty: string | null;
      unitPrice: string | null;
      amount: string | null;
      unsure: boolean;
      match: { how: string; productUnitId: number; sku: string; units: unknown[] } | null;
    }[];
  } | null;
  memory: { readings: number; lines: number; layout: boolean } | null;
}

/**
 * «Падаан унших» over HTTP (ADR-0210): the model and the scanner are scripted, so what is checked
 * is ours: rights, what reaches the model, how its answer becomes a proposal, that a keeper never
 * sees the prices, that a saved reading is a draft receipt with the note's prices, and what the
 * supplier's memory learns and forgets.
 */
describe('delivery notes read by the model', () => {
  let app: NestExpressApplication;
  const llm = new FakeLlm();
  /** What the scripted scanner answers next. */
  const device: Response[] = [];
  const asked: { method: string; url: string }[] = [];
  let sql: Client;
  let admin: string;
  let keeper: string;
  let otherKeeper: string;
  let accountant: string;
  let outsider: string;
  let supplier: { id: number; name: string };
  let cola: ProductJson;
  let water: ProductJson;
  let page: Buffer;
  const boxCode = ean('865000200001');
  const http = () => request(app.getHttpServer());

  const scriptedFetch: ScannerFetch = (url, init) => {
    asked.push({ method: init.method ?? 'GET', url });
    const next = device.shift();
    return next ? Promise.resolve(next) : Promise.reject(new TypeError('no scripted answer'));
  };

  async function upload(token: string, bytes: Buffer, contentType: string): Promise<number> {
    const issued = (
      await http()
        .post('/api/v1/files/presign')
        .set(bearer(token))
        .send({ kind: 'inventory.note_page', contentType, sizeBytes: bytes.length })
        .expect(201)
    ).body as { fileId: number; uploadUrl: string };
    await http().put(issued.uploadUrl).set('Content-Type', contentType).send(bytes).expect(204);
    return issued.fileId;
  }
  const start = (body: Record<string, unknown>, token = keeper) =>
    http().post('/api/v1/receipt-notes').set(bearer(token)).set(idempotency()).send(body);
  const reading = async (id: number, token = keeper): Promise<ReadingJson> =>
    (await http().get(`/api/v1/receipt-notes/${id}`).set(bearer(token)).expect(200))
      .body as ReadingJson;
  /** The reading once the background work is over. */
  async function finished(id: number, token = keeper): Promise<ReadingJson> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = await reading(id, token);
      if (current.status !== 'READING') return current;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`reading ${id} never finished`);
  }
  const save = (id: number, body: Record<string, unknown>, token = keeper) =>
    http()
      .post(`/api/v1/receipt-notes/${id}/receipt`)
      .set(bearer(token))
      .set(idempotency())
      .send(body);

  const line = (patch: Record<string, unknown> = {}) => ({
    page: 1,
    name: 'Coca Cola 0.5л',
    code: null,
    barcode: null,
    unit: 'ш',
    qty: '10',
    unitPrice: '1500',
    amount: '15000',
    free: false,
    productUnitId: null,
    unsure: false,
    ...patch,
  });
  const answer = (patch: Record<string, unknown> = {}) => ({
    supplierName: 'МСМ ХХК',
    supplierRegNo: REG_NO,
    docNo: 'A-1042',
    docDate: '2026.11.17',
    totalQty: '18',
    totalAmount: '199500',
    pricesIncludeVat: true,
    lines: [
      line({
        name: 'Кола хайрцаг',
        barcode: boxCode,
        unit: 'хайрцаг',
        qty: '5',
        unitPrice: '36000',
        amount: '180000',
      }),
      line({
        name: 'Цэвэр ус 0.5л',
        productUnitId: unitOf(water, 'PCS').id,
        unitPrice: '1500',
        amount: '15000',
      }),
      line({ name: 'Кола задгай', code: 'CC-1', qty: '3', unitPrice: '1500', amount: '4500' }),
    ],
    layoutNotes: 'Columns: №, name, unit, quantity, price, amount. Prices include VAT.',
    remark: '',
    ...patch,
  });
  const partsOf = (index: number): LlmContentPart[] => {
    const content = llm.requests[index]?.messages[0]?.content;
    if (!Array.isArray(content)) throw new Error('the request carries no parts');
    return content;
  };
  const count = async (table: string) =>
    (await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0]?.n;

  beforeAll(async () => {
    page = await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#fafafa' } })
      .jpeg()
      .toBuffer();
    app = await createHttpApp({
      override: (builder) =>
        builder
          .overrideProvider(LLM_CLIENT)
          .useValue(llm)
          .overrideProvider(SCANNER_FETCH)
          .useValue(scriptedFetch),
    });
    sql = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    keeper = await customRoleUser(app, admin, ['inventory.receipts.manage']);
    otherKeeper = await customRoleUser(app, admin, ['inventory.receipts.manage']);
    accountant = await customRoleUser(app, admin, [
      'inventory.receipts.manage',
      'inventory.costs.manage',
    ]);
    outsider = await customRoleUser(app, admin, ['sales.orders.read']);
    const catalog = catalogApi(app, admin);
    const drinks = await catalog.category('Ундаа');
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    cola = await catalog.product({
      sku: '700',
      name: 'Coca Cola 0.5л',
      categoryId: drinks,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '24', barcodes: [boxCode] }],
    });
    water = await catalog.product({
      sku: '701',
      name: 'Цэвэр ус 0.5л',
      categoryId: drinks,
      baseUomId: pcs,
    });
    supplier = await partnersApi(app, admin).supplier({ name: 'МСМ ХХК', regNo: REG_NO });
    const inventory = inventoryApi(app, admin);
    const home = (await inventory.warehouse('W1')).id;
    for (const product of [cola, water]) {
      await inventory.setHome(product.id, home);
      await http()
        .post('/api/v1/product-suppliers')
        .set(bearer(admin))
        .send({ productId: product.id, supplierId: supplier.id })
        .expect(201);
    }
  });

  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  beforeEach(() => {
    device.length = 0;
    asked.length = 0;
    llm.reset();
  });

  it('only receipt holders reach the readings, only the setup right the scanners', async () => {
    await http().get('/api/v1/receipt-notes/status').set(bearer(outsider)).expect(403);
    await start({ fileIds: [1] }, outsider).expect(403);
    await http().get('/api/v1/receipt-notes').set(bearer(outsider)).expect(403);
    await http().get('/api/v1/receipt-notes/1').set(bearer(outsider)).expect(403);
    await http().get('/api/v1/receipt-notes/1/pages/1').set(bearer(outsider)).expect(403);
    await save(1, { supplierId: supplier.id, lines: [] }, outsider).expect(403);
    await http().get('/api/v1/receipt-notes/scanners').set(bearer(keeper)).expect(403);
    await http()
      .post('/api/v1/receipt-notes/scanners')
      .set(bearer(keeper))
      .send({ name: 'Оффис', url: 'http://192.168.1.60' })
      .expect(403);
    expect(llm.requests).toHaveLength(0);
    expect(asked).toHaveLength(0);
  });

  it('says what is set: a model, no scanner yet', async () => {
    const status = await http().get('/api/v1/receipt-notes/status').set(bearer(keeper)).expect(200);
    expect(status.body).toEqual({ read: true, scanners: [] });
  });

  it('refuses pages that are not the caller’s own uploads', async () => {
    const theirs = await upload(otherKeeper, page, 'image/jpeg');
    await start({ fileIds: [theirs], supplierId: supplier.id }).expect(404);
    await start({ fileIds: [], supplierId: supplier.id }).expect(422);
    expect(llm.requests).toHaveLength(0);
    expect(await count('receipt_note_readings')).toBe('0');
  });

  let firstReading = 0;

  it('reads a named supplier’s note: a picture and a PDF, matched by barcode and by the model', async () => {
    llm.enqueue(answer());
    const fileIds = [
      await upload(keeper, page, 'image/jpeg'),
      await upload(keeper, PDF, 'application/pdf'),
    ];
    // Hold the scripted answer until the POST returns: even a fast model must run in the background.
    const modelGate = Promise.withResolvers<void>();
    const complete = llm.complete.bind(llm);
    const heldRead = jest.spyOn(llm, 'complete').mockImplementationOnce(async (llmRequest) => {
      await modelGate.promise;
      return complete(llmRequest);
    });
    try {
      const started = (await start({ fileIds, supplierId: supplier.id }).expect(201))
        .body as ReadingJson;
      firstReading = started.id;
      expect(started.status).toBe('READING');
    } finally {
      modelGate.resolve();
      heldRead.mockRestore();
    }
    const done = await finished(firstReading, accountant);
    expect(done).toMatchObject({
      status: 'READY',
      failure: null,
      supplier: { id: supplier.id },
      pages: [
        { fileId: fileIds[0], contentType: 'image/jpeg' },
        { fileId: fileIds[1], contentType: 'application/pdf' },
      ],
      proposal: { docNo: 'A-1042', docDate: '2026-11-17', totalAmount: '199500', vat: 'INCLUDED' },
      memory: { readings: 0, lines: 0, layout: false },
    });
    expect(done.proposal?.lines.map((row) => row.match?.how ?? null)).toEqual([
      'BARCODE',
      'MODEL',
      null,
    ]);
    expect(done.proposal?.lines[0]?.match).toMatchObject({
      productUnitId: unitOf(cola, 'BOX').id,
      sku: '700',
    });
    expect(done.proposal?.lines[0]?.match?.units).toHaveLength(2);
    expect(done.proposal?.lines[0]).toMatchObject({ unitPrice: '36000', amount: '180000' });

    // One call: the supplier was named. It carries the supplier's products and both pages.
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]?.timeoutMs).toBeGreaterThan(60_000);
    const parts = partsOf(0);
    expect(parts.map((part) => part.type)).toEqual(['text', 'text', 'image', 'text', 'document']);
    const data = JSON.parse(parts[0]?.type === 'text' ? parts[0].text : '{}') as {
      supplier: unknown;
      layoutNotes: unknown;
      products: string[];
    };
    expect(data.supplier).toEqual({ name: 'МСМ ХХК', regNo: REG_NO });
    expect(data.layoutNotes).toBeNull();
    expect(data.products).toHaveLength(3);
    expect(data.products).toContain(
      `${unitOf(cola, 'BOX').id} | 700 | Coca Cola 0.5л | хайрцаг x 24`,
    );
    expect(parts[4]).toEqual({
      type: 'document',
      mediaType: 'application/pdf',
      data: PDF.toString('base64'),
    });
  });

  it('never shows a keeper the note’s prices', async () => {
    const seen = await reading(firstReading, keeper);
    expect(seen.proposal?.totalAmount).toBeNull();
    expect(seen.proposal?.lines.map((row) => [row.unitPrice, row.amount])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
    expect(seen.proposal?.lines.map((row) => row.qty)).toEqual(['5', '10', '3']);
  });

  it('streams a page to receipt and cost holders only', async () => {
    const [first, second] = (await reading(firstReading)).pages;
    const picture = await http()
      .get(`/api/v1/receipt-notes/${firstReading}/pages/${first?.fileId}`)
      .set(bearer(accountant))
      .expect(200);
    expect(picture.headers['content-type']).toBe('image/jpeg');
    expect(picture.headers['cache-control']).toBe('private, no-store');
    const file = await http()
      .get(`/api/v1/receipt-notes/${firstReading}/pages/${second?.fileId}`)
      .set(bearer(keeper))
      .expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    await http()
      .get(`/api/v1/receipt-notes/${firstReading}/pages/999999`)
      .set(bearer(keeper))
      .expect(404);
  });

  it('lists what waits to be checked', async () => {
    const open = (await http().get('/api/v1/receipt-notes').set(bearer(keeper)).expect(200))
      .body as {
      id: number;
      status: string;
      supplierName: string;
      pageCount: number;
      lineCount: number;
    }[];
    expect(open).toEqual([
      expect.objectContaining({
        id: firstReading,
        status: 'READY',
        supplierName: 'МСМ ХХК',
        pageCount: 2,
        lineCount: 3,
      }),
    ]);
  });

  let firstReceipt = 0;

  it('saves the checked reading as a draft receipt with the note’s prices, by a keeper who never saw them', async () => {
    await save(firstReading, { supplierId: supplier.id, lines: [] }).expect(422);
    const saved = await save(firstReading, {
      supplierId: supplier.id,
      lines: [
        { index: 0, productUnitId: unitOf(cola, 'BOX').id, enteredQty: '5' },
        { index: 1, productUnitId: unitOf(water, 'PCS').id, enteredQty: '10' },
        // The person chose the product of the line nothing matched.
        { index: 2, productUnitId: unitOf(cola, 'PCS').id, enteredQty: '3' },
      ],
    }).expect(201);
    firstReceipt = (saved.body as { receiptId: number }).receiptId;

    const receipt = (
      await http().get(`/api/v1/receipts/${firstReceipt}`).set(bearer(accountant)).expect(200)
    ).body as {
      status: string;
      number: string | null;
      supplierId: number;
      supplierDocNo: string;
      supplierDocDate: string;
      noteTotalAmount: string;
      lines: {
        productUnitId: number;
        enteredQty: string;
        docUnitPrice: string;
        docAmount: string;
      }[];
    };
    expect(receipt).toMatchObject({
      status: 'DRAFT',
      supplierId: supplier.id,
      supplierDocNo: 'A-1042',
      supplierDocDate: '2026-11-17',
      noteTotalAmount: '199500.00',
    });
    expect(receipt.number).toMatch(/^GR-/);
    expect(
      receipt.lines.map((row) => [
        row.productUnitId,
        row.enteredQty,
        row.docUnitPrice,
        row.docAmount,
      ]),
    ).toEqual([
      [unitOf(cola, 'BOX').id, '5', '36000.00', '180000.00'],
      [unitOf(water, 'PCS').id, '10', '1500.00', '15000.00'],
      [unitOf(cola, 'PCS').id, '3', '1500.00', '4500.00'],
    ]);

    const after = await reading(firstReading);
    expect(after).toMatchObject({
      status: 'SAVED',
      receiptId: firstReceipt,
      receiptNumber: receipt.number,
      memory: { readings: 1, lines: 3, layout: true },
    });
    const ref = await http()
      .get(`/api/v1/receipt-notes/of-receipt/${firstReceipt}`)
      .set(bearer(keeper))
      .expect(200);
    expect(ref.body).toEqual({ readingId: firstReading });
    // Nothing moved: a draft receipt is all there is.
    expect(await count('stock_ledger')).toBe('0');
  });

  it('saves a reading once', async () => {
    const again = await save(firstReading, {
      supplierId: supplier.id,
      lines: [{ index: 0, productUnitId: unitOf(cola, 'BOX').id, enteredQty: '5' }],
    }).expect(409);
    expect((again.body as { code: string }).code).toBe('NOTE_READING_STATE');
    expect(await count('goods_receipts')).toBe('1');
  });

  it('reads the supplier’s next note with what it learnt: the layout notes and the line a person matched', async () => {
    llm.enqueue(
      answer({
        docNo: 'A-1043',
        lines: [line({ name: 'Кола задгай', code: 'CC-1', qty: '7', amount: '10500' })],
        totalAmount: '10500',
        layoutNotes: '',
      }),
    );
    const started = (
      await start({
        fileIds: [await upload(keeper, page, 'image/jpeg')],
        supplierId: supplier.id,
      }).expect(201)
    ).body as ReadingJson;
    const done = await finished(started.id);
    const first = partsOf(0)[0];
    const data = JSON.parse(first?.type === 'text' ? first.text : '{}') as { layoutNotes: string };
    expect(data.layoutNotes).toContain('Prices include VAT');
    expect(done.proposal?.lines[0]?.match).toMatchObject({
      how: 'MEMORY',
      productUnitId: unitOf(cola, 'PCS').id,
    });
    // A note that taught nothing about the layout keeps what was known.
    await save(started.id, {
      supplierId: supplier.id,
      lines: [{ index: 0, productUnitId: unitOf(cola, 'PCS').id, enteredQty: '7' }],
    }).expect(201);
    const memory = await http()
      .get(`/api/v1/receipt-notes/memory/${supplier.id}`)
      .set(bearer(keeper))
      .expect(200);
    expect(memory.body).toEqual({ readings: 2, lines: 3, layout: true });
    const uses = await sql.query<{ uses: number }>(
      `SELECT uses FROM receipt_note_aliases WHERE key = 'c:cc 1|ш'`,
    );
    expect(uses.rows[0]?.uses).toBe(2);
  });

  it('recognises the supplier from the first page when nobody named it', async () => {
    llm.enqueue({ supplierName: '"МСМ" ХХК', supplierRegNo: REG_NO }, answer({ lines: [line()] }));
    const started = (
      await start({ fileIds: [await upload(keeper, page, 'image/jpeg')] }).expect(201)
    ).body as ReadingJson;
    expect(started.supplier).toBeNull();
    const done = await finished(started.id);
    expect(done).toMatchObject({ status: 'READY', supplier: { id: supplier.id } });
    expect(llm.requests).toHaveLength(2);
    // The second call already knows the supplier's products.
    const first = partsOf(1)[0];
    expect(first?.type === 'text' ? first.text : '').toContain('| 701 |');
    await http()
      .post(`/api/v1/receipt-notes/${started.id}/discard`)
      .set(bearer(keeper))
      .expect(200);
  });

  it('reads a note of an unknown seller without products, leaving the supplier to the person', async () => {
    llm.enqueue(
      { supplierName: 'Танихгүй ХХК', supplierRegNo: null },
      answer({ supplierName: 'Танихгүй ХХК', lines: [line({ barcode: boxCode })] }),
    );
    const started = (
      await start({ fileIds: [await upload(keeper, page, 'image/jpeg')] }).expect(201)
    ).body as ReadingJson;
    const done = await finished(started.id);
    expect(done).toMatchObject({ status: 'READY', supplier: null, memory: null });
    // The catalogue still knows the printed barcode.
    expect(done.proposal?.lines[0]?.match?.how).toBe('BARCODE');
    const discarded = await http()
      .post(`/api/v1/receipt-notes/${started.id}/discard`)
      .set(bearer(keeper))
      .expect(200);
    expect((discarded.body as ReadingJson).status).toBe('DISCARDED');
    await save(started.id, {
      supplierId: supplier.id,
      lines: [{ index: 0, productUnitId: unitOf(cola, 'BOX').id, enteredQty: '1' }],
    }).expect(409);
  });

  it('keeps a failed reading with its reason and reads it again on request', async () => {
    llm.enqueue(
      new LlmError('HTTP', 'the provider answered HTTP 529', {
        status: 529,
        providerCode: 'overloaded_error',
      }),
    );
    const started = (
      await start({
        fileIds: [await upload(keeper, page, 'image/jpeg')],
        supplierId: supplier.id,
      }).expect(201)
    ).body as ReadingJson;
    const failed = await finished(started.id);
    expect(failed).toMatchObject({
      status: 'FAILED',
      proposal: null,
      failure: { reason: 'HTTP', status: 529, providerCode: 'overloaded_error' },
    });
    await save(started.id, {
      supplierId: supplier.id,
      lines: [{ index: 0, productUnitId: unitOf(cola, 'BOX').id, enteredQty: '1' }],
    }).expect(409);

    llm.enqueue(answer({ lines: [line()] }));
    await http().post(`/api/v1/receipt-notes/${started.id}/retry`).set(bearer(keeper)).expect(200);
    expect(await finished(started.id)).toMatchObject({ status: 'READY', failure: null });
    await http().post(`/api/v1/receipt-notes/${started.id}/retry`).set(bearer(keeper)).expect(409);
    await http()
      .post(`/api/v1/receipt-notes/${started.id}/discard`)
      .set(bearer(keeper))
      .expect(200);
  });

  it('fails a reading whose answer is not the asked shape, and one whose page is no picture', async () => {
    llm.enqueue({ lines: 'none' });
    const odd = (
      await start({
        fileIds: [await upload(keeper, page, 'image/jpeg')],
        supplierId: supplier.id,
      }).expect(201)
    ).body as ReadingJson;
    expect((await finished(odd.id)).failure).toMatchObject({ reason: 'INVALID_RESPONSE' });

    // A JPEG by its first bytes only: the upload passes, the reading names the page.
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    const bad = (
      await start({
        fileIds: [await upload(keeper, broken, 'image/jpeg')],
        supplierId: supplier.id,
      }).expect(201)
    ).body as ReadingJson;
    expect((await finished(bad.id)).failure).toMatchObject({
      reason: 'UNREADABLE_PAGE',
      status: 1,
    });
    expect(llm.requests).toHaveLength(1);
    for (const id of [odd.id, bad.id]) {
      await http().post(`/api/v1/receipt-notes/${id}/discard`).set(bearer(keeper)).expect(200);
    }
  });

  it('forgets a supplier’s notes on request', async () => {
    const forgotten = await http()
      .delete(`/api/v1/receipt-notes/memory/${supplier.id}`)
      .set(bearer(keeper))
      .expect(200);
    expect(forgotten.body).toEqual({ readings: 2, lines: 0, layout: false });
    expect(await count('receipt_note_aliases')).toBe('0');
  });

  describe('the scanner', () => {
    const capabilities = () =>
      new Response(
        '<scan:ScannerCapabilities><pwg:MakeAndModel>Acme 9000</pwg:MakeAndModel><scan:Platen/></scan:ScannerCapabilities>',
        { status: 200 },
      );
    let scannerId = 0;

    it('takes only an address of the building’s own network', async () => {
      for (const url of ['http://example.com', 'http://127.0.0.1', 'http://192.168.1.60/eSCL']) {
        await http()
          .post('/api/v1/receipt-notes/scanners')
          .set(bearer(admin))
          .send({ name: 'Оффис', url })
          .expect(422);
        await http()
          .post('/api/v1/receipt-notes/scanners/check')
          .set(bearer(admin))
          .send({ url })
          .expect(422);
      }
      expect(asked).toHaveLength(0);
    });

    it('asks a device what it is before it is saved', async () => {
      device.push(capabilities());
      const ok = await http()
        .post('/api/v1/receipt-notes/scanners/check')
        .set(bearer(admin))
        .send({ url: '192.168.1.60' })
        .expect(200);
      expect(ok.body).toEqual({
        ok: true,
        model: 'Acme 9000',
        glass: true,
        feeder: false,
        reason: null,
      });
      expect(asked).toEqual([
        { method: 'GET', url: 'http://192.168.1.60/eSCL/ScannerCapabilities' },
      ]);

      device.push(new Response('<html>camera</html>', { status: 200 }));
      const other = await http()
        .post('/api/v1/receipt-notes/scanners/check')
        .set(bearer(admin))
        .send({ url: 'http://192.168.1.10' })
        .expect(200);
      expect(other.body).toMatchObject({ ok: false, reason: 'NOT_A_SCANNER' });
    });

    it('saves a scanner and offers it to the keepers while it is switched on', async () => {
      const created = await http()
        .post('/api/v1/receipt-notes/scanners')
        .set(bearer(admin))
        .send({ name: ' Оффис ', url: '192.168.1.60' })
        .expect(201);
      expect(created.body).toMatchObject({
        name: 'Оффис',
        url: 'http://192.168.1.60',
        active: true,
      });
      scannerId = (created.body as { id: number }).id;
      const status = await http()
        .get('/api/v1/receipt-notes/status')
        .set(bearer(keeper))
        .expect(200);
      expect(status.body).toEqual({ read: true, scanners: [{ id: scannerId, name: 'Оффис' }] });
    });

    it('scans a sheet into a page of the caller’s, which a reading then takes', async () => {
      device.push(
        new Response(null, {
          status: 201,
          headers: { location: 'http://printer.local/eSCL/ScanJobs/job-1' },
        }),
        new Response(new Uint8Array(page), { status: 200 }),
        new Response(null, { status: 200 }),
      );
      const scanned = await http()
        .post(`/api/v1/receipt-notes/scanners/${scannerId}/scan`)
        .set(bearer(keeper))
        .send({ source: 'GLASS' })
        .expect(200);
      const sheets = (scanned.body as { sheets: { fileId: number; preview: string }[] }).sheets;
      expect(sheets).toHaveLength(1);
      expect(Buffer.from(sheets[0]?.preview ?? '', 'base64').subarray(0, 3)).toEqual(
        Buffer.from([0xff, 0xd8, 0xff]),
      );
      expect(asked.map((call) => `${call.method} ${call.url}`)).toEqual([
        'POST http://192.168.1.60/eSCL/ScanJobs',
        'GET http://192.168.1.60/eSCL/ScanJobs/job-1/NextDocument',
        'DELETE http://192.168.1.60/eSCL/ScanJobs/job-1',
      ]);

      llm.enqueue(answer({ lines: [line()] }));
      const started = (
        await start({ fileIds: [sheets[0]?.fileId], supplierId: supplier.id }).expect(201)
      ).body as ReadingJson;
      expect((await finished(started.id)).status).toBe('READY');
      await http()
        .post(`/api/v1/receipt-notes/${started.id}/discard`)
        .set(bearer(keeper))
        .expect(200);
    });

    it('names why a scan failed, and offers no scanner that is switched off', async () => {
      device.push(new Response(null, { status: 503 }));
      const busy = await http()
        .post(`/api/v1/receipt-notes/scanners/${scannerId}/scan`)
        .set(bearer(keeper))
        .send({ source: 'GLASS' })
        .expect(502);
      expect(busy.body).toMatchObject({
        code: 'SCANNER_FAILED',
        params: { reason: 'BUSY', status: 503 },
      });

      await http()
        .put(`/api/v1/receipt-notes/scanners/${scannerId}`)
        .set(bearer(admin))
        .send({ name: 'Оффис', url: 'http://192.168.1.60', active: false })
        .expect(200);
      await http()
        .post(`/api/v1/receipt-notes/scanners/${scannerId}/scan`)
        .set(bearer(keeper))
        .send({ source: 'GLASS' })
        .expect(404);
      const status = await http()
        .get('/api/v1/receipt-notes/status')
        .set(bearer(keeper))
        .expect(200);
      expect((status.body as { scanners: unknown[] }).scanners).toEqual([]);
    });
  });

  it('counts the readings on the usage page and stores no prompt or page text', async () => {
    const usage = (await http().get('/api/v1/ai/usage').set(bearer(admin)).expect(200)).body as {
      today: { receiptReads: number };
    };
    expect(usage.today.receiptReads).toBeGreaterThan(5);
    const purposes = await sql.query<{ purpose: string }>(
      `SELECT DISTINCT purpose FROM ai_usage ORDER BY purpose`,
    );
    expect(purposes.rows.map((row) => row.purpose)).toEqual(['RECEIPT_READ']);
  });
});
