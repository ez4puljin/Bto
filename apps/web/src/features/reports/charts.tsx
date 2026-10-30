import { Decimal } from '@tugeel/shared/money';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatTugrik } from '@/lib/money';

/*
 * The report charts (ADR-0108), drawn by Recharts with the page's colour tokens only (`var(--…)`),
 * so they follow the theme. Each chart also lists its values for screen readers.
 */

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 };
const GRID = 'var(--border)';

/** A chart number from a NUMERIC string: geometry only, never arithmetic. */
const plotted = (value: string | null): number =>
  value === null ? 0 : new Decimal(value).toNumber();

/** Axis ticks in thousands, millions or billions («12 мян», «1.5 сая»). */
function useShortAmount(): (value: number) => string {
  const { t } = useTranslation();
  return (value) => {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000)
      return t('reports.common.billions', { value: (value / 1_000_000_000).toFixed(1) });
    if (abs >= 1_000_000)
      return t('reports.common.millions', { value: (value / 1_000_000).toFixed(1) });
    if (abs >= 1_000) return t('reports.common.thousands', { value: Math.round(value / 1_000) });
    return String(Math.round(value));
  };
}

/** The chart's frame: a fixed height, the full width, a start size for the first paint. */
function Frame(props: {
  height: number;
  label: string;
  children: ReactNode;
  list: ReactNode;
  legend?: ReactNode;
}) {
  return (
    <figure aria-label={props.label} className="m-0">
      <div aria-hidden style={{ height: props.height }} className="w-full">
        <ResponsiveContainer
          width="100%"
          height={props.height}
          initialDimension={{ width: 640, height: props.height }}
        >
          {props.children}
        </ResponsiveContainer>
      </div>
      {props.legend}
      {props.list}
    </figure>
  );
}

function TooltipBox(props: { title: string; rows: readonly (readonly [string, string])[] }) {
  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-xs text-popover-foreground shadow-popover ring-1 ring-black/[0.06]">
      <p className="mb-1 font-semibold">{props.title}</p>
      {props.rows.map(([label, value]) => (
        <p key={label} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono">{value}</span>
        </p>
      ))}
    </div>
  );
}

export interface TrendPoint {
  month: string;
  sales: string;
  lastYearSales: string;
}

/** Twelve months of sales against the same months a year earlier. */
export function TrendChart(props: { points: readonly TrendPoint[]; label: string }) {
  const { t } = useTranslation();
  const shortAmount = useShortAmount();
  const current = t('reports.dashboard.trend.current');
  const lastYear = t('reports.dashboard.trend.lastYear');
  const data = props.points.map((point) => ({
    month: point.month,
    sales: plotted(point.sales),
    lastYearSales: plotted(point.lastYearSales),
    point,
  }));
  return (
    <Frame
      height={260}
      label={props.label}
      legend={
        // The two lines named on the chart itself, not only in the tooltip (ADR-0113); the
        // screen-reader list below already names them.
        <div
          aria-hidden
          className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"
        >
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" className="shrink-0">
              <line x1="0" y1="3" x2="18" y2="3" stroke="var(--chart-1)" strokeWidth="2.5" />
            </svg>
            {current}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" className="shrink-0">
              <line
                x1="0"
                y1="3"
                x2="18"
                y2="3"
                stroke="var(--muted-foreground)"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
            </svg>
            {lastYear}
          </span>
        </div>
      }
      list={
        <ul className="sr-only">
          {props.points.map((point) => (
            <li key={point.month}>
              {`${point.month}: ${current} ${formatTugrik(point.sales)}, ${lastYear} ${formatTugrik(point.lastYearSales)}`}
            </li>
          ))}
        </ul>
      }
    >
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="month"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          tickFormatter={(value: string) => value.slice(2)}
        />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={shortAmount}
        />
        <Tooltip
          cursor={{ stroke: GRID }}
          content={({ active, payload }) => {
            const point = (payload?.[0]?.payload as { point?: TrendPoint } | undefined)?.point;
            return active && point ? (
              <TooltipBox
                title={point.month}
                rows={[
                  [current, formatTugrik(point.sales)],
                  [lastYear, formatTugrik(point.lastYearSales)],
                ]}
              />
            ) : null;
          }}
        />
        <Line
          type="monotone"
          dataKey="lastYearSales"
          name={lastYear}
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="sales"
          name={current}
          stroke="var(--chart-1)"
          strokeWidth={2.5}
          dot={{ r: 2.5, fill: 'var(--chart-1)' }}
          isAnimationActive={false}
        />
      </LineChart>
    </Frame>
  );
}

export interface BarItem {
  key: string;
  label: string;
  value: string;
  /** More lines for the tooltip and the screen-reader list («Ашгийн хувь 12.5%»). */
  extra?: string;
}

/** Horizontal bars, largest first (top categories, top suppliers); a bar opens its report. */
export function HorizontalBars(props: {
  items: readonly BarItem[];
  label: string;
  valueLabel: string;
  onSelect?: (item: BarItem) => void;
  /** Screen readers get the bars as links when they open something. */
  renderLink?: (item: BarItem, text: string) => ReactNode;
}) {
  const shortAmount = useShortAmount();
  const data = props.items.map((item) => ({ ...item, amount: plotted(item.value) }));
  const height = Math.max(120, props.items.length * 34 + 16);
  return (
    <Frame
      height={height}
      label={props.label}
      list={
        <ul className="sr-only has-[a:focus-visible]:not-sr-only has-[a:focus-visible]:mt-2 has-[a:focus-visible]:flex has-[a:focus-visible]:flex-col has-[a:focus-visible]:gap-1 has-[a:focus-visible]:text-[0.8125rem]">
          {props.items.map((item) => {
            const text = [item.label, formatTugrik(item.value), item.extra]
              .filter(Boolean)
              .join(', ');
            return <li key={item.key}>{props.renderLink ? props.renderLink(item, text) : text}</li>;
          })}
        </ul>
      }
    >
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
        barCategoryGap={6}
      >
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis
          type="number"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={shortAmount}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={140}
          tickFormatter={(value: string) => (value.length > 20 ? `${value.slice(0, 19)}…` : value)}
        />
        <Tooltip
          cursor={{ fill: 'var(--accent)' }}
          content={({ active, payload }) => {
            const item = payload?.[0]?.payload as BarItem | undefined;
            return active && item ? (
              <TooltipBox
                title={item.label}
                rows={[
                  [props.valueLabel, formatTugrik(item.value)],
                  ...(item.extra ? ([['', item.extra]] as const) : []),
                ]}
              />
            ) : null;
          }}
        />
        <Bar
          dataKey="amount"
          name={props.valueLabel}
          fill="var(--chart-1)"
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
          cursor={props.onSelect ? 'pointer' : undefined}
          onClick={(entry: unknown) => {
            const item = (entry as { payload?: BarItem } | undefined)?.payload;
            if (item && props.onSelect) props.onSelect(item);
          }}
        />
      </BarChart>
    </Frame>
  );
}
