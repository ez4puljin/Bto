import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  defaultDocumentLayout,
  DOCUMENT_TEMPLATE_LIMITS,
  type DocumentLayout,
  documentLayoutFor,
  type PublishedDocumentTemplate,
} from '@tugeel/shared/sales';
import request, { type Response } from 'supertest';
import { connectAs, createHttpApp, waitFor } from '../harness/apps';
import { bearer, login, seedUser } from '../harness/identity';

interface TemplateJson {
  id: number;
  kind: 'PICK_LIST' | 'DELIVERY_NOTE';
  name: string;
  isDefault: boolean;
  version: number;
  hasDraft: boolean;
  pipelines: { id: number; name: string }[];
  layout: DocumentLayout;
  draft: DocumentLayout | null;
  versions: { version: number }[];
}

const ROLES = { VIEW: [], EDIT: [], MOVE: [] };

/**
 * The wholesale documents' templates (ADR-0143): the defaults seeded at boot, a checked draft
 * published as a version, a pipeline's choice of the right kind, the print layouts for orders'
 * pipelines, deletes only of unused templates, the rights. Synthetic data only.
 */
describe('sales document templates', () => {
  let app: NestExpressApplication;
  let admin: string;
  let office: string;
  let pipelineId: number;
  let boardId: number;

  const http = () => request(app.getHttpServer());
  const list = async (): Promise<TemplateJson[]> =>
    (await http().get('/api/v1/sales/document-templates').set(bearer(admin)).expect(200))
      .body as TemplateJson[];
  const pipelineBody = (fields: Record<string, unknown> = {}) => ({
    boardId,
    name: 'Падааны дамжлага',
    visibility: 'PUBLIC',
    ownOrdersOnly: false,
    roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
    stages: [
      {
        name: 'Ирсэн',
        action: 'NONE',
        printPickList: false,
        printDeliveryNote: false,
        roles: ROLES,
      },
    ],
    ...fields,
  });

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    boardId = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(admin))
          .send({ name: 'Загварын самбар' })
          .expect(201)
      ).body as { id: number }
    ).id;
    pipelineId = (
      (
        await http()
          .post('/api/v1/sales-pipelines')
          .set(bearer(admin))
          .send(pipelineBody())
          .expect(201)
      ).body as { id: number }
    ).id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('validates print-layout pipeline ids before SQL without changing the comma-separated contract', async () => {
    const endpoint = '/api/v1/sales/document-templates/print-layouts';
    for (const query of [{}, { pipelineIds: '' }]) {
      const response = await http().get(endpoint).set(bearer(office)).query(query).expect(200);
      expect(response.body.pipelines).toEqual([]);
      expect(response.body.templates).toHaveLength(2);
    }
    for (const pipelineIds of [
      String(pipelineId),
      `00${pipelineId},${pipelineId}`,
      Array.from({ length: 100 }, () => String(pipelineId)).join(','),
    ]) {
      const response = await http()
        .get(endpoint)
        .set(bearer(office))
        .query({ pipelineIds })
        .expect(200);
      expect(response.body.pipelines).toEqual([expect.objectContaining({ id: pipelineId })]);
    }
    for (const pipelineIds of [
      '99999999999999999999',
      '9'.repeat(1000),
      '9007199254740992',
      '0',
      ',',
      `${pipelineId},`,
      `,${pipelineId}`,
      `${pipelineId},,${pipelineId}`,
      Array.from({ length: 101 }, () => String(pipelineId)).join(','),
    ]) {
      const response = await http()
        .get(endpoint)
        .set(bearer(office))
        .query({ pipelineIds })
        .expect(422);
      expect(response.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: expect.arrayContaining([expect.objectContaining({ path: 'pipelineIds' })]),
      });
    }
    await http().get(`${endpoint}?pipelineIds=1&pipelineIds=2`).set(bearer(office)).expect(422);
  });

  it('starts with a default of each kind laid out as the document printed before', async () => {
    for (const kind of ['PICK_LIST', 'DELIVERY_NOTE'] as const) {
      const fallback = (await list()).find((entry) => entry.kind === kind && entry.isDefault);
      const detail = (
        await http()
          .get(`/api/v1/sales/document-templates/${fallback?.id}`)
          .set(bearer(admin))
          .expect(200)
      ).body as TemplateJson;
      expect(detail.layout).toEqual(defaultDocumentLayout(kind));
    }
  });

  it('checks a draft, publishes it as a version and lets a pipeline choose it', async () => {
    const created = (
      await http()
        .post('/api/v1/sales/document-templates')
        .set(bearer(admin))
        .send({ kind: 'DELIVERY_NOTE', name: 'Орон нутгийн падаан' })
        .expect(201)
    ).body as TemplateJson;
    const layout = defaultDocumentLayout('DELIVERY_NOTE');
    // A delivery note keeps its totals; the product column stays printed; no column twice.
    await http()
      .put(`/api/v1/sales/document-templates/${created.id}/draft`)
      .set(bearer(admin))
      .send({
        name: created.name,
        layout: { ...layout, blocks: layout.blocks.filter((block) => block.type !== 'TOTALS') },
      })
      .expect(422);
    const lines = layout.blocks.find((block) => block.type === 'LINES');
    if (lines?.type !== 'LINES') throw new Error('no lines');
    await http()
      .put(`/api/v1/sales/document-templates/${created.id}/draft`)
      .set(bearer(admin))
      .send({
        name: created.name,
        layout: {
          ...layout,
          blocks: layout.blocks.map((block) =>
            block.type === 'LINES'
              ? {
                  ...lines,
                  columns: lines.columns.map((column) =>
                    column.key === 'PRODUCT' ? { ...column, on: false } : column,
                  ),
                }
              : block,
          ),
        },
      })
      .expect(422);
    const edited: DocumentLayout = {
      size: 'SM',
      blocks: [
        { type: 'TEXT', text: 'Буцаалт 3 хоногийн дотор', align: 'CENTER', size: 'SM', bold: true },
        ...layout.blocks.map((block) =>
          block.type === 'LINES'
            ? {
                ...lines,
                columns: [...lines.columns]
                  .reverse()
                  .map((column) => (column.key === 'NO' ? { ...column, on: true } : column)),
              }
            : block,
        ),
      ],
    };
    await http()
      .put(`/api/v1/sales/document-templates/${created.id}/draft`)
      .set(bearer(admin))
      .send({ name: created.name, layout: edited })
      .expect(200);
    const published = (
      await http()
        .post(`/api/v1/sales/document-templates/${created.id}/publish`)
        .set(bearer(admin))
        .expect(200)
    ).body as TemplateJson;
    expect(published).toMatchObject({ version: 2, hasDraft: false });
    expect(published.layout.size).toBe('SM');

    // A delivery note's template is no pick list's.
    await http()
      .put(`/api/v1/sales-pipelines/${pipelineId}`)
      .set(bearer(admin))
      .send(pipelineBody({ pickListTemplateId: created.id }))
      .expect(422);
    const pipeline = (
      await http()
        .put(`/api/v1/sales-pipelines/${pipelineId}`)
        .set(bearer(admin))
        .send(pipelineBody({ deliveryNoteTemplateId: created.id }))
        .expect(200)
    ).body as { deliveryNoteTemplateId: number | null; pickListTemplateId: number | null };
    expect(pipeline).toMatchObject({
      deliveryNoteTemplateId: created.id,
      pickListTemplateId: null,
    });
    // Saved again without the field: the choice stays.
    await http()
      .put(`/api/v1/sales-pipelines/${pipelineId}`)
      .set(bearer(admin))
      .send(pipelineBody())
      .expect(200);
    expect((await list()).find((entry) => entry.id === created.id)?.pipelines).toEqual([
      { id: pipelineId, name: 'Падааны дамжлага' },
    ]);

    // The print page: the published layouts and the pipeline's choice, for a reader of orders.
    const print = (
      await http()
        .get('/api/v1/sales/document-templates/print-layouts')
        .query({ pipelineIds: `${pipelineId}` })
        .set(bearer(office))
        .expect(200)
    ).body as {
      templates: PublishedDocumentTemplate[];
      pipelines: { id: number; deliveryNoteTemplateId: number | null }[];
    };
    const choice = print.pipelines.find((entry) => entry.id === pipelineId);
    expect(
      documentLayoutFor(print.templates, 'DELIVERY_NOTE', choice?.deliveryNoteTemplateId)?.size,
    ).toBe('SM');
    expect(documentLayoutFor(print.templates, 'PICK_LIST', null)).toEqual(
      defaultDocumentLayout('PICK_LIST'),
    );

    // In use: no delete until the pipeline lets it go.
    await http()
      .delete(`/api/v1/sales/document-templates/${created.id}`)
      .set(bearer(admin))
      .expect(409);
    await http()
      .put(`/api/v1/sales-pipelines/${pipelineId}`)
      .set(bearer(admin))
      .send(pipelineBody({ deliveryNoteTemplateId: null }))
      .expect(200);
    await http()
      .delete(`/api/v1/sales/document-templates/${created.id}`)
      .set(bearer(admin))
      .expect(204);
  });

  it('lets only a manager of the boards change the templates', async () => {
    await http().get('/api/v1/sales/document-templates').set(bearer(office)).expect(403);
    await http()
      .post('/api/v1/sales/document-templates')
      .set(bearer(office))
      .send({ kind: 'PICK_LIST', name: 'x' })
      .expect(403);
  });

  it('keeps the catalogue cap when different managers create both kinds concurrently', async () => {
    const otherAdmin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const initial = await list();
    for (let n = initial.length; n < DOCUMENT_TEMPLATE_LIMITS.maxTemplates - 1; n += 1) {
      await http()
        .post('/api/v1/sales/document-templates')
        .set(bearer(admin))
        .send({ kind: 'PICK_LIST', name: `Concurrent baseline ${n}` })
        .expect(201);
    }

    const gate = await connectAs('admin');
    let pending: Promise<Response[]> | undefined;
    try {
      await gate.query('BEGIN');
      // Counts can run, but inserts wait: concurrent creates must share the last free slot.
      await gate.query('LOCK TABLE sales_document_templates IN SHARE MODE');
      pending = Promise.all(
        Array.from({ length: 8 }, (_, n) =>
          http()
            .post('/api/v1/sales/document-templates')
            .set(bearer(n % 2 === 0 ? admin : otherAdmin))
            .send({
              kind: n % 2 === 0 ? 'PICK_LIST' : 'DELIVERY_NOTE',
              name: `Concurrent new ${n}`,
            }),
        ),
      );
      // Observe actual blocked transactions; no timing sleep or mocked database/service.
      await waitFor(async () => {
        await gate.query('SELECT pg_stat_clear_snapshot()');
        const { rows } = await gate.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
             AND (query LIKE 'insert into "sales_document_templates"%'
                  OR query LIKE 'SELECT pg_advisory_xact_lock%')`,
        );
        return (rows[0]?.n ?? 0) >= 2 ? true : undefined;
      });
    } finally {
      await gate.query('ROLLBACK');
      await gate.end();
    }
    const responses = await pending;
    if (!responses) throw new Error('concurrent creates did not start');
    const successful = responses.filter((response) => response.status === 201);
    expect(successful).toHaveLength(1);
    expect(responses.filter((response) => response.status === 422)).toHaveLength(7);
    for (const response of responses.filter((result) => result.status === 422)) {
      expect(response.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: expect.arrayContaining([
          expect.objectContaining({ path: 'name', constraint: 'count' }),
        ]),
      });
    }
    expect(await list()).toHaveLength(DOCUMENT_TEMPLATE_LIMITS.maxTemplates);
    const winner = successful[0]?.body as TemplateJson;
    await http()
      .delete(`/api/v1/sales/document-templates/${winner.id}`)
      .set(bearer(admin))
      .expect(204);
    await http()
      .post('/api/v1/sales/document-templates')
      .set(bearer(otherAdmin))
      .send({ kind: 'DELIVERY_NOTE', name: 'After cap slot released' })
      .expect(201);
    expect(await list()).toHaveLength(DOCUMENT_TEMPLATE_LIMITS.maxTemplates);
  });
});
