import test from 'node:test';
import assert from 'node:assert/strict';
import { roleAccountIds } from './reconcile.mjs';

test('shared SALES/POS role accounts are counted once and missing/null mappings are not fabricated', () => {
  const rules = [
    { posting_key: 'SALES', account_id: '7' },
    { posting_key: 'POS_SALES', account_id: '7' },
    { posting_key: 'SALES_RETURN', account_id: '9' },
    { posting_key: 'INVENTORY', account_id: null },
  ];
  assert.deepEqual(roleAccountIds(rules, ['SALES', 'POS_SALES', 'SALES_RETURN']), ['7', '9']);
  assert.deepEqual(roleAccountIds(rules, ['INVENTORY', 'MISSING']), []);
});
