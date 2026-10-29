import { useSyncExternalStore } from 'react';

/**
 * Whether the window matches a media query, kept current as it is resized. Without `matchMedia`
 * (jsdom, an old browser) it is false, so tests see the narrow layout unless they mock it.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = mediaList(query);
      if (!list) return () => {};
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => mediaList(query)?.matches ?? false,
    () => false,
  );
}

/** Screens of 1600px and more: a list may show its wider default set of columns (ADR-0119). */
export const WIDE_SCREEN = '(min-width: 1600px)';

function mediaList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(query);
}
