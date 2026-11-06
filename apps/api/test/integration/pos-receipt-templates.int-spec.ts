import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  defaultReceiptLayout,
  type PosSnapshot,
  type ReceiptLayout,
  receiptLayoutFor,
} from '@tugeel/shared/pos';
import { createHttpApp } from '../harness/apps';
import { posActors, posApi, posStore } from '../harness/pos';

interface TemplateJson {
  id: number;
  kind: 'SALE' | 'RETURN';
  name: string;
  isDefault: boolean;
  version: number;
  hasDraft: boolean;
  tills: { id: number; code: string }[];
  layout: ReceiptLayout;
  draft: ReceiptLayout | null;
  versions: { version: number; publishedBy: string | null }[];
}

/**
 * The receipt templates (ADR-0141): the defaults seeded at boot, a draft checked and published as
 * a new version, an old version brought back, one default of each kind, a POS's choice of its own
 * kind, the published layouts in the snapshot, deletes only of unused templates, the rights.
 */
describe('pos receipt templates', () => {
  let app: NestExpressApplication;
  let actors: Awaited<ReturnType<typeof posActors>>;
  let store: Awaited<ReturnType<typeof posStore>>;

  beforeAll(async () => {
    app = await createHttpApp();
    actors = await posActors(app);
    store = await posStore(app, actors.admin, 'PRT');
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => posApi(app, actors.admin).http();
  const auth = () => posApi(app, actors.admin).auth;
  const list = async (): Promise<TemplateJson[]> =>
    (await http().get('/api/v1/pos/receipt-templates').set(auth()).expect(200))
      .body as TemplateJson[];
  const snapshot = async (): Promise<PosSnapshot> =>
    (
      (
        await http()
          .get('/api/v1/pos/sync/snapshot')
          .set('Authorization', `Bearer ${store.edgeToken}`)
          .expect(200)
      ).body as { snapshot: PosSnapshot }
    ).snapshot;

  it('starts with a default of each kind laid out as the built-in receipt', async () => {
    const templates = await list();
    for (const kind of ['SALE', 'RETURN'] as const) {
      const fallback = templates.find((entry) => entry.kind === kind && entry.isDefault);
      expect(fallback).toMatchObject({ version: 1, hasDraft: false });
      const detail = (
        await http().get(`/api/v1/pos/receipt-templates/${fallback?.id}`).set(auth()).expect(200)
      ).body as TemplateJson;
      expect(detail.layout).toEqual(defaultReceiptLayout());
    }
  });

  it('keeps a checked draft apart from the layout in force until it is published', async () => {
    const created = (
      await http()
        .post('/api/v1/pos/receipt-templates')
        .set(auth())
        .send({ kind: 'SALE', name: 'Архины пос' })
        .expect(201)
    ).body as TemplateJson;
    expect(created).toMatchObject({ version: 1, isDefault: false, draft: null });
    const layout = defaultReceiptLayout();
    // The e-Barimt block cannot go; an unknown option is refused; an empty text too.
    const withoutEbarimt = {
      ...layout,
      blocks: layout.blocks.filter((block) => block.type !== 'EBARIMT'),
    };
    await http()
      .put(`/api/v1/pos/receipt-templates/${created.id}/draft`)
      .set(auth())
      .send({ name: 'Архины пос', layout: withoutEbarimt })
      .expect(422);
    await http()
      .put(`/api/v1/pos/receipt-templates/${created.id}/draft`)
      .set(auth())
      .send({ name: 'Архины пос', layout: { ...layout, paper: 'MM110' } })
      .expect(422);
    await http()
      .put(`/api/v1/pos/receipt-templates/${created.id}/draft`)
      .set(auth())
      .send({
        name: 'Архины пос',
        layout: { ...layout, blocks: [...layout.blocks, { type: 'TEXT', text: '  ' }] },
      })
      .expect(422);
    const edited: ReceiptLayout = {
      paper: 'MM58',
      size: 'SM',
      blocks: [
        { type: 'TEXT', text: '  18+ насныханд  ', align: 'CENTER', size: 'LG', bold: true },
        ...layout.blocks.filter((block) => block.type !== 'LOYALTY'),
      ],
    };
    const drafted = (
      await http()
        .put(`/api/v1/pos/receipt-templates/${created.id}/draft`)
        .set(auth())
        .send({ name: 'Архины пос 2', layout: edited })
        .expect(200)
    ).body as TemplateJson;
    expect(drafted).toMatchObject({ name: 'Архины пос 2', hasDraft: true, version: 1 });
    expect(drafted.layout).toEqual(defaultReceiptLayout());
    expect(drafted.draft?.blocks[0]).toEqual({
      type: 'TEXT',
      text: '18+ насныханд',
      align: 'CENTER',
      size: 'LG',
      bold: true,
    });
    const published = (
      await http()
        .post(`/api/v1/pos/receipt-templates/${created.id}/publish`)
        .set(auth())
        .expect(200)
    ).body as TemplateJson;
    expect(published).toMatchObject({ version: 2, hasDraft: false, draft: null });
    expect(published.layout.paper).toBe('MM58');
    expect(published.versions.map((entry) => entry.version)).toEqual([2, 1]);
    // Nothing to publish now.
    await http()
      .post(`/api/v1/pos/receipt-templates/${created.id}/publish`)
      .set(auth())
      .expect(422);
    // Version 1 back as the draft, then thrown away.
    const restored = (
      await http()
        .post(`/api/v1/pos/receipt-templates/${created.id}/versions/1/restore`)
        .set(auth())
        .expect(200)
    ).body as TemplateJson;
    expect(restored.draft).toEqual(defaultReceiptLayout());
    expect(restored.layout.paper).toBe('MM58');
    const discarded = (
      await http()
        .post(`/api/v1/pos/receipt-templates/${created.id}/discard`)
        .set(auth())
        .expect(200)
    ).body as TemplateJson;
    expect(discarded).toMatchObject({ hasDraft: false, version: 2 });
  });

  it('gives a POS a template of the right kind and sends the published layouts to the edge', async () => {
    const own = (await list()).find((entry) => entry.name === 'Архины пос 2');
    const saleDefault = (await list()).find((entry) => entry.kind === 'SALE' && entry.isDefault);
    const returnDefault = (await list()).find(
      (entry) => entry.kind === 'RETURN' && entry.isDefault,
    );
    if (!own || !saleDefault || !returnDefault) throw new Error('templates missing');
    // A sale's template is no return's.
    await posApi(app, actors.admin)
      .updateTill(store.till.id, { returnTemplateId: own.id })
      .expect(422);
    await posApi(app, actors.admin)
      .updateTill(store.till.id, { saleTemplateId: own.id })
      .expect(200);
    expect((await list()).find((entry) => entry.id === own.id)?.tills).toEqual([
      expect.objectContaining({ id: store.till.id }),
    ]);
    const shot = await snapshot();
    expect(shot.tills.find((till) => till.id === store.till.id)).toMatchObject({
      saleTemplateId: own.id,
      returnTemplateId: null,
    });
    const till = shot.tills.find((entry) => entry.id === store.till.id);
    expect(receiptLayoutFor(shot.receiptTemplates, 'SALE', till?.saleTemplateId)?.paper).toBe(
      'MM58',
    );
    expect(receiptLayoutFor(shot.receiptTemplates, 'RETURN', till?.returnTemplateId)).toEqual(
      defaultReceiptLayout(),
    );
    // A draft never reaches the edge.
    await http()
      .put(`/api/v1/pos/receipt-templates/${own.id}/draft`)
      .set(auth())
      .send({ name: own.name, layout: { ...defaultReceiptLayout(), size: 'LG' } })
      .expect(200);
    const after = await snapshot();
    expect(after.receiptTemplates?.find((entry) => entry.id === own.id)?.layout.size).toBe('SM');
  });

  it('keeps one default of each kind and deletes only an unused template', async () => {
    const own = (await list()).find((entry) => entry.name === 'Архины пос 2');
    const saleDefault = (await list()).find((entry) => entry.kind === 'SALE' && entry.isDefault);
    if (!own || !saleDefault) throw new Error('templates missing');
    // In use by К1: no delete.
    await http().delete(`/api/v1/pos/receipt-templates/${own.id}`).set(auth()).expect(409);
    await posApi(app, actors.admin).updateTill(store.till.id, { saleTemplateId: null }).expect(200);
    // The default: no delete either.
    await http().delete(`/api/v1/pos/receipt-templates/${saleDefault.id}`).set(auth()).expect(409);
    await http().post(`/api/v1/pos/receipt-templates/${own.id}/default`).set(auth()).expect(200);
    const defaults = (await list()).filter((entry) => entry.kind === 'SALE' && entry.isDefault);
    expect(defaults.map((entry) => entry.id)).toEqual([own.id]);
    await http()
      .post(`/api/v1/pos/receipt-templates/${saleDefault.id}/default`)
      .set(auth())
      .expect(200);
    await http().delete(`/api/v1/pos/receipt-templates/${own.id}`).set(auth()).expect(204);
    expect((await list()).some((entry) => entry.id === own.id)).toBe(false);
  });

  it('lets the office read and only a manager change', async () => {
    const office = posApi(app, actors.office);
    await office.http().get('/api/v1/pos/receipt-templates').set(office.auth).expect(200);
    await office
      .http()
      .post('/api/v1/pos/receipt-templates')
      .set(office.auth)
      .send({ kind: 'SALE', name: 'x' })
      .expect(403);
    const warehouse = posApi(app, actors.warehouse);
    await warehouse.http().get('/api/v1/pos/receipt-templates').set(warehouse.auth).expect(403);
  });
});
