import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
import { WIDE_SCREEN } from '@/lib/use-media-query';

vi.mock('@/app/auth-context', () => ({
  useAuthState: () => ({ status: 'authenticated', me: { id: 1 } }),
}));

const KEYS = ['code', 'name', 'note', 'cost'] as const;
const LOCKED = ['code', 'name'] as const;
const NARROW = ['note', 'cost'] as const;
const WIDE = ['cost'] as const;
const OWN_KEY = 'tugeel.demo.hiddenColumns.v1:1';

/** A window that is, or is not, 1600px wide, for `useMediaQuery`. */
function screenOf(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === WIDE_SCREEN && wide,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const hook = () => renderHook(() => useHiddenColumns('demo', KEYS, LOCKED, NARROW, WIDE));

describe('useHiddenColumns (ADR-0050, ADR-0066, ADR-0119)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('hides the narrow default set on a laptop and the wide set on a 1600px screen', () => {
    screenOf(false);
    const narrow = hook();
    expect([...narrow.result.current.hidden]).toEqual(['note', 'cost']);
    narrow.unmount();
    screenOf(true);
    expect([...hook().result.current.hidden]).toEqual(['cost']);
  });

  it('counts a window without matchMedia as narrow, and the narrow set as both when no wide set', () => {
    expect([...hook().result.current.hidden]).toEqual(['note', 'cost']);
    screenOf(true);
    const { result } = renderHook(() => useHiddenColumns('demo', KEYS, LOCKED, NARROW));
    expect([...result.current.hidden]).toEqual(['note', 'cost']);
  });

  it('lets a stored choice win over both default sets', () => {
    screenOf(true);
    localStorage.setItem(OWN_KEY, JSON.stringify(['note']));
    const { result } = hook();
    expect([...result.current.hidden]).toEqual(['note']);
    act(() => result.current.showAll());
    expect(result.current.hidden.size).toBe(0);
    expect(localStorage.getItem(OWN_KEY)).toBe('[]');
  });
});
