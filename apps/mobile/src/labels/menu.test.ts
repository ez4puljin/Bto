import { describe, expect, it } from 'vitest';
import type { Me } from '../api/session';
import { menuOf } from '../staff/menu';

const person = (permissions: string[]) => ({ permissions }) as unknown as Me;
const keysOf = (permissions: string[]) =>
  menuOf(person(permissions)).flatMap((group) => group.items.map((item) => item.key));

describe('«Үнийн шошго» in the menu', () => {
  it('is the store seller’s, in «Ажил»', () => {
    const seller = menuOf(person(['inventory.transfers.manage']));
    const work = seller.find((group) => group.key === 'work');
    expect(work?.items).toContainEqual({ key: 'labels', href: '/labels' });
    expect(keysOf([])).not.toContain('labels');
    expect(keysOf(['sales.orders.rep'])).not.toContain('labels');
  });
});
