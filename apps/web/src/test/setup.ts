import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { clearToasts } from '@/lib/toast';

// `pnpm check` runs every workspace's tests at once; a page that waits for sign-in, then its
// data, can need more than the default 1 s under that load. A longer wait, not a retry.
configure({ asyncUtilTimeout: 3000 });

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
});
