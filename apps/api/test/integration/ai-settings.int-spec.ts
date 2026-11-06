import type { NestExpressApplication } from '@nestjs/platform-express';
import { AI_DATA_GROUPS, aiDataPermission } from '@tugeel/shared/ai';
import type { Client } from 'pg';
import request from 'supertest';
import { type FetchFn, LLM_CLIENT, LLM_FETCH } from '../../src/integrations/llm';
import { FakeLlm, query } from '../harness/ai';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';

/** Not a real key: tests never reach a provider (ADR-0045), every fetch below is scripted. */
const TEST_KEY = 'test-key-not-real-abcdefghij-WXYZ';
const OTHER_KEY = 'other-test-key-not-real-0123-5678';
const EVERY_GROUP = AI_DATA_GROUPS.map(aiDataPermission);

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

/** The AI's connection, data groups, limits and meter over HTTP (ADR-0162). */
describe('AI settings', () => {
  let app: NestExpressApplication;
  const envClient = new FakeLlm();
  const sent: Sent[] = [];
  /** What the scripted provider says next; a call with nothing queued answers a plain text. */
  const answers: { status: number; body: unknown }[] = [];
  let sql: Client;
  let admin: string;
  let asker: string;
  let catalogOnly: string;
  let noGroups: string;
  let worker: string;
  const http = () => request(app.getHttpServer());

  const scriptedFetch: FetchFn = (url, init) => {
    sent.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body:
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    });
    const next = answers.shift();
    return Promise.resolve(
      new Response(
        JSON.stringify(
          next?.body ?? {
            model: 'answered-model',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'Товч дүгнэлт' }],
            usage: { input_tokens: 1000, output_tokens: 100 },
          },
        ),
        { status: next?.status ?? 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  };
  /** A model answer as Anthropic's API sends it. */
  const anthropicAnswer = (answer: unknown) => ({
    status: 200,
    body: {
      model: 'answered-model',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(answer) }],
      usage: { input_tokens: 1000, output_tokens: 100 },
    },
  });

  const patch = (body: Record<string, unknown>, token = admin) =>
    http().patch('/api/v1/ai/settings').set(bearer(token)).send(body);
  const view = (token = admin) => http().get('/api/v1/ai/settings').set(bearer(token));
  const usage = (query_ = '') => http().get(`/api/v1/ai/usage${query_}`).set(bearer(admin));
  const ask = (token: string, question = 'Хэдэн бараа байна?') =>
    http().post('/api/v1/ai/questions').set(bearer(token)).set(idempotency()).send({ question });
  const status = (token: string) => http().get('/api/v1/ai/status').set(bearer(token));

  beforeAll(async () => {
    app = await createHttpApp({
      override: (builder) =>
        builder
          .overrideProvider(LLM_CLIENT)
          .useValue(envClient)
          .overrideProvider(LLM_FETCH)
          .useValue(scriptedFetch),
    });
    sql = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    asker = await customRoleUser(app, admin, ['ai.ask', ...EVERY_GROUP]);
    catalogOnly = await customRoleUser(app, admin, ['ai.ask', 'ai.data.catalog']);
    noGroups = await customRoleUser(app, admin, ['ai.ask']);
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const catalog = catalogApi(app, admin);
    await catalog.product({
      sku: '10',
      name: 'Кока кола',
      categoryId: await catalog.category('Ундаа'),
      baseUomId: await catalog.uomId('PCS'),
    });
  });

  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  beforeEach(() => {
    sent.length = 0;
    answers.length = 0;
    envClient.reset();
  });

  it('only holders of ai.settings.manage reach the settings and the usage', async () => {
    for (const token of [worker, asker]) {
      await view(token).expect(403);
      await patch({ userDailyQuestions: 5 }, token).expect(403);
      await http().get('/api/v1/ai/usage').set(bearer(token)).expect(403);
      await http().post('/api/v1/ai/settings/test').set(bearer(token)).send({}).expect(403);
    }
  });

  it('with nothing saved the .env is in force', async () => {
    const { body } = await view().expect(200);
    expect(body).toMatchObject({
      source: 'ENV',
      enabled: true,
      provider: 'openai',
      model: 'fake-model',
      keyHint: null,
      secretReady: true,
    });
  });

  it('the key is sealed, never returned, audited or echoed', async () => {
    const { body, text } = await patch({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      apiKey: TEST_KEY,
    }).expect(200);
    expect(text).not.toContain(TEST_KEY);
    expect(body).toMatchObject({
      source: 'SETTINGS',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      keyHint: 'WXYZ',
      keyUnreadable: false,
      priceInputPerMtok: '2',
      priceOutputPerMtok: '10',
    });

    const { rows } = await sql.query<{ api_key_sealed: string }>(
      'SELECT api_key_sealed FROM ai_settings WHERE id = 1',
    );
    expect(rows[0]?.api_key_sealed.startsWith('v1.')).toBe(true);
    expect(rows[0]?.api_key_sealed).not.toContain(TEST_KEY);

    const audit = await sql.query<{ row: string }>(
      `SELECT row_to_json(a)::text AS row FROM audit_log a WHERE entity = 'ai_settings'`,
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    for (const { row } of audit.rows) {
      expect(row).not.toContain(TEST_KEY);
      expect(row).not.toContain(rows[0]?.api_key_sealed);
      expect(row).not.toContain('WXYZ');
    }

    const refused = await patch({ apiKey: 'has spaces in the key' }).expect(422);
    expect(refused.text).not.toContain('has spaces');
  });

  it('a saved connection answers at once and goes only to its provider', async () => {
    answers.push(anthropicAnswer(query('SELECT sku FROM products ORDER BY sku')));
    const { body } = await ask(asker).expect(201);
    expect(body.question.status).toBe('ANSWERED');
    expect(envClient.requests).toHaveLength(0);
    expect(sent).toHaveLength(2);
    for (const call of sent) {
      expect(call.url).toBe('https://api.anthropic.com/v1/messages');
      expect(call.headers['x-api-key']).toBe(TEST_KEY);
      expect(call.body?.model).toBe('claude-sonnet-5-5');
    }
    const { rows } = await sql.query<{ purpose: string; cost_usd: string; input_tokens: number }>(
      'SELECT purpose, cost_usd::text, input_tokens FROM ai_usage ORDER BY id',
    );
    // 1,000 input at $2 and 100 output at $10 per million tokens, each of the two calls.
    expect(rows.slice(-2)).toEqual([
      { purpose: 'ASK', cost_usd: '0.003000', input_tokens: 1000 },
      { purpose: 'ASK', cost_usd: '0.003000', input_tokens: 1000 },
    ]);
  });

  it('a key does not follow a connection to another provider', async () => {
    await patch({ provider: 'openai', model: 'some-model' }).expect(422);
    const { body } = await view().expect(200);
    expect(body.provider).toBe('anthropic');
    expect(body.keyHint).toBe('WXYZ');
  });

  it('a typed address never receives a key; Ollama takes one and no key', async () => {
    answers.push(
      { status: 200, body: { models: [{ name: 'llama4:latest' }] } },
      { status: 200, body: {} },
    );
    await http()
      .post('/api/v1/ai/settings/test')
      .set(bearer(admin))
      .send({ provider: 'ollama', model: 'llama4', baseUrl: 'http://192.168.1.50:11434/api' })
      .expect(200, { ok: true });
    expect(sent[0]?.url).toBe('http://192.168.1.50:11434/api/tags');
    expect(sent[0]?.headers['x-api-key']).toBeUndefined();

    await http()
      .post('/api/v1/ai/settings/test')
      .set(bearer(admin))
      .send({ provider: 'anthropic', model: 'claude-opus-5-5', baseUrl: 'http://evil.example/v1' })
      .expect(200, { ok: true });
    expect(sent[1]?.url).toBe('https://api.anthropic.com/v1/models/claude-opus-5-5');
    expect(sent[1]?.headers['x-api-key']).toBe(TEST_KEY);
  });

  it('the check tries typed values without saving them, and says why it failed', async () => {
    answers.push({ status: 401, body: { error: { type: 'authentication_error' } } });
    const { body } = await http()
      .post('/api/v1/ai/settings/test')
      .set(bearer(admin))
      .send({ provider: 'anthropic', model: 'claude-opus-5-5', apiKey: OTHER_KEY })
      .expect(200);
    expect(body).toEqual({
      ok: false,
      reason: 'HTTP',
      status: 401,
      providerCode: 'authentication_error',
    });
    expect(sent[0]?.method).toBe('GET');
    expect(sent[0]?.headers['x-api-key']).toBe(OTHER_KEY);
    expect((await view()).body.model).toBe('claude-sonnet-5-5');
  });

  it('the usage shows the connection, the totals and the people', async () => {
    answers.push({ status: 200, body: {} });
    const { body } = await usage('?check=true').expect(200);
    expect(sent[0]?.url).toBe('https://api.anthropic.com/v1/models/claude-sonnet-5-5');
    expect(body.connection).toMatchObject({
      state: 'CONNECTED',
      source: 'SETTINGS',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      reason: null,
    });
    expect(body.month).toMatchObject({
      questions: 1,
      invoiceChecks: 0,
      inputTokens: 2000,
      outputTokens: 200,
      costUsd: '0.006000',
      unpricedCalls: 0,
    });
    expect(body.today.costUsd).toBe('0.006000');
    expect(body.budget).toEqual({ state: 'NONE', limitUsd: null, spentUsd: '0.006000' });
    expect(body.byUser).toHaveLength(1);
    expect(body.byUser[0]).toMatchObject({ questions: 1, costUsd: '0.006000' });
  });

  it('an empty account shows as credit, on a question and on the page', async () => {
    answers.push({
      status: 400,
      body: { error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } },
    });
    const { body } = await ask(asker).expect(502);
    expect(body.params).toMatchObject({ status: 400, providerCode: 'credit_balance_too_low' });
    expect(JSON.stringify(body)).not.toContain('balance is too low');
    const after = await usage().expect(200);
    expect(after.body.connection.lastFailure).toMatchObject({
      reason: 'HTTP',
      providerCode: 'credit_balance_too_low',
    });
    // The next answered call clears it.
    answers.push(anthropicAnswer(query('SELECT sku FROM products')));
    await ask(asker).expect(201);
    expect((await usage().expect(200)).body.connection.lastFailure).toBeNull();
  });

  describe('data groups', () => {
    it('ai.ask with no group reads nothing and costs nothing', async () => {
      const { body } = await ask(noGroups).expect(403);
      expect(body.code).toBe('AI_DATA_FORBIDDEN');
      expect(sent).toHaveLength(0);
      expect((await status(noGroups).expect(200)).body.datasets).toEqual([]);
    });

    it('the model is told only the groups held, and the guard holds the line', async () => {
      const { body: state } = await status(catalogOnly).expect(200);
      expect([...state.datasets].sort()).toEqual(['categories', 'product_units', 'products']);

      answers.push(
        anthropicAnswer(query('SELECT name FROM customers')),
        anthropicAnswer(query('SELECT name FROM ai.customers')),
      );
      const { body } = await ask(catalogOnly).expect(201);
      expect(body.question).toMatchObject({ status: 'REFUSED', errorCode: 'DATA_ACCESS' });
      expect(body.result).toBeNull();
      const instructions = sent[0]?.body?.system as string;
      expect(instructions).toContain('ai.products:');
      expect(instructions).not.toContain('ai.customers:');
      expect(instructions).not.toContain('ai.invoices:');
    });

    it('a saved report outside the groups does not run for that person', async () => {
      answers.push(anthropicAnswer(query('SELECT name FROM customers')));
      const asked = await ask(admin).expect(201);
      const report = await http()
        .post('/api/v1/ai/reports')
        .set(bearer(admin))
        .set(idempotency())
        .send({ questionId: asked.body.question.id, name: 'Харилцагчид' })
        .expect(201);
      const id = report.body.id as number;

      await http().post(`/api/v1/ai/reports/${id}/run`).set(bearer(admin)).expect(200);
      const run = await http()
        .post(`/api/v1/ai/reports/${id}/run`)
        .set(bearer(catalogOnly))
        .expect(403);
      expect(run.body.code).toBe('AI_DATA_FORBIDDEN');
      const exported = await http()
        .get(`/api/v1/ai/reports/${id}/export`)
        .set(bearer(catalogOnly))
        .expect(403);
      expect(exported.body.code).toBe('AI_DATA_FORBIDDEN');
    });
  });

  describe('limits', () => {
    it('a month limit needs a price', async () => {
      await patch({ provider: 'anthropic', model: 'unknown-model' }).expect(200);
      const { body } = await patch({ monthlyBudgetUsd: '20' }).expect(422);
      expect(body.code).toBe('AI_PRICE_REQUIRED');
      await patch({
        priceInputPerMtok: '1',
        priceOutputPerMtok: '2',
        monthlyBudgetUsd: '20',
      }).expect(200);
      await patch({ monthlyBudgetUsd: null, model: 'claude-sonnet-5-5' }).expect(200);
      expect((await view()).body.priceInputPerMtok).toBe('2');
      await patch({ priceInputPerMtok: '1' }).expect(422);
    });

    it('one person stops at the day limit, the others ask on', async () => {
      await patch({ userDailyQuestions: 1 }).expect(200);
      const fresh = await customRoleUser(app, admin, ['ai.ask', 'ai.data.catalog']);
      answers.push(anthropicAnswer(query('SELECT sku FROM products')));
      await ask(fresh).expect(201);
      const { body } = await ask(fresh).expect(429);
      expect(body).toMatchObject({ code: 'AI_USER_LIMIT_REACHED', params: { limit: 1 } });
      expect(sent.filter((call) => call.method === 'POST')).toHaveLength(2);
      await patch({ userDailyQuestions: null }).expect(200);
    });

    it('warns from 80 % and stops new work at the month limit, reports running on', async () => {
      const spentBefore = (await usage().expect(200)).body.budget.spentUsd as string;
      await sql.query(
        `INSERT INTO ai_usage (purpose, provider, model, input_tokens, output_tokens, cost_usd)
         VALUES ('ASK', 'anthropic', 'claude-sonnet-5-5', 0, 0, 1 - $1::numeric)`,
        [spentBefore],
      );
      await patch({ monthlyBudgetUsd: '1.20' }).expect(200);
      expect((await status(asker).expect(200)).body.budget).toBe('WARN');
      expect((await usage().expect(200)).body.budget).toMatchObject({
        state: 'WARN',
        limitUsd: '1.20',
      });

      await patch({ monthlyBudgetUsd: '1.00' }).expect(200);
      expect((await status(asker).expect(200)).body.budget).toBe('REACHED');
      const { body } = await ask(asker).expect(429);
      expect(body.code).toBe('AI_BUDGET_REACHED');
      // No model call; the connection checks above are free GETs.
      expect(sent.filter((call) => call.method === 'POST')).toHaveLength(0);

      const reports = await http().get('/api/v1/ai/reports').set(bearer(admin)).expect(200);
      const id = reports.body.data[0].id as number;
      await http().post(`/api/v1/ai/reports/${id}/run`).set(bearer(admin)).expect(200);

      await patch({ monthlyBudgetUsd: null }).expect(200);
    });
  });

  it('the switch stops the model whatever the .env says; reports run on', async () => {
    await patch({ enabled: false }).expect(200);
    expect((await status(asker).expect(200)).body.configured).toBe(false);
    expect((await usage().expect(200)).body.connection.state).toBe('OFF');
    await ask(asker).expect(503);
    const reports = await http().get('/api/v1/ai/reports').set(bearer(admin)).expect(200);
    await http()
      .post(`/api/v1/ai/reports/${reports.body.data[0].id as number}/run`)
      .set(bearer(admin))
      .expect(200);
    await patch({ enabled: true }).expect(200);
  });

  it('a key the secret no longer opens stops the AI and says so', async () => {
    const { rows } = await sql.query<{ sealed: string }>(
      'SELECT api_key_sealed AS sealed FROM ai_settings WHERE id = 1',
    );
    await sql.query(`UPDATE ai_settings SET api_key_sealed = 'v1.a.b.c' WHERE id = 1`);
    expect((await view()).body.keyUnreadable).toBe(true);
    expect((await status(asker)).body.configured).toBe(false);
    expect((await usage().expect(200)).body.connection).toMatchObject({
      state: 'FAILED',
      reason: 'KEY_UNREADABLE',
    });
    await sql.query('UPDATE ai_settings SET api_key_sealed = $1 WHERE id = 1', [rows[0]?.sealed]);
  });

  it('removing the saved connection returns to the .env and drops the key', async () => {
    const { body } = await patch({ provider: null }).expect(200);
    expect(body).toMatchObject({ source: 'ENV', provider: 'openai', keyHint: null });
    const { rows } = await sql.query<{ sealed: string | null }>(
      'SELECT api_key_sealed AS sealed FROM ai_settings WHERE id = 1',
    );
    expect(rows[0]?.sealed).toBeNull();
    envClient.enqueue(query('SELECT sku FROM products'), 'Дүгнэлт');
    await ask(asker).expect(201);
    expect(envClient.requests).toHaveLength(2);
    expect(sent).toHaveLength(0);
    // The fake's model has no known price: tokens are counted, no cost.
    const { body: after } = await usage().expect(200);
    expect(after.month.unpricedCalls).toBe(2);
  });

  it('only the api writes the settings; the log is append-only; ai_reader sees neither', async () => {
    const appRole = await connectAs('app');
    const reader = await connectAs('ai_reader');
    try {
      await expect(appRole.query('DELETE FROM ai_settings')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(appRole.query('UPDATE ai_usage SET cost_usd = 0')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(appRole.query('DELETE FROM ai_usage')).rejects.toMatchObject({ code: '42501' });
      await expect(sql.query('DELETE FROM ai_usage')).rejects.toMatchObject({ code: '23001' });
      await expect(reader.query('SELECT 1 FROM public.ai_settings')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(reader.query('SELECT 1 FROM public.ai_usage')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await appRole.end();
      await reader.end();
    }
  });
});
