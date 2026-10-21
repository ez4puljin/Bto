import type { HomeSectionKind, HomeSectionSort } from '@tugeel/shared/sales';
import type { StoreBannerLink } from '../api/customer';
import { monthDay } from '../dates/calendar';

// «Нүүр», a section's full list and a category's page of «Bto300» (ADR-0092 #1, #5–#7; the Main,
// SectionList and Category boards) as pure functions: the sections' names, the chips' colours,
// the orders a list offers, where a banner leads and the carousel's slides.

/** Where a section is shown: the home names the fixed sections one way, a category page another. */
export type SectionPlace = 'home' | 'category';

/** The fixed sections' names in mn.json (`mobile.customer.sections.*`). */
export type SectionName =
  | 'recent'
  | 'promotions'
  | 'discounts'
  | 'deals'
  | 'new'
  | 'favourites'
  | 'newInCategory'
  | 'dealsInCategory';

export type SectionText = { kind: 'own'; text: string } | { kind: 'name'; name: SectionName };

interface SectionLike {
  kind: HomeSectionKind;
  title: string | null;
  subtitle: string | null;
  lastDay: string | null;
}

const NAMES: Record<Exclude<HomeSectionKind, 'SEGMENT'>, SectionName> = {
  RECENT: 'recent',
  PROMOTIONS: 'promotions',
  DISCOUNTS: 'discounts',
  DEALS: 'deals',
  NEW: 'new',
  FAVOURITES: 'favourites',
};

/** A segment's own name; a fixed section's from mn.json («Шинээр нэмэгдсэн бараа» on a category). */
export function sectionTitleOf(section: SectionLike, place: SectionPlace = 'home'): SectionText {
  if (section.kind === 'SEGMENT') return { kind: 'own', text: section.title ?? '' };
  if (place === 'category' && section.kind === 'NEW')
    return { kind: 'name', name: 'newInCategory' };
  if (place === 'category' && section.kind === 'DEALS') {
    return { kind: 'name', name: 'dealsInCategory' };
  }
  return { kind: 'name', name: NAMES[section.kind] };
}

/**
 * The line under a section's title: a segment's description (or none), «10/31 хүртэл ·
 * хугацаатай хямдрал» for the promotions (`date`), a fixed line for the others.
 */
export type SectionSubtitle =
  { kind: 'own'; text: string } | { kind: 'name'; name: SectionName; date: string | null } | null;

export function sectionSubtitleOf(
  section: SectionLike,
  place: SectionPlace = 'home',
): SectionSubtitle {
  if (section.kind === 'SEGMENT') {
    const text = section.subtitle?.trim() ?? '';
    return text ? { kind: 'own', text } : null;
  }
  const title = sectionTitleOf(section, place);
  if (title.kind !== 'name') return null;
  return {
    kind: 'name',
    name: title.name,
    date: section.kind === 'PROMOTIONS' && section.lastDay ? monthDay(section.lastDay) : null,
  };
}

/** A quick-link chip's colours (the Main board): promotions orange, discounts red, new blue. */
export type ChipTone = 'promotion' | 'discount' | 'new' | 'plain';

export function chipToneOf(kind: HomeSectionKind): ChipTone {
  switch (kind) {
    case 'PROMOTIONS':
      return 'promotion';
    case 'DISCOUNTS':
    case 'DEALS':
      return 'discount';
    case 'NEW':
      return 'new';
    default:
      return 'plain';
  }
}

/** A sort's words in mn.json (`mobile.customer.sorts.*`). */
export type SortName = 'mostOrdered' | 'deal' | 'new' | 'favourited' | 'priceAsc' | 'priceDesc';

/**
 * The orders a section's list offers (ADR-0093 #6). The section's own order (DEFAULT) comes first,
 * named after what it is; an order that would repeat it is left out (a discounts list is already
 * «Хямдрал ихээр», a segment and «Шинэ бараа» already «Шинэ эхэндээ»).
 */
export function sectionSortsOf(
  kind: HomeSectionKind,
): { value: HomeSectionSort; name: SortName }[] {
  const own: SortName =
    kind === 'RECENT'
      ? 'mostOrdered'
      : kind === 'FAVOURITES'
        ? 'favourited'
        : kind === 'PROMOTIONS' || kind === 'DISCOUNTS' || kind === 'DEALS'
          ? 'deal'
          : 'new';
  const others: { value: HomeSectionSort; name: SortName }[] = [
    { value: 'DEAL', name: 'deal' },
    { value: 'NEW', name: 'new' },
    { value: 'PRICE_ASC', name: 'priceAsc' },
    { value: 'PRICE_DESC', name: 'priceDesc' },
  ];
  return [{ value: 'DEFAULT', name: own }, ...others.filter((sort) => sort.name !== own)];
}

/** The screen a banner opens (ADR-0092 #5): a segment's list, a category's page or a product. */
export function bannerTargetOf(link: StoreBannerLink | null): string | null {
  if (!link) return null;
  switch (link.kind) {
    case 'SEGMENT':
      return `/section/segment-${link.id}`;
    case 'CATEGORY':
      return `/category/${link.id}`;
    case 'PRODUCT':
      return `/product/${link.id}`;
  }
}

/** How long a banner stays before the carousel moves on by itself (the owner, 2026-10-20). */
export const BANNER_SECONDS = 5;

/** The slide after `index`, back to the first after the last (the slide itself: `pageAt`). */
export function nextSlide(index: number, count: number): number {
  return count <= 1 ? 0 : (index + 1) % count;
}

/** «Ангиллын жагсаалт» on «Нүүр»: four a row, two rows; «Бүгд» lists every one. */
export const HOME_CATEGORY_TILES = 8;

export function homeCategoriesOf<T>(categories: readonly T[]): T[] {
  return categories.slice(0, HOME_CATEGORY_TILES);
}

/** A section's list opened from a category page carries the category: `?categoryIds=5&from=category`. */
export function sectionRouteOf(key: string, categoryId?: number): string {
  return categoryId === undefined
    ? `/section/${key}`
    : `/section/${key}?categoryIds=${categoryId}&from=category`;
}
