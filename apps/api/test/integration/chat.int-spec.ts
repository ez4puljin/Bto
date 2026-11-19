import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool, type PoolClient } from 'pg';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { CHAT_LIMITS } from '@tugeel/shared/chat';
import { createHttpApp } from '../harness/apps';
import { idempotency, type ProductJson } from '../harness/catalog';
import { type AppStore, appStore, storeOrderBody } from '../harness/customer-app';
import { salesFlow } from '../harness/finance';
import { bearer, login, type SeededUser, seedUser } from '../harness/identity';

interface ButtonJson {
  id: string;
  label: string;
}
interface MessageJson {
  id: number;
  sender: 'CUSTOMER' | 'BOT' | 'STAFF';
  staffUserId: number | null;
  staffName: string | null;
  body: string;
  buttons: ButtonJson[] | null;
  buttonId: string | null;
  flowNode: string | null;
}
interface ConversationJson {
  id: number;
  mode: 'BOT' | 'STAFF';
  awaitingStaff: boolean;
  unread: number;
  buttons: ButtonJson[];
}
interface ChatJson {
  conversation: ConversationJson;
  messages: MessageJson[];
  nextCursor: string | null;
  rep: { name: string; phone: string | null } | null;
}
interface SentJson {
  conversation: ConversationJson;
  messages: MessageJson[];
}
interface StaffChatJson {
  id: number;
  customerId: number;
  customerName: string;
  mode: 'BOT' | 'STAFF';
  awaitingStaff: boolean;
  unread: number;
  closedAt: string | null;
  lastMessage: MessageJson | null;
  reps: { id: number; name: string }[];
}
interface WireEvent {
  event: string;
  data: Record<string, unknown>;
}

const BOT = mn.chat.bot;
const MENU = [
  { id: 'ORDER_STATUS', label: 'Захиалгын төлөв' },
  { id: 'DELIVERY_INFO', label: 'Хүргэлтийн мэдээлэл' },
  { id: 'BALANCE', label: 'Тооцооны үлдэгдэл' },
  { id: 'HOURS_ADDRESS', label: 'Ажлын цаг, хаяг' },
  { id: 'STAFF', label: 'Ажилтантай холбогдох' },
];

/**
 * The customer chat (ADR-0224): a store's one conversation, the scripted bot's greeting and four
 * topics, the hand-off to staff, the staff's answer, the close, the unread counts, the live
 * streams and the rights. Synthetic data.
 */
describe('customer chat (ADR-0224)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let admin: string;
  let office: string;
  let officeId: number;
  let accountant: string;
  let rep: string;
  let repUser: SeededUser;
  let otherRep: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let tea: ProductJson;
  /** Asks the topics. */
  let store: AppStore;
  /** Never sees the first one's conversation; taken over by staff. */
  let other: AppStore;
  /** Hands off, is answered and closed. */
  let third: AppStore;
  let soldNumber: string;
  let pendingNumber: string;
  let otherNumber: string;
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  const open = async (target: AppStore) =>
    (await target.api.post('/chat/open').expect(200)).body as ChatJson;
  const send = (target: AppStore, body: { text?: string; buttonId?: string }) =>
    target.api.post('/chat/messages', body).set(idempotency());
  const sent = async (target: AppStore, body: { text?: string; buttonId?: string }) =>
    (await send(target, body).expect(201)).body as SentJson;
  const staffGet = async <T>(path: string, token: string, query: Record<string, unknown> = {}) =>
    (await http().get(`/api/v1/chat${path}`).query(query).set(bearer(token)).expect(200)).body as T;
  const staffList = async (token: string, state?: string) =>
    (await staffGet<{ data: StaffChatJson[] }>('/conversations', token, state ? { state } : {}))
      .data;
  const reply = (token: string, id: number, text: string) =>
    http()
      .post(`/api/v1/chat/conversations/${id}/messages`)
      .set(bearer(token))
      .set(idempotency())
      .send({ text });
  const close = (token: string, id: number) =>
    http().post(`/api/v1/chat/conversations/${id}/close`).set(bearer(token));

  /** An app order of `target`; sold by the office when `sell`. Returns its number. */
  const ordered = async (target: AppStore, qty: string, sell: boolean): Promise<string> => {
    const order = (
      await target.api
        .send(storeOrderBody(today, [{ productUnitId: flow.pcs(tea), qty }]))
        .expect(201)
    ).body as { id: number; number: string };
    if (sell) await flow.sell(order.id);
    return order.number;
  };

  /** Opens an SSE route over a real socket and collects its events. */
  const openStream = (path: string, token: string) => {
    const events: WireEvent[] = [];
    let status = 0;
    let response: IncomingMessage | null = null;
    const opened = new Promise<void>((resolve, reject) => {
      const req = get(
        `${baseUrl}${path}`,
        { headers: { Authorization: `Bearer ${token}` } },
        (res) => {
          response = res;
          status = res.statusCode ?? 0;
          res.setEncoding('utf8');
          let buffer = '';
          res.on('data', (chunk: string) => {
            buffer += chunk;
            let end = buffer.indexOf('\n\n');
            while (end >= 0) {
              const block = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const event = /^event: (.*)$/m.exec(block)?.[1];
              const data = /^data: (.*)$/m.exec(block)?.[1];
              if (event) {
                events.push({
                  event,
                  data: data ? (JSON.parse(data) as Record<string, unknown>) : {},
                });
              }
              end = buffer.indexOf('\n\n');
            }
          });
          resolve();
        },
      );
      req.on('error', reject);
    });
    return {
      opened,
      events,
      status: () => status,
      async until(check: (event: WireEvent) => boolean): Promise<WireEvent> {
        const deadline = Date.now() + 5_000;
        for (;;) {
          const found = events.find(check);
          if (found) return found;
          if (Date.now() > deadline) throw new Error(`no such event in ${JSON.stringify(events)}`);
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      },
      close: () => response?.destroy(),
    };
  };

  beforeAll(async () => {
    app = await createHttpApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const officeUser = await seedUser(app, { roles: ['OFFICE'] });
    officeId = officeUser.id;
    office = (await login(app, officeUser)).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    repUser = await seedUser(app, { roles: ['SALES_REP'] });
    rep = (await login(app, repUser)).accessToken;
    otherRep = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;
    flow = await salesFlow(app, admin, 'CHT');
    await http()
      .put('/api/v1/sales-settings/channels')
      .set(bearer(admin))
      .send({
        channel: 'CUSTOMER_APP',
        pipelineId: flow.pipeline.id,
        stageId: flow.stage('Захиалга').id,
      })
      .expect(200);
    tea = await flow.product('9401', 'Чатын цай', '2500', '100');
    store = await appStore(app, office);
    other = await appStore(app, office);
    third = await appStore(app, office);
    soldNumber = await ordered(store, '4', true);
    pendingNumber = await ordered(store, '1', false);
    otherNumber = await ordered(other, '1', true);
    // The third store stands on the first rep's round; the other rep's round is empty.
    await http()
      .put(`/api/v1/rep-visits/plans/${repUser.id}/1`)
      .set(bearer(admin))
      .send({ customerIds: [third.customerId] })
      .expect(200);
  });
  afterAll(async () => {
    await app.close();
  });

  it('opens a store’s one conversation with the greeting and the five buttons', async () => {
    expect((await store.api.get('/chat/unread').expect(200)).body).toEqual({ unread: 0 });
    const chat = await open(store);
    expect(chat.conversation).toMatchObject({ mode: 'BOT', awaitingStaff: false, unread: 0 });
    expect(chat.conversation.buttons).toEqual(MENU);
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toMatchObject({
      sender: 'BOT',
      flowNode: 'GREETING',
      body: BOT.defaults.greeting,
      buttons: MENU,
      staffUserId: null,
    });
    expect(chat.nextCursor).toBeNull();
    // A second open is the same conversation, not a second greeting.
    const again = await open(store);
    expect(again.conversation.id).toBe(chat.conversation.id);
    expect(again.messages).toHaveLength(1);
  });

  it('answers the four topics from the store’s own data and the office’s texts', async () => {
    const orders = await sent(store, { buttonId: 'ORDER_STATUS' });
    expect(orders.messages.map((message) => message.sender)).toEqual(['CUSTOMER', 'BOT']);
    expect(orders.messages[0]).toMatchObject({ body: 'Захиалгын төлөв', buttonId: 'ORDER_STATUS' });
    const status = orders.messages[1];
    expect(status).toMatchObject({ flowNode: 'ORDER_STATUS', buttons: MENU });
    expect(status?.body.split('\n')).toEqual([
      BOT.orders.title,
      `${pendingNumber} · ${today} · ${mn.sales.customerStates.PENDING}`,
      `${soldNumber} · ${today} · ${mn.sales.customerStates.DELIVERED}`,
    ]);
    expect(status?.body).not.toContain(otherNumber);

    const delivery = await sent(store, { buttonId: 'DELIVERY_INFO' });
    expect(delivery.messages[1]).toMatchObject({
      flowNode: 'DELIVERY_INFO',
      body: BOT.defaults.deliveryText,
    });
    const hours = await sent(store, { buttonId: 'HOURS_ADDRESS' });
    expect(hours.messages[1]).toMatchObject({
      flowNode: 'HOURS_ADDRESS',
      body: BOT.defaults.hoursText,
    });

    const balance = await sent(store, { buttonId: 'BALANCE' });
    expect(balance.messages[1]).toMatchObject({ flowNode: 'BALANCE', body: 'Таны өр: 10,000₮' });
    expect(balance.conversation).toMatchObject({ mode: 'BOT', unread: 0, buttons: MENU });
    // The other store reads its own figures, never the first one's.
    const theirs = await sent(other, { buttonId: 'BALANCE' });
    expect(theirs.messages[1]?.body).toBe('Таны өр: 2,500₮');
    const theirOrders = await sent(other, { buttonId: 'ORDER_STATUS' });
    expect(theirOrders.messages[1]?.body).toContain(otherNumber);
    expect(theirOrders.messages[1]?.body).not.toContain(soldNumber);
  });

  it('offers the buttons once for a text that repeats none, and never guesses', async () => {
    const first = await sent(store, { text: '  Маргааш ирэх үү?  ' });
    expect(first.messages[0]).toMatchObject({ body: 'Маргааш ирэх үү?', buttonId: null });
    expect(first.messages[1]).toMatchObject({
      flowNode: 'FALLBACK',
      body: BOT.fallback,
      buttons: MENU,
    });
    const second = await sent(store, { text: 'Сонсож байна уу' });
    expect(second.messages).toHaveLength(1);
    expect(second.conversation.buttons).toEqual(MENU);
    // A typed label is its button.
    const typed = await sent(store, { text: 'ажлын цаг, хаяг' });
    expect(typed.messages[0]).toMatchObject({ buttonId: 'HOURS_ADDRESS' });
    expect(typed.messages[1]).toMatchObject({ flowNode: 'HOURS_ADDRESS' });

    await send(store, {}).expect(422);
    await send(store, { text: 'a', buttonId: 'BALANCE' }).expect(422);
    await send(store, { buttonId: 'NO_SUCH' }).expect(422);
    await send(store, { text: 'я'.repeat(CHAT_LIMITS.messageMax + 1) }).expect(422);
    await store.api.post('/chat/messages', { text: 'түлхүүргүй' }).expect(400);
    // The same Idempotency-Key writes one message.
    const key = idempotency();
    const once = await store.api.post('/chat/messages', { text: 'Нэг удаа' }).set(key).expect(201);
    const twice = await store.api.post('/chat/messages', { text: 'Нэг удаа' }).set(key).expect(201);
    expect((twice.body as SentJson).messages[0]?.id).toBe((once.body as SentJson).messages[0]?.id);
  });

  it('keeps a store’s conversation to that store', async () => {
    const mine = await open(store);
    const theirs = await open(other);
    expect(theirs.conversation.id).not.toBe(mine.conversation.id);
    expect(theirs.messages.map((message) => message.flowNode ?? message.buttonId)).toEqual([
      'GREETING',
      'BALANCE',
      'BALANCE',
      'ORDER_STATUS',
      'ORDER_STATUS',
    ]);
    const older = (await other.api.get('/chat/messages?limit=2').expect(200)).body as {
      data: MessageJson[];
      nextCursor: string | null;
    };
    expect(older.data).toHaveLength(2);
    expect(older.nextCursor).not.toBeNull();
    const page = (
      await other.api.get(`/chat/messages?limit=2&cursor=${older.nextCursor}`).expect(200)
    ).body as { data: MessageJson[] };
    const ids = new Set(mine.messages.map((message) => message.id));
    expect([...older.data, ...page.data].some((message) => ids.has(message.id))).toBe(false);
    // A customer token reaches no staff route, a staff token no store route.
    await http().get('/api/v1/chat/conversations').set(bearer(store.token)).expect(403);
    await http()
      .get(`/api/v1/chat/conversations/${mine.conversation.id}/messages`)
      .set(bearer(other.token))
      .expect(403);
    await http().post('/api/v1/customer-app/chat/open').set(bearer(office)).expect(403);
    await http().post('/api/v1/customer-app/chat/open').expect(401);
  });

  it('hands a conversation to staff: it waits for the holders of chat.answer', async () => {
    const chat = await open(third);
    expect(await staffList(office, 'WAITING')).toEqual([]);
    const handed = await sent(third, { buttonId: 'STAFF' });
    expect(handed.messages[1]).toMatchObject({
      flowNode: 'HANDOFF',
      body: BOT.handoff,
      buttons: null,
    });
    expect(handed.conversation).toMatchObject({ mode: 'STAFF', awaitingStaff: true, buttons: [] });
    // With staff the bot is silent, whatever the store writes.
    const waiting = await sent(third, { text: 'Захиалгын төлөв' });
    expect(waiting.messages).toHaveLength(1);

    for (const token of [office, admin]) {
      const list = await staffList(token, 'WAITING');
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: chat.conversation.id,
        customerId: third.customerId,
        mode: 'STAFF',
        awaitingStaff: true,
        unread: 2,
        lastMessage: { sender: 'CUSTOMER', body: 'Захиалгын төлөв' },
      });
      expect(list[0]?.customerName).not.toBe('');
    }
    expect(await staffGet('/unread', office)).toEqual({ waiting: 1, unread: 2 });
    expect((await staffList(office, 'ALL')).map((row) => row.customerId).sort()).toEqual(
      [store.customerId, other.customerId, third.customerId].sort(),
    );
    const history = await staffGet<{ data: MessageJson[] }>(
      `/conversations/${chat.conversation.id}/messages`,
      office,
    );
    expect(history.data.map((message) => message.sender)).toEqual([
      'BOT',
      'CUSTOMER',
      'BOT',
      'CUSTOMER',
    ]);
    // Without a chat right every staff route is refused.
    await http().get('/api/v1/chat/conversations').set(bearer(accountant)).expect(403);
    await http().get('/api/v1/chat/unread').set(bearer(accountant)).expect(403);
    await http()
      .get(`/api/v1/chat/conversations/${chat.conversation.id}`)
      .set(bearer(accountant))
      .expect(403);
    await reply(accountant, chat.conversation.id, 'Сайн байна уу').expect(403);
    await close(accountant, chat.conversation.id).expect(403);
    const refused = openStream('/api/v1/chat/live', accountant);
    await refused.opened;
    expect(refused.status()).toBe(403);
    refused.close();
  });

  it('shows a waiting conversation to the rep of the store’s round, and to no other rep', async () => {
    const mine = await staffList(rep, 'WAITING');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      customerId: third.customerId,
      awaitingStaff: true,
      reps: [{ id: repUser.id, name: 'Тест хэрэглэгч' }],
    });
    const id = mine[0]?.id ?? 0;
    expect(await staffGet('/unread', rep)).toEqual({ waiting: 1, unread: 2 });
    // The rep sees only its own stores, whatever the state asked for.
    expect((await staffList(rep, 'ALL')).map((row) => row.customerId)).toEqual([third.customerId]);
    await staffGet(`/conversations/${id}/messages`, rep);
    // Another rep: nothing in the list, and the conversation does not exist for them.
    expect(await staffList(otherRep, 'ALL')).toEqual([]);
    expect(await staffGet('/unread', otherRep)).toEqual({ waiting: 0, unread: 0 });
    for (const path of [`/conversations/${id}`, `/conversations/${id}/messages`]) {
      await http().get(`/api/v1/chat${path}`).set(bearer(otherRep)).expect(404);
    }
    await reply(otherRep, id, 'Миний дэлгүүр биш').expect(404);
    await close(otherRep, id).expect(404);
    const [storeChat] = (await staffList(office, 'ALL')).filter(
      (row) => row.customerId === store.customerId,
    );
    await http().get(`/api/v1/chat/conversations/${storeChat?.id}`).set(bearer(rep)).expect(404);
    await http().get('/api/v1/chat/settings').set(bearer(rep)).expect(403);
    // «Залгах»: the store on a round gets its rep, a store on none gets null.
    expect((await open(third)).rep).toEqual({ name: 'Тест хэрэглэгч', phone: repUser.phone });
    expect((await open(store)).rep).toBeNull();
  });

  it('carries a staff answer to the store, live and as an unread message', async () => {
    const [waiting] = await staffList(office, 'WAITING');
    if (!waiting) throw new Error('nothing waits');
    const seen = (
      await http()
        .post(`/api/v1/chat/conversations/${waiting.id}/read`)
        .set(bearer(office))
        .expect(200)
    ).body as StaffChatJson;
    expect(seen).toMatchObject({ unread: 0, awaitingStaff: true });
    expect(await staffGet('/unread', office)).toEqual({ waiting: 1, unread: 0 });

    const storeLive = openStream('/api/v1/customer-app/chat/live', third.token);
    const otherLive = openStream('/api/v1/customer-app/chat/live', other.token);
    const staffLive = openStream('/api/v1/chat/live', admin);
    const repLive = openStream('/api/v1/chat/live', rep);
    const otherRepLive = openStream('/api/v1/chat/live', otherRep);
    try {
      const lives = [storeLive, otherLive, staffLive, repLive, otherRepLive];
      await Promise.all(lives.map((live) => live.opened));
      expect(storeLive.status()).toBe(200);
      await Promise.all(lives.map((live) => live.until((event) => event.event === 'ready')));
      const answered = (await reply(office, waiting.id, '  Сайн байна уу, шалгая.  ').expect(201))
        .body as { conversation: StaffChatJson; message: MessageJson };
      expect(answered.message).toMatchObject({
        sender: 'STAFF',
        staffUserId: officeId,
        staffName: 'Тест хэрэглэгч',
        body: 'Сайн байна уу, шалгая.',
      });
      expect(answered.conversation).toMatchObject({ mode: 'STAFF', awaitingStaff: false });

      const heard = await storeLive.until((event) => event.event === 'message');
      expect(heard.data).toMatchObject({
        conversation: { id: waiting.id, mode: 'STAFF', unread: 1, buttons: [] },
        message: { id: answered.message.id, sender: 'STAFF', body: 'Сайн байна уу, шалгая.' },
      });
      expect(heard.data.conversation).not.toHaveProperty('customerId');
      const staffHeard = await staffLive.until((event) => event.event === 'message');
      expect(staffHeard.data).toMatchObject({
        conversation: { id: waiting.id, customerId: third.customerId, awaitingStaff: false },
        message: { id: answered.message.id },
      });
      // The store answers: staff hear it; the other store hears nothing of either.
      const back = await sent(third, { text: 'Баярлалаа' });
      expect(back.messages).toHaveLength(1);
      await staffLive.until(
        (event) =>
          event.event === 'message' &&
          (event.data.message as MessageJson | null)?.id === back.messages[0]?.id,
      );
      await repLive.until(
        (event) =>
          event.event === 'message' &&
          (event.data.message as MessageJson | null)?.id === back.messages[0]?.id,
      );
      expect(otherLive.events.filter((event) => event.event !== 'ready')).toEqual([]);
      expect(otherRepLive.events.filter((event) => event.event !== 'ready')).toEqual([]);
    } finally {
      storeLive.close();
      otherLive.close();
      staffLive.close();
      repLive.close();
      otherRepLive.close();
    }

    expect((await third.api.get('/chat/unread').expect(200)).body).toEqual({ unread: 1 });
    expect(await staffList(office, 'WAITING')).toHaveLength(1);
    expect(await staffGet('/unread', office)).toEqual({ waiting: 1, unread: 1 });
    const read = (await third.api.post('/chat/read').expect(200)).body as ConversationJson;
    expect(read.unread).toBe(0);
    expect((await open(third)).messages.at(-2)).toMatchObject({ sender: 'STAFF' });
    await reply(office, waiting.id, '   ').expect(422);
    await reply(office, 999_999, 'Хэн бэ').expect(404);
  });

  it('closes a conversation back to the bot and keeps its history', async () => {
    const before = await open(third);
    // The store's rep closes it, as the office could.
    const closed = (await close(rep, before.conversation.id).expect(200)).body as StaffChatJson;
    expect(closed).toMatchObject({
      mode: 'BOT',
      awaitingStaff: false,
      unread: 0,
      lastMessage: { sender: 'BOT', flowNode: 'CLOSED', body: BOT.closed },
    });
    expect(closed.closedAt).not.toBeNull();
    expect(await staffList(office, 'STAFF')).toEqual([]);
    expect(await staffGet('/unread', office)).toEqual({ waiting: 0, unread: 0 });
    // The closing note reached the store unasked; the history stays.
    expect((await third.api.get('/chat/unread').expect(200)).body).toEqual({ unread: 1 });
    const after = await open(third);
    expect(after.conversation).toMatchObject({ mode: 'BOT', unread: 0, buttons: MENU });
    expect(after.messages).toHaveLength(before.messages.length + 1);
    // Closing it again writes nothing.
    await close(office, before.conversation.id).expect(200);
    expect((await open(third)).messages).toHaveLength(after.messages.length);
    // A new message starts with the bot again.
    const asked = await sent(third, { buttonId: 'DELIVERY_INFO' });
    expect(asked.messages[1]).toMatchObject({ sender: 'BOT', flowNode: 'DELIVERY_INFO' });
  });

  it('lets staff take over a conversation the store has not handed off', async () => {
    const theirs = await open(other);
    expect(theirs.conversation.mode).toBe('BOT');
    const taken = (await reply(admin, theirs.conversation.id, 'Танд туслах уу?').expect(201))
      .body as { conversation: StaffChatJson };
    expect(taken.conversation).toMatchObject({ mode: 'STAFF', awaitingStaff: false, unread: 0 });
    const answer = await sent(other, { buttonId: 'BALANCE' });
    expect(answer.messages).toHaveLength(1);
    expect(answer.conversation).toMatchObject({ mode: 'STAFF', awaitingStaff: true, buttons: [] });
    expect((await staffList(office, 'WAITING')).map((row) => row.customerId)).toEqual([
      other.customerId,
    ]);
    await close(admin, theirs.conversation.id).expect(200);
  });

  it('keeps the bot’s texts as settings of their own right', async () => {
    const settings = () => http().get('/api/v1/chat/settings');
    const save = (token: string, body: Record<string, unknown>) =>
      http().put('/api/v1/chat/settings').set(bearer(token)).send(body);
    await settings().set(bearer(office)).expect(403);
    await save(office, { greeting: 'Сайн уу' }).expect(403);
    expect((await settings().set(bearer(admin)).expect(200)).body).toMatchObject({
      greeting: null,
      deliveryText: null,
      hoursText: null,
      defaults: BOT.defaults,
    });
    await save(admin, { deliveryText: 'я'.repeat(CHAT_LIMITS.textMax + 1) }).expect(422);
    const saved = await save(admin, {
      greeting: null,
      deliveryText: '  Хүргэлтийн талаар оффисоос лавлана уу.  ',
      hoursText: '',
    }).expect(200);
    expect(saved.body).toMatchObject({
      greeting: null,
      deliveryText: 'Хүргэлтийн талаар оффисоос лавлана уу.',
      hoursText: null,
    });
    const delivery = await sent(third, { buttonId: 'DELIVERY_INFO' });
    expect(delivery.messages[1]?.body).toBe('Хүргэлтийн талаар оффисоос лавлана уу.');
    const hours = await sent(third, { buttonId: 'HOURS_ADDRESS' });
    expect(hours.messages[1]?.body).toBe(BOT.defaults.hoursText);
  });

  it('refuses a store’s messages past the minute’s limit', async () => {
    const busy = await appStore(app, office);
    for (let n = 1; n <= CHAT_LIMITS.sendsPerMinute; n += 1) {
      await send(busy, { text: `Мессеж ${n}` }).expect(201);
    }
    const refused = await send(busy, { text: 'Дахиад нэг' }).expect(429);
    expect((refused.body as { code: string }).code).toBe('TOO_MANY_REQUESTS');
    expect((await open(busy)).messages).toHaveLength(CHAT_LIMITS.sendsPerMinute + 2);
  });

  it('never lets a read clear a message that came while the read waited on the conversation', async () => {
    const racer = await appStore(app, office);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    /**
     * Holds the conversation's row lock in a transaction of its own, starts `read`, and once the
     * read waits on that lock commits `meanwhile` (what a reply or a send writes) under it.
     */
    const raced = async <T>(
      id: number,
      read: () => Promise<T>,
      meanwhile: (client: PoolClient) => Promise<void>,
    ): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM chat_conversations WHERE id = $1 FOR UPDATE', [id]);
        await meanwhile(client);
        const pending = read();
        const deadline = Date.now() + 5_000;
        for (;;) {
          const { rows } = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND query ILIKE '%chat_conversations%'`,
          );
          if ((rows[0]?.n ?? 0) > 0) break;
          if (Date.now() > deadline) throw new Error('the read never waited on the lock');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await client.query('COMMIT');
        return await pending;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };
    try {
      const chat = await open(racer);
      const id = chat.conversation.id;
      await reply(office, id, 'Эхний хариу').expect(201);
      expect((await racer.api.get('/chat/unread').expect(200)).body).toEqual({ unread: 1 });

      // A staff answer commits while the store's read waits: the read clears only the first one.
      const storeRead = await raced(
        id,
        async () => (await racer.api.post('/chat/read').expect(200)).body as ConversationJson,
        async (client) => {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO chat_messages (conversation_id, sender, staff_user_id, body)
             VALUES ($1, 'STAFF', $2, 'Хоёр дахь хариу') RETURNING id`,
            [id, officeId],
          );
          await client.query(
            `UPDATE chat_conversations SET customer_unread = customer_unread + 1,
                    last_message_id = $2, last_message_at = now() WHERE id = $1`,
            [id, rows[0]?.id],
          );
        },
      );
      expect(storeRead.unread).toBe(1);
      expect((await racer.api.get('/chat/unread').expect(200)).body).toEqual({ unread: 1 });
      expect((await racer.api.post('/chat/read').expect(200)).body).toMatchObject({ unread: 0 });

      // The mirror: a store's message commits while the staff's read waits.
      await sent(racer, { text: 'Асуулт байна' });
      const staffRead = await raced(
        id,
        async () =>
          (
            await http()
              .post(`/api/v1/chat/conversations/${id}/read`)
              .set(bearer(office))
              .expect(200)
          ).body as StaffChatJson,
        async (client) => {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO chat_messages (conversation_id, sender, customer_user_id, body)
             SELECT conversation_id, 'CUSTOMER', customer_user_id, 'Дахиад нэг асуулт'
               FROM chat_messages WHERE conversation_id = $1 AND sender = 'CUSTOMER' LIMIT 1
             RETURNING id`,
            [id],
          );
          await client.query(
            `UPDATE chat_conversations SET staff_unread = staff_unread + 1, awaiting_staff = true,
                    last_message_id = $2, last_message_at = now() WHERE id = $1`,
            [id, rows[0]?.id],
          );
        },
      );
      expect(staffRead.unread).toBe(1);
      expect((await staffGet<StaffChatJson>(`/conversations/${id}`, office)).unread).toBe(1);
      await close(office, id).expect(200);
    } finally {
      await pool.end();
    }
  });
});
