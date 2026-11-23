import { useTranslation } from 'react-i18next';
import type { ChartColors } from '@/components/chart/chart-colors';
import { EChart } from '@/components/chart/echart';
import { formatTugrik } from '@/lib/money';
import { escapeHtml, plottedNumber as plotted, useShortAmount } from './chart-format';
import { marginText } from './report-helpers';

/*
 * The charts of «Ашгийн самбар» (ADR-0237), drawn with ECharts through `components/chart` (ADR-0146
 * #7) in the design tokens' colours only. Each keeps its figures in the page as a table for screen
 * readers; the page's own tables carry every figure a finger cannot hover for.
 */

/** A chart's figures for those who cannot see the canvas (and for the tests). */
function FigureTable(props: { head: readonly string[]; rows: readonly (readonly string[])[] }) {
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

const AXIS = (colors: ChartColors) => ({
  axisLine: { lineStyle: { color: colors.grid } },
  axisTick: { show: false },
  axisLabel: { color: colors.muted, fontSize: 11 },
  splitLine: { lineStyle: { color: colors.grid, type: 'dashed' as const } },
});

export interface TrendBar {
  key: string;
  label: string;
  sales: string;
  profit: string;
  margin: string | null;
  /** Net profit (ADR-0238); null under a source filter. */
  netProfit: string | null;
}

/**
 * Net sales and gross profit as bars, the net profit as a line on their axis (when the books are
 * read), the margin as a line on its own axis.
 */
export function BoardTrendChart(props: { points: readonly TrendBar[]; label: string }) {
  const { t } = useTranslation();
  const short = useShortAmount();
  const sales = t('reports.board.columns.sales');
  const profit = t('reports.board.columns.profit');
  const margin = t('reports.board.columns.margin');
  const net = t('reports.board.columns.netProfit');
  const { points } = props;
  const withNet = points.some((point) => point.netProfit !== null);
  return (
    <EChart
      label={props.label}
      height={300}
      option={(colors) => ({
        grid: { left: 4, right: 4, top: 36, bottom: 4, containLabel: true },
        legend: {
          top: 0,
          left: 0,
          itemWidth: 12,
          itemHeight: 8,
          textStyle: { color: colors.muted, fontSize: 12 },
          data: withNet ? [sales, profit, net, margin] : [sales, profit, margin],
        },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: (items: { dataIndex: number }[]) => {
            const point = points[items[0]?.dataIndex ?? -1];
            if (!point) return '';
            return [
              `<b>${escapeHtml(point.label.replace('\n', ' '))}</b>`,
              `${escapeHtml(sales)}: <b>${escapeHtml(formatTugrik(point.sales))}</b>`,
              `${escapeHtml(profit)}: <b>${escapeHtml(formatTugrik(point.profit))}</b>`,
              ...(point.netProfit === null
                ? []
                : [`${escapeHtml(net)}: <b>${escapeHtml(formatTugrik(point.netProfit))}</b>`]),
              `${escapeHtml(margin)}: <b>${escapeHtml(marginText(point.margin))}</b>`,
            ].join('<br/>');
          },
        },
        xAxis: {
          type: 'category',
          data: points.map((point) => point.label),
          ...AXIS(colors),
          splitLine: { show: false },
        },
        yAxis: [
          {
            type: 'value',
            ...AXIS(colors),
            axisLine: { show: false },
            axisLabel: { color: colors.muted, fontSize: 11, formatter: short },
          },
          {
            type: 'value',
            ...AXIS(colors),
            axisLine: { show: false },
            splitLine: { show: false },
            axisLabel: { color: colors.muted, fontSize: 11, formatter: '{value}%' },
          },
        ],
        series: [
          {
            name: sales,
            type: 'bar',
            barMaxWidth: 22,
            barGap: '15%',
            itemStyle: { color: colors.series[0], borderRadius: [4, 4, 0, 0] },
            animationDelay: (index: number) => index * 40,
            data: points.map((point) => plotted(point.sales)),
          },
          {
            name: profit,
            type: 'bar',
            barMaxWidth: 22,
            itemStyle: { color: colors.series[1], borderRadius: [4, 4, 0, 0] },
            animationDelay: (index: number) => index * 40 + 20,
            data: points.map((point) => plotted(point.profit)),
          },
          ...(withNet
            ? [
                {
                  name: net,
                  type: 'line',
                  smooth: true,
                  symbol: 'circle',
                  symbolSize: 7,
                  lineStyle: { width: 2.5, color: colors.series[3] },
                  itemStyle: { color: colors.series[3] },
                  data: points.map((point) =>
                    point.netProfit === null ? null : plotted(point.netProfit),
                  ),
                },
              ]
            : []),
          {
            name: margin,
            type: 'line',
            yAxisIndex: 1,
            smooth: true,
            symbol: 'circle',
            symbolSize: 7,
            lineStyle: { width: 2.5, color: colors.series[2] },
            itemStyle: { color: colors.series[2] },
            data: points.map((point) => (point.margin === null ? null : plotted(point.margin))),
          },
        ],
      })}
    >
      <FigureTable
        head={
          withNet
            ? [t('reports.board.period'), sales, profit, net, margin]
            : [t('reports.board.period'), sales, profit, margin]
        }
        rows={points.map((point) => [
          point.label.replace('\n', ' '),
          formatTugrik(point.sales),
          formatTugrik(point.profit),
          ...(withNet ? [point.netProfit === null ? '' : formatTugrik(point.netProfit)] : []),
          marginText(point.margin),
        ])}
      />
    </EChart>
  );
}

/**
 * One step of the profit's structure: a `total` stands from zero, a `change` floats from where the
 * last step ended.
 */
export interface WaterfallStep {
  key: string;
  label: string;
  kind: 'total' | 'change';
  value: string;
}

/**
 * «Ашгийн бүтэц»: net sales → − cost → gross profit → + discounts → + other income → − operating
 * expenses → operating profit → − tax → net profit (ADR-0238), as the page lists the steps.
 */
export function WaterfallChart(props: { steps: readonly WaterfallStep[]; label: string }) {
  const { t } = useTranslation();
  const short = useShortAmount();
  let level = 0;
  const bars = props.steps.map((step) => {
    const value = plotted(step.value);
    const start = step.kind === 'total' ? 0 : level;
    const end = step.kind === 'total' ? value : level + value;
    level = end;
    return { step, value, low: Math.min(start, end), high: Math.max(start, end) };
  });
  const last = props.steps.length - 1;
  return (
    <EChart
      label={props.label}
      height={300}
      option={(colors) => {
        const colorOf = (index: number, value: number, kind: WaterfallStep['kind']) => {
          if (kind === 'change') return value < 0 ? colors.bad : colors.good;
          return index === last ? colors.primary : colors.series[0];
        };
        return {
          grid: { left: 4, right: 4, top: 28, bottom: 4, containLabel: true },
          tooltip: {
            trigger: 'item',
            formatter: (point: { dataIndex: number }) => {
              const bar = bars[point.dataIndex];
              if (!bar) return '';
              return `${escapeHtml(bar.step.label)}: <b>${escapeHtml(formatTugrik(bar.step.value))}</b>`;
            },
          },
          xAxis: {
            type: 'category',
            data: bars.map((bar) => bar.step.label),
            ...AXIS(colors),
            splitLine: { show: false },
            axisLabel: {
              color: colors.muted,
              interval: 0,
              fontSize: 10.5,
              lineHeight: 13,
              // ECharts breaks Cyrillic between any two letters: a line per word instead.
              formatter: (value: string) => value.split(' ').join('\n'),
            },
          },
          yAxis: {
            type: 'value',
            ...AXIS(colors),
            axisLine: { show: false },
            axisLabel: { color: colors.muted, fontSize: 11, formatter: short },
          },
          series: [
            {
              type: 'bar',
              stack: 'waterfall',
              silent: true,
              itemStyle: { color: 'transparent' },
              emphasis: { disabled: true },
              data: bars.map((bar) => bar.low),
            },
            {
              type: 'bar',
              stack: 'waterfall',
              barMaxWidth: 56,
              animationDelay: (index: number) => index * 120,
              label: {
                show: true,
                position: 'top',
                color: colors.foreground,
                fontSize: 11,
                formatter: (point: { dataIndex: number }) => {
                  const bar = bars[point.dataIndex];
                  if (!bar) return '';
                  const text = short(Math.abs(bar.value));
                  return bar.step.kind === 'change' ? `${bar.value < 0 ? '−' : '+'}${text}` : text;
                },
              },
              data: bars.map((bar, index) => ({
                value: bar.high - bar.low,
                itemStyle: {
                  color: colorOf(index, bar.value, bar.step.kind),
                  borderRadius: [4, 4, 4, 4],
                },
              })),
            },
          ],
        };
      }}
    >
      <FigureTable
        head={[t('reports.board.columns.name'), t('reports.board.columns.sales')]}
        rows={props.steps.map((step) => [step.label, formatTugrik(step.value)])}
      />
    </EChart>
  );
}

export interface RankBar {
  key: string;
  label: string;
  profit: string;
  share: string | null;
}

/** The top rows by gross profit as horizontal bars, a loss in the destructive colour. */
export function RankBars(props: { rows: readonly RankBar[]; label: string }) {
  const { t } = useTranslation();
  const short = useShortAmount();
  const { rows } = props;
  const tip = (row: RankBar) =>
    row.share === null ? formatTugrik(row.profit) : `${formatTugrik(row.profit)} · ${row.share}%`;
  return (
    <EChart
      label={props.label}
      height={Math.max(120, rows.length * 32 + 12)}
      option={(colors) => ({
        grid: { left: 2, right: 64, top: 4, bottom: 4, containLabel: true },
        xAxis: { type: 'value', show: false },
        yAxis: {
          type: 'category',
          inverse: true,
          data: rows.map((row) => row.label),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: colors.foreground, fontSize: 12, width: 140, overflow: 'truncate' },
        },
        tooltip: {
          trigger: 'item',
          formatter: (point: { dataIndex: number }) => {
            const row = rows[point.dataIndex];
            return row ? `${escapeHtml(row.label)}: <b>${escapeHtml(tip(row))}</b>` : '';
          },
        },
        series: [
          {
            type: 'bar',
            barMaxWidth: 16,
            animationDelay: (index: number) => index * 40,
            label: {
              show: true,
              position: 'right',
              color: colors.foreground,
              fontSize: 11,
              formatter: (point: { dataIndex: number }) => {
                const row = rows[point.dataIndex];
                return row ? short(plotted(row.profit)) : '';
              },
            },
            data: rows.map((row) => {
              const value = plotted(row.profit);
              return {
                value,
                itemStyle: {
                  color: value < 0 ? colors.bad : colors.series[1],
                  borderRadius: value < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0],
                },
              };
            }),
          },
        ],
      })}
    >
      <FigureTable
        head={[t('reports.board.columns.name'), t('reports.board.columns.profit')]}
        rows={rows.map((row) => [row.label, tip(row)])}
      />
    </EChart>
  );
}

export interface ShareSlice {
  key: string;
  label: string;
  amount: string;
  share: string | null;
}

/** The operating expenses' top-level groups as a ring, each with its share (ADR-0238). */
export function ExpenseShareChart(props: { slices: readonly ShareSlice[]; label: string }) {
  const { t } = useTranslation();
  const { slices } = props;
  const tip = (slice: ShareSlice) =>
    slice.share === null
      ? formatTugrik(slice.amount)
      : `${formatTugrik(slice.amount)} · ${slice.share}%`;
  return (
    <EChart
      label={props.label}
      height={260}
      option={(colors) => ({
        tooltip: {
          trigger: 'item',
          formatter: (point: { dataIndex: number }) => {
            const slice = slices[point.dataIndex];
            return slice ? `${escapeHtml(slice.label)}: <b>${escapeHtml(tip(slice))}</b>` : '';
          },
        },
        legend: {
          bottom: 0,
          left: 'center',
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { color: colors.muted, fontSize: 11 },
          formatter: (name: string) => (name.length > 22 ? `${name.slice(0, 21)}…` : name),
        },
        series: [
          {
            type: 'pie',
            radius: ['48%', '72%'],
            center: ['50%', '42%'],
            avoidLabelOverlap: true,
            itemStyle: { borderColor: colors.surface, borderWidth: 2, borderRadius: 4 },
            label: {
              show: true,
              color: colors.foreground,
              fontSize: 11,
              formatter: (point: { dataIndex: number }) => {
                const slice = slices[point.dataIndex];
                return slice?.share ? `${slice.share}%` : '';
              },
            },
            data: slices.map((slice, index) => ({
              name: slice.label,
              value: Math.max(0, plotted(slice.amount)),
              itemStyle: { color: colors.series[index % colors.series.length] },
            })),
          },
        ],
      })}
    >
      <FigureTable
        head={[
          t('reports.board.expenses.columns.name'),
          t('reports.board.expenses.columns.amount'),
        ]}
        rows={slices.map((slice) => [slice.label, tip(slice)])}
      />
    </EChart>
  );
}
