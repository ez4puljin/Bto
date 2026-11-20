import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import {
  ELEVENLABS_CONFIG,
  ELEVENLABS_FETCH,
  type ElevenLabsFetch,
} from '../../src/integrations/elevenlabs';
import { PhoneReconcileFlowService } from '../../src/modules/phone-agent';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { salesFlow } from '../harness/finance';
import { bearer, login, seedUser, uniquePhone } from '../harness/identity';
import { expectReconciled } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';

interface StartJson {
  answer: boolean;
  callId: number;
  reason: string | null;
  signedUrl: string | null;
  dynamicVariables: Record<string, unknown> | null;
}

interface ProductAnswer {
  productId: number;
  name: string;
  sellable: boolean;
  stock: string;
  units: { unitId: number; name: string; factor: string; base: boolean }[];
}

/** Not a real key or agent: the «ElevenLabs» here is scripted and no request leaves the process. */
const FAKE_AGENT = {
  apiKey: 'test-key-not-real',
  agentId: 'agent_test',
  baseUrl: 'https://el.test',
};
const NEVER = '00:00';
const ALL_DAY: [string, string][] = [[NEVER, '24:00']];
const week = (intervals: [string, string][]) =>
  Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((day) => [day, intervals]));

/**
 * The phone AI order line's api (ADR-0232, stage 1) as the Windows bridge and the office call it:
 * the station's key, who may be answered and when, who is calling, the agent's tools, «no order
 * without yes», the transcript's dedup and its reconcile against a scripted provider. Synthetic
 * data only.
 */
describe('the phone AI order line (ADR-0232)', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let cola: ProductJson;
  let water: ProductJson;
  let store: CustomerJson;
  let byContact: CustomerJson;
  let other: CustomerJson;
  let storePhone: string;
  let contactPhone: string;
  let sharedPhone: string;
  let lineId: number;
  let key: string;
  let otherKey: string;
  /** The scripted provider: what it answers and how often it was asked. */
  const provider = {
    signedUrls: 0,
    fail: false,
    conversations: new Map<string, unknown>(),
  };
  const http = () => request(app.getHttpServer());
  const today = businessDate();

  const fakeFetch: ElevenLabsFetch = (url, init) => {
    const headers = init.headers as Record<string, string>;
    if (headers['xi-api-key'] !== FAKE_AGENT.apiKey) throw new Error('the key was not sent');
    const json = (status: number, body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    if (url.startsWith(`${FAKE_AGENT.baseUrl}/v1/convai/conversation/get-signed-url`)) {
      provider.signedUrls += 1;
      if (provider.fail) return json(503, { detail: 'down' });
      return json(200, { signed_url: `wss://el.test/convai?token=t${provider.signedUrls}` });
    }
    const conversation = /\/v1\/convai\/conversations\/([^/?]+)$/.exec(url)?.[1];
    if (conversation && provider.conversations.has(conversation)) {
      return json(200, provider.conversations.get(conversation));
    }
    return json(404, { detail: 'not found' });
  };

  const station = (stationKey: string = key) => {
    const auth = { Authorization: `Bearer ${stationKey}` };
    const post = (path: string, body: object, idem: Record<string, string> = idempotency()) =>
      http().post(`/api/v1/phone-agent${path}`).set(auth).set(idem).send(body);
    return {
      status: () => http().get('/api/v1/phone-agent/station').set(auth),
      start: (callerPhone: string | null, idem?: Record<string, string>, callRef = randomUUID()) =>
        post('/calls', { callRef, callerPhone }, idem),
      events: (
        callId: number,
        events: { seq: number; role: string; text: string; atMs?: number }[],
        fields: Record<string, unknown> = {},
        idem?: Record<string, string>,
      ) =>
        post(
          `/calls/${callId}/events`,
          { events: events.map((event) => ({ atMs: event.seq * 1000, ...event })), ...fields },
          idem,
        ),
      tool: (
        callId: number,
        name: string,
        seq: number,
        args: Record<string, unknown>,
        idem?: Record<string, string>,
        afterSeq = seq - 1,
      ) => post(`/calls/${callId}/tools/${name}`, { afterSeq, seq, args }, idem),
      end: (callId: number, body: object, idem?: Record<string, string>) =>
        post(`/calls/${callId}/end`, body, idem),
    };
  };
  const answered = async (callerPhone: string | null): Promise<StartJson> => {
    const started = (await station().start(callerPhone).expect(201)).body as StartJson;
    expect(started.answer).toBe(true);
    return started;
  };
  const setLine = (body: Record<string, unknown>) =>
    http().put(`/api/v1/phone-lines/${lineId}`).set(bearer(admin)).send(body);
  const setPhoneChannel = (pipelineId: number | null, stageId: number | null) =>
    http()
      .put('/api/v1/sales-settings/channels')
      .set(bearer(admin))
      .send({ channel: 'PHONE_AI', pipelineId, stageId });
  const phoneOrders = async () =>
    (
      await sql.query<{ count: string }>(
        "SELECT count(*) FROM sales_orders WHERE channel = 'PHONE_AI'",
      )
    ).rows[0]?.count;
  const notificationsOf = async (token: string) =>
    (
      (await http().get('/api/v1/me/notifications').set(bearer(token)).expect(200)).body as {
        data: {
          kind: string;
          orderNumber: string;
          customerName: string;
          callId: number | null;
          callbackId: number | null;
          phone: string | null;
        }[];
      }
    ).data;

  beforeAll(async () => {
    app = await createHttpApp({
      override: (builder) =>
        builder
          .overrideProvider(ELEVENLABS_FETCH)
          .useValue(fakeFetch)
          .overrideProvider(ELEVENLABS_CONFIG)
          .useValue(FAKE_AGENT),
    });
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    flow = await salesFlow(app, admin, 'PHA');
    cola = await flow.product('9601', 'Кола утас', '1000', '30');
    water = await flow.product('9602', 'Ус утас', '500', '5');
    // A box of 12 for «нэг хайрцагт 12 ширхэг» and «ердөө 2 хайрцаг үлдсэн».
    const boxId = (
      (await http().get('/api/v1/uoms').set(bearer(admin)).expect(200)).body as {
        data: { id: number; code: string | null }[];
      }
    ).data.find((uom) => uom.code === 'BOX')?.id;
    cola = (
      await http()
        .post(`/api/v1/products/${cola.id}/units`)
        .set(bearer(admin))
        .send({ uomId: boxId, factorToBase: '12' })
        .expect(201)
    ).body as ProductJson;
    const partners = partnersApi(app, office);
    storePhone = uniquePhone();
    contactPhone = uniquePhone();
    sharedPhone = uniquePhone();
    store = await partners.customer({
      name: 'Утасны дэлгүүр',
      phone: storePhone,
      address: { address: 'Мөрөн, 5-р баг' },
    });
    byContact = await partners.customer({ name: 'Холбоо барих дэлгүүр' });
    await http()
      .post(`/api/v1/customers/${byContact.id}/contacts`)
      .set(bearer(office))
      .send({ name: 'Эзэн', phone: contactPhone })
      .expect(201);
    await partners.customer({ name: 'Хос дугаар А', phone: sharedPhone });
    await partners.customer({ name: 'Хос дугаар Б', phone: sharedPhone });
    other = await partners.customer({ name: 'Өөр дэлгүүр', phone: uniquePhone() });
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('keeps the lines for phone.lines.manage and shows a key only when it is made', async () => {
    await http().get('/api/v1/phone-lines').set(bearer(office)).expect(403);
    await http().get('/api/v1/phone-calls').set(bearer(office)).expect(403);
    const idem = idempotency();
    const create = () =>
      http()
        .post('/api/v1/phone-lines')
        .set(bearer(admin))
        .set(idem)
        .send({ name: 'Захиалгын утас', greeting: 'Сайн байна уу' });
    const created = (await create().expect(201)).body as {
      line: { id: number; active: boolean; online: boolean };
      key: string;
    };
    expect(created.key).toMatch(/^bpl_\d+_[A-Za-z0-9_-]{20,}$/);
    // A new line is off until someone switches it on.
    expect(created.line).toMatchObject({ active: false, online: false });
    lineId = created.line.id;
    key = created.key;
    const replay = await create().expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((replay.body as { key?: string }).key).toBeUndefined();
    const stored = await sql.query<{ key_hash: string }>(
      'SELECT key_hash FROM phone_lines WHERE id = $1',
      [lineId],
    );
    expect(stored.rows[0]?.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0]?.key_hash).not.toContain(key.split('_')[2]);
    await setLine({ schedule: { week: { '1': [['18:00', '09:00']] } } }).expect(422);
    await setLine({ schedule: { week: { '8': [] } } }).expect(422);
    otherKey = (
      (
        await http()
          .post('/api/v1/phone-lines')
          .set(bearer(admin))
          .set(idempotency())
          .send({ name: 'Хоёр дахь утас' })
          .expect(201)
      ).body as { key: string }
    ).key;
  });

  it('opens the station only to its key, and replaces it at once', async () => {
    const refused = await http().get('/api/v1/phone-agent/station').expect(401);
    expect(refused.body).toMatchObject({ code: 'PHONE_KEY_INVALID' });
    await station(`${key.slice(0, -1)}x`)
      .status()
      .expect(401);
    await station(`bpl_999999_${'a'.repeat(32)}`)
      .status()
      .expect(401);
    await station(`Bearer ${admin}`).status().expect(401);
    // A staff token is no station key, and a station key is no staff token.
    await http()
      .get('/api/v1/phone-lines')
      .set({ Authorization: `Bearer ${key}` })
      .expect(401);
    const status = (await station().status().expect(200)).body as Record<string, unknown>;
    expect(status).toEqual({
      lineId,
      name: 'Захиалгын утас',
      active: false,
      workingHours: false,
      agentConfigured: true,
    });
    const seen = await sql.query<{ seen: boolean }>(
      'SELECT last_seen_at IS NOT NULL AS seen FROM phone_lines WHERE id = $1',
      [lineId],
    );
    expect(seen.rows[0]?.seen).toBe(true);
    const rotated = (
      await http()
        .post(`/api/v1/phone-lines/${lineId}/key`)
        .set(bearer(admin))
        .set(idempotency())
        .expect(200)
    ).body as { key: string };
    await station(key).status().expect(401);
    key = rotated.key;
    await station().status().expect(200);
    // A write without an Idempotency-Key is refused before anything is stored.
    await http()
      .post('/api/v1/phone-agent/calls')
      .set({ Authorization: `Bearer ${key}` })
      .send({ callRef: 'no-key', callerPhone: storePhone })
      .expect(400);
  });

  it('lets the phone ring while the line is off or nothing takes PHONE_AI orders', async () => {
    const off = (await station().start(storePhone).expect(201)).body as StartJson;
    expect(off).toMatchObject({ answer: false, reason: 'LINE_INACTIVE', signedUrl: null });
    await setLine({ active: true }).expect(200);
    const closed = (await station().start(storePhone).expect(201)).body as StartJson;
    expect(closed).toMatchObject({ answer: false, reason: 'AI_CLOSED' });
    expect(provider.signedUrls).toBe(0);
    // A declined call is stored, over at once, with no outcome; it takes no events.
    const row = await sql.query<{ answered: boolean; ended: boolean; outcome: string | null }>(
      'SELECT answered, ended_at IS NOT NULL AS ended, outcome FROM phone_calls WHERE id = $1',
      [closed.callId],
    );
    expect(row.rows[0]).toEqual({ answered: false, ended: true, outcome: null });
    const refused = await station()
      .events(closed.callId, [{ seq: 1, role: 'USER', text: 'Байна уу' }])
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'PHONE_CALL_NOT_ANSWERED' });
  });

  it('lands PHONE_AI only on a stage without an action, like the app channel', async () => {
    const refused = await setPhoneChannel(flow.pipeline.id, flow.stage('Хяналт').id).expect(422);
    expect(refused.body).toMatchObject({
      errors: [{ path: 'stageId', constraint: 'phoneAiStage' }],
    });
    const channels = (
      await setPhoneChannel(flow.pipeline.id, flow.stage('Захиалга').id).expect(200)
    ).body as { channel: string; stageId: number }[];
    expect(channels).toContainEqual(
      expect.objectContaining({ channel: 'PHONE_AI', stageId: flow.stage('Захиалга').id }),
    );
  });

  it('answers only outside the line’s working hours, by the server’s clock', async () => {
    await setLine({ schedule: { week: week(ALL_DAY), exceptions: [] } }).expect(200);
    const working = (await station().start(storePhone).expect(201)).body as StartJson;
    expect(working).toMatchObject({ answer: false, reason: 'WORKING_HOURS', signedUrl: null });
    expect((await station().status().expect(200)).body).toMatchObject({ workingHours: true });
    expect(provider.signedUrls).toBe(0);
    // Today is an exception without working hours (a holiday): the AI answers.
    await setLine({
      schedule: { week: week(ALL_DAY), exceptions: [{ date: today, intervals: [] }] },
    }).expect(200);
    await answered(storePhone);
    expect(provider.signedUrls).toBe(1);
    await setLine({ schedule: { week: week([]), exceptions: [] } }).expect(200);
  });

  it('gives a signed URL for one call and never replays it', async () => {
    const idem = idempotency();
    const callRef = randomUUID();
    const before = provider.signedUrls;
    const first = (await station().start(storePhone, idem, callRef).expect(201)).body as StartJson;
    expect(first).toMatchObject({
      answer: true,
      reason: null,
      signedUrl: `wss://el.test/convai?token=t${before + 1}`,
      dynamicVariables: {
        call_id: String(first.callId),
        caller_known: true,
        store_name: 'Утасны дэлгүүр',
        can_deliver: true,
        greeting: 'Сайн байна уу',
      },
    });
    const replay = await station().start(storePhone, idem, callRef).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((replay.body as StartJson).callId).toBe(first.callId);
    expect((replay.body as { signedUrl?: string }).signedUrl).toBeUndefined();
    expect(provider.signedUrls).toBe(before + 1);
    const stored = await sql.query<{ body: string }>(
      "SELECT response_body::text AS body FROM idempotency_keys WHERE actor_kind = 'PHONE_LINE' AND key = $1",
      [idem['Idempotency-Key']],
    );
    expect(stored.rows[0]?.body).not.toContain('token=');
    // The same Android call reported again with a new key is the same row.
    const again = (await station().start(storePhone, idempotency(), callRef).expect(201))
      .body as StartJson;
    expect(again.callId).toBe(first.callId);
    // The provider is down: the phone rings for staff, and the call is filed FAILED.
    provider.fail = true;
    const down = (await station().start(storePhone).expect(201)).body as StartJson;
    provider.fail = false;
    expect(down).toMatchObject({ answer: false, reason: 'AGENT_UNAVAILABLE', signedUrl: null });
    const failed = await sql.query<{ outcome: string; answered: boolean }>(
      'SELECT outcome, answered FROM phone_calls WHERE id = $1',
      [down.callId],
    );
    expect(failed.rows[0]).toEqual({ outcome: 'FAILED', answered: false });
  });

  it('knows a store by its phone or a contact’s; none, several or withheld leave only a callback', async () => {
    const own = await answered(storePhone.replace('+976', ''));
    expect(own.dynamicVariables).toMatchObject({ caller_known: true });
    const contact = await answered(contactPhone);
    expect(contact.dynamicVariables).toMatchObject({
      caller_known: true,
      store_name: 'Холбоо барих дэлгүүр',
      can_deliver: false,
    });
    for (const number of [uniquePhone(), sharedPhone, null]) {
      const call = await answered(number);
      expect(call.dynamicVariables).toMatchObject({ caller_known: false, store_name: '' });
      // Availability is still told…
      const found = await station()
        .tool(call.callId, 'search_products', 1, { query: 'Кола' })
        .expect(200);
      expect((found.body as { answer: { products: unknown[] } }).answer.products).toHaveLength(1);
      // …but no price, no order and no status.
      for (const [seq, name, args] of [
        [2, 'quote', { lines: [{ unitId: flow.pcs(cola), qty: 1 }] }],
        [3, 'place_order', { quoteId: randomUUID() }],
        [4, 'order_status', {}],
      ] as const) {
        const refused = await station().tool(call.callId, name, seq, args).expect(409);
        expect(refused.body).toMatchObject({ code: 'PHONE_CALLER_UNKNOWN' });
      }
      await station()
        .tool(call.callId, 'request_callback', 5, { reason: 'Захиалга өгөх гэсэн' })
        .expect(200);
      // Asked twice, a call still leaves one task.
      await station().tool(call.callId, 'request_callback', 6, { reason: 'Дахин' }).expect(200);
      const tasks = await sql.query<{ phone: string | null; customer_id: string | null }>(
        'SELECT phone, customer_id::text FROM phone_callbacks WHERE call_id = $1',
        [call.callId],
      );
      expect(tasks.rows).toEqual([{ phone: number, customer_id: null }]);
      const ended = await station()
        .end(call.callId, { reason: 'COMPLETED', durationS: 40 })
        .expect(200);
      expect(ended.body).toMatchObject({ outcome: 'CALLBACK', orderNumber: null });
    }
    expect(await phoneOrders()).toBe('0');
    // Every holder of phone.calls.read is told of each task; the office holds no such right.
    const told = (await notificationsOf(admin)).filter((row) => row.kind === 'PHONE_CALLBACK');
    expect(told).toHaveLength(3);
    expect(told).toContainEqual(expect.objectContaining({ phone: sharedPhone, orderNumber: '' }));
    expect(told).toContainEqual(expect.objectContaining({ phone: null }));
    expect(await notificationsOf(office)).toEqual([]);
  });

  let callId: number;
  let quoteId: string;
  let orderNumber: string;

  it('stores the turns once and marks a search that found nothing', async () => {
    callId = (await answered(storePhone)).callId;
    const turns = [
      { seq: 1, role: 'AGENT', text: 'Сайн байна уу, юугаар туслах вэ?' },
      { seq: 2, role: 'USER', text: 'Кола байна уу' },
    ];
    const idem = idempotency();
    const first = await station()
      .events(callId, turns, { conversationId: 'conv_main' }, idem)
      .expect(200);
    expect(first.body).toEqual({ stored: 2, lastSeq: 2 });
    const replay = await station()
      .events(callId, turns, { conversationId: 'conv_main' }, idem)
      .expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    // The same batch under a new key, with other words at a stored number: nothing changes.
    const resent = await station()
      .events(callId, [
        { seq: 2, role: 'USER', text: 'Өөр үг' },
        turns[0] ?? { seq: 1, role: 'AGENT', text: '' },
      ])
      .expect(200);
    expect(resent.body).toEqual({ stored: 0, lastSeq: 2 });
    const kept = await sql.query<{ text: string }>(
      'SELECT text FROM phone_call_messages WHERE call_id = $1 AND seq = 2',
      [callId],
    );
    expect(kept.rows[0]?.text).toBe('Кола байна уу');
    await station()
      .events(callId, [{ seq: 0, role: 'USER', text: 'x' }])
      .expect(422);
    await station()
      .events(callId, [{ seq: 9, role: 'TOOL', text: 'x' }])
      .expect(422);
    // Another line's key does not see this call.
    const foreign = await station(otherKey)
      .events(callId, [{ seq: 3, role: 'USER', text: 'x' }])
      .expect(404);
    expect(foreign.body).toMatchObject({ code: 'PHONE_CALL_NOT_FOUND' });

    const found = (
      await station().tool(callId, 'search_products', 3, { query: 'Кола' }).expect(200)
    ).body as { answer: { products: ProductAnswer[] } };
    expect(found.answer.products).toEqual([
      {
        productId: cola.id,
        name: 'Кола утас',
        sellable: true,
        stock: 'available',
        units: expect.arrayContaining([
          { unitId: flow.pcs(cola), name: expect.any(String), factor: '1', base: true },
          { unitId: unitOf(cola, 'BOX').id, name: expect.any(String), factor: '12', base: false },
        ]),
      },
    ]);
    // No price, no stock number, no code in what the agent hears.
    expect(JSON.stringify(found.answer)).not.toMatch(/price|available":|sku|"30"|1000/);
    const none = (
      await station().tool(callId, 'search_products', 4, { query: 'байхгүйбараа' }).expect(200)
    ).body as { answer: { products: ProductAnswer[] } };
    expect(none.answer.products).toEqual([]);
    const noHits = (
      await http().get('/api/v1/phone-searches/no-hits').set(bearer(admin)).expect(200)
    ).body as { data: { callId: number; seq: number; query: string }[] };
    expect(noHits.data).toEqual([
      expect.objectContaining({ callId, seq: 4, query: 'байхгүйбараа' }),
    ]);
    const unknownTool = await station().tool(callId, 'drop_tables', 5, {}).expect(404);
    expect(unknownTool.body).toMatchObject({ code: 'PHONE_TOOL_UNKNOWN' });
    await station().tool(callId, 'search_products', 6, { query: '' }).expect(422);
  });

  it('says «байгаа», or only how many are left when less is free than was asked', async () => {
    const ask = async (seq: number, unitId: number, qty: number | string) =>
      (
        await station()
          .tool(callId, 'check_availability', seq, { productId: cola.id, unitId, qty })
          .expect(200)
      ).body as { answer: Record<string, unknown> };
    const box = unitOf(cola, 'BOX');
    expect((await ask(7, flow.pcs(cola), 30)).answer).toEqual({ status: 'available' });
    expect((await ask(8, box.id, '2')).answer).toEqual({ status: 'available' });
    // 30 pieces free: five boxes of 12 are not there, two are.
    expect((await ask(9, box.id, 5)).answer).toEqual({
      status: 'only',
      qty: '2',
      unit: expect.any(String),
    });
    expect((await ask(10, flow.pcs(cola), 40)).answer).toEqual({
      status: 'only',
      qty: '30',
      unit: expect.any(String),
    });
    const missing = await station()
      .tool(callId, 'check_availability', 11, {
        productId: cola.id,
        unitId: flow.pcs(water),
        qty: 1,
      })
      .expect(404);
    expect(missing.body).toMatchObject({ code: 'PHONE_PRODUCT_NOT_FOUND' });
  });

  it('quotes a preliminary total and takes no order without the caller’s answer', async () => {
    const lines = [
      { unitId: unitOf(cola, 'BOX').id, qty: 1 },
      { unitId: flow.pcs(water), qty: '3' },
    ];
    const quoted = (await station().tool(callId, 'quote', 12, { lines }).expect(200)).body as {
      answer: {
        quoteId: string;
        preliminary: boolean;
        total: string;
        lines: { productId: number; qty: string; total: string }[];
      };
    };
    expect(quoted.answer).toMatchObject({
      preliminary: true,
      total: '13500',
      lines: [
        { productId: cola.id, qty: '1', total: '12000' },
        { productId: water.id, qty: '3', total: '1500' },
      ],
    });
    quoteId = quoted.answer.quoteId;
    const place = (seq: number, afterSeq = seq - 1, id = quoteId) =>
      station().tool(
        callId,
        'place_order',
        seq,
        { quoteId: id, fulfilment: 'DELIVERY' },
        idempotency(),
        afterSeq,
      );
    // Straight after the quote: nobody read it back, nobody answered.
    expect((await place(13).expect(409)).body).toMatchObject({ code: 'PHONE_ORDER_NOT_CONFIRMED' });
    // The agent read it back, the caller has not answered yet.
    await station()
      .events(callId, [
        { seq: 14, role: 'AGENT', text: 'Нэг хайрцаг кола, гурван ус, нийт 13500. Зөв үү?' },
      ])
      .expect(200);
    expect((await place(15).expect(409)).body).toMatchObject({ code: 'PHONE_ORDER_NOT_CONFIRMED' });
    // The caller answered, but a turn before it never arrived (16 is missing).
    await station()
      .events(callId, [{ seq: 17, role: 'USER', text: 'Тийм' }])
      .expect(200);
    expect((await place(18, 17).expect(409)).body).toMatchObject({
      code: 'PHONE_ORDER_NOT_CONFIRMED',
    });
    // A quote id that is not this call's latest quote.
    await station()
      .events(callId, [{ seq: 16, role: 'USER', text: 'Аан' }])
      .expect(200);
    expect((await place(19, 18, randomUUID()).expect(409)).body).toMatchObject({
      code: 'PHONE_QUOTE_NOT_FOUND',
    });
    expect(await phoneOrders()).toBe('0');
    // Every refusal is in the transcript at its own number: no gap is left behind.
    const refusals = await sql.query<{ seq: number; code: string }>(
      "SELECT seq, meta->>'code' AS code FROM phone_call_messages WHERE call_id = $1 AND meta->>'ok' = 'false' AND meta->>'tool' = 'place_order' ORDER BY seq",
      [callId],
    );
    expect(refusals.rows).toEqual([
      { seq: 13, code: 'PHONE_ORDER_NOT_CONFIRMED' },
      { seq: 15, code: 'PHONE_ORDER_NOT_CONFIRMED' },
      { seq: 18, code: 'PHONE_ORDER_NOT_CONFIRMED' },
      { seq: 19, code: 'PHONE_QUOTE_NOT_FOUND' },
    ]);
  });

  it('places a draft on the PHONE_AI stage once the caller answered the read-back', async () => {
    // The store is on a credit hold: a draft passes no credit check, the office's confirm will.
    await http()
      .put(`/api/v1/customers/${store.id}/credit`)
      .set(bearer(admin))
      .send({
        creditLimit: '1',
        settlementGroup: 'DAY_20',
        creditHold: true,
        creditHoldReason: 'Тест',
      })
      .expect(200);
    const idem = idempotency();
    const args = { quoteId, fulfilment: 'DELIVERY', note: 'Өглөө хүргэнэ' };
    const placed = await station().tool(callId, 'place_order', 20, args, idem, 19).expect(200);
    const answer = (placed.body as { answer: Record<string, string> }).answer;
    expect(answer).toEqual({
      number: expect.any(String),
      fulfilment: 'DELIVERY',
      deliveryDate: addDays(today, 1),
    });
    orderNumber = answer.number ?? '';
    // The lost answer asked again: by the same key, and by the same number under a new key.
    const replay = await station().tool(callId, 'place_order', 20, args, idem, 19).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const again = await station().tool(callId, 'place_order', 20, args, idempotency(), 19);
    expect(again.status).toBe(200);
    expect((again.body as { answer: Record<string, string> }).answer).toEqual(answer);
    // The number holds this tool call: another one there is refused, and so is a second order.
    const taken = await station().tool(callId, 'end_call', 20, {}, idempotency(), 19).expect(409);
    expect(taken.body).toMatchObject({ code: 'PHONE_SEQ_TAKEN' });
    const second = await station().tool(callId, 'place_order', 21, args).expect(409);
    expect(second.body).toMatchObject({ code: 'PHONE_ORDER_PLACED' });
    expect(await phoneOrders()).toBe('1');

    const order = await sql.query<{
      id: string;
      status: string;
      channel: string;
      payment_method: string;
      delivery_date: string;
      fulfilment: string;
      stage_id: string;
      created_by: string | null;
      customer_user_id: string | null;
      customer_id: string;
      contact_phone: string;
      address_id: string | null;
      total: string | null;
      note: string;
    }>(
      `SELECT id::text, status, channel, payment_method, delivery_date::text, fulfilment,
              stage_id::text, created_by, customer_user_id, customer_id::text, contact_phone,
              address_id::text, total, note
         FROM sales_orders WHERE number = $1`,
      [orderNumber],
    );
    expect(order.rows[0]).toEqual({
      id: expect.any(String),
      status: 'DRAFT',
      channel: 'PHONE_AI',
      payment_method: 'CREDIT',
      delivery_date: addDays(today, 1),
      fulfilment: 'DELIVERY',
      stage_id: String(flow.stage('Захиалга').id),
      created_by: null,
      customer_user_id: null,
      customer_id: String(store.id),
      contact_phone: storePhone,
      address_id: String(store.addresses[0]?.id),
      total: null,
      note: 'Өглөө хүргэнэ',
    });
    const orderId = order.rows[0]?.id;
    // Exactly the quote's lines; nothing reserved, nothing invoiced, no credit decision.
    const lines = await sql.query<{ product_id: string; qty: string }>(
      'SELECT product_id::text, qty::text FROM sales_order_lines WHERE order_id = $1 ORDER BY line_no',
      [orderId],
    );
    expect(lines.rows).toEqual([
      { product_id: String(cola.id), qty: '1.000' },
      { product_id: String(water.id), qty: '3.000' },
    ]);
    const reserved = await sql.query<{ count: string }>(
      "SELECT count(*) FROM stock_reservations WHERE doc_type = 'SO' AND doc_id = $1",
      [orderId],
    );
    expect(reserved.rows[0]?.count).toBe('0');
    const invoices = await sql.query<{ count: string }>(
      'SELECT count(*) FROM invoices WHERE order_id = $1',
      [orderId],
    );
    expect(invoices.rows[0]?.count).toBe('0');
    // The author is the line: in the audit and on the order's first event.
    const audit = await sql.query<{ actor_kind: string; actor_id: string }>(
      "SELECT actor_kind, actor_id::text FROM audit_log WHERE entity = 'sales_orders' AND entity_id = $1 AND action = 'CREATE'",
      [orderId],
    );
    expect(audit.rows).toEqual([{ actor_kind: 'PHONE_LINE', actor_id: String(lineId) }]);
    const events = await sql.query<{ actor_label: string; to_status: string }>(
      'SELECT actor_label, to_status FROM order_status_events WHERE order_id = $1',
      [orderId],
    );
    expect(events.rows).toEqual([{ actor_label: 'phone-ai', to_status: 'DRAFT' }]);
    const call = await sql.query<{ outcome: string; order_number: string; sales_order_id: string }>(
      'SELECT outcome, order_number, sales_order_id::text FROM phone_calls WHERE id = $1',
      [callId],
    );
    expect(call.rows[0]).toEqual({
      outcome: 'ORDERED',
      order_number: orderNumber,
      sales_order_id: orderId,
    });
    // The office sees it on its board and is told at once; it confirms like any draft.
    const onBoard = (await flow.orders.get(Number(orderId))) as unknown as { channel: string };
    expect(onBoard.channel).toBe('PHONE_AI');
    expect(await notificationsOf(admin)).toContainEqual(
      expect.objectContaining({
        kind: 'PHONE_ORDER',
        orderNumber,
        customerName: 'Утасны дэлгүүр',
        callId,
      }),
    );
    // The office's confirm is where credit is decided: the hold refuses it there, not before.
    expect((await flow.confirm(Number(orderId))).status).toBe(409);
  });

  it('tells a store only its own orders: another store’s number is «not found»', async () => {
    const foreign = await flow.draft(other.id, [{ productUnitId: flow.pcs(water), qty: '1' }]);
    const status = async (seq: number, number?: string) =>
      (
        await station()
          .tool(callId, 'order_status', seq, number === undefined ? {} : { number })
          .expect(200)
      ).body as { answer: { found: boolean; orders: Record<string, unknown>[] } };
    const own = await status(22, orderNumber);
    expect(own.answer).toEqual({
      found: true,
      orders: [
        {
          number: orderNumber,
          state: 'PENDING',
          createdDate: today,
          fulfilment: 'DELIVERY',
          deliveryDate: addDays(today, 1),
        },
      ],
    });
    const others = await status(23, foreign.number ?? '');
    const never = await status(24, 'ZZ-000000');
    expect(foreign.number).toEqual(expect.any(String));
    expect(others.answer).toEqual({ found: false, orders: [] });
    expect(others.answer).toEqual(never.answer);
    const latest = await status(25);
    expect(latest.answer.orders.map((row) => row.number)).toEqual([orderNumber]);
    // No amount, no credit word in any answer of the call.
    const answers = await sql.query<{ meta: string }>(
      "SELECT meta::text AS meta FROM phone_call_messages WHERE call_id = $1 AND role = 'TOOL'",
      [callId],
    );
    expect(answers.rows.map((row) => row.meta).join(' ')).not.toMatch(/credit|hold|limit|debt/i);
  });

  it('suggests new products in stock once per call', async () => {
    const first = (await station().tool(callId, 'new_products', 26, { limit: 3 }).expect(200))
      .body as { answer: { products: { productId: number }[] } };
    expect(first.answer.products.map((row) => row.productId).sort()).toEqual(
      [cola.id, water.id].sort(),
    );
    const again = (await station().tool(callId, 'new_products', 27, {}).expect(200)).body as {
      answer: { products: unknown[]; alreadySuggested: boolean };
    };
    expect(again.answer).toEqual({ products: [], alreadySuggested: true });
    await station().tool(callId, 'new_products', 28, { limit: 9 }).expect(422);
  });

  it('ends the call once and fills the missing turns from the provider', async () => {
    await station().tool(callId, 'end_call', 29, { reason: 'Баярлалаа' }).expect(200);
    const idem = idempotency();
    const body = { reason: 'COMPLETED', durationS: 95 };
    const ended = await station().end(callId, body, idem).expect(200);
    expect(ended.body).toEqual({ callId, outcome: 'ORDERED', orderNumber });
    expect(
      (await station().end(callId, body, idem).expect(200)).headers['idempotent-replayed'],
    ).toBe('true');
    // A second end under a new key changes nothing.
    await station().end(callId, { reason: 'ERROR', durationS: 1 }).expect(200);
    const row = await sql.query<{ duration_s: number; end_reason: string; outcome: string }>(
      'SELECT duration_s, end_reason, outcome FROM phone_calls WHERE id = $1',
      [callId],
    );
    expect(row.rows[0]).toEqual({ duration_s: 95, end_reason: 'COMPLETED', outcome: 'ORDERED' });
    const jobs = await sql.query<{ count: string }>(
      "SELECT count(*) FROM pgboss.job WHERE name = 'phoneagent.reconcile' AND data->>'callId' = $1",
      [String(callId)],
    );
    expect(jobs.rows[0]?.count).toBe('1');
    const late = await station().tool(callId, 'search_products', 30, { query: 'Ус' }).expect(409);
    expect(late.body).toMatchObject({ code: 'PHONE_CALL_ENDED' });

    // The provider's copy: the stored turns, and two the bridge never delivered.
    provider.conversations.set('conv_main', {
      conversation_id: 'conv_main',
      status: 'done',
      metadata: { call_duration_secs: 97, cost: 412 },
      transcript: [
        { role: 'agent', message: 'Сайн байна уу, юугаар туслах вэ?', time_in_call_secs: 1 },
        { role: 'user', message: 'Кола  байна уу', time_in_call_secs: 2 },
        {
          role: 'agent',
          message: null,
          time_in_call_secs: 3,
          tool_calls: [{ tool_name: 'quote' }],
        },
        { role: 'agent', message: 'Кола байгаа. Хэдийг авах вэ?', time_in_call_secs: 5 },
        { role: 'user', message: 'Нэг хайрцаг', time_in_call_secs: 8 },
        {
          role: 'agent',
          message: 'Нэг хайрцаг кола, гурван ус, нийт 13500. Зөв үү?',
          time_in_call_secs: 14,
        },
        { role: 'user', message: 'Аан', time_in_call_secs: 16 },
        { role: 'user', message: 'Тийм', time_in_call_secs: 17 },
      ],
    });
    const before = await sql.query<{ seq: number; text: string }>(
      'SELECT seq, text FROM phone_call_messages WHERE call_id = $1 ORDER BY seq',
      [callId],
    );
    const flowService = app.get(PhoneReconcileFlowService);
    expect(await flowService.reconcile(callId)).toEqual({ status: 'done', added: 2 });
    const after = await sql.query<{
      seq: number;
      role: string;
      text: string;
      source: string;
      at_ms: number;
    }>(
      "SELECT seq, role, text, meta->>'source' AS source, at_ms FROM phone_call_messages WHERE call_id = $1 ORDER BY seq",
      [callId],
    );
    // What was stored is as it was; the two missing turns are appended, marked RECONCILED.
    expect(after.rows.slice(0, before.rows.length).map(({ seq, text }) => ({ seq, text }))).toEqual(
      before.rows,
    );
    expect(after.rows.slice(before.rows.length)).toEqual([
      {
        seq: 31,
        role: 'AGENT',
        text: 'Кола байгаа. Хэдийг авах вэ?',
        source: 'RECONCILED',
        at_ms: 5000,
      },
      { seq: 32, role: 'USER', text: 'Нэг хайрцаг', source: 'RECONCILED', at_ms: 8000 },
    ]);
    expect(await flowService.reconcile(callId)).toEqual({ status: 'skipped', why: 'already' });
    const detail = (
      await http().get(`/api/v1/phone-calls/${callId}`).set(bearer(admin)).expect(200)
    ).body as {
      call: Record<string, unknown>;
      messages: { seq: number; atMs: number; meta: { source: string } }[];
    };
    expect(detail.call).toMatchObject({
      id: callId,
      customerName: 'Утасны дэлгүүр',
      callerPhone: storePhone,
      outcome: 'ORDERED',
      orderNumber,
      durationS: 95,
      costEstimate: '412.0000',
      reconciled: true,
    });
    // The transcript reads in the order it was spoken: a reconciled turn sits where it was said.
    expect(detail.messages.map((message) => message.atMs)).toEqual(
      [...detail.messages.map((message) => message.atMs)].sort((a, b) => a - b),
    );
    expect(detail.messages).toHaveLength(after.rows.length);
  });

  it('keeps a transcript append-only and closes a call the bridge never ended', async () => {
    expect(
      await sqlStateOf(
        sql.query("UPDATE phone_call_messages SET text = 'x' WHERE call_id = $1", [callId]),
      ),
    ).toBe('42501');
    expect(
      await sqlStateOf(sql.query('DELETE FROM phone_call_messages WHERE call_id = $1', [callId])),
    ).toBe('42501');
    expect(await sqlStateOf(sql.query('DELETE FROM phone_calls WHERE id = $1', [callId]))).toBe(
      '42501',
    );
    const lost = await answered(contactPhone);
    await station()
      .events(lost.callId, [{ seq: 1, role: 'USER', text: 'Захиалга шалгах гэсэн' }])
      .expect(200);
    await station().tool(lost.callId, 'order_status', 2, {}).expect(200);
    await sql.query(
      "UPDATE phone_calls SET started_at = now() - interval '16 minutes' WHERE id = $1",
      [lost.callId],
    );
    expect((await app.get(PhoneReconcileFlowService).sweep()).closed).toBeGreaterThanOrEqual(1);
    const row = await sql.query<{ outcome: string; ended: boolean; end_reason: string | null }>(
      'SELECT outcome, ended_at IS NOT NULL AS ended, end_reason FROM phone_calls WHERE id = $1',
      [lost.callId],
    );
    expect(row.rows[0]).toEqual({ outcome: 'STATUS_ONLY', ended: true, end_reason: null });
    // No conversation id was ever told: there is nothing to reconcile against.
    expect(await app.get(PhoneReconcileFlowService).reconcile(lost.callId)).toEqual({
      status: 'skipped',
      why: 'no_conversation',
    });
    expect((await app.get(PhoneReconcileFlowService).sweep()).closed).toBe(0);
  });

  it('lists calls and callbacks for phone.calls.read, and closes a task once', async () => {
    const calls = (
      await http()
        .get('/api/v1/phone-calls')
        .query({ outcome: 'ORDERED' })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: { id: number; orderNumber: string | null }[] };
    expect(calls.data).toEqual([expect.objectContaining({ id: callId, orderNumber })]);
    const declined = (
      await http()
        .get('/api/v1/phone-calls')
        .query({ answered: 'false', limit: 2 })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: { answered: boolean }[]; nextCursor: string | null };
    expect(declined.data).toHaveLength(2);
    expect(declined.nextCursor).toEqual(expect.any(String));
    const open = (await http().get('/api/v1/phone-callbacks').set(bearer(admin)).expect(200))
      .body as { data: { id: number; status: string; reason: string }[] };
    expect(open.data).toHaveLength(3);
    const task = open.data[0];
    const close = (status: string) =>
      http()
        .post(`/api/v1/phone-callbacks/${task?.id}/close`)
        .set(bearer(admin))
        .set(idempotency())
        .send({ status });
    expect((await close('DONE').expect(200)).body).toMatchObject({ status: 'DONE' });
    expect((await close('DROPPED').expect(409)).body).toMatchObject({
      code: 'PHONE_CALLBACK_STATE',
    });
    const left = (await http().get('/api/v1/phone-callbacks').set(bearer(admin)).expect(200))
      .body as { data: unknown[] };
    expect(left.data).toHaveLength(2);
    await http().get('/api/v1/phone-callbacks').set(bearer(office)).expect(403);
    await http().get(`/api/v1/phone-calls/${callId}`).set(bearer(office)).expect(403);
  });
});
