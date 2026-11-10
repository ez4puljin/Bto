import { describe, expect, it } from 'vitest';
import type { Me } from '../api/session';
import { favouritesOf, menuOf, toggledFavourites } from './menu';

const person = (permissions: string[]) => ({ permissions }) as unknown as Me;

const keysOf = (permissions: string[]) =>
  menuOf(person(permissions)).flatMap((group) => group.items.map((item) => item.key));

describe('the staff menu', () => {
  it('gives a person without work rights expiry, attendance, the company side and their profile', () => {
    const groups = menuOf(person([]));
    expect(groups.map((group) => group.key)).toEqual(['work', 'attendance', 'community', 'me']);
    const keys = keysOf([]);
    expect(keys[0]).toBe('expiry');
    expect(keys).toContain('attendance');
    expect(keys).toContain('community');
    expect(keys).not.toContain('rep');
    expect(keys).not.toContain('picking');
    expect(keys).not.toContain('transfers');
    expect(keys).not.toContain('repSettings');
  });

  it('shows «ХТ захиалга» and the order settings only to a rep', () => {
    const keys = keysOf(['sales.orders.rep']);
    expect(keys[0]).toBe('rep');
    expect(keys).toContain('repNotifications');
    expect(keys).toContain('repSettings');
    expect(keys).not.toContain('picking');
  });

  it('opens each person their own profile', () => {
    const hrefOf = (permissions: string[]) =>
      menuOf(person(permissions))
        .flatMap((group) => group.items)
        .find((item) => item.key === 'profile')?.href;
    expect(hrefOf(['sales.orders.rep'])).toBe('/profile');
    expect(hrefOf([])).toBe('/me');
  });

  it('shows picking and transfers by their own rights', () => {
    expect(keysOf(['sales.orders.pick'])).toContain('picking');
    expect(keysOf(['sales.orders.pick'])).not.toContain('transfers');
    expect(keysOf(['inventory.transfers.manage'])).toContain('transfers');
    expect(keysOf(['inventory.transfers.manage'])).not.toContain('picking');
  });

  it('gives a driver «Ачилт» (ADR-0179), first among their favourites', () => {
    expect(keysOf(['sales.orders.load'])).toContain('loading');
    expect(keysOf(['sales.orders.pick'])).not.toContain('loading');
    const driver = menuOf(person(['sales.orders.load']));
    expect(favouritesOf(null, driver).map((item) => item.key)).toEqual(['loading', 'community']);
  });
});

describe('the favourites', () => {
  const rep = menuOf(person(['sales.orders.rep']));

  it('starts with the person’s work and «Хамт олон»', () => {
    expect(favouritesOf(null, rep).map((item) => item.key)).toEqual(['rep', 'community']);
    expect(favouritesOf(null, menuOf(person([]))).map((item) => item.key)).toEqual(['community']);
  });

  it('keeps an empty choice empty', () => {
    expect(favouritesOf([], rep)).toEqual([]);
  });

  it('keeps the chosen order and drops what the person may no longer open', () => {
    const keys = favouritesOf(['thanks', 'picking', 'rep', 'gone', 7], rep).map((item) => item.key);
    expect(keys).toEqual(['thanks', 'rep']);
  });

  it('adds at the end and takes out', () => {
    expect(toggledFavourites(['rep'], 'thanks')).toEqual(['rep', 'thanks']);
    expect(toggledFavourites(['rep', 'thanks'], 'rep')).toEqual(['thanks']);
  });
});
