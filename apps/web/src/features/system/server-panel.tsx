import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUbDateTime } from '@/lib/dayjs';
import { cn } from '@/lib/utils';
import {
  type ServerSample,
  durationParts,
  formatBytes,
  formatPercent,
  levelOf,
} from './server-format';
import type { ServerMetrics } from './use-server-metrics';

/*
 * The server panel of «Системийн төлөв»: what the machine's processors, memory and disk are doing,
 * with an hour of history. Colours are the page's tokens only, so the panel follows the theme.
 */

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 };
const GRID = 'var(--border)';
const CPU_COLOR = 'var(--chart-1)';
const MEMORY_COLOR = 'var(--chart-4)';

const LEVEL_BAR = { ok: 'bg-primary', warn: 'bg-warning', high: 'bg-destructive' } as const;
const LEVEL_TEXT = { ok: '', warn: 'text-warning', high: 'text-destructive' } as const;

/** `3 өдөр 4 ц`, `6 ц 41 мин` or `12 мин`. */
function useDuration(): (seconds: number) => string {
  const { t } = useTranslation();
  return (seconds) => {
    // A plain object: i18next's options want an index signature.
    const parts = { ...durationParts(seconds) };
    if (parts.days > 0) return t('systemStatus.server.duration.days', parts);
    if (parts.hours > 0) return t('systemStatus.server.duration.hours', parts);
    return t('systemStatus.server.duration.minutes', parts);
  };
}

function Meter({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn('h-full rounded-full transition-[width]', LEVEL_BAR[levelOf(percent)])}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function Tile(props: { title: string; value: string; percent?: number; lines: readonly string[] }) {
  return (
    <section
      aria-label={props.title}
      className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06]"
    >
      <h2 className="text-[0.8125rem] font-medium text-muted-foreground">{props.title}</h2>
      <p
        className={cn(
          'font-mono text-[1.5rem] leading-tight font-semibold',
          props.percent === undefined ? '' : LEVEL_TEXT[levelOf(props.percent)],
        )}
      >
        {props.value}
      </p>
      {props.percent === undefined ? null : <Meter percent={props.percent} label={props.title} />}
      <div className="flex flex-col gap-0.5 text-[0.75rem] text-muted-foreground">
        {props.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </section>
  );
}

function Tiles({ data }: { data: ServerMetrics }) {
  const { t } = useTranslation();
  const duration = useDuration();
  const ofTotal = (used: number, total: number) =>
    t('systemStatus.server.usedOf', { used: formatBytes(used), total: formatBytes(total) });
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Tile
        title={t('systemStatus.server.cpu')}
        value={formatPercent(data.cpu.percent)}
        percent={data.cpu.percent}
        lines={[
          t('systemStatus.server.cpuSub', {
            threads: data.host.cpuThreads,
            load: data.cpu.load1.toFixed(2),
          }),
        ]}
      />
      <Tile
        title={t('systemStatus.server.memory')}
        value={formatPercent(data.memory.percent)}
        percent={data.memory.percent}
        lines={[ofTotal(data.memory.usedBytes, data.memory.totalBytes)]}
      />
      {data.disk ? (
        <Tile
          title={t('systemStatus.server.disk')}
          value={formatPercent(data.disk.percent)}
          percent={data.disk.percent}
          lines={[
            ofTotal(data.disk.usedBytes, data.disk.totalBytes),
            t('systemStatus.server.freeLeft', { free: formatBytes(data.disk.freeBytes) }),
          ]}
        />
      ) : null}
      <Tile
        title={t('systemStatus.server.uptime')}
        value={duration(data.host.uptimeSeconds)}
        lines={[data.host.system]}
      />
    </div>
  );
}

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ulaanbaatar',
  hour: '2-digit',
  minute: '2-digit',
});

function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6" className="shrink-0">
        <line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2.5" />
      </svg>
      {label}
    </span>
  );
}

/** Processor and memory percent over the last hour. */
function UsageChart({ history, label }: { history: readonly ServerSample[]; label: string }) {
  const { t } = useTranslation();
  const cpu = t('systemStatus.server.chart.cpu');
  const memory = t('systemStatus.server.chart.memory');
  const newest = history.at(-1);
  if (!newest) {
    return (
      <p role="status" className="py-8 text-center text-sm text-muted-foreground">
        {t('systemStatus.server.chart.empty')}
      </p>
    );
  }
  return (
    <figure aria-label={label} className="m-0">
      <div aria-hidden style={{ height: 260 }} className="w-full">
        <ResponsiveContainer
          width="100%"
          height={260}
          initialDimension={{ width: 640, height: 260 }}
        >
          <LineChart data={[...history]} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              minTickGap={48}
              tickFormatter={(value: number) => clock.format(value)}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(value: number) => `${value}%`}
            />
            <Tooltip
              cursor={{ stroke: GRID }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as ServerSample | undefined;
                return active && point ? (
                  <div className="rounded-lg bg-popover px-3 py-2 text-xs text-popover-foreground shadow-popover ring-1 ring-black/[0.06]">
                    <p className="mb-1 font-semibold">{formatUbDateTime(point.t)}</p>
                    {(
                      [
                        [cpu, point.cpu],
                        [memory, point.mem],
                      ] as const
                    ).map(([name, value]) => (
                      <p key={name} className="flex justify-between gap-4">
                        <span className="text-muted-foreground">{name}</span>
                        <span className="font-mono">{formatPercent(value)}</span>
                      </p>
                    ))}
                  </div>
                ) : null;
              }}
            />
            <Line
              type="monotone"
              dataKey="mem"
              name={memory}
              stroke={MEMORY_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="cpu"
              name={cpu}
              stroke={CPU_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div
        aria-hidden
        className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"
      >
        <LegendLine color={CPU_COLOR} label={cpu} />
        <LegendLine color={MEMORY_COLOR} label={memory} />
      </div>
      <p className="sr-only">
        {t('systemStatus.server.chart.summary', {
          cpu: formatPercent(newest.cpu),
          memory: formatPercent(newest.mem),
        })}
      </p>
    </figure>
  );
}

/** One small column per logical processor: which ones are busy. */
function Cores({ perCore }: { perCore: readonly number[] }) {
  const { t } = useTranslation();
  return (
    <ul className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 xl:grid-cols-12">
      {perCore.map((percent, index) => {
        const text = t('systemStatus.server.cores.core', {
          index: index + 1,
          percent: formatPercent(percent),
        });
        return (
          <li key={index} title={text} className="flex flex-col items-center gap-1">
            <span className="sr-only">{text}</span>
            <span
              aria-hidden
              className="flex h-12 w-full items-end overflow-hidden rounded-md bg-muted"
            >
              <span
                className={cn('w-full transition-[height]', LEVEL_BAR[levelOf(percent)])}
                style={{ height: `${Math.min(100, Math.max(2, percent))}%` }}
              />
            </span>
            <span aria-hidden className="font-mono text-[0.6875rem] text-muted-foreground">
              {Math.round(percent)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Rows({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="divide-y divide-border/80">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-2">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="text-right font-mono text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailCard(props: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border/80 py-3">
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">{props.children}</CardContent>
    </Card>
  );
}

/** The memory as one bar: what programs hold, what the cache holds, and what is free. */
function MemoryBar({ memory }: { memory: ServerMetrics['memory'] }) {
  const share = (bytes: number) => `${Math.max(0, (bytes / memory.totalBytes) * 100)}%`;
  // The cache counts as available, so it is drawn out of the available part.
  const cache = Math.min(memory.cachedBytes, memory.availableBytes);
  return (
    <div aria-hidden className="mx-4 my-3 flex h-2 overflow-hidden rounded-full bg-muted">
      <span className="bg-primary" style={{ width: share(memory.usedBytes) }} />
      <span className="bg-primary/30" style={{ width: share(cache) }} />
    </div>
  );
}

function Details({ data }: { data: ServerMetrics }) {
  const { t } = useTranslation();
  const duration = useDuration();
  const { memory, disk, database } = data;
  const storage: (readonly [string, ReactNode])[] = [];
  if (disk) {
    storage.push(
      [t('systemStatus.server.details.diskTotal'), formatBytes(disk.totalBytes)],
      [
        t('systemStatus.server.details.diskUsed'),
        `${formatBytes(disk.usedBytes)} (${formatPercent(disk.percent)})`,
      ],
      [t('systemStatus.server.details.diskFree'), formatBytes(disk.freeBytes)],
    );
  }
  if (database) {
    storage.push(
      [t('systemStatus.server.details.dbSize'), formatBytes(database.sizeBytes)],
      [
        t('systemStatus.server.details.dbConnections'),
        t('systemStatus.server.details.connectionsOf', {
          open: database.connections,
          max: database.maxConnections,
        }),
      ],
    );
  }
  const apiMemory =
    data.process.limitBytes === null
      ? formatBytes(data.process.rssBytes)
      : t('systemStatus.server.details.apiLimit', {
          used: formatBytes(data.process.rssBytes),
          limit: formatBytes(data.process.limitBytes),
        });
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-4">
      <DetailCard title={t('systemStatus.server.details.cpuTitle')}>
        <Rows
          rows={[
            [
              t('systemStatus.server.details.model'),
              <span className="font-sans">{data.host.cpuModel}</span>,
            ],
            [t('systemStatus.server.details.threads'), data.host.cpuThreads],
            [
              t('systemStatus.server.details.load'),
              [data.cpu.load1, data.cpu.load5, data.cpu.load15]
                .map((load) => load.toFixed(2))
                .join(' · '),
            ],
            [
              t('systemStatus.server.details.os'),
              <span className="font-sans">{`${data.host.system} (${data.host.arch})`}</span>,
            ],
            [t('systemStatus.server.details.hostUptime'), duration(data.host.uptimeSeconds)],
          ]}
        />
      </DetailCard>
      <DetailCard title={t('systemStatus.server.details.memoryTitle')}>
        <MemoryBar memory={memory} />
        <Rows
          rows={[
            [t('systemStatus.server.details.total'), formatBytes(memory.totalBytes)],
            [
              t('systemStatus.server.details.used'),
              `${formatBytes(memory.usedBytes)} (${formatPercent(memory.percent)})`,
            ],
            [t('systemStatus.server.details.cached'), formatBytes(memory.cachedBytes)],
            [t('systemStatus.server.details.available'), formatBytes(memory.availableBytes)],
            [
              t('systemStatus.server.details.swap'),
              memory.swapTotalBytes > 0
                ? t('systemStatus.server.usedOf', {
                    used: formatBytes(memory.swapUsedBytes),
                    total: formatBytes(memory.swapTotalBytes),
                  })
                : t('systemStatus.server.details.swapNone'),
            ],
          ]}
        />
      </DetailCard>
      <DetailCard title={t('systemStatus.server.details.storageTitle')}>
        <Rows rows={storage} />
      </DetailCard>
      <DetailCard title={t('systemStatus.server.details.apiTitle')}>
        <Rows
          rows={[
            [t('systemStatus.server.details.apiCpu'), formatPercent(data.process.cpuPercent)],
            [t('systemStatus.server.details.apiMemory'), apiMemory],
            [t('systemStatus.server.details.apiUptime'), duration(data.process.uptimeSeconds)],
            [t('systemStatus.server.details.node'), data.process.nodeVersion],
          ]}
        />
      </DetailCard>
    </div>
  );
}

/** The whole panel: tiles, the hour's graph, the processors one by one, and the details. */
export function ServerPanel(props: {
  data: ServerMetrics | undefined;
  isPending: boolean;
  isError: boolean;
}) {
  const { t } = useTranslation();
  const { data } = props;
  if (!data) {
    return (
      <Card className="py-0">
        <CardContent className="px-4 py-3">
          {props.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t('systemStatus.server.unavailable')}
            </p>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {t('systemStatus.server.loading')}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }
  const chartTitle = t('systemStatus.server.chart.title');
  return (
    <section aria-label={t('systemStatus.server.title')} className="space-y-4">
      <Tiles data={data} />
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Card className="gap-2 xl:col-span-2">
          <CardHeader>
            <CardTitle>{chartTitle}</CardTitle>
            <p className="text-[0.75rem] text-muted-foreground">
              {t('systemStatus.server.chart.hint', { seconds: data.intervalSeconds })}
            </p>
          </CardHeader>
          <CardContent>
            <UsageChart history={data.history} label={chartTitle} />
          </CardContent>
        </Card>
        <Card className="gap-2">
          <CardHeader>
            <CardTitle>{t('systemStatus.server.cores.title')}</CardTitle>
            <p className="text-[0.75rem] text-muted-foreground">
              {t('systemStatus.server.cores.hint')}
            </p>
          </CardHeader>
          <CardContent>
            <Cores perCore={data.cpu.perCore} />
          </CardContent>
        </Card>
      </div>
      <Details data={data} />
    </section>
  );
}
