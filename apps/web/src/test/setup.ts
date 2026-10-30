import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { clearToasts } from '@/lib/toast';

// The shelves are on hold on screen (lib/features.ts); the tests cover the shelf paths as built.
vi.mock('@/lib/features', () => ({ BINS_SOON: false }));

// `pnpm check` runs every workspace's tests at once; a page that waits for sign-in, then its
// data, can need more than the default 1 s under that load (the first test of a file booting the
// app took 3.3 s on 2026-10-14). A longer wait, not a retry.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no ResizeObserver; Radix measures checkboxes inside a <form> with it.
if (!('ResizeObserver' in globalThis)) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
}

afterEach(() => {
  cleanup();
  // Toasts live in a module-level store (lib/toast); each test starts with none.
  clearToasts();
  // Lists remember hidden columns in localStorage (ADR-0037); each test starts with none.
  localStorage.clear();
  // The product list keeps its ticks in sessionStorage (ADR-0052); each test starts with none.
  sessionStorage.clear();
});
