import { CalendarRange, ClipboardList, Clock, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChartColors } from '@/components/chart/chart-colors';
import { EChart } from '@/components/chart/echart';
import { ProblemAlert } from '@/components/problem-alert';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { type HrRequestInsights, useRequestInsights } from './api';
import { shareOf, sumOf } from './insights-format';
import {
  type BarRow,
  FigureTable,
  HorizontalBars,
  InsightCard,
  InsightEmpty,
  InsightsSkeleton,
  PersonRow,
  ProgressBar,
  RingChart,
  type RingRow,
  StatTile,
} from './insights-kit';
import { useInsightLabels } from './insights-hooks';

const statusColor =
  (key: string) =>
  (colors: ChartColors): string => {
    if (key === 'APPROVED') return colors.good;
    if (key === 'PENDING') return colors.warn;
    if (key === 'REJECTED') return colors.bad;
    return colors.unknown;
  };

/** The approved requests per month of the year, one series. */
function MonthBars({ data }: { data: HrRequestInsights }) {
  const { t } = useTranslation();
  const names = data.months.map((month) =>
    t('common.calendar.month', { month: Number.parseInt(month.month.slice(5, 7), 10) }),
  );
  if (data.total === 0) return <InsightEmpty title={t('hr.insights.requests.none')} />;
  return (
    <EChart
      label={t('hr.insights.requests.months')}
      height={232}
      option={(colors) => ({
        grid: { left: 2, right: 2, top: 20, bottom: 2, containLabel: true },
        xAxis: {
          type: 'category',
          data: names,
          axisLine: { lineStyle: { color: colors.grid } },
          axisTick: { show: false },
          axisLabel: { color: colors.muted, fontSize: 12, interval: 0 },
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
          {
            type: 'bar',
            name: t('hr.insights.requests.count'),
            barMaxWidth: 20,
            itemStyle: { color: colors.series[0], borderRadius: [4, 4, 0, 0] },
            animationDelay: (index: number) => index * 40,
            label: {
              show: true,
              position: 'top',
              color: colors.foreground,
              fontSize: 12,
              formatter: (point: { value: number }) =>
                point.value > 0 ? formatCount(point.value) : '',
            },
            data: data.months.map((month) => month.count),
          },
        ],
      })}
    >
      <FigureTable
        head={[t('hr.insights.fields.month'), t('hr.insights.requests.count')]}
        rows={data.months.map((month, index) => [names[index] ?? '', month.count])}
      />
    </EChart>
  );
}

export function RequestsTab({ year }: { year: number }) {
  const { t } = useTranslation();
  const labels = useInsightLabels();
  const query = useRequestInsights(year);
  if (query.error && !query.data) {
    return <ProblemAlert problem={problemFromError(query.error)} onRetry={query.refetch} />;
  }
  const data = query.data;
  if (!data) return <InsightsSkeleton />;

  const topType = data.types[0] ?? null;
  const topSender = data.employees[0] ?? null;
  const typeRows: BarRow[] = data.types.map((type) => ({
    key: String(type.typeId),
    label: type.name,
    value: type.count,
    color: type.color,
    note: t('hr.insights.requests.days', { count: formatCount(type.days) }),
  }));
  const statusRows: RingRow[] = data.statuses.map((row) => ({
    key: row.key,
    label: labels.label('requestStatuses', row.key),
    value: row.count,
    color: statusColor(row.key),
  }));
  const allRequests = sumOf(data.statuses, (row) => row.count);
  const pending = data.statuses.find((row) => row.key === 'PENDING')?.count ?? 0;
  const busiest = data.months.reduce<(typeof data.months)[number] | null>(
    (best, month) => (month.count > (best?.count ?? 0) ? month : best),
    null,
  );
  const senderPeak = Math.max(1, ...data.employees.map((person) => person.count));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile title={t('hr.insights.requests.total')} icon={ClipboardList} value={data.total} />
        <StatTile
          title={t('hr.insights.requests.hours')}
          icon={Clock}
          tone="muted"
          value={data.minutes / 60}
          decimals={data.minutes % 60 === 0 ? 0 : 1}
        />
        <StatTile
          title={t('hr.insights.requests.topType')}
          icon={CalendarRange}
          tone="muted"
          text={topType?.name ?? t('common.none')}
          line={
            topType ? (
              <span className="truncate text-[0.75rem] text-muted-foreground">
                {t('hr.insights.requests.times', { count: formatCount(topType.count) })}
              </span>
            ) : null
          }
        />
        <StatTile
          title={t('hr.insights.requests.topSender')}
          icon={UserRound}
          tone="muted"
          text={topSender?.fullName ?? t('common.none')}
          line={
            topSender ? (
              <span className="truncate text-[0.75rem] text-muted-foreground">
                {t('hr.insights.requests.times', { count: formatCount(topSender.count) })}
              </span>
            ) : null
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <InsightCard
          title={t('hr.insights.requests.types')}
          finding={
            topType
              ? t('hr.insights.requests.typesFinding', {
                  type: topType.name,
                  percent: shareOf(topType.count, data.total),
                })
              : null
          }
        >
          <HorizontalBars
            label={t('hr.insights.requests.types')}
            rows={typeRows}
            head={[
              t('hr.insights.requests.type'),
              t('hr.insights.requests.count'),
              t('hr.insights.fields.share'),
            ]}
            emptyText={t('hr.insights.requests.none')}
          />
        </InsightCard>

        <InsightCard
          title={t('hr.insights.requests.employees')}
          finding={
            topSender
              ? t('hr.insights.requests.employeesFinding', {
                  name: topSender.fullName,
                  count: formatCount(topSender.count),
                })
              : null
          }
        >
          {data.employees.length === 0 ? (
            <InsightEmpty title={t('hr.insights.requests.none')} />
          ) : (
            <ul className="divide-y divide-border">
              {data.employees.map((person) => (
                <PersonRow
                  key={person.userId}
                  name={person.fullName}
                  photoUrl={person.photoUrl}
                  line={
                    <ProgressBar
                      percent={shareOf(person.count, senderPeak)}
                      label={t('hr.insights.requests.barOf', { name: person.fullName })}
                    />
                  }
                  figure={
                    <span className="font-semibold">
                      {t('hr.insights.requests.times', { count: formatCount(person.count) })}
                    </span>
                  }
                />
              ))}
            </ul>
          )}
        </InsightCard>

        <InsightCard
          title={t('hr.insights.requests.statuses')}
          finding={
            allRequests > 0
              ? t('hr.insights.requests.statusesFinding', { count: formatCount(pending) })
              : null
          }
        >
          <RingChart
            label={t('hr.insights.requests.statuses')}
            rows={statusRows}
            head={[
              t('hr.insights.requests.status'),
              t('hr.insights.requests.count'),
              t('hr.insights.fields.share'),
            ]}
            centerValue={formatCount(allRequests)}
            centerLabel={t('hr.insights.requests.centre')}
            emptyText={t('hr.insights.requests.none')}
          />
        </InsightCard>

        <InsightCard
          title={t('hr.insights.requests.months')}
          className="lg:col-span-2 2xl:col-span-3"
          finding={
            busiest
              ? t('hr.insights.requests.monthsFinding', {
                  month: Number.parseInt(busiest.month.slice(5, 7), 10),
                  count: formatCount(busiest.count),
                })
              : null
          }
        >
          <MonthBars data={data} />
        </InsightCard>
      </div>
    </div>
  );
}
