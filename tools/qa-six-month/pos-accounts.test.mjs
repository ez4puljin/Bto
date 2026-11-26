import assert from 'node:assert/strict';
import test from 'node:test';
import { configurePosAccounts, POS_ACCOUNT_DEFAULTS } from './pos-accounts.mjs';

const fixture = (rules, accounts = []) => {
  let writes = 0;
  return {
    runtime: { clock: { day: '2026-06-01' }, reader: { query: async () => ({ rows: rules }) } },
    refs: { accounts: { bank: { id: 100 } } },
    state: { operations: {}, checks: {} },
    all: async () => accounts,
    save: async () => {},
    create: async () => {
      writes++;
      throw new Error('unexpected write');
    },
    write: async () => {
      writes++;
      throw new Error('unexpected write');
    },
    get writes() {
      return writes;
    },
  };
};

test('POS setup refuses to repurpose an existing account or bypass future mapping history', async () => {
  const unrelated = fixture(
    [
      {
        posting_key: 'OTHER_INCOME',
        account_id: '1',
        effective_from: '2000-01-01',
        status: 'ACTIVE',
      },
    ],
    [{ id: 1, code: '100102', kind: 'ASSET', status: 'ACTIVE' }],
  );
  await assert.rejects(configurePosAccounts(unrelated), /conflicts with existing/);
  assert.equal(unrelated.writes, 0);
  const future = fixture([
    { posting_key: 'POS_SALES', account_id: '9', effective_from: '2026-11-24', status: 'ACTIVE' },
  ]);
  await assert.rejects(configurePosAccounts(future), /existing\/future rule history/);
  assert.equal(future.writes, 0);
});

test('already configured opening-day POS roles remain unchanged on resume', async () => {
  const rules = POS_ACCOUNT_DEFAULTS.map((s, i) => ({
    posting_key: s.role,
    account_id: String(i + 1),
    effective_from: '2026-06-01',
    status: 'ACTIVE',
  }));
  const ctx = fixture(rules);
  await configurePosAccounts(ctx);
  assert.equal(ctx.writes, 0);
  assert.equal(ctx.state.checks.posChartSetup.accounts.length, 4);
});

test('POS setup never repurposes an existing cash-journal account with a default code', async () => {
  const ctx = fixture(
    [],
    [{ id: 1, code: '100102', kind: 'ASSET', status: 'ACTIVE', journal: 'CASH', currency: 'MNT' }],
  );
  await assert.rejects(configurePosAccounts(ctx), /conflicts with existing configuration/);
  assert.equal(ctx.writes, 0);
});

test('POS setup never assigns a foreign-currency default-code account', async () => {
  const ctx = fixture(
    [],
    [
      {
        id: 1,
        code: '100102',
        kind: 'ASSET',
        status: 'ACTIVE',
        journal: 'GENERAL',
        currency: 'USD',
      },
    ],
  );
  await assert.rejects(configurePosAccounts(ctx), /conflicts with existing configuration/);
  assert.equal(ctx.writes, 0);
});
