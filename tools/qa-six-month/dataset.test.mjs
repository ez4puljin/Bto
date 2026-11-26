import assert from 'node:assert/strict';
import test from 'node:test';
import { CUSTOMERS, DAYS, PRODUCTS, SUPPLIERS } from './dataset.mjs';
import { validateDataset } from './plan.mjs';

test('the fictional catalogue has exact requested counts and complete supplier grouping', () => {
  const result = validateDataset();
  assert.equal(result.products, 500);
  assert.equal(result.suppliers, 60);
  assert.equal(result.supplierDepartments, 20);
  assert.equal(result.kgProducts, 50);
  assert.ok(SUPPLIERS.every((s) => s.note.includes('зохиомол')));
  assert.ok(CUSTOMERS.every((s) => s.note.includes('зохиомол')));
});

test('every product and carton barcode is a distinct valid EAN-13 in the synthetic range', () => {
  // Independent right-to-left complete-code checksum, including published valid/invalid vectors.
  const valid = (code) =>
    [...code].reverse().reduce((sum, digit, at) => sum + Number(digit) * (at % 2 ? 3 : 1), 0) %
      10 ===
    0;
  assert.equal(valid('4006381333931'), true);
  assert.equal(valid('4006381333932'), false);
  const codes = PRODUCTS.flatMap((p) => [p.barcode, p.boxBarcode]);
  assert.equal(new Set(codes).size, 1000);
  for (const code of codes) {
    assert.match(code, /^29882[45]\d{7}$/);
    assert.equal(valid(code), true);
  }
});

test('the history contains contiguous actual calendar dates across six named months', () => {
  assert.equal(DAYS[0], '2026-06-01');
  assert.equal(DAYS.at(-1), '2026-11-23');
  for (let i = 1; i < DAYS.length; i += 1)
    assert.equal(new Date(DAYS[i]) - new Date(DAYS[i - 1]), 86400000);
  assert.deepEqual(
    [...new Set(DAYS.map((d) => d.slice(0, 7)))],
    ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
  );
});

test('fictional partners contain no fabricated real-world bank, telephone or taxpayer identity', () => {
  for (const partner of [...SUPPLIERS, ...CUSTOMERS]) {
    assert.equal(partner.phone, undefined);
    assert.equal(partner.tin, undefined);
    assert.equal(partner.bankAccount, undefined);
    if (partner.email) assert.ok(partner.email.endsWith('@example.invalid'));
  }
});
