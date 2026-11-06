import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PAGE_WIDTHS, widthOf } from '@/app/page-width';
import { routes } from '@/app/router';

/** The pages inside the shell: its index and the routes with a relative path, at any depth. */
function shellPages(list: readonly RouteObject[]): RouteObject[] {
  return list.flatMap((route) => [
    ...(route.index || (route.path && !route.path.startsWith('/')) ? [route] : []),
    ...shellPages(route.children ?? []),
  ]);
}

describe('page widths (ADR-0066)', () => {
  it('lets every page of the shell say how wide it runs', () => {
    const pages = shellPages(routes);
    expect(pages.length).toBeGreaterThan(60);
    const missing = pages
      .filter((route) => widthOf(route.handle) === null)
      .map((route) => route.path ?? '(index)');
    expect(missing).toEqual([]);
  });
});

describe('page widths (ADR-0119, ADR-0158)', () => {
  it('lets lists and work pages take the whole frame, at the left', () => {
    expect(PAGE_WIDTHS.wide).toBe('max-w-none');
    expect(PAGE_WIDTHS.full).toBe('max-w-none');
  });

  it('keeps short pages in one centred column, with equal margins', () => {
    expect(PAGE_WIDTHS.reading).toBe('mx-auto max-w-[60rem]');
  });
});
