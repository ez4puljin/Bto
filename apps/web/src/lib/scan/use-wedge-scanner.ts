import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { WEDGE_DEFAULTS, WedgeDetector } from './wedge-detector';

/** Text fields keep their keys: a person may be typing there, and a scan box reads its own input. */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

const OPEN_DIALOGS = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

/**
 * Whether a scan must not reach the scan box at `root` (ADR-0047 #4): a dialog that does not hold
 * the box is open (a confirmation, a create dialog), or the box sits in a page made inert behind
 * the phone menu. Without a root, any open dialog blocks.
 */
export function scanBlocked(root: Element | null): boolean {
  if (root?.closest('[inert]')) return true;
  return Array.from(document.querySelectorAll(OPEN_DIALOGS)).some(
    (dialog) => root === null || !dialog.contains(root),
  );
}

/**
 * Listens for keyboard-wedge scans anywhere on the page while focus is outside text fields, so a
 * scan works without clicking into the scan box first (ADR-0021 #1). `letters` reads shelf labels
 * by physical key (scan contexts only). A scan's Enter is always swallowed, so it never presses a
 * focused button; the code reaches `onScan` only while `enabled` and not blocked by a dialog.
 */
export function useWedgeScanner(
  onScan: (code: string) => void,
  enabled = true,
  options: { letters?: boolean; root?: RefObject<Element | null> } = {},
): void {
  const handler = useRef(onScan);
  const active = useRef(enabled);
  const letters = options.letters ?? false;
  const root = options.root;
  useEffect(() => {
    handler.current = onScan;
    active.current = enabled;
  });
  useEffect(() => {
    const detector = new WedgeDetector({ ...WEDGE_DEFAULTS, letters });
    const listener = (event: KeyboardEvent) => {
      if (isTextField(event.target)) {
        detector.reset();
        return;
      }
      const code = detector.feed(event);
      if (code === null) return;
      event.preventDefault();
      if (!active.current || scanBlocked(root?.current ?? null)) return;
      handler.current(code);
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [letters, root]);
}

/**
 * For a dialog's content: a scan that ends while a button there has the focus never presses it, so
 * a stray scan cannot confirm a dialog whose main button takes the focus (ADR-0047 #3, #4). Text
 * fields keep their keys. Returns the content's capture-phase keydown handler.
 */
export function useScanEnterGuard(): (event: ReactKeyboardEvent<HTMLElement>) => void {
  const detector = useRef(new WedgeDetector({ ...WEDGE_DEFAULTS, letters: true }));
  return useCallback((event) => {
    if (isTextField(event.target)) {
      detector.current.reset();
      return;
    }
    if (detector.current.feed(event) !== null) event.preventDefault();
  }, []);
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
