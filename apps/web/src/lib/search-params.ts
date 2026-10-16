import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * The URL keeps a page's filters and its open record (`?invoice=`, `?shift=`; ADR-0066 replaces
 * the copies of these two helpers in each page).
 */

/** `?…` with one parameter set (or removed when empty), the others kept: a row's link to its panel. */
export function hrefWithParam(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined,
): string {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return `?${next.toString()}`;
}

/** Sets or clears one search parameter in place (no new history entry), keeping the others. */
export function useSetParam(): (key: string, value: string | null | undefined) => void {
  const [, setParams] = useSearchParams();
  return useCallback(
    (key, value) =>
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
}
