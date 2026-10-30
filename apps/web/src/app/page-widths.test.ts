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

describe('page widths (ADR-0119)', () => {
  it('lets every width take the whole frame (reading lost its 1400px cap on 2026-10-30)', () => {
    expect(PAGE_WIDTHS.wide).toBe('max-w-none');
    expect(PAGE_WIDTHS.full).toBe('max-w-none');
    expect(PAGE_WIDTHS.reading).toBe('max-w-none');
    // Pages sit at the left: no page is centred by its width class.
    for (const value of Object.values(PAGE_WIDTHS)) expect(value).not.toContain('mx-auto');
  });
});
