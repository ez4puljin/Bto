import { describe, expect, it } from 'vitest';
import { WedgeDetector, type WedgeKey } from './wedge-detector';

const KEY_CODES: Record<string, string> = {
  Enter: 'Enter',
  Shift: 'ShiftLeft',
  '-': 'Minus',
};
const codeOf = (key: string) =>
  KEY_CODES[key] ?? (/^[0-9]$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`);

/** Keydowns for `keys` starting at `start`, `gap` milliseconds apart. */
function burst(keys: string[], gap: number, start = 1000): WedgeKey[] {
  return keys.map((key, index) => ({
    key,
    code: codeOf(key),
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    timeStamp: start + index * gap,
  }));
}
const chars = (text: string) => [...text];
const feedAll = (detector: WedgeDetector, events: WedgeKey[]) =>
  events.map((event) => detector.feed(event)).filter((code) => code !== null);

describe('WedgeDetector', () => {
  it('reads a fast burst that ends with Enter', () => {
    const detector = new WedgeDetector();
    expect(feedAll(detector, burst([...chars('4006381333931'), 'Enter'], 8))).toEqual([
      '4006381333931',
    ]);
  });

  it('ignores a person typing, short bursts and a slow Enter', () => {
    const detector = new WedgeDetector();
    expect(feedAll(detector, burst([...chars('12345'), 'Enter'], 150))).toEqual([]);
    expect(feedAll(detector, burst([...chars('123'), 'Enter'], 5))).toEqual([]);
    const slowEnter = burst(chars('123456'), 5);
    slowEnter.push({ ...burst(['Enter'], 0, 5000)[0]! });
    expect(feedAll(detector, slowEnter)).toEqual([]);
  });

  it('starts over after a pause, so keys typed before a scan are not part of it', () => {
    const detector = new WedgeDetector();
    const typed = burst(chars('99'), 5, 0);
    const scanned = burst([...chars('ABC-123'), 'Enter'], 10, 500);
    expect(feedAll(detector, [...typed, ...scanned])).toEqual(['ABC-123']);
  });

  it('reads digits through the Mongolian layout and lets Shift pass between letters', () => {
    const detector = new WedgeDetector();
    const events = burst(['№', '-', '"', '₮', 'Shift', 'K', 'Enter'], 6);
    const [one, two, three, four] = [events[0]!, events[1]!, events[2]!, events[3]!];
    one.code = 'Digit1';
    two.code = 'Digit2';
    three.code = 'Digit3';
    four.code = 'Digit4';
    expect(feedAll(detector, events)).toEqual(['1234K']);
  });

  it('drops a burst when a shortcut or a navigation key comes in between', () => {
    const detector = new WedgeDetector();
    const events = burst([...chars('1234'), 'ArrowDown', ...chars('56'), 'Enter'], 5);
    expect(feedAll(detector, events)).toEqual([]);
    const withCtrl = burst([...chars('12345'), 'Enter'], 5);
    withCtrl[2]!.ctrlKey = true;
    expect(feedAll(detector, withCtrl)).toEqual([]);
  });
});
