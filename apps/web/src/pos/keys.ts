import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { layoutDigit, withLayoutDigit } from '@/lib/barcode-keys';

/** Keeps the focus where it is (the scan box) when a touch or a click presses a button. */
export function keepFocus(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

/**
 * For a number field's keydown: the Mongolian layout types symbols on the number row, so its
 * keys are read by position (`withLayoutDigit`). Calls `set` with the new text when it mapped one.
 */
export function typeDigits(
  event: ReactKeyboardEvent<HTMLInputElement>,
  value: string,
  set: (value: string) => void,
): void {
  const typed = withLayoutDigit(event, value);
  if (typed !== null) set(typed);
}

/** The digit a key typed, on any layout and on the number pad; null for every other key. */
export function digitOf(event: {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): string | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (/^[0-9]$/.test(event.key)) return event.key;
  return layoutDigit(event);
}

/** The + and − keys of the number pad and the main keyboard. */
export function isPlusKey(event: { key: string; code: string }): boolean {
  return event.key === '+' || event.code === 'NumpadAdd';
}

export function isMinusKey(event: { key: string; code: string }): boolean {
  return event.key === '-' || event.code === 'NumpadSubtract';
}
