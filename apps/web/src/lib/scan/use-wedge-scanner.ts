import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef } from 'react';
import { WEDGE_DEFAULTS, WedgeDetector } from './wedge-detector';

/** Text fields keep their keys: a person may be typing there, and a scan box reads its own input. */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Listens for keyboard-wedge scans anywhere on the page while focus is outside text fields, so a
 * scan works without clicking into the scan box first (ADR-0021 #1). `letters` reads shelf labels
 * by physical key (scan contexts only).
 */
export function useWedgeScanner(
  onScan: (code: string) => void,
  enabled = true,
  options: { letters?: boolean } = {},
): void {
  const handler = useRef(onScan);
  const letters = options.letters ?? false;
  useEffect(() => {
    handler.current = onScan;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const detector = new WedgeDetector({ ...WEDGE_DEFAULTS, letters });
    const listener = (event: KeyboardEvent) => {
      if (isTextField(event.target)) {
        detector.reset();
        return;
      }
      const code = detector.feed(event);
      if (code === null) return;
      // The Enter that ends a scan must not also press a focused button.
      event.preventDefault();
      handler.current(code);
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [enabled, letters]);
}

/**
 * For a text field of a scan screen (a quantity): a scan that lands in it goes to `onScan` and the
 * field gets back the value it had before the burst, so scanning the next item never turns into a
 * quantity of 4 901 234 567 894. Returns the field's keydown handler.
 */
export function useScanGuard(
  onScan: (code: string) => void,
  options: { letters?: boolean } = {},
): (
  event: ReactKeyboardEvent<HTMLInputElement>,
  value: string,
  restore: (value: string) => void,
) => void {
  const handler = useRef(onScan);
  const detector = useRef(
    new WedgeDetector({ ...WEDGE_DEFAULTS, letters: options.letters ?? false }),
  );
  const before = useRef('');
  const last = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    handler.current = onScan;
  });
  return useCallback((event, value, restore) => {
    if (event.timeStamp - last.current > WEDGE_DEFAULTS.maxGapMs) before.current = value;
    last.current = event.timeStamp;
    const code = detector.current.feed(event);
    if (code === null) return;
    event.preventDefault();
    restore(before.current);
    handler.current(code);
  }, []);
}
