import { describe, expect, it } from 'vitest';
import { cardPictures, heroPictures, pageAt } from './pictures';

const images = [
  { url: '/f/a.jpg', thumbUrl: '/f/a-t.jpg' },
  { url: '/f/b.jpg', thumbUrl: null },
];

describe('product pictures', () => {
  it('gives a card the thumbnails, the full file where a thumbnail is missing', () => {
    expect(cardPictures({ thumbUrl: '/f/a-t.jpg', images })).toEqual(['/f/a-t.jpg', '/f/b.jpg']);
    expect(cardPictures({ thumbUrl: '/f/only.jpg', images: [] })).toEqual(['/f/only.jpg']);
    expect(cardPictures({ thumbUrl: null, images: [] })).toEqual([]);
  });

  it('gives the product page the full files, each with its thumbnail to show first', () => {
    expect(heroPictures({ thumbUrl: '/f/a-t.jpg', images })).toEqual([
      { url: '/f/a.jpg', placeholder: '/f/a-t.jpg' },
      { url: '/f/b.jpg', placeholder: null },
    ]);
    expect(heroPictures({ thumbUrl: '/f/only.jpg', images: [] })).toEqual([
      { url: '/f/only.jpg', placeholder: null },
    ]);
  });

  it('finds the pager page from the offset, within the pictures', () => {
    expect(pageAt(0, 160, 3)).toBe(0);
    expect(pageAt(170, 160, 3)).toBe(1);
    expect(pageAt(900, 160, 3)).toBe(2);
    expect(pageAt(-40, 160, 3)).toBe(0);
    expect(pageAt(100, 0, 3)).toBe(0);
  });
});
