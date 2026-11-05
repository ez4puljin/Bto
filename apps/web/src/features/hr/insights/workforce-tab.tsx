import { EDUCATION_LEVELS, LEFT_REASON_KINDS, MARITAL_STATUSES } from '@tugeel/shared/hr';
import { businessDate } from '@tugeel/shared/time';
import { ArrowLeftRight, CalendarClock, Users, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { type ChartColors, chartColors } from '@/components/chart/chart-colors';
import { EChart } from '@/components/chart/echart';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import {
  type HrCalendarItem,
  type HrCount,
  type HrGenderCount,
  type HrMatrixRow,
  type HrMovementMonth,
  type HrWorkforceInsights,
  useInsightsCalendar,
  useWorkforceInsights,
} from './api';
import { escapeHtml, shareOf, sumOf, topKnown, UNKNOWN } from './insights-format';
import {
  type BarRow,
  Delta,
  FigureTable,
  HorizontalBars,
  InsightCard,
  InsightEmpty,
  InsightsSkeleton,
  PersonRow,
  RingChart,
  type RingRow,
  StatTile,
  SwatchLine,
} from './insights-kit';
import { useInsightLabels } from './insights-hooks';

/** The districts past this many fold into «Бусад»: a ninth hue is never needed, nor a long list. */
const DISTRICT_ROWS = 9;

/* ------------------------------------------------------------- the matrix */

/** Divisions × levels: one blue from light to dark, the count in each cell, the total last. */
function DivisionMatrix({ matrix }: { matrix: readonly HrMatrixRow[] }) {
  const { t } = useTranslation();
  const labels = useInsightLabels();
  const levelKeys = (matrix[0]?.levels ?? [])
    .map((level) => level.key)
    .filter(
      (key) =>
        key !== UNKNOWN ||
        matrix.some((row) => row.levels.some((level) => level.key === key && level.count > 0)),
    );
  const columns = levelKeys.map((key) => labels.label('levels', key));
  const totalColumn = t('hr.insights.fields.total');
  const rows = matrix.map((row) => labels.name(row.division));
  const countAt = (row: HrMatrixRow, key: string) =>
    row.levels.find((level) => level.key === key)?.count ?? 0;
  const largest = Math.max(
    1,
    ...matrix.flatMap((row) => levelKeys.map((key) => countAt(row, key))),
  );

  // [column, row, the visual map's figure, the figure shown]: the total column reads -1, outside the
  // map's range, so it stays unfilled and only its number shows.
  const cell = (colors: ChartColors, x: number, y: number, count: number) => {
    const depth = 0.08 + (0.92 * count) / largest;
    return {
      value: [x, y, count, count],
      label: {
        color: depth >= 0.85 ? colors.surface : count === 0 ? colors.muted : colors.foreground,
      },
    };
  };

  return (
    <div className="transition-opacity duration-700 starting:opacity-0">
      <EChart
        label={t('hr.insights.matrix.title')}
        height={matrix.length * 44 + 36}
        option={(colors) => ({
          grid: { left: 2, right: 2, top: 28, bottom: 2, containLabel: true },
          xAxis: {
            type: 'category',
            position: 'top',
            data: [...columns, totalColumn],
            axisLine: { show: false },
            axisTick: { show: false },
            splitArea: { show: false },
            axisLabel: {
              color: colors.muted,
              fontSize: 12,
              interval: 0,
              width: 120,
              overflow: 'truncate',
            },
          },
          yAxis: {
            type: 'category',
            inverse: true,
            data: rows,
            axisLine: { show: false },
            axisTick: { show: false },
            splitArea: { show: false },
            axisLabel: { color: colors.foreground, fontSize: 12, width: 132, overflow: 'truncate' },
          },
          tooltip: {
            trigger: 'item',
            formatter: (point: { value: [number, number, number, number] }) => {
              const [x, y, , count] = point.value;
              const column = x < columns.length ? columns[x] : totalColumn;
              return `${escapeHtml(rows[y] ?? '')} / ${escapeHtml(column ?? '')}: <b>${formatCount(count)}</b>`;
            },
          },
          visualMap: {
            show: false,
            dimension: 2,
            seriesIndex: 0,
            // A figure outside `range` counts as out of range only when `min` lies below the range:
            // otherwise ECharts clamps it to the lightest step.
            min: -0.001,
            max: largest,
            range: [0, largest],
            inRange: { color: [colors.primary, colors.primary], colorAlpha: [0.08, 1] },
            outOfRange: { colorAlpha: 0 },
          },
          series: [
            {
              type: 'heatmap',
              itemStyle: { borderColor: colors.surface, borderWidth: 2, borderRadius: 4 },
              emphasis: { itemStyle: { borderColor: colors.foreground, borderWidth: 1 } },
              label: {
                show: true,
                fontSize: 13,
                formatter: (point: { value: [number, number, number, number] }) =>
                  formatCount(point.value[3]),
              },
              data: matrix.flatMap((row, y) => [
                ...levelKeys.map((key, x) => cell(colors, x, y, countAt(row, key))),
                {
                  value: [levelKeys.length, y, -1, row.total],
                  label: { color: colors.foreground, fontWeight: 600 },
                },
              ]),
            },
          ],
        })}
      >
        <FigureTable
          head={[t('hr.insights.fields.division'), ...columns, totalColumn]}
          rows={matrix.map((row, y) => [
            rows[y] ?? '',
            ...levelKeys.map((key) => countAt(row, key)),
            row.total,
          ])}
        />
      </EChart>
    </div>
  );
}

/* ---------------------------------------------------------- the two stacks */

/** Age bands split by gender, stacked, with a 2px surface gap between the parts. */
function AgeGenderBars({ rows, total }: { rows: readonly HrGenderCount[]; total: number }) {
  const { t } = useTranslation();
  const labels = useInsightLabels();
  const shown = rows.filter(
    (row) => row.key !== UNKNOWN || row.male + row.female + row.unknown > 0,
  );
  const names = shown.map((row) => labels.label('ageBands', row.key));
  const widest = Math.max(1, ...shown.map((row) => row.male + row.female + row.unknown));
  if (total === 0) return <InsightEmpty title={t('hr.insights.empty.people')} />;
  const series = (
    name: string,
    color: string,
    surface: string,
    count: (row: HrGenderCount) => number,
  ) => ({
    type: 'bar',
    name,
    stack: 'gender',
    barMaxWidth: 16,
    itemStyle: { color, borderColor: surface, borderWidth: 2, borderRadius: 4 },
    animationDelay: (index: number) => index * 40,
    label: {
      show: true,
      position: 'inside',
      color: surface,
      fontSize: 11,
      // A part too narrow for its figure prints none: the tooltip and the table keep it.
      formatter: (point: { value: number }) =>
        point.value / widest >= 0.08 ? formatCount(point.value) : '',
    },
    data: shown.map(count),
  });
  return (
    <EChart
      label={t('hr.insights.ageGender.title')}
      height={shown.length * 34 + 36}
      option={(colors) => ({
        legend: {
          top: 0,
          left: 0,
          icon: 'circle',
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { color: colors.foreground, fontSize: 12 },
        },
        grid: { left: 2, right: 8, top: 30, bottom: 2, containLabel: true },
        xAxis: { type: 'value', show: false, min: 0, minInterval: 1 },
        yAxis: {
          type: 'category',
          inverse: true,
          data: names,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: colors.foreground, fontSize: 12 },
        },
        tooltip: { trigger: 'axis', axisPointer: { type: 'none' } },
        series: [
          series(t('hr.insights.genders.MALE'), colors.male, colors.surface, (row) => row.male),
          series(
            t('hr.insights.genders.FEMALE'),
            colors.female,
            colors.surface,
            (row) => row.female,
          ),
          series(t('hr.insights.unknown'), colors.unknown, colors.surface, (row) => row.unknown),
        ],
      })}
    >
      <FigureTable
        head={[
          t('hr.insights.fields.band'),
          t('hr.insights.genders.MALE'),
          t('hr.insights.genders.FEMALE'),
          t('hr.insights.unknown'),
        ]}
        rows={shown.map((row, index) => [names[index] ?? '', row.male, row.female, row.unknown])}
      />
    </EChart>
  );
}

/** The children by age band: a radar of boys and girls, with the same figures listed beside it. */
function ChildrenRadar({ rows, total }: { rows: readonly HrGenderCount[]; total: number }) {
  const { t } = useTranslation();
  const labels = useInsightLabels();
  const palette = useMemo(chartColors, []);
  if (total === 0) return <InsightEmpty title={t('hr.insights.empty.children')} />;
  const names = rows.map((row) => labels.label('childBands', row.key));
  const peak = Math.max(1, ...rows.flatMap((row) => [row.male, row.female]));
  const shape = (name: string, color: string, value: number[]) => ({
    name,
    value,
    symbolSize: 8,
    itemStyle: { color },
    lineStyle: { color, width: 2 },
    areaStyle: { color, opacity: 0.1 },
  });
  const boys = t('hr.insights.children.boys');
  const girls = t('hr.insights.children.girls');
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)]">
      <EChart
        label={t('hr.insights.children.title')}
        height={232}
        option={(colors) => ({
          tooltip: { trigger: 'item' },
          radar: {
            radius: '68%',
            indicator: names.map((name) => ({ name, max: peak })),
            axisName: { color: colors.muted, fontSize: 12 },
            axisLine: { lineStyle: { color: colors.grid } },
            splitLine: { lineStyle: { color: colors.grid } },
            splitArea: { show: false },
          },
          series: [
            {
              type: 'radar',
              data: [
                shape(
                  boys,
                  colors.male,
                  rows.map((row) => row.male),
                ),
                shape(
                  girls,
                  colors.female,
                  rows.map((row) => row.female),
                ),
              ],
            },
          ],
        })}
      >
        <FigureTable
          head={[t('hr.insights.fields.band'), boys, girls]}
          rows={rows.map((row, index) => [names[index] ?? '', row.male, row.female])}
        />
      </EChart>
      <div className="min-w-0 space-y-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          <SwatchLine color={palette.male} label={boys} />
          <SwatchLine color={palette.female} label={girls} />
        </ul>
        <ul className="divide-y divide-border text-[0.8125rem]">
          {rows.map((row, index) => (
            <li key={row.key} className="flex items-center justify-between gap-2 py-1">
              <span className="min-w-0 truncate">{names[index]}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {t('hr.insights.children.split', { boys: row.male, girls: row.female })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the movement */

/** One column pair per month of the year: who joined, who left. */
function MovementBars({ months }: { months: readonly HrMovementMonth[] }) {
  const { t } = useTranslation();
  const joined = t('hr.insights.movement.joined');
  const left = t('hr.insights.movement.left');
  const names = months.map((month) =>
    t('common.calendar.month', { month: Number.parseInt(month.month.slice(5, 7), 10) }),
  );
  const series = (name: string, color: string, ink: string, data: number[]) => ({
    type: 'bar',
    name,
    barMaxWidth: 12,
    barGap: '15%',
    itemStyle: { color, borderRadius: [4, 4, 0, 0] },
    animationDelay: (index: number) => index * 40,
    label: {
      show: true,
      position: 'top',
      color: ink,
      fontSize: 11,
      formatter: (point: { value: number }) => (point.value > 0 ? formatCount(point.value) : ''),
    },
    data,
  });
  return (
    <EChart
      label={t('hr.insights.movement.title')}
      height={232}
      option={(colors) => ({
        legend: {
          top: 0,
          left: 0,
          icon: 'circle',
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { color: colors.foreground, fontSize: 12 },
        },
        grid: { left: 2, right: 2, top: 36, bottom: 2, containLabel: true },
        xAxis: {
          type: 'category',
          data: names,
          axisLine: { lineStyle: { color: colors.grid } },
          axisTick: { show: false },
          axisLabel: {
            color: colors.muted,
            fontSize: 12,
            interval: 0,
            formatter: (_: string, index: number) => String(index + 1),
          },
        },
        yAxis: {
          type: 'value',
          min: 0,
          minInterval: 1,
          axisLabel: { color: colors.muted, fontSize: 12 },
          splitLine: { lineStyle: { color: colors.grid } },
        },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow', shadowStyle: { opacity: 0.04 } },
        },
        series: [
          series(
            joined,
            colors.series[0] ?? colors.primary,
            colors.foreground,
            months.map((month) => month.joined),
          ),
          series(
            left,
            colors.series[1] ?? colors.primary,
            colors.foreground,
            months.map((month) => month.left),
          ),
        ],
      })}
    >
      <FigureTable
        head={[t('hr.insights.fields.month'), joined, left]}
        rows={months.map((month, index) => [names[index] ?? '', month.joined, month.left])}
      />
    </EChart>
  );
}

/* -------------------------------------------------------- birthdays, jubilees */

function monthsOfYear(year: string): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
}

/** This month's people from the HR calendar, with a month select in the card's corner. */
function CalendarCard(props: {
  kind: 'BIRTHDAY' | 'ANNIVERSARY';
  title: string;
  monthLabel: string;
  emptyText: string;
  total: number;
  finding: (count: number) => string;
  line: (item: HrCalendarItem) => string;
}) {
  const { t } = useTranslation();
  const today = businessDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const calendar = useInsightsCalendar(month);
  const people = (calendar.data ?? []).filter((item) => item.kind === props.kind);
  return (
    <InsightCard
      title={props.title}
      total={props.total}
      finding={calendar.data ? props.finding(people.length) : null}
      action={
        <NativeSelect
          variant="filter"
          active={false}
          aria-label={props.monthLabel}
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        >
          {monthsOfYear(today.slice(0, 4)).map((value) => (
            <option key={value} value={value}>
              {t('common.calendar.month', { month: Number.parseInt(value.slice(5), 10) })}
            </option>
          ))}
        </NativeSelect>
      }
    >
      {calendar.error && !calendar.data ? (
        <ProblemAlert problem={problemFromError(calendar.error)} onRetry={calendar.refetch} />
      ) : people.length === 0 ? (
        <InsightEmpty title={calendar.isPending ? t('hr.insights.loading') : props.emptyText} />
      ) : (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto pr-1">
          {people.map((item) => (
            <PersonRow
              key={`${item.userId}-${item.date}`}
              name={item.title}
              photoUrl={item.photoUrl}
              line={props.line(item)}
              figure={item.date.slice(5).replace('-', '.')}
            />
          ))}
        </ul>
      )}
    </InsightCard>
  );
}

/* ---------------------------------------------------------- what is unfilled */

function MissingNote({ data, className }: { data: HrWorkforceInsights; className?: string }) {
  const { t } = useTranslation();
  const entries = [
    ['birthDate', data.missing.birthDate],
    ['gender', data.missing.gender],
    ['education', data.missing.education],
    ['district', data.missing.district],
    ['level', data.missing.level],
  ] as const;
  const open = entries.filter(([, count]) => count > 0);
  if (open.length === 0) return null;
  return (
    <InsightCard
      title={t('hr.insights.missing.title')}
      finding={t('hr.insights.missing.finding')}
      className={className}
    >
      <ul className="divide-y divide-border">
        {open.map(([key, count]) => (
          <li key={key} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            <span className="min-w-0 truncate">{t(`hr.insights.missing.${key}`)}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {t('hr.insights.missing.count', { count: formatCount(count) })}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.8125rem]">
        <Link to="/hr/staff" className="text-link hover:underline">
          {t('hr.insights.missing.open')}
        </Link>
      </p>
    </InsightCard>
  );
}

/* ----------------------------------------------------------------- the tab */

const fixedColor =
  (keys: readonly string[]) =>
  (key: string) =>
  (colors: ChartColors): string => {
    const index = keys.indexOf(key);
    return key === UNKNOWN || index < 0
      ? colors.unknown
      : (colors.series[index % colors.series.length] ?? colors.primary);
  };

const maritalColor = fixedColor(MARITAL_STATUSES);
const reasonColor = fixedColor(LEFT_REASON_KINDS);

const genderColor =
  (key: string) =>
  (colors: ChartColors): string =>
    key === 'MALE' ? colors.male : key === 'FEMALE' ? colors.female : colors.unknown;

export function WorkforceTab({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation();
  const labels = useInsightLabels();
  const query = useWorkforceInsights(from, to);
  if (query.error && !query.data) {
    return <ProblemAlert problem={problemFromError(query.error)} onRetry={query.refetch} />;
  }
  const data = query.data;
  if (!data) return <InsightsSkeleton />;

  const countHead = [
    t('hr.insights.fields.name'),
    t('hr.insights.fields.count'),
    t('hr.insights.fields.share'),
  ];
  const known = (rows: readonly HrCount[]) => rows.filter((row) => row.key !== UNKNOWN);
  const dropEmptyUnknown = (rows: readonly HrCount[]) =>
    rows.filter((row) => row.key !== UNKNOWN || row.count > 0);

  const biggestDivision = data.matrix.find((row) => row.division !== UNKNOWN) ?? null;
  const tenureRows: BarRow[] = dropEmptyUnknown(data.tenure).map((row) => ({
    key: row.key,
    label: labels.label('tenure', row.key),
    value: row.count,
  }));
  const tenureKnown = sumOf(known(data.tenure), (row) => row.count);
  const underYear = sumOf(
    data.tenure.filter((row) => row.key === '0-6m' || row.key === '6m-1y'),
    (row) => row.count,
  );

  const educationOrder = [...EDUCATION_LEVELS, UNKNOWN] as readonly string[];
  const educationRows: BarRow[] = dropEmptyUnknown(
    [...data.education].sort(
      (a, b) => educationOrder.indexOf(a.key) - educationOrder.indexOf(b.key),
    ),
  ).map((row) => ({
    key: row.key,
    label: labels.label('education', row.key),
    value: row.count,
  }));
  const topEducation = topKnown(data.education);

  const ageRows = data.ageGender.map((row) => ({
    key: row.key,
    count: row.male + row.female + row.unknown,
  }));
  const topAge = topKnown(ageRows);

  const genderRows: RingRow[] = data.genders.map((row) => ({
    key: row.key,
    label: row.key === UNKNOWN ? labels.unknown : labels.label('genders', row.key),
    value: row.count,
    color: genderColor(row.key),
  }));
  const maleCount = data.genders.find((row) => row.key === 'MALE')?.count ?? 0;
  const femaleCount = data.genders.find((row) => row.key === 'FEMALE')?.count ?? 0;

  const districtRows: BarRow[] = (() => {
    const named = data.districts.filter((row) => row.key !== UNKNOWN);
    const unknown = data.districts.filter((row) => row.key === UNKNOWN && row.count > 0);
    const shown: BarRow[] = named.slice(0, DISTRICT_ROWS).map((row) => ({
      key: row.key,
      label: row.key,
      value: row.count,
    }));
    const others = sumOf(named.slice(DISTRICT_ROWS), (row) => row.count);
    if (others > 0) {
      shown.push({ key: 'OTHERS', label: t('hr.insights.districts.others'), value: others });
    }
    return [
      ...shown,
      ...unknown.map((row) => ({ key: row.key, label: labels.unknown, value: row.count })),
    ];
  })();
  const topDistrict = topKnown(data.districts);

  const maritalRows: RingRow[] = data.marital.map((row) => ({
    key: row.key,
    label: labels.label('marital', row.key),
    value: row.count,
    color: maritalColor(row.key),
  }));
  const topMarital = topKnown(data.marital);

  const topChildBand = topKnown(
    data.children.map((row) => ({ key: row.key, count: row.male + row.female + row.unknown })),
  );

  const yearJoined = sumOf(data.movement, (month) => month.joined);
  const yearLeft = sumOf(data.movement, (month) => month.left);
  const movementYear = to.slice(0, 4);

  const reasonRows: RingRow[] = data.leftReasons.map((row) => ({
    key: row.key,
    label: labels.label('leftReasons', row.key),
    value: row.count,
    color: reasonColor(row.key),
  }));
  const reasonsTotal = sumOf(data.leftReasons, (row) => row.count);
  const topReason = topKnown(data.leftReasons);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          title={t('hr.insights.tiles.total')}
          icon={Users}
          value={data.total}
          line={<Delta now={data.total} before={data.totalBefore} />}
        />
        <StatTile
          title={t('hr.insights.tiles.movement')}
          icon={ArrowLeftRight}
          tone="success"
          value={data.joined}
          secondValue={data.left}
          line={
            <div className="flex min-w-0 flex-col">
              <Delta
                prefix={t('hr.insights.tiles.joined')}
                now={data.joined}
                before={data.joinedBefore}
              />
              <Delta
                prefix={t('hr.insights.tiles.left')}
                now={data.left}
                before={data.leftBefore}
              />
            </div>
          }
        />
        <StatTile
          title={t('hr.insights.tiles.averageAge')}
          icon={UsersRound}
          tone="muted"
          value={data.averageAge === null ? null : Number.parseFloat(data.averageAge)}
          decimals={1}
          line={<Delta now={data.averageAge} before={data.averageAgeBefore} decimals={1} />}
        />
        <StatTile
          title={t('hr.insights.tiles.averageTenure')}
          icon={CalendarClock}
          tone="muted"
          value={data.averageTenure === null ? null : Number.parseFloat(data.averageTenure)}
          decimals={1}
          line={<Delta now={data.averageTenure} before={data.averageTenureBefore} decimals={1} />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <InsightCard
          title={t('hr.insights.matrix.title')}
          className="lg:col-span-2"
          total={data.total}
          finding={
            biggestDivision
              ? t('hr.insights.matrix.finding', {
                  division: biggestDivision.division,
                  count: formatCount(biggestDivision.total),
                  percent: shareOf(biggestDivision.total, data.total),
                })
              : null
          }
        >
          {data.matrix.length === 0 ? (
            <InsightEmpty title={t('hr.insights.empty.people')} />
          ) : (
            <DivisionMatrix matrix={data.matrix} />
          )}
        </InsightCard>

        <InsightCard
          title={t('hr.insights.tenure.title')}
          total={data.total}
          finding={
            tenureKnown > 0
              ? t('hr.insights.tenure.finding', { percent: shareOf(underYear, tenureKnown) })
              : t('hr.insights.empty.unfilled')
          }
        >
          <HorizontalBars
            label={t('hr.insights.tenure.title')}
            rows={tenureRows}
            head={countHead}
            emptyText={t('hr.insights.empty.people')}
          />
        </InsightCard>

        <CalendarCard
          kind="BIRTHDAY"
          title={t('hr.insights.birthdays.title')}
          monthLabel={t('hr.insights.birthdays.month')}
          emptyText={t('hr.insights.birthdays.empty')}
          total={data.total}
          finding={(count) => t('hr.insights.birthdays.finding', { count: formatCount(count) })}
          line={() => t('hr.insights.birthdays.line')}
        />
        <CalendarCard
          kind="ANNIVERSARY"
          title={t('hr.insights.anniversaries.title')}
          monthLabel={t('hr.insights.anniversaries.month')}
          emptyText={t('hr.insights.anniversaries.empty')}
          total={data.total}
          finding={(count) => t('hr.insights.anniversaries.finding', { count: formatCount(count) })}
          line={(item) => t('hr.insights.anniversaries.line', { years: item.years ?? 0 })}
        />

        <InsightCard
          title={t('hr.insights.education.title')}
          total={data.total}
          finding={
            topEducation
              ? t('hr.insights.education.finding', {
                  level: labels.label('education', topEducation.key),
                  percent: shareOf(topEducation.count, data.total),
                })
              : t('hr.insights.empty.unfilled')
          }
        >
          <HorizontalBars
            label={t('hr.insights.education.title')}
            rows={educationRows}
            head={countHead}
            emptyText={t('hr.insights.empty.people')}
          />
        </InsightCard>

        <InsightCard
          title={t('hr.insights.ageGender.title')}
          total={data.total}
          finding={
            topAge
              ? t('hr.insights.ageGender.finding', {
                  band: labels.label('ageBands', topAge.key),
                  percent: shareOf(topAge.count, data.total),
                })
              : t('hr.insights.empty.unfilled')
          }
        >
          <AgeGenderBars rows={data.ageGender} total={data.total} />
        </InsightCard>

        <InsightCard
          title={t('hr.insights.genders.title')}
          total={data.total}
          finding={
            maleCount + femaleCount > 0
              ? t('hr.insights.genders.finding', {
                  male: shareOf(maleCount, data.total),
                  female: shareOf(femaleCount, data.total),
                })
              : t('hr.insights.empty.unfilled')
          }
        >
          <RingChart
            label={t('hr.insights.genders.title')}
            rows={genderRows}
            head={countHead}
            centerValue={formatCount(data.total)}
            centerLabel={t('hr.insights.fields.people')}
            emptyText={t('hr.insights.empty.people')}
          />
        </InsightCard>

        <InsightCard
          title={t('hr.insights.districts.title')}
          total={data.total}
          finding={
            topDistrict
              ? t('hr.insights.districts.finding', {
                  district: topDistrict.key,
                  percent: shareOf(topDistrict.count, data.total),
                })
              : t('hr.insights.empty.unfilled')
          }
        >
          <HorizontalBars
            label={t('hr.insights.districts.title')}
            rows={districtRows}
            head={countHead}
            emptyText={t('hr.insights.empty.people')}
          />
        </InsightCard>

        <InsightCard
          title={t('hr.insights.marital.title')}
          total={data.total}
          finding={
            topMarital
              ? t('hr.insights.marital.finding', {
                  status: labels.label('marital', topMarital.key),
                  percent: shareOf(topMarital.count, data.total),
                })
              : t('hr.insights.empty.unfilled')
          }
        >
          <RingChart
            label={t('hr.insights.marital.title')}
            rows={maritalRows}
            head={countHead}
            centerValue={formatCount(data.total)}
            centerLabel={t('hr.insights.fields.people')}
            emptyText={t('hr.insights.empty.people')}
          />
        </InsightCard>

        <InsightCard
          title={t('hr.insights.children.title')}
          total={data.total}
          finding={
            topChildBand
              ? t('hr.insights.children.finding', {
                  count: formatCount(data.childrenTotal),
                  band: labels.label('childBands', topChildBand.key),
                })
              : t('hr.insights.children.noneFilled')
          }
        >
          <ChildrenRadar rows={data.children} total={data.childrenTotal} />
        </InsightCard>

        <InsightCard
          title={t('hr.insights.leftReasons.title')}
          finding={
            topReason
              ? t('hr.insights.leftReasons.finding', {
                  reason: labels.label('leftReasons', topReason.key),
                  percent: shareOf(topReason.count, reasonsTotal),
                })
              : null
          }
        >
          <RingChart
            label={t('hr.insights.leftReasons.title')}
            rows={reasonRows}
            head={countHead}
            centerValue={formatCount(reasonsTotal)}
            centerLabel={t('hr.insights.fields.people')}
            emptyText={t('hr.insights.leftReasons.empty')}
          />
        </InsightCard>

        <InsightCard
          title={t('hr.insights.movement.title')}
          className="lg:col-span-2"
          total={data.total}
          finding={t('hr.insights.movement.finding', {
            year: movementYear,
            joined: formatCount(yearJoined),
            left: formatCount(yearLeft),
          })}
        >
          <dl className="mb-3 flex flex-wrap gap-x-8 gap-y-1">
            <div>
              <dt className="text-[0.8125rem] text-muted-foreground">
                {t('hr.insights.movement.joinedYear', { year: movementYear })}
              </dt>
              <dd className="font-mono text-[1.375rem] font-semibold">{formatCount(yearJoined)}</dd>
            </div>
            <div>
              <dt className="text-[0.8125rem] text-muted-foreground">
                {t('hr.insights.movement.leftYear', { year: movementYear })}
              </dt>
              <dd className="font-mono text-[1.375rem] font-semibold">{formatCount(yearLeft)}</dd>
            </div>
          </dl>
          <MovementBars months={data.movement} />
        </InsightCard>

        <MissingNote data={data} className="lg:col-span-2 2xl:col-span-1" />
      </div>
    </div>
  );
}
