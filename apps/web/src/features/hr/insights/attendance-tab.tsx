import { AlarmClock, LogIn, LogOut, Timer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EChart } from '@/components/chart/echart';
import { SearchField } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { type HrAttendanceEmployee, type HrAttendanceInsights, useAttendanceInsights } from './api';
import {
  ATTENDANCE_STARTED,
  escapeHtml,
  formatHours,
  percentValue,
  UNKNOWN,
} from './insights-format';
import {
  type BarRow,
  Delta,
  FigureTable,
  HorizontalBars,
  InsightCard,
  InsightEmpty,
  InsightNote,
  InsightsSkeleton,
  PersonRow,
  ProgressBar,
  StatTile,
} from './insights-kit';
import { useInsightLabels } from './insights-hooks';

const LEADERS = 3;

/** Worked of planned as one ring: the figure in the middle moves as the range changes. */
function PerformanceGauge({ data }: { data: HrAttendanceInsights }) {
  const { t } = useTranslation();
  const value = percentValue(data.performance);
  return (
    <div className="space-y-2">
      <EChart
        label={t('hr.insights.attendance.performance')}
        height={208}
        option={(colors) => ({
          tooltip: {
            trigger: 'item',
            formatter: () =>
              `${escapeHtml(t('hr.insights.attendance.performance'))}: <b>${value}%</b>`,
          },
          series: [
            {
              type: 'gauge',
              startAngle: 90,
              endAngle: -270,
              min: 0,
              max: 100,
              radius: '92%',
              pointer: { show: false },
              axisTick: { show: false },
              splitLine: { show: false },
              axisLabel: { show: false },
              axisLine: { lineStyle: { width: 16, color: [[1, colors.grid]] } },
              progress: {
                show: true,
                width: 16,
                roundCap: true,
                itemStyle: { color: colors.primary },
              },
              title: { show: false },
              detail: {
                valueAnimation: true,
                offsetCenter: [0, 0],
                formatter: '{value}%',
                color: colors.foreground,
                fontSize: 30,
                fontWeight: 600,
              },
              data: [{ value }],
            },
          ],
        })}
      >
        <FigureTable
          head={[
            t('hr.insights.attendance.performance'),
            t('hr.insights.attendance.worked'),
            t('hr.insights.attendance.planned'),
          ]}
          rows={[
            [
              `${data.performance}%`,
              formatHours(data.workedMinutes),
              formatHours(data.plannedMinutes),
            ],
          ]}
        />
      </EChart>
      <div className="flex justify-center">
        <Delta now={data.performance} before={data.performanceBefore} decimals={1} />
      </div>
    </div>
  );
}

function HoursLine({ person }: { person: HrAttendanceEmployee }) {
  const { t } = useTranslation();
  return (
    <>
      {t('hr.insights.attendance.hoursOf', {
        worked: formatHours(person.workedMinutes),
        planned: formatHours(person.plannedMinutes),
      })}
    </>
  );
}

function Leaders({
  people,
  title,
  emptyText,
}: {
  people: readonly HrAttendanceEmployee[];
  title: string;
  emptyText: string;
}) {
  const { t } = useTranslation();
  return (
    <InsightCard title={title}>
      {people.length === 0 ? (
        <InsightEmpty title={emptyText} />
      ) : (
        <ul className="divide-y divide-border">
          {people.map((person) => (
            <PersonRow
              key={person.userId}
              name={person.fullName}
              photoUrl={person.photoUrl}
              line={<HoursLine person={person} />}
              figure={
                <span className="font-semibold">
                  {t('hr.insights.percent', { value: person.performance ?? '0' })}
                </span>
              }
            />
          ))}
        </ul>
      )}
    </InsightCard>
  );
}

/** Everyone with a bar for their share of the planned hours, narrowed by a search. */
function EmployeeList({
  people,
  className,
}: {
  people: readonly HrAttendanceEmployee[];
  className?: string;
}) {
  const { t } = useTranslation();
  const labels = useInsightLabels();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('mn');
    if (needle === '') return people;
    return people.filter((person) => person.fullName.toLocaleLowerCase('mn').includes(needle));
  }, [people, query]);
  return (
    <InsightCard
      title={t('hr.insights.attendance.employees')}
      className={className}
      total={people.length}
      action={
        <SearchField
          aria-label={t('hr.insights.attendance.search')}
          placeholder={t('hr.insights.attendance.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      }
    >
      {shown.length === 0 ? (
        <InsightEmpty title={t('hr.insights.attendance.noEmployees')} />
      ) : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto pr-1">
          {shown.map((person) => (
            <li
              key={person.userId}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(5rem,10rem)_auto] items-center gap-3"
            >
              <ul className="min-w-0">
                <PersonRow
                  name={person.fullName}
                  photoUrl={person.photoUrl}
                  line={labels.name(person.division)}
                />
              </ul>
              <ProgressBar
                percent={percentValue(person.performance)}
                label={t('hr.insights.attendance.barOf', { name: person.fullName })}
              />
              <div className="w-28 text-right text-[0.8125rem] tabular-nums">
                <p className="font-semibold">
                  {person.performance === null
                    ? t('common.none')
                    : t('hr.insights.percent', { value: person.performance })}
                </p>
                <p className="truncate text-[0.75rem] text-muted-foreground">
                  <HoursLine person={person} />
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </InsightCard>
  );
}

/** The year's months as one line of performance on one axis, 0 to 100 percent. */
function TrendLine({ data }: { data: HrAttendanceInsights }) {
  const { t } = useTranslation();
  // Months before recording began have planned hours and no punches: a gap, not a zero.
  const firstMonth = ATTENDANCE_STARTED.slice(0, 7);
  const figure = (month: HrAttendanceInsights['trend'][number]) =>
    month.month < firstMonth ? null : month.performance;
  const names = data.trend.map((month) =>
    t('common.calendar.month', { month: Number.parseInt(month.month.slice(5, 7), 10) }),
  );
  if (data.trend.every((month) => figure(month) === null)) {
    return <InsightEmpty title={t('hr.insights.attendance.noTrend')} />;
  }
  return (
    <EChart
      label={t('hr.insights.attendance.trend')}
      height={280}
      option={(colors) => ({
        grid: { left: 2, right: 12, top: 12, bottom: 2, containLabel: true },
        xAxis: {
          type: 'category',
          data: names,
          boundaryGap: false,
          axisLine: { lineStyle: { color: colors.grid } },
          axisTick: { show: false },
          axisLabel: {
            color: colors.muted,
            fontSize: 12,
            formatter: (_: string, index: number) => String(index + 1),
          },
        },
        yAxis: {
          type: 'value',
          min: 0,
          max: 100,
          axisLabel: { color: colors.muted, fontSize: 12, formatter: '{value}%' },
          splitLine: { lineStyle: { color: colors.grid } },
        },
        tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${value}%` },
        series: [
          {
            type: 'line',
            name: t('hr.insights.attendance.performance'),
            symbol: 'circle',
            symbolSize: 8,
            showSymbol: true,
            connectNulls: false,
            lineStyle: { width: 2, color: colors.primary, cap: 'round', join: 'round' },
            itemStyle: { color: colors.primary, borderColor: colors.surface, borderWidth: 2 },
            areaStyle: { color: colors.primary, opacity: 0.1 },
            data: data.trend.map((month) => {
              const value = figure(month);
              return value === null ? '-' : percentValue(value);
            }),
          },
        ],
      })}
    >
      <FigureTable
        head={[t('hr.insights.fields.month'), t('hr.insights.attendance.performance')]}
        rows={data.trend.map((month, index) => {
          const value = figure(month);
          return [names[index] ?? '', value === null ? t('common.none') : `${value}%`];
        })}
      />
    </EChart>
  );
}

export function AttendanceTab(props: {
  from: string;
  to: string;
  clamped: boolean;
  startNote: string;
}) {
  const { t } = useTranslation();
  const labels = useInsightLabels();
  const query = useAttendanceInsights(props.from, props.to);
  if (query.error && !query.data) {
    return <ProblemAlert problem={problemFromError(query.error)} onRetry={query.refetch} />;
  }
  const data = query.data;
  if (!data) return <InsightsSkeleton />;

  const divisionRows: BarRow[] = data.divisions.map((row) => ({
    key: row.division,
    label: labels.name(row.division),
    value: percentValue(row.performance),
    text: row.performance === null ? t('common.none') : `${row.performance}%`,
    note: t('hr.insights.attendance.hoursOf', {
      worked: formatHours(row.workedMinutes),
      planned: formatHours(row.plannedMinutes),
    }),
  }));
  const rated = data.employees.filter((person) => person.plannedMinutes > 0);
  const best = rated.slice(0, LEADERS);
  const watch = rated.slice(Math.max(LEADERS, rated.length - LEADERS)).reverse();
  const rankedDivisions = data.divisions.filter(
    (row) => row.performance !== null && row.division !== UNKNOWN,
  );
  const lowestDivision = rankedDivisions.reduce<(typeof rankedDivisions)[number] | null>(
    (lowest, row) =>
      !lowest || percentValue(row.performance) < percentValue(lowest.performance) ? row : lowest,
    null,
  );

  return (
    <div className="space-y-4">
      <InsightNote>
        {props.startNote}
        {props.clamped
          ? ` ${t('hr.insights.attendance.clamped', { from: data.from, to: data.to })}`
          : ''}
      </InsightNote>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <InsightCard
          title={t('hr.insights.attendance.performance')}
          finding={
            data.performance === null
              ? null
              : t('hr.insights.attendance.performanceFinding', {
                  worked: formatHours(data.workedMinutes),
                  planned: formatHours(data.plannedMinutes),
                })
          }
        >
          {data.performance === null ? (
            <InsightEmpty title={t('hr.insights.attendance.noPlan')} />
          ) : (
            <PerformanceGauge data={data} />
          )}
        </InsightCard>

        <div className="grid min-w-0 auto-rows-fr gap-4 sm:grid-cols-2 2xl:col-span-2">
          <StatTile
            title={t('hr.insights.attendance.arrival')}
            icon={LogIn}
            text={data.averageArrival ?? t('common.none')}
          />
          <StatTile
            title={t('hr.insights.attendance.departure')}
            icon={LogOut}
            text={data.averageDeparture ?? t('common.none')}
          />
          <StatTile
            title={t('hr.insights.attendance.late')}
            icon={AlarmClock}
            tone="warning"
            value={data.averageLateMinutes}
            unit={t('hr.insights.attendance.minuteUnit')}
            line={
              <span className="truncate text-[0.75rem] text-muted-foreground">
                {t('hr.insights.attendance.lateDays', { count: formatCount(data.lateDays) })}
              </span>
            }
          />
          <StatTile
            title={t('hr.insights.attendance.early')}
            icon={Timer}
            tone="muted"
            value={data.averageEarlyMinutes}
            unit={t('hr.insights.attendance.minuteUnit')}
            line={
              <span className="truncate text-[0.75rem] text-muted-foreground">
                {t('hr.insights.attendance.absentDays', { count: formatCount(data.absentDays) })}
              </span>
            }
          />
        </div>

        <InsightCard
          title={t('hr.insights.attendance.divisions')}
          finding={
            lowestDivision
              ? t('hr.insights.attendance.divisionFinding', {
                  division: lowestDivision.division,
                  percent: lowestDivision.performance,
                })
              : null
          }
        >
          <HorizontalBars
            label={t('hr.insights.attendance.divisions')}
            rows={divisionRows}
            whole={100}
            max={100}
            head={[t('hr.insights.fields.division'), t('hr.insights.attendance.performance')]}
            emptyText={t('hr.insights.attendance.noPlan')}
          />
        </InsightCard>

        <Leaders
          title={t('hr.insights.attendance.best')}
          people={best}
          emptyText={t('hr.insights.attendance.noPlan')}
        />
        <Leaders
          title={t('hr.insights.attendance.watch')}
          people={watch}
          emptyText={t('hr.insights.attendance.noWatch')}
        />

        <InsightCard title={t('hr.insights.attendance.trend')}>
          <TrendLine data={data} />
        </InsightCard>

        <EmployeeList people={data.employees} className="lg:col-span-2" />
      </div>
    </div>
  );
}
