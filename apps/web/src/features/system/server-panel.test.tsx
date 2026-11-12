import { screen, within } from '@testing-library/react';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { WORKER_ME, json, renderApp, signedIn } from '@/test/render-app';
import { durationParts, formatBytes, formatPercent, levelOf, mergeHistory } from './server-format';

const GB = 1024 ** 3;

const SERVER = {
  sampledAt: '2026-11-13T00:30:00.000Z',
  intervalSeconds: 5,
  host: {
    system: 'Linux 7.0.0-43-generic',
    arch: 'x64',
    cpuModel: 'Intel(R) Xeon(R) CPU E5-4657L v2 @ 2.40GHz',
    cpuThreads: 4,
    uptimeSeconds: 6 * 3600 + 41 * 60,
  },
  cpu: { percent: 12.4, perCore: [5, 95.5, 72, 0], load1: 0.63, load5: 0.4, load15: 0.5 },
  memory: {
    totalBytes: 30 * GB,
    usedBytes: 9 * GB,
    availableBytes: 21 * GB,
    cachedBytes: 15 * GB,
    swapTotalBytes: 0,
    swapUsedBytes: 0,
    percent: 30,
  },
  disk: { totalBytes: 233 * GB, usedBytes: 95 * GB, freeBytes: 127 * GB, percent: 42.8 },
  database: { sizeBytes: 512 * 1024 ** 2, connections: 12, maxConnections: 40 },
  process: {
    nodeVersion: 'v26.7.0',
    uptimeSeconds: 125,
    cpuPercent: 1.5,
    rssBytes: 256 * 1024 ** 2,
    heapUsedBytes: 100 * 1024 ** 2,
    limitBytes: GB,
  },
  history: [
    { t: 1_794_530_000_000, cpu: 10, mem: 29.5 },
    { t: 1_794_530_005_000, cpu: 12.4, mem: 30 },
  ],
};

const text = mn.systemStatus.server;

/** A translation with its `{{name}}` places filled, as i18next does. */
const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));

describe('the server panel helpers', () => {
  it('writes sizes in binary steps', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(30 * GB)).toBe('30.0 GB');
    expect(formatBytes(233 * GB)).toBe('233 GB');
    expect(formatBytes(2 * 1024 ** 4)).toBe('2.0 TB');
    expect(formatPercent(12.44)).toBe('12.4%');
  });

  it('splits seconds into days, hours and minutes', () => {
    expect(durationParts(59)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(durationParts(6 * 3600 + 41 * 60 + 5)).toEqual({ days: 0, hours: 6, minutes: 41 });
    expect(durationParts(3 * 86_400 + 4 * 3600)).toEqual({ days: 3, hours: 4, minutes: 0 });
  });

  it('warns from 70 % and alarms from 90 %', () => {
    expect([0, 69.9, 70, 89.9, 90, 100].map(levelOf)).toEqual([
      'ok',
      'ok',
      'warn',
      'warn',
      'high',
      'high',
    ]);
  });

  it('adds only newer points to the held history and keeps the newest', () => {
    const held = [
      { t: 1, cpu: 1, mem: 1 },
      { t: 2, cpu: 2, mem: 2 },
    ];
    const fresh = [
      { t: 2, cpu: 9, mem: 9 },
      { t: 3, cpu: 3, mem: 3 },
    ];
    expect(mergeHistory(held, fresh).map((sample) => sample.t)).toEqual([1, 2, 3]);
    expect(mergeHistory(held, fresh)[1]?.cpu).toBe(2);
    expect(mergeHistory(held, fresh, 2).map((sample) => sample.t)).toEqual([2, 3]);
    expect(mergeHistory([], fresh).map((sample) => sample.t)).toEqual([2, 3]);
  });
});

describe('the server panel on the status page', () => {
  it('shows the processors, the memory, the disk and the database to an admin', async () => {
    const fetchMock = signedIn(undefined, { 'GET /api/v1/system/server': () => json(SERVER) });
    renderApp('/system/status', fetchMock);

    const panel = await screen.findByRole('region', { name: text.title });
    const cpu = within(panel).getByRole('region', { name: text.cpu });
    expect(within(cpu).getByText('12.4%')).toBeInTheDocument();
    expect(within(cpu).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12');
    expect(
      within(cpu).getByText(fill(text.cpuSub, { threads: 4, load: '0.63' })),
    ).toBeInTheDocument();

    const memory = within(panel).getByRole('region', { name: text.memory });
    expect(within(memory).getByText('30.0%')).toBeInTheDocument();
    expect(within(memory).getByText('9.0 GB / 30.0 GB')).toBeInTheDocument();

    const disk = within(panel).getByRole('region', { name: text.disk });
    expect(within(disk).getByText('42.8%')).toBeInTheDocument();
    expect(within(disk).getByText('95.0 GB / 233 GB')).toBeInTheDocument();
    expect(within(disk).getByText(fill(text.freeLeft, { free: '127 GB' }))).toBeInTheDocument();

    const uptime = within(panel).getByRole('region', { name: text.uptime });
    expect(
      within(uptime).getByText(fill(text.duration.hours, { hours: 6, minutes: 41 })),
    ).toBeInTheDocument();

    // The graph says its newest point in words; every processor has its own line.
    expect(
      within(panel).getByText(fill(text.chart.summary, { cpu: '12.4%', memory: '30.0%' })),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(fill(text.cores.core, { index: 2, percent: '95.5%' })),
    ).toBeInTheDocument();

    expect(within(panel).getByText(SERVER.host.cpuModel)).toBeInTheDocument();
    expect(within(panel).getByText('512 MB')).toBeInTheDocument();
    expect(within(panel).getByText('12 / 40')).toBeInTheDocument();
    expect(
      within(panel).getByText(fill(text.details.apiLimit, { used: '256 MB', limit: '1.0 GB' })),
    ).toBeInTheDocument();
    expect(within(panel).getByText(text.details.swapNone)).toBeInTheDocument();

    // The first call asks for the whole hour.
    const call = fetchMock.mock.calls.find(([request]) => request.url.includes('/system/server'));
    expect(call?.[0].url).toBe('http://tugeel.test/api/v1/system/server');
  });

  it('says so when the server cannot be read, and keeps the component states', async () => {
    renderApp('/system/status', signedIn());
    expect(await screen.findByText(text.unavailable)).toBeInTheDocument();
    expect(screen.getAllByText(mn.systemStatus.state.up)).toHaveLength(2);
  });

  it('is not asked for, nor shown, without the settings right', async () => {
    const fetchMock = signedIn(WORKER_ME, { 'GET /api/v1/system/server': () => json(SERVER) });
    renderApp('/system/status', fetchMock);
    expect(await screen.findAllByText(mn.systemStatus.state.up)).toHaveLength(2);
    expect(screen.queryByRole('region', { name: text.title })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([request]) => request.url.includes('/system/server'))).toBe(
      false,
    );
  });
});
