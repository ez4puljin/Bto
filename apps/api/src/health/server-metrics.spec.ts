import {
  SampleRing,
  cpuPercentBetween,
  diskPercentOf,
  diskReadingOf,
  parseMeminfo,
  percentOf,
  sumCpuTimes,
} from './server-metrics';

const times = (user: number, idle: number) => ({ user, nice: 0, sys: 0, idle, irq: 0 });

describe('the server panel helpers', () => {
  it('counts a percent with one decimal and never outside 0–100', () => {
    expect(percentOf(1, 3)).toBe(33.3);
    expect(percentOf(5, 4)).toBe(100);
    expect(percentOf(-1, 4)).toBe(0);
    expect(percentOf(1, 0)).toBe(0);
  });

  it('reads the busy share of a processor between two readings', () => {
    expect(cpuPercentBetween(times(100, 900), times(150, 950))).toBe(50);
    expect(cpuPercentBetween(times(100, 900), times(100, 1900))).toBe(0);
    // Counters that did not move, or went back after a suspend, are no load.
    expect(cpuPercentBetween(times(100, 900), times(100, 900))).toBe(0);
    expect(cpuPercentBetween(times(100, 900), times(50, 400))).toBe(0);
  });

  it('adds the processors up to the whole machine', () => {
    const before = sumCpuTimes([times(0, 0), times(0, 0)]);
    const after = sumCpuTimes([times(100, 0), times(0, 100)]);
    expect(cpuPercentBetween(before, after)).toBe(50);
  });

  it('reads /proc/meminfo: used is what programs can no longer be given', () => {
    const reading = parseMeminfo(
      [
        'MemTotal:       31739904 kB',
        'MemFree:         5386968 kB',
        'MemAvailable:   21358848 kB',
        'Buffers:          500000 kB',
        'Cached:         14000000 kB',
        'SReclaimable:    1000000 kB',
        'SwapTotal:       8388604 kB',
        'SwapFree:        8000000 kB',
        'HugePages_Total:       0',
        'Active(file):    7000000 kB',
      ].join('\n'),
    );
    expect(reading).toEqual({
      totalBytes: 31739904 * 1024,
      usedBytes: (31739904 - 21358848) * 1024,
      availableBytes: 21358848 * 1024,
      cachedBytes: 15500000 * 1024,
      swapTotalBytes: 8388604 * 1024,
      swapUsedBytes: 388604 * 1024,
    });
  });

  it('estimates the available memory on a kernel that does not say it, and refuses other text', () => {
    const old = parseMeminfo('MemTotal: 1000 kB\nMemFree: 100 kB\nCached: 300 kB\n');
    expect(old?.availableBytes).toBe(400 * 1024);
    expect(old?.usedBytes).toBe(600 * 1024);
    expect(parseMeminfo('not a meminfo file')).toBeNull();
  });

  it('sizes a disk as df does', () => {
    const disk = diskReadingOf({ bsize: 4096, blocks: 1000, bfree: 400, bavail: 350 });
    expect(disk).toEqual({
      totalBytes: 4096 * 1000,
      usedBytes: 4096 * 600,
      freeBytes: 4096 * 350,
    });
    // 600 used of 600 + 350 a program can reach.
    expect(diskPercentOf(disk)).toBe(63.2);
  });

  it('keeps the newest samples and returns those after a moment', () => {
    const ring = new SampleRing(3);
    for (const t of [1, 2, 3, 4]) ring.push({ t, cpu: t, mem: 0 });
    expect(ring.after().map((sample) => sample.t)).toEqual([2, 3, 4]);
    expect(ring.after(3).map((sample) => sample.t)).toEqual([4]);
    expect(ring.after(4)).toEqual([]);
  });
});
