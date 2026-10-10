import mn from '@tugeel/shared/i18n/mn.json';
import type { Client } from 'pg';
import { connectAs, createHttpApp } from '../harness/apps';

/** System units of measure are synced at api boot (like identity's catalog), never by a migration. */
describe('catalog reference data', () => {
  let sql: Client;

  beforeAll(async () => {
    sql = await connectAs('app');
  });
  afterAll(async () => {
    await sql.end();
  });

  const units = async () =>
    (
      await sql.query<{
        code: string;
        name: string;
        fractional: boolean;
        measure_unit: string | null;
      }>(`SELECT code, name, fractional, measure_unit FROM uoms ORDER BY id`)
    ).rows;

  it('creates the system units once, named from mn.json, and keeps what the admin changed', async () => {
    const first = await createHttpApp();
    await first.close();
    expect(await units()).toEqual([
      { code: 'PCS', name: mn.uoms.system.PCS, fractional: false, measure_unit: null },
      { code: 'BLOCK', name: mn.uoms.system.BLOCK, fractional: false, measure_unit: null },
      { code: 'BOX', name: mn.uoms.system.BOX, fractional: false, measure_unit: null },
      { code: 'KG', name: mn.uoms.system.KG, fractional: true, measure_unit: null },
    ]);

    await sql.query(
      `UPDATE uoms SET name = 'ширхэг', name_key = 'ширхэг', measure_unit = 'ш' WHERE code = 'PCS'`,
    );
    const second = await createHttpApp();
    await second.close();
    const after = await units();
    expect(after).toHaveLength(4);
    expect(after[0]).toEqual({ code: 'PCS', name: 'ширхэг', fractional: false, measure_unit: 'ш' });
  });
});
