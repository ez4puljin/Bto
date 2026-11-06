import { Decimal } from '@tugeel/shared/money';
import { ArrowDown, ArrowUp, Info, type LucideIcon, Minus } from 'lucide-react';
import { type CSSProperties, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type ChartColors, chartColors } from '@/components/chart/chart-colors';
import { EChart } from '@/components/chart/echart';
import { EmptyState } from '@/components/list';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCount } from '@/lib/money';
import { cn } from '@/lib/utils';
import { Avatar } from '../hr-kit';
import { useCountUp } from './insights-hooks';
import { escapeHtml, shareOf, UNKNOWN } from './insights-format';

/*
 * What the dashboard's three tabs share: the card with its finding, the tile whose number counts
 * up, the horizontal bars, the ring, the people's rows. Colours come from `ChartColors`; the ink of
 * every label stays in the text tokens, the mark beside it carries the identity.
 */

/* ------------------------------------------------------------- the figures */

/** A chart's figures for those who cannot see the canvas (and for the tests). */
export function FigureTable(props: {
  head: readonly string[];
  rows: readonly (readonly (string | number)[])[];
}) {
  return (
    <table>
      <thead>
        <tr>
          {props.head.map((cell) => (
            <th key={cell} scope="col">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row, index) => (
          <tr key={`${index}-${row[0]}`}>
            {row.map((cell, column) => (
              <td key={column}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------------------------------------------------------- the card */

/**
 * One card of the dashboard, a region named by its title; it ends with a line worked out from the
 * figures and, where people are counted, «Нийт: N ажилтан».
 */
export function InsightCard(props: {
  title: string;
  finding?: string | null;
  total?: number;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const hasFoot = Boolean(props.finding) || props.total !== undefined;
  return (
    <Card role="region" aria-label={props.title} className={cn('min-w-0', props.className)}>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        {props.action ? <CardAction>{props.action}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col justify-center">
        {props.children}
      </CardContent>
      {hasFoot ? (
        <CardContent className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[0.8125rem]">
          {props.finding ? <p className="min-w-0 text-foreground">{props.finding}</p> : <span />}
          {props.total !== undefined ? (
            <p className="shrink-0 text-muted-foreground tabular-nums">
              {t('hr.insights.totalPeople', { total: formatCount(props.total) })}
            </p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

export function InsightEmpty({ title }: { title: string }) {
  return <EmptyState title={title} />;
}

/** A note across the page: what the figures rest on. */
export function InsightNote(props: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-xl bg-info-soft px-4 py-2.5 text-[0.8125rem] text-foreground',
        props.className,
      )}
    >
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-link" />
      <span className="min-w-0">{props.children}</span>
    </p>
  );
}

export function InsightsSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('hr.insights.loading')} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((slot) => (
          <div key={slot} className="h-24 animate-pulse rounded-xl bg-fill" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((slot) => (
          <div key={slot} className="h-72 animate-pulse rounded-xl bg-fill" />
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the tiles */

function grouped(value: number, decimals: number): string {
  const [whole = '0', rest] = value.toFixed(decimals).split('.');
  return rest === undefined ? formatCount(Number(whole)) : `${formatCount(Number(whole))}.${rest}`;
}

/** The change against the period before: an arrow and words, never colour alone. */
export function Delta(props: {
  now: string | number | null;
  before: string | number | null;
  decimals?: number;
  /** Says which figure this is when a tile holds two. */
  prefix?: string;
}) {
  const { t } = useTranslation();
  const decimals = props.decimals ?? 0;
  let Icon: LucideIcon = Minus;
  let text = t('hr.insights.delta.none');
  if (props.now !== null && props.before !== null) {
    const change = new Decimal(props.now).minus(props.before);
    const value = change.abs().toFixed(decimals);
    if (change.isZero()) text = t('hr.insights.delta.same');
    else if (change.isPositive()) {
      Icon = ArrowUp;
      text = t('hr.insights.delta.up', { value });
    } else {
      Icon = ArrowDown;
      text = t('hr.insights.delta.down', { value });
    }
  }
  const words = props.prefix ? `${props.prefix}: ${text}` : text;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-[0.75rem] text-muted-foreground">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate" title={words}>
        {words}
      </span>
    </span>
  );
}

const TONE = {
  primary: 'bg-info-soft text-link',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  destructive: 'bg-danger-soft text-destructive',
  muted: 'bg-fill text-muted-foreground',
} as const;

function CountingFigure(props: { value: number; decimals: number; unit?: string }) {
  const shown = useCountUp(props.value);
  return (
    <span aria-hidden>
      {grouped(shown, props.decimals)}
      {props.unit ? ` ${props.unit}` : ''}
    </span>
  );
}

/**
 * One figure: `value` counts up (screen readers get the final figure only), `text` stands as it is
 * (a clock time, a name). Under it the label and an optional line or change.
 */
export function StatTile(props: {
  title: string;
  icon: LucideIcon;
  tone?: keyof typeof TONE;
  value?: number | null;
  /** A second figure counted beside the first: «3 / 1». */
  secondValue?: number;
  decimals?: number;
  unit?: string;
  text?: string;
  line?: ReactNode;
}) {
  const { t } = useTranslation();
  const Icon = props.icon;
  const decimals = props.decimals ?? 0;
  const number = props.value ?? null;
  return (
    <section
      aria-label={props.title}
      className="flex min-w-0 items-center gap-3 rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06]"
    >
      <span
        aria-hidden
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-full',
          TONE[props.tone ?? 'primary'],
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        {props.text !== undefined ? (
          <p
            className="truncate font-mono text-[1.375rem] leading-tight font-semibold"
            title={props.text}
          >
            {props.text}
          </p>
        ) : number === null ? (
          <p className="font-mono text-[1.5rem] leading-tight font-semibold">{t('common.none')}</p>
        ) : (
          <p className="font-mono text-[1.5rem] leading-tight font-semibold">
            <CountingFigure value={number} decimals={decimals} unit={props.unit} />
            {props.secondValue === undefined ? null : (
              <>
                <span aria-hidden className="text-muted-foreground">
                  {' / '}
                </span>
                <CountingFigure value={props.secondValue} decimals={decimals} />
              </>
            )}
            <span className="sr-only">
              {grouped(number, decimals)}
              {props.unit ? ` ${props.unit}` : ''}
              {props.secondValue === undefined ? '' : ` / ${grouped(props.secondValue, decimals)}`}
            </span>
          </p>
        )}
        <h2 className="truncate text-[0.8125rem] font-medium text-muted-foreground">
          {props.title}
        </h2>
        {props.line ? <div className="flex min-w-0">{props.line}</div> : null}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- the bars */

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** The mark's own colour (a request type's); else the first series, grey for «unknown». */
  color?: string;
  /** The figure at the bar's tip; else «count · percent». */
  text?: string;
  /** More for the tooltip. */
  note?: string;
}

const ROW_HEIGHT = 30;

/** Horizontal bars with their figures at the tips, one series, the longest setting the scale. */
export function HorizontalBars(props: {
  label: string;
  rows: readonly BarRow[];
  /** The share is of this; the sum of the rows without it. */
  whole?: number;
  /** The scale's end when the figures have one (percent). */
  max?: number;
  head: readonly string[];
  emptyText: string;
}) {
  const whole = props.whole ?? props.rows.reduce((sum, row) => sum + row.value, 0);
  // A scale with its own end (percent) still reads at zero; counts of nothing are an empty state.
  const nothing =
    props.rows.length === 0 ||
    (props.max === undefined && props.rows.every((row) => row.value === 0));
  if (nothing) return <InsightEmpty title={props.emptyText} />;
  const tip = (row: BarRow) =>
    row.text ?? `${formatCount(row.value)} · ${shareOf(row.value, whole)}%`;
  return (
    <EChart
      label={props.label}
      height={Math.max(96, props.rows.length * ROW_HEIGHT + 8)}
      option={(colors) => ({
        grid: { left: 2, right: 76, top: 4, bottom: 4, containLabel: true },
        xAxis: {
          type: 'value',
          show: false,
          min: 0,
          ...(props.max === undefined ? {} : { max: props.max }),
        },
        yAxis: {
          type: 'category',
          inverse: true,
          data: props.rows.map((row) => row.label),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: colors.foreground, fontSize: 12, width: 132, overflow: 'truncate' },
        },
        tooltip: {
          trigger: 'item',
          formatter: (point: { dataIndex: number }) => {
            const row = props.rows[point.dataIndex];
            if (!row) return '';
            const note = row.note ? `<br/>${escapeHtml(row.note)}` : '';
            return `${escapeHtml(row.label)}: <b>${escapeHtml(tip(row))}</b>${note}`;
          },
        },
        series: [
          {
            type: 'bar',
            barMaxWidth: 14,
            itemStyle: { borderRadius: [0, 4, 4, 0] },
            showBackground: false,
            animationDelay: (index: number) => index * 40,
            label: {
              show: true,
              position: 'right',
              color: colors.foreground,
              fontSize: 12,
              formatter: (point: { dataIndex: number }) => {
                const row = props.rows[point.dataIndex];
                return row ? tip(row) : '';
              },
            },
            data: props.rows.map((row) => ({
              value: row.value,
              itemStyle: {
                color: row.color ?? (row.key === UNKNOWN ? colors.unknown : colors.series[0]),
              },
            })),
          },
        ],
      })}
    >
      <FigureTable
        head={props.head}
        rows={props.rows.map((row) =>
          props.max === undefined
            ? [row.label, row.value, `${shareOf(row.value, whole)}%`]
            : [row.label, row.text ?? row.value],
        )}
      />
    </EChart>
  );
}

/* ---------------------------------------------------------------- the ring */

export interface RingRow {
  key: string;
  label: string;
  value: number;
  color: (colors: ChartColors) => string;
}

/** A dot beside a label: the mark carries the colour, the text keeps its ink. */
export function SwatchLine(props: {
  color: string;
  label: string;
  figure?: string;
  className?: string;
}) {
  return (
    <li className={cn('flex items-center gap-2 text-[0.8125rem]', props.className)}>
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: props.color } satisfies CSSProperties}
      />
      <span className="min-w-0 flex-1 truncate" title={props.label}>
        {props.label}
      </span>
      {props.figure ? (
        <span className="shrink-0 text-muted-foreground tabular-nums">{props.figure}</span>
      ) : null}
    </li>
  );
}

/** A ring with its total in the centre and its list beside it, the zero rows left out. */
export function RingChart(props: {
  label: string;
  rows: readonly RingRow[];
  head: readonly string[];
  centerValue: string;
  centerLabel: string;
  emptyText: string;
}) {
  const colors = useMemo(chartColors, []);
  const rows = props.rows.filter((row) => row.value > 0);
  const whole = rows.reduce((sum, row) => sum + row.value, 0);
  const tip = (row: RingRow) => `${formatCount(row.value)} · ${shareOf(row.value, whole)}%`;
  if (rows.length === 0) return <InsightEmpty title={props.emptyText} />;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
      <div className="relative mx-auto w-full max-w-44 sm:max-w-none">
        <EChart
          label={props.label}
          height={176}
          option={(palette) => ({
            tooltip: {
              trigger: 'item',
              formatter: (point: { dataIndex: number }) => {
                const row = rows[point.dataIndex];
                return row ? `${escapeHtml(row.label)}: <b>${escapeHtml(tip(row))}</b>` : '';
              },
            },
            series: [
              {
                type: 'pie',
                radius: ['62%', '82%'],
                center: ['50%', '50%'],
                startAngle: 90,
                avoidLabelOverlap: false,
                label: { show: false },
                labelLine: { show: false },
                itemStyle: { borderColor: palette.surface, borderWidth: 2, borderRadius: 4 },
                emphasis: { scale: true, scaleSize: 4 },
                animationType: 'expansion',
                data: rows.map((row) => ({
                  name: row.label,
                  value: row.value,
                  itemStyle: { color: row.color(palette) },
                })),
              },
            ],
          })}
        >
          <FigureTable
            head={props.head}
            rows={rows.map((row) => [row.label, row.value, `${shareOf(row.value, whole)}%`])}
          />
        </EChart>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex h-44 flex-col items-center justify-center text-center"
        >
          <span className="font-mono text-[1.375rem] leading-tight font-semibold">
            {props.centerValue}
          </span>
          <span className="text-[0.75rem] text-muted-foreground">{props.centerLabel}</span>
        </div>
      </div>
      <ul className="min-w-0 space-y-1.5">
        {rows.map((row) => (
          <SwatchLine key={row.key} color={row.color(colors)} label={row.label} figure={tip(row)} />
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- the people */

/** A thin bar for a person's figure; it grows on arrival and moves when the figure changes. */
export function ProgressBar(props: { percent: number; label: string }) {
  const width = Math.max(0, Math.min(100, props.percent));
  return (
    <span
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      className="block h-1.5 w-full overflow-hidden rounded-full bg-fill"
    >
      <span
        className="block h-full w-(--bar) rounded-full bg-primary transition-[width] duration-700 ease-apple starting:w-0"
        style={{ '--bar': `${width}%` } as CSSProperties}
      />
    </span>
  );
}

/** One person in a dashboard list: the photo, the name, a line under it and the figure. */
export function PersonRow(props: {
  name: string;
  photoUrl: string | null;
  line?: ReactNode;
  figure?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 py-1.5">
      <Avatar name={props.name} src={props.photoUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={props.name}>
          {props.name}
        </p>
        {props.line ? (
          <div className="truncate text-[0.75rem] text-muted-foreground">{props.line}</div>
        ) : null}
      </div>
      {props.figure ? (
        <div className="shrink-0 text-right text-[0.8125rem] tabular-nums">{props.figure}</div>
      ) : null}
    </li>
  );
}
