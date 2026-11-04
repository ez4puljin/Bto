import { isTillCode, tillCodeLookKey, tillCodeUrlSegment } from '@tugeel/shared/pos';

/**
 * ADR-0138: the POS a kiosk page is opened for — the first segment of the path on the store edge
 * (`http://<edge>:7400/K1`) or `?till=K1` beside `pos.html` (the dev server) — as its till code,
 * or null when the address names none. Latin look-alikes become the Cyrillic code (`K1` → `К1`).
 */
export function tillFromAddress(location: Pick<Location, 'pathname' | 'search'>): string | null {
  const query = new URLSearchParams(location.search).get('till');
  const segment = location.pathname.split('/').filter(Boolean)[0] ?? '';
  let raw = query ?? (segment.toLowerCase() === 'pos.html' ? '' : segment);
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const code = tillCodeLookKey(raw);
  return code && isTillCode(code) ? code : null;
}

/** The address that opens a POS: `/K1` on the edge, `pos.html?till=K1` on the dev server. */
export function tillAddress(code: string, location: Pick<Location, 'pathname'>): string {
  const segment = tillCodeUrlSegment(code);
  return location.pathname.endsWith('.html')
    ? `${location.pathname}?till=${segment}`
    : `/${segment}`;
}
