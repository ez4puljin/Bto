import type { Client } from 'pg';
import { connectAs } from '../harness/apps';

describe('integrity: database locale (ADR-0003)', () => {
  let app: Client;

  beforeAll(async () => {
    app = await connectAs('app');
  });
  afterAll(async () => {
    await app.end();
  });

  it('case-folds Mongolian Cyrillic', async () => {
    const { rows } = await app.query<{ lower: string; upper: string; ok: boolean }>(
      `SELECT lower('ӨҮЁ') AS lower, upper('өүё') AS upper, assert_unicode_casefold() AS ok`,
    );
    expect(rows[0]).toEqual({ lower: 'өүё', upper: 'ӨҮЁ', ok: true });
  });

  it('runs on a UTF-8 database with the ICU locale provider', async () => {
    const { rows } = await app.query<{ encoding: string; provider: string }>(
      `SELECT pg_encoding_to_char(encoding) AS encoding, datlocprovider AS provider
         FROM pg_database WHERE datname = current_database()`,
    );
    expect(rows[0]).toEqual({ encoding: 'UTF8', provider: 'i' });
  });

  it('runs the integrity suite with a 5 second statement timeout', async () => {
    const { rows } = await app.query<{ statement_timeout: string }>('SHOW statement_timeout');
    expect(rows[0]?.statement_timeout).toBe('5s');
  });
});
