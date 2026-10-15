import { describe, expect, it, vi } from 'vitest';
import { WEDGE_DEFAULTS, WedgeDetector } from '@/lib/scan/wedge-detector';
import { wedgeScan } from '@/test/scan';

describe('wedgeScan', () => {
  it('stays a scan however long each key takes to handle', async () => {
    const detector = new WedgeDetector();
    const codes: string[] = [];
    const stamps: number[] = [];
    const listener = (event: KeyboardEvent) => {
      stamps.push(event.timeStamp);
      const code = detector.feed(event);
      if (code !== null) codes.push(code);
      // A machine busy with every workspace's tests: each key outlasts a scan's longest gap.
      const end = performance.now() + WEDGE_DEFAULTS.maxGapMs + 10;
      while (performance.now() < end) {
        // busy
      }
    };
    window.addEventListener('keydown', listener);
    try {
      await wedgeScan('4006381333931');
    } finally {
      window.removeEventListener('keydown', listener);
    }
    expect(codes).toEqual(['4006381333931']);
    expect(stamps.slice(1).map((stamp, index) => stamp - stamps[index]!)).toEqual(
      Array.from({ length: 13 }, () => 10),
    );
    expect(vi.isFakeTimers()).toBe(false);
  });
});
