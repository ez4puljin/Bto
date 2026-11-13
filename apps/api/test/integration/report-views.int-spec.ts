import type { NestExpressApplication } from '@nestjs/platform-express';
import { REPORT_VIEW_LIMIT } from '@tugeel/shared/reports';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';

interface ViewJson {
  id: number;
  page: string;
  name: string;
  query: string;
  period: string | null;
  shared: boolean;
  mine: boolean;
  editable: boolean;
  removable: boolean;
  createdBy: { id: number; fullName: string };
}

/**
 * Saved views of the report pages (ADR-0194): a view is its author's or shared, only the author
 * changes it, the page's own right is asked for, and a moving period keeps no dates.
 */
describe('report views', () => {
  let app: NestExpressApplication;
  let admin: string;
  let dulam: string;
  let bold: string;
  let books: string;
  const http = () => request(app.getHttpServer());
  const list = async (token: string, page: string) =>
    (await http().get('/api/v1/reports/views').query({ page }).set(bearer(token)).expect(200)).body
      .data as ViewJson[];
  const create = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/reports/views').set(bearer(token)).set(idempotency()).send(body);
  const view = (name: string, over: Record<string, unknown> = {}) => ({
    page: 'product-sales',
    name,
    query: 'to=2026-11-13&by=brand&from=2026-11-01&w=3&w=1',
    period: null,
    shared: false,
    ...over,
  });

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    dulam = await customRoleUser(app, admin, ['reports.view']);
    bold = await customRoleUser(app, admin, ['reports.view']);
    books = await customRoleUser(app, admin, ['finance.read']);
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps a view under its name, the address in a stable order', async () => {
    const created = (await create(dulam, view('Брэндээр, 3 агуулах')).expect(201)).body as ViewJson;
    expect(created).toMatchObject({
      page: 'product-sales',
      name: 'Брэндээр, 3 агуулах',
      query: 'by=brand&from=2026-11-01&to=2026-11-13&w=3&w=1',
      period: null,
      shared: false,
      mine: true,
      editable: true,
      removable: true,
    });
    expect((await list(dulam, 'product-sales')).map((row) => row.id)).toContain(created.id);
    // Another page's list does not carry it, and another person does not see a private view.
    expect((await list(dulam, 'stock-balance')).map((row) => row.id)).not.toContain(created.id);
    expect((await list(bold, 'product-sales')).map((row) => row.id)).not.toContain(created.id);
  });

  it('keeps no dates for a period that moves with the calendar', async () => {
    const created = (
      await create(dulam, view('Энэ сар брэндээр', { period: 'thisMonth' })).expect(201)
    ).body as ViewJson;
    expect(created).toMatchObject({ period: 'thisMonth', query: 'by=brand&w=3&w=1' });
    // Back to fixed dates: the author sends the address with them.
    const fixed = (
      await http()
        .patch(`/api/v1/reports/views/${created.id}`)
        .set(bearer(dulam))
        .send({ period: null, query: 'by=brand&from=2026-01-01&to=2026-03-31' })
        .expect(200)
    ).body as ViewJson;
    expect(fixed).toMatchObject({ period: null, query: 'by=brand&from=2026-01-01&to=2026-03-31' });
    // And a period again drops them from what is kept.
    const moving = (
      await http()
        .patch(`/api/v1/reports/views/${created.id}`)
        .set(bearer(dulam))
        .send({ period: 'lastMonth' })
        .expect(200)
    ).body as ViewJson;
    expect(moving).toMatchObject({ period: 'lastMonth', query: 'by=brand' });
  });

  it('shows a shared view to others, who can open but not change it', async () => {
    const shared = (await create(dulam, view('Хуваалцсан', { shared: true })).expect(201))
      .body as ViewJson;
    const seen = (await list(bold, 'product-sales')).find((row) => row.id === shared.id);
    expect(seen).toMatchObject({ mine: false, editable: false, removable: false, shared: true });
    expect(seen?.createdBy.fullName).not.toBe('');
    const refused = await http()
      .patch(`/api/v1/reports/views/${shared.id}`)
      .set(bearer(bold))
      .send({ name: 'Миний болгов' })
      .expect(403);
    expect(refused.body.code).toBe('FORBIDDEN');
    await http().delete(`/api/v1/reports/views/${shared.id}`).set(bearer(bold)).expect(403);
    // The author takes it back: others no longer see it.
    await http()
      .patch(`/api/v1/reports/views/${shared.id}`)
      .set(bearer(dulam))
      .send({ shared: false })
      .expect(200);
    expect((await list(bold, 'product-sales')).map((row) => row.id)).not.toContain(shared.id);
  });

  it('lists the caller’s own views before the shared ones, by name', async () => {
    await create(bold, view('Я нэртэй')).expect(201);
    await create(bold, view('А нэртэй')).expect(201);
    await create(dulam, view('Б бусдын хуваалцсан', { shared: true })).expect(201);
    const rows = await list(bold, 'product-sales');
    const own = rows.filter((row) => row.mine).map((row) => row.name);
    expect(own).toEqual(['А нэртэй', 'Я нэртэй']);
    expect(rows.findIndex((row) => !row.mine)).toBe(own.length);
  });

  it('refuses a second view of the same name on the same page, whatever the case', async () => {
    await create(dulam, view('Давхар нэр')).expect(201);
    const again = await create(dulam, view('давхар НЭР')).expect(409);
    expect(again.body.code).toBe('DUPLICATE_VALUE');
    // Another page and another person may use the name.
    await create(dulam, view('Давхар нэр', { page: 'stock-balance' })).expect(201);
    await create(bold, view('Давхар нэр')).expect(201);
  });

  it('asks for the right of the page a view belongs to', async () => {
    await http()
      .get('/api/v1/reports/views')
      .query({ page: 'product-sales' })
      .set(bearer(books))
      .expect(403);
    await create(books, view('Номын', { page: 'product-sales' })).expect(403);
    await create(books, view('Авлага өглөг', { page: 'party-ledger', query: 'by=party' })).expect(
      201,
    );
    // reports.view alone does not open the margins' pages or the books.
    await create(dulam, view('Ашиг', { page: 'profit' })).expect(403);
    await create(dulam, view('Номын', { page: 'party-ledger' })).expect(403);
    await http().get('/api/v1/reports/views').query({ page: 'aging' }).expect(401);
  });

  it('lets a holder of the settings right remove a shared view, never a private one', async () => {
    const shared = (await create(dulam, view('Орхигдсон', { shared: true })).expect(201))
      .body as ViewJson;
    const own = (await create(dulam, view('Хувийн')).expect(201)).body as ViewJson;
    const seen = (await list(admin, 'product-sales')).find((row) => row.id === shared.id);
    expect(seen).toMatchObject({ mine: false, editable: false, removable: true });
    await http().delete(`/api/v1/reports/views/${own.id}`).set(bearer(admin)).expect(403);
    await http().delete(`/api/v1/reports/views/${shared.id}`).set(bearer(admin)).expect(204);
    expect((await list(dulam, 'product-sales')).map((row) => row.id)).not.toContain(shared.id);
    await http().delete(`/api/v1/reports/views/${shared.id}`).set(bearer(dulam)).expect(404);
    await http().delete(`/api/v1/reports/views/${own.id}`).set(bearer(dulam)).expect(204);
  });

  it('checks what it is given', async () => {
    await create(dulam, view('Буруу хуудас', { page: 'dashboard' })).expect(422);
    await create(dulam, view('Буруу хаяг', { query: 'by=brand name' })).expect(422);
    await create(dulam, view('Буруу хугацаа', { period: 'lastYear' })).expect(422);
    await create(dulam, view('   ')).expect(422);
    await create(dulam, view('x'.repeat(81))).expect(422);
    await http()
      .get('/api/v1/reports/views')
      .query({ page: 'nothing' })
      .set(bearer(dulam))
      .expect(422);
  });

  it('answers a repeated send with the same view', async () => {
    const key = idempotency();
    const body = view('Нэг удаа');
    const first = await http().post('/api/v1/reports/views').set(bearer(dulam)).set(key).send(body);
    const second = await http()
      .post('/api/v1/reports/views')
      .set(bearer(dulam))
      .set(key)
      .send(body);
    expect(first.status).toBe(201);
    expect((second.body as ViewJson).id).toBe((first.body as ViewJson).id);
  });

  it('stops at the limit of one person’s views of a page', async () => {
    const tester = await customRoleUser(app, admin, ['reports.view']);
    for (let n = 1; n <= REPORT_VIEW_LIMIT; n += 1) {
      await create(tester, view(`Загвар ${n}`, { page: 'stock' })).expect(201);
    }
    const full = await create(tester, view('Илүү', { page: 'stock' })).expect(409);
    expect(full.body).toMatchObject({ code: 'REPORT_VIEW_LIMIT', params: { limit: 30 } });
    // Another page still takes one.
    await create(tester, view('Өөр хуудас', { page: 'aging' })).expect(201);
  });
});
