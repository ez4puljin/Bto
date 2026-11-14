import type { NestExpressApplication } from '@nestjs/platform-express';
import { gtinCheckDigit } from '@tugeel/shared/gtin';
import type { Client } from 'pg';
import sharp from 'sharp';
import request from 'supertest';
import { LLM_CLIENT, LlmError, type LlmContentPart } from '../../src/integrations/llm';
import { PICTURE_FETCH, type PictureFetch } from '../../src/integrations/picture';
import { FakeLlm } from '../harness/ai';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

/** Not a real key: tests never reach the background service, every fetch below is scripted. */
const TEST_KEY = 'test-picture-key-not-real-WXYZ';
const ean = (body: string) => `${body}${gtinCheckDigit(body)}`;

/** Real pictures, made once: the flow reads what it is given (ADR-0199). */
const pictures = {
  /** Small upright JPEGs, as the web uploads them; `mark` tells one from another. */
  jpegs: new Map<number, Buffer>(),
  /** What the background service answers: a red product and a blue matchbox apart from it. */
  cutOut: Buffer.alloc(0),
  logo: Buffer.alloc(0),
  /** A phone's camera photo: large, and lying on its side until its EXIF turns it. */
  camera: Buffer.alloc(0),
};
const solid = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } });

async function makePictures(): Promise<void> {
  for (const mark of [1, 2, 3, 5]) {
    pictures.jpegs.set(
      mark,
      await solid(320, 240, `rgb(${mark * 40}, 90, 120)`)
        .jpeg()
        .toBuffer(),
    );
  }
  pictures.cutOut = await sharp({
    create: { width: 600, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: await solid(200, 700, '#ff0000').png().toBuffer(), left: 100, top: 50 },
      { input: await solid(100, 60, '#0000ff').png().toBuffer(), left: 420, top: 650 },
    ])
    .png()
    .toBuffer();
  pictures.logo = await solid(300, 100, '#008000').png().toBuffer();
  pictures.camera = await solid(3200, 2400, '#336699')
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

function jpegBytes(mark: number): Buffer {
  const bytes = pictures.jpegs.get(mark);
  if (!bytes) throw new Error(`no test picture ${mark}`);
  return bytes;
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
  let home: number;
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
    new Response(new Uint8Array(pictures.cutOut), {
      status: 200,
      headers: { 'x-credits-charged': '1' },
    });

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
  const image = (body: Record<string, unknown>, token = registrar) =>
    http().post('/api/v1/product-registrations/ai/image').set(bearer(token)).send(body);
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
    await makePictures();
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
    home = (await inventoryApi(app, admin).warehouse('W1')).id;
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
    await image({ photoFileId: 1 }, worker).expect(403);
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
    expect(plain.body).toEqual({ image: pictures.cutOut.toString('base64'), stamp: null });
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
    const logoBytes = pictures.logo;
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

  it('draws the finished image for a phone: upright, cut out, only the product, the logo, ready to attach', async () => {
    const logo = await upload(admin, 'ai.picture_stamp', pictures.logo, 'image/png');
    await saveSettings({ stampFileId: logo }).expect(200);
    const taken = await upload(registrar, 'catalog.ai_photo', pictures.camera, 'image/jpeg');
    answers.push(cutOut());
    const { body } = await image({
      photoFileId: taken,
      productBox: { left: 0.1, top: 0.05, width: 0.4, height: 0.9 },
    }).expect(200);
    expect(body).toMatchObject({ picture: 'made', failure: null });

    // The service got the photo upright and scaled, not the camera's 3200 × 2400 on its side.
    const sentPhoto = sent[0]?.form?.get('image_file') as File;
    const sentMeta = await sharp(Buffer.from(await sentPhoto.arrayBuffer())).metadata();
    expect([sentMeta.width, sentMeta.height, sentMeta.orientation]).toEqual([960, 1280, undefined]);

    // The picture: a white square, the red product in the middle, the logo top-left, no matchbox.
    const jpeg = Buffer.from(body.image as string, 'base64');
    const meta = await sharp(jpeg).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1000, 1000, 'jpeg']);
    const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => [
      ...data.subarray((y * 1000 + x) * 3, (y * 1000 + x) * 3 + 3),
    ];
    const [red, green, corner] = [at(500, 500), at(60, 60), at(950, 50)];
    expect((red[0] ?? 0) > 200 && (red[2] ?? 255) < 60).toBe(true);
    expect((green[1] ?? 0) > 100 && (green[0] ?? 255) < 60).toBe(true);
    expect(corner.every((value) => value > 245)).toBe(true);
    let blue = 0;
    for (let i = 0; i < data.length; i += 3) {
      if ((data[i + 2] ?? 0) > 200 && (data[i] ?? 255) < 60 && (data[i + 1] ?? 255) < 60) blue += 1;
    }
    expect(blue).toBe(0);

    // Both files wait as the registrar's own product photos, and a registration attaches them.
    const stored = await sql.query<{ kind: string; status: string }>(
      'SELECT kind, status FROM files WHERE id = ANY($1::bigint[]) ORDER BY id',
      [[body.imageFileId, body.thumbFileId]],
    );
    expect(stored.rows).toEqual([
      { kind: 'catalog.product_image', status: 'PENDING' },
      { kind: 'catalog.product_thumb', status: 'PENDING' },
    ]);
    const registered = await http()
      .post('/api/v1/product-registrations')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        sku: '777',
        name: 'Утаснаас бүртгэсэн бараа',
        categoryId: water,
        baseUomId: pcs,
        boxFactor: '12',
        supplierId: supplier.id,
        homeWarehouseId: home,
        images: [{ imageFileId: body.imageFileId, thumbFileId: body.thumbFileId }],
      })
      .expect(201);
    const product = (
      await http()
        .get(`/api/v1/products/${(registered.body as { productId: number }).productId}`)
        .set(bearer(admin))
        .expect(200)
    ).body as { images: { isPrimary: boolean; url: string }[] };
    expect(product.images).toHaveLength(1);
    expect(product.images[0]?.isPrimary).toBe(true);
    await http()
      .get(product.images[0]?.url ?? '')
      .expect(200);
    await saveSettings({ stampFileId: null }).expect(200);
  });

  it('keeps the photo as taken when the service refuses, and says why', async () => {
    answers.push(
      json(402, { errors: [{ title: 'Insufficient credits', code: 'insufficient_credits' }] }),
    );
    const { body } = await image({ photoFileId: await photo(registrar, 5) }).expect(200);
    expect(body).toMatchObject({
      picture: 'original',
      failure: { reason: 'HTTP', status: 402, providerCode: 'insufficient_credits' },
    });
    expect(Buffer.from(body.image as string, 'base64').equals(jpegBytes(5))).toBe(true);
    // A cut-out with nothing in it is no picture either.
    answers.push(
      new Response(
        new Uint8Array(
          await sharp({
            create: {
              width: 50,
              height: 50,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
          })
            .png()
            .toBuffer(),
        ),
        { status: 200 },
      ),
    );
    const empty = await image({ photoFileId: await photo() }).expect(200);
    expect(empty.body).toMatchObject({ picture: 'original', failure: { reason: 'EMPTY' } });
  });

  it('refuses an upload that is no readable photo, and another person’s', async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
    const id = await upload(registrar, 'catalog.ai_photo', broken, 'image/jpeg');
    const refused = await image({ photoFileId: id }).expect(415);
    expect(refused.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    await read([id]).expect(415);
    await image({ photoFileId: await photo(otherRegistrar) }).expect(404);
    await image({
      photoFileId: await photo(),
      productBox: { left: 2, top: 0, width: 1, height: 1 },
    }).expect(422);
    expect(sent).toHaveLength(0);
  });

  it('removing the key stops the pictures again', async () => {
    const removed = await saveSettings({ apiKey: null }).expect(200);
    expect(removed.body.keyHint).toBeNull();
    expect((await status().expect(200)).body).toEqual({ read: true, picture: false });
    await picture(await photo()).expect(503);
  });

  it('without a key the image is the photo as taken, upright and scaled, with nothing to explain', async () => {
    const taken = await upload(registrar, 'catalog.ai_photo', pictures.camera, 'image/jpeg');
    const { body } = await image({ photoFileId: taken }).expect(200);
    expect(body).toMatchObject({ picture: 'original', failure: null });
    const meta = await sharp(Buffer.from(body.image as string, 'base64')).metadata();
    expect([meta.width, meta.height]).toEqual([960, 1280]);
    expect(sent).toHaveLength(0);
  });
});
