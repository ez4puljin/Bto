import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

/** Milliseconds between two keys of a scan (scanners type a character every 5–30 ms). */
const KEY_GAP_MS = 10;

/**
 * A keyboard-wedge scan of `code`: the code and Enter typed into whatever has the focus, one key
 * every 10 ms by the events' clock however busy the machine is. The wedge detector reads each
 * keydown's `timeStamp`, which jsdom takes from `Date.now()`; under the load of `pnpm check` real
 * keystrokes once landed more than `WEDGE_DEFAULTS.maxGapMs` apart and the scan read as typing.
 * So only `Date` is faked here, and it moves only between keys.
 */
export async function wedgeScan(code: string): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    if (new KeyboardEvent('keydown').timeStamp !== Date.now()) {
      throw new Error(
        'jsdom no longer stamps events with Date.now(): wedgeScan must fake its clock',
      );
    }
    const scanner = userEvent.setup({
      delay: KEY_GAP_MS,
      advanceTimers: (ms) => {
        vi.advanceTimersByTime(ms);
      },
    });
    await scanner.keyboard(`${code}{Enter}`);
  } finally {
    vi.useRealTimers();
  }
}
