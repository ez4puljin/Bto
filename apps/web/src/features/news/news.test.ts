import { afterEach, describe, expect, it } from 'vitest';
import {
  entryOf,
  FIRST_VISIT_LIMIT,
  markAllRead,
  NEWS,
  type NewsEntry,
  readIds,
  sortEntries,
  unreadOf,
} from './news';

const entry = (id: string): NewsEntry => ({ id, date: id.slice(0, 10), title: id, blocks: [] });

describe('news', () => {
  afterEach(() => window.localStorage.clear());

  it('reads every shipped file: a dated name and a title', () => {
    expect(NEWS.length).toBeGreaterThan(0);
    for (const item of NEWS) {
      expect(item.id).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
      expect(item.title, item.id).toBeTruthy();
    }
    expect(NEWS).toEqual(sortEntries(NEWS));
  });

  it('refuses a file without a date or a title', () => {
    expect(entryOf('./content/notes.md', '# A')).toBeNull();
    expect(entryOf('./content/2026-11-26-a.md', 'no title')).toBeNull();
    expect(entryOf('./content/2026-11-26-a.md', '# Гарчиг\n\nМөр')).toMatchObject({
      id: '2026-11-26-a',
      date: '2026-11-26',
      title: 'Гарчиг',
    });
  });

  it('sorts newest first', () => {
    const sorted = sortEntries([
      entry('2026-11-01-a'),
      entry('2026-11-03-a'),
      entry('2026-11-03-b'),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['2026-11-03-b', '2026-11-03-a', '2026-11-01-a']);
  });

  it('shows every unread entry, however many, and only the newest few on a first visit', () => {
    const all = Array.from({ length: 9 }, (_, index) => entry(`2026-11-1${index}-a`));
    expect(unreadOf(all, null)).toHaveLength(FIRST_VISIT_LIMIT);
    expect(unreadOf(all, new Set())).toHaveLength(9);
    // An entry landed later under an older date is still unread.
    expect(unreadOf(all, new Set(all.slice(1).map((item) => item.id)))).toEqual([all[0]]);
  });

  it('keeps what one user read apart from another', () => {
    expect(readIds(7)).toBeNull();
    markAllRead(7, [entry('2026-11-26-a')]);
    expect(readIds(7)).toEqual(new Set(['2026-11-26-a']));
    expect(readIds(8)).toBeNull();
    window.localStorage.setItem('bto.news.read.9', 'not json');
    expect(readIds(9)).toBeNull();
  });
});
