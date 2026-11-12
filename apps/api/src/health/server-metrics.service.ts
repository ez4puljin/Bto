import { readFile, statfs } from 'node:fs/promises';
import os from 'node:os';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig } from '../common/config/app-config';
import { DB_POOL } from '../common/db/db.tokens';
import {
  type CpuTimes,
  type DiskReading,
  type MemoryReading,
  SampleRing,
  cpuPercentBetween,
  diskPercentOf,
  diskReadingOf,
  oneDecimal,
  parseMeminfo,
  percentOf,
  sumCpuTimes,
} from './server-metrics';
import type { ServerMetricsDto } from './server-metrics.dto';

/** How often the machine is read. */
export const SAMPLE_SECONDS = 5;
/** One hour of history is kept in memory; a restart of the api starts it again. */
const HISTORY_SAMPLES = (60 * 60) / SAMPLE_SECONDS;

interface CpuReading {
  at: number;
  cores: CpuTimes[];
  process: NodeJS.CpuUsage;
}

/**
 * The server panel of «Системийн төлөв»: processors, memory, disk and the database of the machine
 * the api runs on, read every few seconds, with an hour of history for the graph. Nothing is
 * stored: the numbers live in this process. In Docker the api still sees the whole machine's
 * processors and memory (`/proc` is the host's for these), and the disk under its files.
 */
@Injectable()
export class ServerMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly history = new SampleRing(HISTORY_SAMPLES);
  private timer: NodeJS.Timeout | undefined;
  private firstTimer: NodeJS.Timeout | undefined;
  private last: CpuReading = readCpu();
  private cpuPercent = 0;
  private perCore: number[] = [];
  private processCpuPercent = 0;

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    // The first percent a second after the start, then one every SAMPLE_SECONDS. Neither timer
    // keeps the process alive.
    this.firstTimer = setTimeout(() => void this.sample(), 1_000);
    this.firstTimer.unref();
    this.timer = setInterval(() => void this.sample(), SAMPLE_SECONDS * 1_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearTimeout(this.firstTimer);
    clearInterval(this.timer);
  }

  /** Reads the processors and the memory once and adds a point to the history. */
  async sample(): Promise<void> {
    const now = readCpu();
    const elapsedMs = now.at - this.last.at;
    if (elapsedMs > 0) {
      this.cpuPercent = cpuPercentBetween(sumCpuTimes(this.last.cores), sumCpuTimes(now.cores));
      this.perCore = now.cores.map((times, index) => {
        const before = this.last.cores[index];
        return before ? cpuPercentBetween(before, times) : 0;
      });
      // Of one processor: a busy api with several threads can pass 100.
      const used = now.process.user + now.process.system;
      const usedBefore = this.last.process.user + this.last.process.system;
      this.processCpuPercent = oneDecimal(((used - usedBefore) / 1_000 / elapsedMs) * 100);
    }
    this.last = now;
    const memory = await readMemory();
    this.history.push({
      t: now.at,
      cpu: this.cpuPercent,
      mem: percentOf(memory.usedBytes, memory.totalBytes),
    });
  }

  /** The machine now, and the history after `since` (all of it when not given). */
  async snapshot(since?: number): Promise<ServerMetricsDto> {
    const [memory, disk, database] = await Promise.all([
      readMemory(),
      this.readDisk(),
      this.readDatabase(),
    ]);
    const cpus = os.cpus();
    const [load1 = 0, load5 = 0, load15 = 0] = os.loadavg();
    const usage = process.memoryUsage();
    const limit = process.constrainedMemory();
    return {
      sampledAt: new Date().toISOString(),
      intervalSeconds: SAMPLE_SECONDS,
      host: {
        system: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        cpuModel: cpus[0]?.model.trim() ?? '',
        cpuThreads: cpus.length,
        uptimeSeconds: Math.round(os.uptime()),
      },
      cpu: {
        percent: this.cpuPercent,
        perCore: this.perCore,
        load1: oneDecimal(load1),
        load5: oneDecimal(load5),
        load15: oneDecimal(load15),
      },
      memory: { ...memory, percent: percentOf(memory.usedBytes, memory.totalBytes) },
      disk: disk ? { ...disk, percent: diskPercentOf(disk) } : null,
      database,
      process: {
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        cpuPercent: this.processCpuPercent,
        rssBytes: usage.rss,
        heapUsedBytes: usage.heapUsed,
        // A container's memory limit; none (0, or the machine's whole memory) outside one.
        limitBytes: limit > 0 && limit < memory.totalBytes ? limit : null,
      },
      history: this.history.after(since),
    };
  }

  /** The filesystem the uploaded files live on: in Docker, the machine's own disk. */
  private async readDisk(): Promise<DiskReading | null> {
    const dir = this.config.get('STORAGE_LOCAL_DIR') ?? process.cwd();
    for (const path of [dir, process.cwd()]) {
      try {
        return diskReadingOf(await statfs(path));
      } catch {
        // The storage folder is made at the first upload: the working folder is on the same disk.
      }
    }
    return null;
  }

  private async readDatabase(): Promise<ServerMetricsDto['database']> {
    try {
      const result = await this.pool.query<{ size: string; connections: number; max: number }>(
        `SELECT pg_database_size(current_database())::text AS size,
                (SELECT count(*)::int FROM pg_stat_activity
                  WHERE datname = current_database()) AS connections,
                current_setting('max_connections')::int AS max`,
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        sizeBytes: Number.parseInt(row.size, 10),
        connections: row.connections,
        maxConnections: row.max,
      };
    } catch {
      return null;
    }
  }
}

function readCpu(): CpuReading {
  return {
    at: Date.now(),
    cores: os.cpus().map((cpu) => cpu.times),
    process: process.cpuUsage(),
  };
}

/** Linux tells buffers, cache and swap apart; elsewhere only total and free are known. */
async function readMemory(): Promise<MemoryReading> {
  if (process.platform === 'linux') {
    try {
      const reading = parseMeminfo(await readFile('/proc/meminfo', 'utf8'));
      if (reading) return reading;
    } catch {
      // Fall through to what Node knows.
    }
  }
  const total = os.totalmem();
  const available = os.freemem();
  return {
    totalBytes: total,
    usedBytes: total - available,
    availableBytes: available,
    cachedBytes: 0,
    swapTotalBytes: 0,
    swapUsedBytes: 0,
  };
}
