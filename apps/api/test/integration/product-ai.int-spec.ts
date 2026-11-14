import type { NestExpressApplication } from '@nestjs/platform-express';
import { gtinCheckDigit } from '@tugeel/shared/gtin';
import type { Client } from 'pg';
import request from 'supertest';
import { LLM_CLIENT, LlmError, type LlmContentPart } from '../../src/integrations/llm';
import { PICTURE_FETCH, type PictureFetch } from '../../src/integrations/picture';
import { FakeLlm } from '../harness/ai';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { partnersApi } from '../harness/partners';

/** Not a real key: tests never reach the background service, every fetch below is scripted. */
const TEST_KEY = 'test-picture-key-not-real-WXYZ';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
const ean = (body: string) => `${body}${gtinCheckDigit(body)}`;

function jpegBytes(mark: number): Buffer {
  const body = Buffer.alloc(300, mark);
  body.set([0xff, 0xd8, 0xff, 0xe0]);
  return body;
}

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  form: FormData | null;
}

/**
 * «AI ашиглах» on the registration form over HTTP (ADR-0198): the model and the background
 * service are scripted, so what is checked is ours: rights, what reaches the provider, what of its
 * answer reaches the form, the settings' secrecy, and that nothing is ever saved by a reading.
 */
describe('product registration: AI reading and picture', () => {
  let app: NestExpressApplication;
  const llm = new FakeLlm();
  const sent: Sent[] = [];
  /** What the scripted background service says next. */
  const answers: Response[] = [];
  let sql: Client;
  let admin: string;
  let registrar: string;
  let otherRegistrar: string;
  let worker: string;
  let water: number;
  let pcs: number;
  let block: number;
  let supplier: { id: number; code: string; name: string };
  const taken = ean('865000100009');
  const http = () => request(app.getHttpServer());

  const scriptedFetch: PictureFetch = (url, init) => {
    sent.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      form: init.body instanceof FormData ? init.body : null,
    });
    const next = answers.shift();
    return next ? Promise.resolve(next) : Promise.reject(new TypeError('no scripted answer'));
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const cutOut = () =>
    new Response(new Uint8Array(PNG), { status: 200, headers: { 'x-credits-charged': '1' } });

  async function upload(
    token: string,
    kind: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<number> {
    const issued = (
      await http()
        .post('/api/v1/files/presign')
        .set(bearer(token))
        .send({ kind, contentType, sizeBytes: bytes.length })
        .expect(201)
    ).body as { fileId: number; uploadUrl: string };
    await http().put(issued.uploadUrl).set('Content-Type', contentType).send(bytes).expect(204);
    return issued.fileId;
  }
  const photo = (token = registrar, mark = 1) =>
    upload(token, 'catalog.ai_photo', jpegBytes(mark), 'image/jpeg');
  const read = (photoFileIds: number[], token = registrar) =>
    http().post('/api/v1/product-registrations/ai/read').set(bearer(token)).send({ photoFileIds });
  const picture = (photoFileId: number, token = registrar) =>
    http()
      .post('/api/v1/product-registrations/ai/picture')
      .set(bearer(token))
      .send({ photoFileId });
  const status = (token = registrar) =>
    http().get('/api/v1/product-registrations/ai').set(bearer(token));
  const settings = () => http().get('/api/v1/ai/picture-settings').set(bearer(admin));
  const saveSettings = (body: Record<string, unknown>) =>
    http().patch('/api/v1/ai/picture-settings').set(bearer(admin)).send(body);
  const answer = (patch: Record<string, unknown> = {}) => ({
    name: 'Цэвэр ус 0.5л',
    categoryId: water,
    baseUnitId: pcs,
    boxQuantity: '12',
    blockQuantity: '6',
    weightKg: '0.5',
    pieceBarcodes: [ean('865000100001'), taken, '1234'],
    cartonBarcodes: [],
    blockBarcodes: [],
    supplierId: supplier.id,
    frontPhoto: 2,
    productBox: { left: 100, top: 100, width: 600, height: 800 },
    note: 'Хайрцагны баркод харагдсангүй.',
    ...patch,
  });
  const count = async (table: string) =>
    (await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0]?.n;

  beforeAll(async () => {
    app = await createHttpApp({
      override: (builder) =>
        builder
          .overrideProvider(LLM_CLIENT)
          .useValue(llm)
          .overrideProvider(PICTURE_FETCH)
          .useValue(scriptedFetch),
    });
    sql = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    registrar = await customRoleUser(app, admin, ['catalog.products.register']);
    otherRegistrar = await customRoleUser(app, admin, ['catalog.products.register']);
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const catalog = catalogApi(app, admin);
    const drinks = await catalog.category('Ундаа');
    water = await catalog.category('Ус', drinks);
    pcs = await catalog.uomId('PCS');
    block = await catalog.uomId('BLOCK');
    supplier = await partnersApi(app, admin).supplier({ name: 'МСМ ХХК' });
    await catalog.product({
      sku: '900',
      name: 'Хуучин ус 1л',
      categoryId: water,
      baseUomId: pcs,
      baseBarcodes: [taken],
    });
  });

  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  beforeEach(() => {
    sent.length = 0;
    answers.length = 0;
    llm.reset();
  });

  it('only who may register products reaches the routes', async () => {
    await status(worker).expect(403);
    await read([1], worker).expect(403);
    await picture(1, worker).expect(403);
    for (const token of [registrar, worker]) {
      await http().get('/api/v1/ai/picture-settings').set(bearer(token)).expect(403);
      await http()
        .patch('/api/v1/ai/picture-settings')
        .set(bearer(token))
        .send({ apiKey: TEST_KEY })
        .expect(403);
      await http().post('/api/v1/ai/picture-settings/test').set(bearer(token)).send({}).expect(403);
    }
    expect(llm.requests).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('says what is set: a model, no background service yet', async () => {
    expect((await status().expect(200)).body).toEqual({ read: true, picture: false });
  });

  it('reads the photos and proposes the form, from the catalogue’s own lists, saving nothing', async () => {
    const [products, images] = [await count('products'), await count('product_images')];
    const photos = [await photo(), await photo(registrar, 2)];
    llm.enqueue(answer());
    const { body } = await read(photos).expect(200);
    expect(body).toEqual({
      name: 'Цэвэр ус 0.5л',
      categoryId: water,
      categoryPath: 'Ундаа / Ус',
      baseUomId: pcs,
      boxFactor: '12',
      weightKg: '0.5',
      baseBarcodes: [ean('865000100001'), taken],
      boxBarcodes: [],
      units: [{ uomId: block, factorToBase: '6', barcodes: [] }],
      supplier: { id: supplier.id, code: supplier.code, name: 'МСМ ХХК' },
      frontPhoto: 1,
      frontPhotoFileId: photos[1],
      productBox: { left: 0.1, top: 0.1, width: 0.6, height: 0.8 },
      droppedBarcodes: 1,
      existing: [expect.objectContaining({ code: taken, sku: '900', name: 'Хуучин ус 1л' })],
      note: 'Хайрцагны баркод харагдсангүй.',
    });

    // What went to the model: the lists as data, then each photo as an image.
    const [sentRequest] = llm.requests;
    expect(sentRequest?.output?.name).toBe('product_registration');
    const parts = sentRequest?.messages[0]?.content as LlmContentPart[];
    const first = parts[0];
    const data = JSON.parse(first?.type === 'text' ? first.text : '{}') as {
      categories: { id: number; path: string }[];
      units: { code: string | null }[];
      suppliers: { id: number; name: string }[];
      nameExamples: string[];
    };
    expect(data.categories).toContainEqual({ id: water, path: 'Ундаа / Ус' });
    expect(data.units.map((unit) => unit.code)).toEqual(expect.arrayContaining(['PCS', 'BOX']));
    expect(data.suppliers).toContainEqual({ id: supplier.id, name: 'МСМ ХХК' });
    expect(data.nameExamples).toContain('Хуучин ус 1л');
    const sentImages = parts.filter((part) => part.type === 'image');
    expect(sentImages).toHaveLength(2);
    expect(sentImages[1]).toEqual({
      type: 'image',
      mediaType: 'image/jpeg',
      data: jpegBytes(2).toString('base64'),
    });

    // Nothing is saved by a reading; the call is on the meter with its purpose.
    expect(await count('products')).toBe(products);
    expect(await count('product_images')).toBe(images);
    const usage = await sql.query<{ purpose: string; n: string }>(
      `SELECT purpose, count(*)::text AS n FROM ai_usage GROUP BY purpose`,
    );
    expect(usage.rows).toContainEqual({ purpose: 'PRODUCT_READ', n: '1' });
    const totals = (await http().get('/api/v1/ai/usage').set(bearer(admin)).expect(200)).body as {
      today: { productReads: number };
    };
    expect(totals.today.productReads).toBe(1);
  });

  it('drops what the catalogue does not hold from an answer', async () => {
    llm.enqueue(
      answer({
        categoryId: 987_654,
        baseUnitId: await catalogApi(app, admin).uomId('BOX'),
        supplierId: 987_654,
        boxQuantity: '2.5',
        blockQuantity: null,
        pieceBarcodes: [],
        frontPhoto: 7,
        productBox: null,
      }),
    );
    const id = await photo();
    const { body } = await read([id]).expect(200);
    expect(body).toMatchObject({
      categoryId: null,
      baseUomId: null,
      supplier: null,
      boxFactor: null,
      units: [],
      frontPhoto: 0,
      frontPhotoFileId: id,
      productBox: null,
      existing: [],
    });
  });

  it('takes only the caller’s own uploaded photos', async () => {
    const theirs = await photo(otherRegistrar);
    await read([theirs]).expect(404);
    const wrongKind = await upload(admin, 'catalog.product_image', jpegBytes(3), 'image/jpeg');
    const refused = await read([wrongKind], admin).expect(422);
    expect(refused.body.code).toBe('FILE_KIND_MISMATCH');
    await read([]).expect(422);
    await read(Array.from({ length: 9 }, (_, index) => index + 1)).expect(422);
    expect(llm.requests).toHaveLength(0);
  });

  it('a provider that fails or answers nonsense is a 502, and the form is filled by hand', async () => {
    const id = await photo();
    llm.enqueue(new LlmError('HTTP', 'the provider answered HTTP 529', { status: 529 }));
    const failed = await read([id]).expect(502);
    expect(failed.body).toMatchObject({
      code: 'AI_PROVIDER_FAILED',
      params: { reason: 'HTTP', status: 529 },
    });
    llm.enqueue({ name: 'Ус' });
    const nonsense = await read([id]).expect(502);
    expect(nonsense.body.params).toMatchObject({ reason: 'INVALID_RESPONSE' });
  });

  it('with the AI switched off a reading is 503 and the status says so', async () => {
    const patch = (enabled: boolean) =>
      http().patch('/api/v1/ai/settings').set(bearer(admin)).send({ enabled }).expect(200);
    await patch(false);
    expect((await status().expect(200)).body).toMatchObject({ read: false });
    const refused = await read([await photo()]).expect(503);
    expect(refused.body.code).toBe('AI_NOT_CONFIGURED');
    await patch(true);
  });

  it('without a key no picture is cut out', async () => {
    const refused = await picture(await photo()).expect(503);
    expect(refused.body.code).toBe('PICTURE_NOT_CONFIGURED');
    expect(sent).toHaveLength(0);
    expect((await settings().expect(200)).body).toMatchObject({
      keyHint: null,
      keyUnreadable: false,
      secretReady: true,
      stampUrl: null,
    });
  });

  it('checks a typed key for free, saves it sealed and shows only its end', async () => {
    answers.push(
      json(200, {
        data: { attributes: { credits: { total: 42 }, api: { free_calls: 50, sizes: 'all' } } },
      }),
    );
    const checked = await http()
      .post('/api/v1/ai/picture-settings/test')
      .set(bearer(admin))
      .send({ apiKey: TEST_KEY })
      .expect(200);
    expect(checked.body).toEqual({
      ok: true,
      reason: null,
      status: null,
      providerCode: null,
      credits: '42',
      freeCalls: 50,
    });
    expect(sent[0]).toMatchObject({
      url: 'https://api.remove.bg/v1.0/account',
      method: 'GET',
      headers: { 'X-Api-Key': TEST_KEY },
    });
    // The check saved nothing.
    expect((await settings().expect(200)).body.keyHint).toBeNull();
    const none = await http()
      .post('/api/v1/ai/picture-settings/test')
      .set(bearer(admin))
      .send({})
      .expect(200);
    expect(none.body).toMatchObject({ ok: false, reason: 'NO_KEY' });

    const saved = await saveSettings({ apiKey: TEST_KEY }).expect(200);
    expect(saved.body.keyHint).toBe('WXYZ');
    expect(JSON.stringify(saved.body)).not.toContain(TEST_KEY);
    const stored = await sql.query<{ api_key_sealed: string }>(
      'SELECT api_key_sealed FROM ai_picture_settings WHERE id = 1',
    );
    expect(stored.rows[0]?.api_key_sealed.startsWith('v1.')).toBe(true);
    expect(stored.rows[0]?.api_key_sealed).not.toContain(TEST_KEY);
    const audit = await sql.query<{ row: string }>(
      `SELECT row_to_json(a)::text AS row FROM audit_log a WHERE entity = 'ai_picture_settings'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.row).not.toContain(TEST_KEY);
    expect(audit.rows[0]?.row).not.toContain('WXYZ');
    expect(audit.rows[0]?.row).toContain('"hasKey": true');
    expect((await status().expect(200)).body).toEqual({ read: true, picture: true });

    answers.push(json(403, { errors: [{ title: 'API Key invalid', code: 'auth_failed' }] }));
    const wrong = await http()
      .post('/api/v1/ai/picture-settings/test')
      .set(bearer(admin))
      .send({})
      .expect(200);
    expect(wrong.body).toMatchObject({
      ok: false,
      reason: 'HTTP',
      status: 403,
      providerCode: 'auth_failed',
    });
  });

  it('cuts the product out through the service and hands the logo with it', async () => {
    const id = await photo(registrar, 5);
    answers.push(cutOut());
    const plain = await picture(id).expect(200);
    expect(plain.body).toEqual({ image: PNG.toString('base64'), stamp: null });
    expect(sent[0]).toMatchObject({
      url: 'https://api.remove.bg/v1.0/removebg',
      method: 'POST',
      headers: { 'X-Api-Key': TEST_KEY },
    });
    const file = sent[0]?.form?.get('image_file') as File;
    expect(Buffer.from(await file.arrayBuffer()).equals(jpegBytes(5))).toBe(true);
    expect(sent[0]?.form?.get('size')).toBe('auto');
    // Another person's photo is not found, and nothing of it goes to the service.
    await picture(await photo(otherRegistrar)).expect(404);
    expect(sent).toHaveLength(1);

    // The company's logo: uploaded, saved, public, and sent along with a cut-out.
    const logoBytes = Buffer.concat([PNG, Buffer.alloc(40, 3)]);
    const logo = await upload(admin, 'ai.picture_stamp', logoBytes, 'image/png');
    const withLogo = await saveSettings({ stampFileId: logo }).expect(200);
    expect(withLogo.body.stampUrl).toMatch(/\.png$/);
    expect(withLogo.body.keyHint).toBe('WXYZ');
    await http()
      .get(withLogo.body.stampUrl as string)
      .expect(200);
    answers.push(cutOut());
    const stamped = await picture(id).expect(200);
    expect(stamped.body.stamp).toEqual({
      data: logoBytes.toString('base64'),
      mediaType: 'image/png',
    });

    // Another logo replaces it and the old file goes; null takes the logo away, the key stays.
    const second = await upload(admin, 'ai.picture_stamp', logoBytes, 'image/png');
    await saveSettings({ stampFileId: second }).expect(200);
    const old = await sql.query<{ status: string }>('SELECT status FROM files WHERE id = $1', [
      logo,
    ]);
    expect(old.rows[0]?.status).toBe('DELETED');
    const cleared = await saveSettings({ stampFileId: null }).expect(200);
    expect(cleared.body).toMatchObject({ stampUrl: null, keyHint: 'WXYZ' });
    await saveSettings({ stampFileId: await photo(admin) }).expect(422);
  });

  it('a service that refuses is a 502 with its code; the photo is kept as taken', async () => {
    answers.push(
      json(402, { errors: [{ title: 'Insufficient credits', code: 'insufficient_credits' }] }),
    );
    const refused = await picture(await photo()).expect(502);
    expect(refused.body).toMatchObject({
      code: 'PICTURE_PROVIDER_FAILED',
      params: { reason: 'HTTP', status: 402, providerCode: 'insufficient_credits' },
    });
    answers.push(new Response('<html>', { status: 200 }));
    const notPng = await picture(await photo()).expect(502);
    expect(notPng.body.params).toMatchObject({ reason: 'INVALID_RESPONSE' });
  });

  it('removing the key stops the pictures again', async () => {
    const removed = await saveSettings({ apiKey: null }).expect(200);
    expect(removed.body.keyHint).toBeNull();
    expect((await status().expect(200)).body).toEqual({ read: true, picture: false });
    await picture(await photo()).expect(503);
  });
});
