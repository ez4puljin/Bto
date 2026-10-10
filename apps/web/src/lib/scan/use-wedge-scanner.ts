import { useEffect, useRef } from 'react';
import { WedgeDetector } from './wedge-detector';

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
 * scan works without clicking into the scan box first (ADR-0021 #1).
 */
export function useWedgeScanner(onScan: (code: string) => void, enabled = true): void {
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const detector = new WedgeDetector();
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
  }, [enabled]);
}
