// Pure helpers of the server panel on «Системийн төлөв»: what the machine's processors, memory and
// disk are doing, read from the operating system. Tested in server-metrics.spec.ts.

/** One processor's counters since boot, in milliseconds (`os.cpus()[n].times`). */
export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

/** A point of the history: when, and the percent of processor and memory in use. */
export interface MetricsSample {
  t: number;
  cpu: number;
  mem: number;
}

export interface MemoryReading {
  totalBytes: number;
  /** Not available to programs: total minus what the kernel says can still be given out. */
  usedBytes: number;
  availableBytes: number;
  /** Buffers and file cache: memory the kernel gives back when programs ask for it. */
  cachedBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export interface DiskReading {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
}

/** One decimal: a percent for the screen, not for arithmetic. */
export function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/** `part` of `whole` as a percent with one decimal; 0 when there is no whole. */
export function percentOf(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return oneDecimal(Math.min(100, Math.max(0, (part / whole) * 100)));
}

/**
 * The busy share of one processor between two readings of its counters, as a percent. Counters
 * that did not move (or went back, after a suspend) give 0.
 */
export function cpuPercentBetween(before: CpuTimes, after: CpuTimes): number {
  const total = (times: CpuTimes) => times.user + times.nice + times.sys + times.idle + times.irq;
  const elapsed = total(after) - total(before);
  if (!(elapsed > 0)) return 0;
  return percentOf(elapsed - (after.idle - before.idle), elapsed);
}

/** The counters of every processor added up: the whole machine as one. */
export function sumCpuTimes(all: readonly CpuTimes[]): CpuTimes {
  const sum: CpuTimes = { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
  for (const times of all) {
    sum.user += times.user;
    sum.nice += times.nice;
    sum.sys += times.sys;
    sum.idle += times.idle;
    sum.irq += times.irq;
  }
  return sum;
}

/**
 * Linux's `/proc/meminfo` (values in kB) as a reading; null when the text is not one (another
 * system). Inside a container this file still describes the whole machine.
 */
export function parseMeminfo(text: string): MemoryReading | null {
  const kb = new Map<string, number>();
  for (const line of text.split('\n')) {
    const match = /^(\w[\w()]*):\s+(\d+)(?:\s+kB)?\s*$/.exec(line);
    if (match?.[1] && match[2]) kb.set(match[1], Number.parseInt(match[2], 10));
  }
  const total = kb.get('MemTotal');
  const free = kb.get('MemFree');
  if (total === undefined || free === undefined) return null;
  const cached = (kb.get('Buffers') ?? 0) + (kb.get('Cached') ?? 0) + (kb.get('SReclaimable') ?? 0);
  // Kernels before 3.14 have no MemAvailable: free plus what the cache gives back is the estimate.
  const available = Math.min(total, kb.get('MemAvailable') ?? free + cached);
  const swapTotal = kb.get('SwapTotal') ?? 0;
  const swapFree = kb.get('SwapFree') ?? 0;
  return {
    totalBytes: total * 1024,
    usedBytes: (total - available) * 1024,
    availableBytes: available * 1024,
    cachedBytes: cached * 1024,
    swapTotalBytes: swapTotal * 1024,
    swapUsedBytes: Math.max(0, swapTotal - swapFree) * 1024,
  };
}

/** A filesystem's size as `df` shows it: used counts the root-reserved blocks, free does not. */
export function diskReadingOf(stats: {
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
}): DiskReading {
  return {
    totalBytes: stats.blocks * stats.bsize,
    usedBytes: (stats.blocks - stats.bfree) * stats.bsize,
    freeBytes: stats.bavail * stats.bsize,
  };
}

/** A disk's used share as `df` counts it: of what is used plus what a program may still write. */
export function diskPercentOf(disk: DiskReading): number {
  return percentOf(disk.usedBytes, disk.usedBytes + disk.freeBytes);
}

/** The newest `capacity` samples, oldest first. */
export class SampleRing {
  private readonly samples: MetricsSample[] = [];

  constructor(private readonly capacity: number) {}

  push(sample: MetricsSample): void {
    this.samples.push(sample);
    if (this.samples.length > this.capacity) {
      this.samples.splice(0, this.samples.length - this.capacity);
    }
  }

  /** Every kept sample, or only those taken after `since` (epoch milliseconds). */
  after(since?: number): MetricsSample[] {
    if (since === undefined) return [...this.samples];
    return this.samples.filter((sample) => sample.t > since);
  }
}
