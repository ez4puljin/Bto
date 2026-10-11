import { type KeyInfo, layoutDigit, scanChar } from '@/lib/barcode-keys';

export interface WedgeOptions {
  /** Shortest code accepted (onScan.js default). */
  minLength: number;
  /** Longest pause between two keys of one scan, in milliseconds. */
  maxGapMs: number;
  /** Read letters and label symbols by physical key too (shelf labels, `scanChar`). */
  letters?: boolean;
}

/**
 * Scanners type a character every 5–30 ms, Bluetooth ones a little slower; people need 80 ms and
 * more between keys, so a burst of at least four characters ending in Enter is a scan.
 */
export const WEDGE_DEFAULTS: WedgeOptions = { minLength: 4, maxGapMs: 50 };

export interface WedgeKey extends KeyInfo {
  timeStamp: number;
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock']);

/**
 * Tells a keyboard-wedge barcode scanner from a person typing (ADR-0021 #1). Feed it the keydowns
 * that happen outside text fields; it returns the code when a fast burst ends with Enter, else null.
 * Number-row keys are read by their physical position, so the Mongolian layout does not matter.
 */
export class WedgeDetector {
  private readonly options: WedgeOptions;
  private buffer = '';
  private last = Number.NEGATIVE_INFINITY;

  constructor(options: WedgeOptions = WEDGE_DEFAULTS) {
    this.options = options;
  }

  feed(event: WedgeKey): string | null {
    // Scanners press Shift for capital letters: it neither adds to nor breaks a burst.
    if (MODIFIERS.has(event.key)) return null;
    const fast = event.timeStamp - this.last <= this.options.maxGapMs;
    if (event.key === 'Enter') {
      const code = fast && this.buffer.length >= this.options.minLength ? this.buffer : null;
      this.reset();
      return code;
    }
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    const mapped = this.options.letters ? scanChar(event) : layoutDigit(event);
    const char = mapped ?? (plain && event.key.length === 1 ? event.key : null);
    if (char === null) {
      this.reset();
      return null;
    }
    this.buffer = fast ? `${this.buffer}${char}` : char;
    this.last = event.timeStamp;
    return null;
  }

  reset(): void {
    this.buffer = '';
    this.last = Number.NEGATIVE_INFINITY;
  }
}
