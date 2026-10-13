import type { NestExpressApplication } from '@nestjs/platform-express';
import ExcelJS from 'exceljs';
import type { Client } from 'pg';
import request from 'supertest';
import { businessDate } from '@tugeel/shared/time';
import { LLM_CLIENT, LlmError } from '../../src/integrations/llm';
import { clarify, FakeLlm, query, unsupported } from '../harness/ai';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';

interface AnswerJson {
  conversationId: number;
  question: {
    id: number;
    status: string;
    kind: string | null;
    sql: string | null;
    explanation: string | null;
    summary: string | null;
    errorCode: string | null;
    rowCount: number | null;
    repaired: boolean;
  };
  result?: {
    columns: { name: string; kind: string }[];
    rows: (string | null)[][];
    truncated: boolean;
  } | null;
}
interface ReportJson {
  id: number;
  name: string;
  sql: string;
  canChange: boolean;
  createdBy: { id: number; fullName: string };
}

const PRODUCTS_SQL = 'SELECT sku AS "Код", name AS "Нэр" FROM products ORDER BY sku';

/** The AI assistant over HTTP with a scripted model (ADR-0045, docs/modules/ai.md). */
describe('AI assistant', () => {
  let app: NestExpressApplication;
  const llm = new FakeLlm();
  let admin: string;
  let asker: string;
  let other: string;
  let worker: string;
  let sql: Client;
  const http = () => request(app.getHttpServer());

  const ask = (token: string, body: Record<string, unknown>, key = idempotency()) =>
    http().post('/api/v1/ai/questions').set(bearer(token)).set(key).send(body);

  beforeAll(async () => {
    app = await createHttpApp({
      override: (builder) => builder.overrideProvider(LLM_CLIENT).useValue(llm),
    });
    sql = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    asker = await customRoleUser(app, admin, ['ai.ask']);
    other = await customRoleUser(app, admin, ['ai.ask']);
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Ундаа');
    const pcs = await catalog.uomId('PCS');
    for (const [sku, name] of [
      ['10', 'Кока кола'],
      ['11', 'Шүүс'],
      ['12', 'Ус'],
    ] as const) {
      await catalog.product({ sku, name, categoryId: category, baseUomId: pcs });
    }
  });
  afterEach(() => {
    expect(llm.pending).toBe(0);
    llm.reset();
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('tells its status and keeps out people without ai.ask', async () => {
    const status = await http().get('/api/v1/ai/status').set(bearer(asker)).expect(200);
    expect(status.body).toEqual({
      configured: true,
      database: true,
      provider: 'openai',
      model: 'fake-model',
    });
    await http().get('/api/v1/ai/status').set(bearer(worker)).expect(403);
    await ask(worker, { question: 'Хэдэн бараа байна?' }).expect(403);
    await http().get('/api/v1/ai/reports').set(bearer(worker)).expect(403);
  });

  it('answers with rows and a summary, logging the question without its rows', async () => {
    llm.enqueue(query(PRODUCTS_SQL, 'Бүх бараа кодоор'), 'Гурван бараа бүртгэлтэй байна.');
    const answer = (await ask(asker, { question: 'Ямар бараа байна?' }).expect(201))
      .body as AnswerJson;
    expect(answer.question).toMatchObject({
      status: 'ANSWERED',
      kind: 'QUERY',
      sql: PRODUCTS_SQL,
      explanation: 'Бүх бараа кодоор',
      summary: 'Гурван бараа бүртгэлтэй байна.',
      rowCount: 3,
      repaired: false,
    });
    expect(answer.result).toEqual({
      columns: [
        { name: 'Код', kind: 'text' },
        { name: 'Нэр', kind: 'text' },
      ],
      rows: [
        ['10', 'Кока кола'],
        ['11', 'Шүүс'],
        ['12', 'Ус'],
      ],
      truncated: false,
    });
    // The first call carries the rules, the datasets and today's date, and asks for the schema.
    const [generate, summarize] = llm.requests;
    expect(generate?.instructions).toContain('ai.products');
    expect(generate?.instructions).toContain(businessDate());
    expect(generate?.output?.name).toBe('sql_answer');
    expect(generate?.messages).toEqual([
      { role: 'user', content: '<question>\nЯмар бараа байна?\n</question>' },
    ]);
    // The summary sees the rows as data, in plain text.
    expect(summarize?.output).toBeUndefined();
    expect(summarize?.messages[0]?.content).toContain('"Кока кола"');
    const logged = await sql.query<Record<string, unknown>>(
      'SELECT * FROM ai_questions WHERE id = $1',
      [answer.question.id],
    );
    expect(logged.rows[0]).toMatchObject({
      status: 'ANSWERED',
      row_count: 3,
      input_tokens: 200,
      output_tokens: 40,
      provider: 'openai',
      model: 'fake-model-2026',
    });
    expect(Object.keys(logged.rows[0] ?? {})).not.toContain('rows');
  });

  it('continues a conversation with the earlier steps as data', async () => {
    llm.enqueue(query(PRODUCTS_SQL), 'Гурван бараа.');
    const first = (await ask(asker, { question: 'Бараанууд?' }).expect(201)).body as AnswerJson;
    llm.enqueue(
      query('SELECT count(*) AS "Тоо" FROM products WHERE status = \'ACTIVE\''),
      'Гурав.',
    );
    const second = (
      await ask(asker, {
        conversationId: first.conversationId,
        question: 'Хэд нь идэвхтэй вэ?',
      }).expect(201)
    ).body as AnswerJson;
    expect(second.conversationId).toBe(first.conversationId);
    const turn = llm.requests[2]?.messages[0]?.content ?? '';
    expect(turn).toContain('<conversation>');
    expect(turn).toContain('"question":"Бараанууд?"');
    expect(turn).toContain(JSON.stringify(PRODUCTS_SQL).slice(1, -1));
    expect(turn).toContain('<question>\nХэд нь идэвхтэй вэ?\n</question>');
    const detail = await http()
      .get(`/api/v1/ai/conversations/${first.conversationId}`)
      .set(bearer(asker))
      .expect(200);
    expect(
      (detail.body as { questions: { question: string }[] }).questions.map((q) => q.question),
    ).toEqual(['Бараанууд?', 'Хэд нь идэвхтэй вэ?']);
    const list = await http().get('/api/v1/ai/conversations').set(bearer(asker)).expect(200);
    expect((list.body as { data: { id: number; title: string }[] }).data[0]).toMatchObject({
      id: first.conversationId,
      title: 'Бараанууд?',
    });
  });

  it('repairs a refused query once and gives up after the second refusal', async () => {
    llm.enqueue(query('SELECT username FROM users'), query(PRODUCTS_SQL), 'Гурван бараа.');
    const repaired = (await ask(asker, { question: 'Бараа?' }).expect(201)).body as AnswerJson;
    expect(repaired.question).toMatchObject({ status: 'ANSWERED', repaired: true, rowCount: 3 });
    const repair = llm.requests[1]?.messages ?? [];
    expect(repair).toHaveLength(3);
    expect(repair[2]?.content).toContain('The system refused that query: relation "users"');

    llm.enqueue(query('SELECT * FROM pg_authid'), query('SELECT pg_sleep(30)'));
    const refused = (await ask(asker, { question: 'Нууц үг?' }).expect(201)).body as AnswerJson;
    expect(refused.question).toMatchObject({
      status: 'REFUSED',
      errorCode: 'FUNCTION',
      sql: 'SELECT pg_sleep(30)',
      repaired: true,
    });
    expect(refused.result).toBeNull();
  });

  it('repairs a query mistake with the database error', async () => {
    llm.enqueue(query('SELECT nope FROM products'), query(PRODUCTS_SQL), 'Гурав.');
    const answer = (await ask(asker, { question: 'Бараа?' }).expect(201)).body as AnswerJson;
    expect(answer.question).toMatchObject({ status: 'ANSWERED', repaired: true });
    expect(llm.requests[1]?.messages[2]?.content).toContain('SQLSTATE 42703');
  });

  it('passes a question back or says the data is missing, without a query', async () => {
    llm.enqueue(clarify('Аль агуулахынх вэ?'));
    const asked = (await ask(asker, { question: 'Үлдэгдэл?' }).expect(201)).body as AnswerJson;
    expect(asked.question).toMatchObject({
      status: 'CLARIFY',
      kind: 'CLARIFY',
      sql: null,
      explanation: 'Аль агуулахынх вэ?',
    });
    llm.enqueue(unsupported('Борлуулалтын мэдээлэл системд хараахан алга.'));
    const missing = (await ask(asker, { question: 'Өчигдөр хэдийг зарсан бэ?' }).expect(201))
      .body as AnswerJson;
    expect(missing.question).toMatchObject({ status: 'UNSUPPORTED', sql: null });
    expect(llm.requests).toHaveLength(2);
  });

  it('replays an idempotent question without its rows', async () => {
    const key = idempotency();
    llm.enqueue(query(PRODUCTS_SQL), 'Гурав.');
    const first = (await ask(asker, { question: 'Давтах?' }, key).expect(201)).body as AnswerJson;
    expect(first.result?.rows).toHaveLength(3);
    const replay = await ask(asker, { question: 'Давтах?' }, key).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const body = replay.body as AnswerJson;
    expect(body.question.id).toBe(first.question.id);
    expect(body).not.toHaveProperty('result');
    // The client runs the question again for its rows; the model is not asked again.
    const rows = await http()
      .post(`/api/v1/ai/questions/${first.question.id}/run`)
      .set(bearer(asker))
      .expect(200);
    expect((rows.body as { rows: unknown[] }).rows).toHaveLength(3);
  });

  it('keeps conversations, questions and their rows to their owner', async () => {
    llm.enqueue(query(PRODUCTS_SQL), 'Гурав.');
    const mine = (await ask(asker, { question: 'Минийх' }).expect(201)).body as AnswerJson;
    await http()
      .get(`/api/v1/ai/conversations/${mine.conversationId}`)
      .set(bearer(other))
      .expect(404);
    await http()
      .post(`/api/v1/ai/questions/${mine.question.id}/run`)
      .set(bearer(other))
      .expect(404);
    await http()
      .get(`/api/v1/ai/questions/${mine.question.id}/export`)
      .set(bearer(other))
      .expect(404);
    await ask(other, { conversationId: mine.conversationId, question: 'Үргэлжлүүлье' }).expect(404);
    const theirs = await http().get('/api/v1/ai/conversations').set(bearer(other)).expect(200);
    expect((theirs.body as { data: unknown[] }).data).toEqual([]);
  });

  it('exports an answer to Excel with numbers as numbers', async () => {
    llm.enqueue(
      query(
        `SELECT sku AS "Код", 1500.50::numeric AS "Дүн", true AS "Идэвхтэй" FROM products ORDER BY sku`,
      ),
      'Гурав.',
    );
    const answer = (await ask(asker, { question: 'Excel?' }).expect(201)).body as AnswerJson;
    const file = await http()
      .get(`/api/v1/ai/questions/${answer.question.id}/export`)
      .set(bearer(asker))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
    expect(file.headers['content-disposition']).toContain(
      `filename="ai-${answer.question.id}.xlsx"`,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.body as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet?.getRow(1).values).toEqual([undefined, 'Код', 'Дүн', 'Идэвхтэй']);
    expect(sheet?.getRow(2).values).toEqual([undefined, '10', 1500.5, 'Тийм']);
    expect(sheet?.rowCount).toBe(4);
  });

  it('saves reports that everyone with ai.ask runs and only the author or a manager changes', async () => {
    llm.enqueue(query(PRODUCTS_SQL), 'Гурав.');
    const answer = (await ask(asker, { question: 'Тайлан' }).expect(201)).body as AnswerJson;
    const created = await http()
      .post('/api/v1/ai/reports')
      .set(bearer(asker))
      .set(idempotency())
      .send({ questionId: answer.question.id, name: '  Барааны жагсаалт ' })
      .expect(201);
    const report = created.body as ReportJson;
    expect(report).toMatchObject({ name: 'Барааны жагсаалт', sql: PRODUCTS_SQL, canChange: true });

    const seen = await http().get('/api/v1/ai/reports').set(bearer(other)).expect(200);
    expect((seen.body as { data: ReportJson[] }).data).toEqual([
      expect.objectContaining({
        id: report.id,
        canChange: false,
        createdBy: expect.objectContaining({ fullName: 'Тест хэрэглэгч' }),
      }),
    ]);
    const ran = await http()
      .post(`/api/v1/ai/reports/${report.id}/run`)
      .set(bearer(other))
      .expect(200);
    expect((ran.body as { rows: unknown[] }).rows).toHaveLength(3);
    await http()
      .patch(`/api/v1/ai/reports/${report.id}`)
      .set(bearer(other))
      .send({ name: 'Миний нэр' })
      .expect(403);
    await http().delete(`/api/v1/ai/reports/${report.id}`).set(bearer(other)).expect(403);

    // Someone else's question never becomes my report; a question without rows never does.
    await http()
      .post('/api/v1/ai/reports')
      .set(bearer(other))
      .set(idempotency())
      .send({ questionId: answer.question.id, name: 'Хулгай' })
      .expect(404);
    llm.enqueue(clarify('Аль нь?'));
    const asked = (await ask(asker, { question: 'Юу?' }).expect(201)).body as AnswerJson;
    await http()
      .post('/api/v1/ai/reports')
      .set(bearer(asker))
      .set(idempotency())
      .send({ questionId: asked.question.id, name: 'Хоосон' })
      .expect(422);

    const renamed = await http()
      .patch(`/api/v1/ai/reports/${report.id}`)
      .set(bearer(admin))
      .send({ name: 'Бараа (админ)' })
      .expect(200);
    expect((renamed.body as ReportJson).name).toBe('Бараа (админ)');
    await http().delete(`/api/v1/ai/reports/${report.id}`).set(bearer(asker)).expect(204);
    await http().post(`/api/v1/ai/reports/${report.id}/run`).set(bearer(asker)).expect(404);
    const audit = await sql.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'ai_reports' AND entity_id = $1 ORDER BY id`,
      [String(report.id)],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
  });

  it('answers 502 when the provider fails, logging nothing', async () => {
    const before = await sql.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM ai_questions',
    );
    llm.enqueue(
      new LlmError('HTTP', 'the provider answered HTTP 401', {
        status: 401,
        providerCode: 'invalid_api_key',
      }),
    );
    const failed = await ask(asker, { question: 'Түлхүүр буруу?' }).expect(502);
    expect(failed.body).toMatchObject({
      code: 'AI_PROVIDER_FAILED',
      params: { reason: 'HTTP', status: 401, providerCode: 'invalid_api_key' },
    });
    const after = await sql.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM ai_questions',
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});

/** Without a provider the assistant is off, but nothing else breaks. */
describe('AI assistant, not configured', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createHttpApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('says so and refuses questions with 503', async () => {
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const status = await request(app.getHttpServer())
      .get('/api/v1/ai/status')
      .set(bearer(admin))
      .expect(200);
    expect(status.body).toEqual({ configured: false, database: true, provider: null, model: null });
    const refused = await request(app.getHttpServer())
      .post('/api/v1/ai/questions')
      .set(bearer(admin))
      .set(idempotency())
      .send({ question: 'Сайн уу?' })
      .expect(503);
    expect((refused.body as { code: string }).code).toBe('AI_NOT_CONFIGURED');
  });
});
