import pg from 'pg';
import { configurePgTypeParsers } from './pg-types';

describe('configurePgTypeParsers', () => {
  it('keeps NUMERIC as text even if a library registered parseFloat first', () => {
    pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => parseFloat(value));
    configurePgTypeParsers();
    const parse = pg.types.getTypeParser(pg.types.builtins.NUMERIC, 'text');
    expect(parse('12345678901234.99')).toBe('12345678901234.99');
  });
});
