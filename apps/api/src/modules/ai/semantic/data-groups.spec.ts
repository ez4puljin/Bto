import { AI_DATA_GROUPS, aiDataPermission } from '@tugeel/shared/ai';
import { isPermission } from '@tugeel/shared/auth';
import { guardSql } from '../sql/sql-guard';
import { accessOf, AI_GROUP_VIEWS, ALL_VIEWS } from './data-groups';
import { AI_DATASETS } from './datasets';

describe('the data groups (ADR-0162)', () => {
  it('every view is in exactly one group', () => {
    const grouped = Object.values(AI_GROUP_VIEWS).flat();
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(AI_DATASETS.map((set) => set.name).sort());
  });

  it('every group is a permission', () => {
    for (const group of AI_DATA_GROUPS) expect(isPermission(aiDataPermission(group))).toBe(true);
  });

  it('opens only the views of the groups held', () => {
    expect(accessOf(new Set(['ai.ask']))).toEqual(new Set());
    const access = accessOf(new Set(['ai.ask', 'ai.data.catalog', 'ai.data.sales']));
    expect([...access].sort()).toEqual([...AI_GROUP_VIEWS.catalog, ...AI_GROUP_VIEWS.sales].sort());
  });

  it('the guard refuses a real view outside the groups, with its own reason', async () => {
    const access = accessOf(new Set(['ai.data.catalog']));
    expect(await guardSql('SELECT sku FROM products', access)).toMatchObject({ ok: true });
    expect(await guardSql('SELECT name FROM customers', access)).toMatchObject({
      ok: false,
      reason: 'DATA_ACCESS',
    });
    expect(
      await guardSql('SELECT p.sku FROM products p JOIN ai.stock s ON s.product_id = p.id', access),
    ).toMatchObject({ ok: false, reason: 'DATA_ACCESS' });
    expect(
      await guardSql('WITH c AS (SELECT name FROM customers) SELECT name FROM c', access),
    ).toMatchObject({ ok: false, reason: 'DATA_ACCESS' });
  });

  it('a CTE may not borrow the name of a view outside the groups to reach it', async () => {
    const access = accessOf(new Set(['ai.data.catalog']));
    expect(
      await guardSql(
        'WITH customers AS (SELECT sku FROM products) SELECT sku FROM customers',
        access,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await guardSql(
        'WITH customers AS (SELECT sku FROM products) SELECT name FROM ai.customers',
        access,
      ),
    ).toMatchObject({ ok: false, reason: 'DATA_ACCESS' });
  });

  it('a name that is no view stays RELATION, and the base tables stay closed to everyone', async () => {
    expect(await guardSql('SELECT 1 FROM users', ALL_VIEWS)).toMatchObject({
      ok: false,
      reason: 'RELATION',
    });
    expect(await guardSql('SELECT 1 FROM ai_settings', ALL_VIEWS)).toMatchObject({
      ok: false,
      reason: 'RELATION',
    });
  });
});
