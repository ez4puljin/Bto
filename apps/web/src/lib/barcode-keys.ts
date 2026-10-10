/** The parts of a KeyboardEvent the digit mapping reads. */
export interface KeyInfo {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const DIGIT_KEY = /^Digit([0-9])$/;

/**
 * The digit of a number-row key when the keyboard layout typed something else. The Mongolian
 * Cyrillic layout puts symbols (№, ₮, …) on the unshifted number row, and a USB barcode scanner
 * types through the active layout, so "4901234567894" would arrive as symbols. `event.code` names
 * the physical key whatever the layout, so barcode fields read digits from it. Null when the key is
 * not a plain number-row press or already typed its digit.
 */
export function layoutDigit(event: KeyInfo): string | null {
  if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return null;
  const digit = DIGIT_KEY.exec(event.code)?.[1];
  return digit !== undefined && event.key !== digit ? digit : null;
}
