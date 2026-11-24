import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ImportKind } from '@tugeel/shared/imports';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { ImportPipelineService } from '../../src/modules/imports';
import { createHttpApp } from '../harness/apps';
import { catalogApi, idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { importsApi, type ImportJobJson } from '../harness/imports';
import { pricingApi } from '../harness/pricing';

const BOX_BARCODE = '4870008701003';

/**
 * Sheets made from the import templates of before 2026-11-24 keep importing (ADR-0036): commit
 * 6894e222 renamed the unit and box barcode labels, and the old words stay aliases of those
 * columns. Only the check runs: nothing is committed. Synthetic data only.
 */
describe('imports: the template wording of before 2026-11-24', () => {
  let app: NestExpressApplication;
  let admin: string;
  let imports: ReturnType<typeof importsApi>;
  const profile = 'Импорт: Хуучин гарчиг';

  /** Uploads a sheet with exactly these header cells and rows, creates the job and checks it. */
  const check = async (kind: ImportKind, rows: unknown[][]): Promise<ImportJobJson> => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Sheet1');
    for (const row of rows) sheet.addRow(row);
    const fileId = await imports.upload(Buffer.from(await book.xlsx.writeBuffer()));
    const created = (
      await request(app.getHttpServer())
        .post('/api/v1/imports')
        .set(bearer(admin))
        .set(idempotency())
        .send({ kind, fileId, fileName: `${kind.toLowerCase()}.xlsx` })
        .expect(201)
    ).body as ImportJobJson;
    await app.get(ImportPipelineService).validate(created.id);
    return imports.get(created.id);
  };

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    imports = importsApi(app, admin);
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Хуучин гарчиг');
    await catalog.product({
      sku: '8862',
      name: 'Бараа 8862',
      categoryId: category,
      baseUomId: await catalog.uomId('PCS'),
    });
    await pricingApi(app, admin).profile(profile);
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['old', 'Суурь нэгж', 'Хайрцагны баркод'],
    ['new', 'Хэмжих нэгж', 'Хайрцгийн баркод'],
  ])('reads a products sheet with the %s unit and box barcode headers', async (_, unit, box) => {
    const job = await check('PRODUCTS', [
      ['Код *', 'Нэр *', 'Ангилал *', unit, 'Хайрцаг дахь тоо', box],
      ['8861', 'Бараа 8861', 'Хуучин гарчиг', 'PCS', 12, BOX_BARCODE],
    ]);
    expect(job).toMatchObject({ status: 'VALIDATED', summary: { actions: { CREATE: 1 } } });
    const [row] = await imports.rows(job.id);
    expect(row?.raw).toMatchObject({ baseUnit: 'PCS', boxQty: '12', boxBarcodes: BOX_BARCODE });
  });

  it.each([
    ['old', 'Суурь нэгж'],
    ['new', 'Хэмжих нэгж'],
  ])('reads a prices sheet with the %s unit header', async (_, unit) => {
    const job = await check('PRICES', [
      ['Код *', 'Нэр', unit, 'Агуулахын үнэ', 'Үнийн тохиргоо'],
      ['8862', 'Бараа 8862', 'ш', 1200, profile],
    ]);
    expect(job).toMatchObject({ status: 'VALIDATED', summary: { actions: { CREATE: 1 } } });
    const [row] = await imports.rows(job.id);
    expect(row?.raw).toMatchObject({ baseUnit: 'ш', warehousePrice: '1200', profile });
  });
});
