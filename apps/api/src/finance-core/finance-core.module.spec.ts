import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FIN_ERROR_CODES } from '@tugeel/fin-contract';
import { Pool } from 'pg';
import { DB_POOL } from '../common/db/db.tokens';
import { FIN_DB, FIN_ERROR_HTTP_STATUS, FinanceCoreModule, FinError } from './index';

describe('FinanceCoreModule (ADR-0069 #8)', () => {
  it('boots with only the shared pool, without any Bto module', async () => {
    // A pool that never connects: building the module runs no query.
    const pool = new Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/none' });
    @Global()
    @Module({ providers: [{ provide: DB_POOL, useValue: pool }], exports: [DB_POOL] })
    class PoolOnly {}
    const app = await Test.createTestingModule({
      imports: [PoolOnly, FinanceCoreModule],
    }).compile();
    expect(app.get(FIN_DB)).toBeDefined();
    await app.close();
    await pool.end();
  });

  it('gives every FIN_* code an HTTP status', () => {
    expect(Object.keys(FIN_ERROR_HTTP_STATUS).sort()).toEqual([...FIN_ERROR_CODES].sort());
    const error = new FinError('FIN_UNBALANCED', 'debit 10.00, credit 9.99', {
      debit: '10.00',
      credit: '9.99',
    });
    expect([error.code, error.status, error.name]).toEqual(['FIN_UNBALANCED', 422, 'FinError']);
  });
});
