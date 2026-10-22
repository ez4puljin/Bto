import { describe, expect, it } from 'vitest';
import {
  bannerTargetOf,
  chipToneOf,
  HOME_CATEGORY_TILES,
  homeCategoriesOf,
  nextSlide,
  sectionIconOf,
  sectionRouteOf,
  sectionSortsOf,
  sectionSubtitleOf,
  sectionTitleOf,
} from './home-sections';

const section = (
  kind: Parameters<typeof sectionTitleOf>[0]['kind'],
  over: Partial<Parameters<typeof sectionTitleOf>[0]> = {},
) => ({ kind, title: null, subtitle: null, lastDay: null, ...over });

describe('the home sections (ADR-0092 #1)', () => {
  it('names a segment by itself and a fixed section from mn.json', () => {
    expect(sectionTitleOf(section('SEGMENT', { title: 'Автомашины бүтээгдэхүүн' }))).toEqual({
      kind: 'own',
      text: 'Автомашины бүтээгдэхүүн',
    });
    expect(sectionTitleOf(section('RECENT'))).toEqual({ kind: 'name', name: 'recent' });
    expect(sectionTitleOf(section('PROMOTIONS'))).toEqual({ kind: 'name', name: 'promotions' });
    expect(sectionTitleOf(section('DISCOUNTS'))).toEqual({ kind: 'name', name: 'discounts' });
    expect(sectionTitleOf(section('NEW'))).toEqual({ kind: 'name', name: 'new' });
    expect(sectionTitleOf(section('FAVOURITES'))).toEqual({ kind: 'name', name: 'favourites' });
  });

  it('names the new and discounted products of a category its own way', () => {
    expect(sectionTitleOf(section('NEW'), 'category')).toEqual({
      kind: 'name',
      name: 'newInCategory',
    });
    expect(sectionTitleOf(section('DEALS'), 'category')).toEqual({
      kind: 'name',
      name: 'dealsInCategory',
    });
  });

  it('puts a segment description, or nothing, and the promotions last day under the title', () => {
    expect(sectionSubtitleOf(section('SEGMENT', { subtitle: ' Өвөлдөө бэлдэцгээе ' }))).toEqual({
      kind: 'own',
      text: 'Өвөлдөө бэлдэцгээе',
    });
    expect(sectionSubtitleOf(section('SEGMENT', { subtitle: '  ' }))).toBeNull();
    expect(sectionSubtitleOf(section('PROMOTIONS', { lastDay: '2026-10-31' }))).toEqual({
      kind: 'name',
      name: 'promotions',
      date: '10/31',
    });
    expect(sectionSubtitleOf(section('NEW', { lastDay: '2026-10-31' }))).toEqual({
      kind: 'name',
      name: 'new',
      date: null,
    });
  });

  it('colours the quick-link chips', () => {
    expect(chipToneOf('PROMOTIONS')).toBe('promotion');
    expect(chipToneOf('DISCOUNTS')).toBe('discount');
    expect(chipToneOf('DEALS')).toBe('discount');
    expect(chipToneOf('NEW')).toBe('new');
    expect(chipToneOf('SEGMENT')).toBe('plain');
    expect(chipToneOf('RECENT')).toBe('plain');
    expect(chipToneOf('FAVOURITES')).toBe('plain');
  });
});

describe("a home section's icon (ADR-0095)", () => {
  it('marks each kind of section', () => {
    expect(sectionIconOf('RECENT')).toEqual({ icon: 'history', tone: 'muted' });
    expect(sectionIconOf('PROMOTIONS')).toEqual({ icon: 'megaphone', tone: 'promotion' });
    expect(sectionIconOf('SEGMENT')).toEqual({ icon: 'megaphone', tone: 'discount' });
    expect(sectionIconOf('DISCOUNTS')).toEqual({ icon: 'tag', tone: 'discount' });
    expect(sectionIconOf('DEALS')).toEqual({ icon: 'tag', tone: 'discount' });
    expect(sectionIconOf('NEW')).toEqual({ icon: 'sparkles', tone: 'new' });
    expect(sectionIconOf('FAVOURITES')).toEqual({ icon: 'heart', tone: 'discount' });
  });
});

describe('a section list orders (ADR-0093 #6)', () => {
  const names = (kind: Parameters<typeof sectionSortsOf>[0]) =>
    sectionSortsOf(kind).map((sort) => `${sort.value}:${sort.name}`);

  it('names its own order and leaves out the one that repeats it', () => {
    expect(names('PROMOTIONS')).toEqual([
      'DEFAULT:deal',
      'NEW:new',
      'PRICE_ASC:priceAsc',
      'PRICE_DESC:priceDesc',
    ]);
    expect(names('NEW')).toEqual([
      'DEFAULT:new',
      'DEAL:deal',
      'PRICE_ASC:priceAsc',
      'PRICE_DESC:priceDesc',
    ]);
    expect(names('SEGMENT')).toEqual(names('NEW'));
    expect(names('DISCOUNTS')).toEqual(names('PROMOTIONS'));
    expect(names('DEALS')).toEqual(names('PROMOTIONS'));
  });

  it('keeps every order for the recent and the favourite products', () => {
    expect(names('RECENT')).toEqual([
      'DEFAULT:mostOrdered',
      'DEAL:deal',
      'NEW:new',
      'PRICE_ASC:priceAsc',
      'PRICE_DESC:priceDesc',
    ]);
    expect(names('FAVOURITES')[0]).toBe('DEFAULT:favourited');
    expect(names('FAVOURITES')).toHaveLength(5);
  });
});

describe('banners and the carousel (ADR-0092 #5)', () => {
  it('opens a segment list, a category page or a product, and nothing without a link', () => {
    expect(bannerTargetOf({ kind: 'SEGMENT', id: 3 })).toBe('/section/segment-3');
    expect(bannerTargetOf({ kind: 'CATEGORY', id: 12 })).toBe('/category/12');
    expect(bannerTargetOf({ kind: 'PRODUCT', id: 7 })).toBe('/product/7');
    expect(bannerTargetOf(null)).toBeNull();
  });

  it('moves on to the next slide, back to the first after the last', () => {
    expect(nextSlide(0, 3)).toBe(1);
    expect(nextSlide(2, 3)).toBe(0);
    expect(nextSlide(0, 1)).toBe(0);
    expect(nextSlide(0, 0)).toBe(0);
  });
});

describe('categories and links', () => {
  it('shows eight categories on the home', () => {
    const all = Array.from({ length: 11 }, (_, index) => index);
    expect(HOME_CATEGORY_TILES).toBe(8);
    expect(homeCategoriesOf(all)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(homeCategoriesOf([1, 2])).toEqual([1, 2]);
  });

  it('opens a section list, from a category page with its category', () => {
    expect(sectionRouteOf('promotions')).toBe('/section/promotions');
    expect(sectionRouteOf('new', 12)).toBe('/section/new?categoryIds=12&from=category');
  });
});
