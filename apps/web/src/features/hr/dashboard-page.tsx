import { timeOf } from '@tugeel/shared/hr';
import { addDays, businessDate } from '@tugeel/shared/time';
import {
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  Clock,
  DoorOpen,
  type LucideIcon,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChevronHead,
  EmptyState,
  LinkRow,
  ListCard,
  ListTable,
  SegmentedControl,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { cn } from '@/lib/utils';
import {
  type AttendanceDashboard,
  type AttendanceDashboardRow,
  type AttendanceTrendPoint,
  useAttendanceDashboard,
} from './api';
import { useRoleLabel, useWorded } from './hr-helpers';
import { Avatar, StatusBadge, TimeCell } from './hr-kit';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ tiles */

type Tone = 'success' | 'primary' | 'warning' | 'destructive' | 'muted';

const TONE = {
  success: 'bg-success-soft text-success',
  primary: 'bg-info-soft text-link',
  warning: 'bg-warning-soft text-warning',
  destructive: 'bg-danger-soft text-destructive',
  muted: 'bg-fill text-muted-foreground',
} satisfies Record<Tone, string>;

/** One figure of the day: an icon in a tinted circle, the count large, a line under it. */
function KpiTile(props: {
  title: string;
  value: string;
  line?: string;
  icon: LucideIcon;
  tone: Tone;
  dim?: boolean;
}) {
  const Icon = props.icon;
  return (
    <section
      aria-label={props.title}
      className={cn(
        'flex items-center gap-3 rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06]',
        props.dim && 'opacity-60',
      )}
    >
      <span
        aria-hidden
        className={cn('grid size-10 shrink-0 place-items-center rounded-full', TONE[props.tone])}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[1.5rem] leading-tight font-semibold">{props.value}</p>
        <h2 className="truncate text-[0.8125rem] font-medium text-muted-foreground">
          {props.title}
        </h2>
        {props.line ? (
          <p className="truncate text-[0.75rem] text-muted-foreground">{props.line}</p>
        ) : null}
      </div>
    </section>
  );
}

function Tiles({ data, past }: { data: AttendanceDashboard; past: boolean }) {
  const { t } = useTranslation();
  const { counts } = data;
  const tiles: ReactNode[] = [
    <KpiTile
      key="present"
      title={t('hr.dashboard.tiles.present')}
      value={`${formatCount(counts.present)} / ${formatCount(counts.expected)}`}
      line={t('hr.dashboard.ofExpected', { expected: formatCount(counts.expected) })}
      icon={UserCheck}
      tone="success"
    />,
    past ? (
      <KpiTile
        key="openIn"
        title={t('hr.dashboard.tiles.openIn')}
        value={formatCount(counts.openIn)}
        icon={DoorOpen}
        tone="muted"
      />
    ) : (
      <KpiTile
        key="inNow"
        title={t('hr.dashboard.tiles.inNow')}
        value={formatCount(counts.inNow)}
        icon={Users}
        tone="primary"
      />
    ),
    <KpiTile
      key="late"
      title={t('hr.dashboard.tiles.late')}
      value={formatCount(counts.late)}
      icon={Clock}
      tone="warning"
    />,
    <KpiTile
      key="absent"
      title={t('hr.dashboard.tiles.absent')}
      value={formatCount(counts.absent)}
      icon={UserX}
      tone="destructive"
    />,
    <KpiTile
      key="off"
      title={t('hr.dashboard.tiles.off')}
      value={formatCount(counts.off)}
      icon={CalendarOff}
      tone="muted"
      dim
    />,
  ];
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{tiles}</div>;
}

/* ------------------------------------------------------------------ trend */

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 };
const GRID = 'var(--border)';

function LegendSwatch(props: { color: string; dashed?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {props.dashed ? (
        <svg width="18" height="6" className="shrink-0">
          <line
            x1="0"
            y1="3"
            x2="18"
            y2="3"
            stroke={props.color}
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        </svg>
      ) : (
        <span aria-hidden className="size-2.5 rounded-sm" style={{ background: props.color }} />
      )}
      {props.label}
    </span>
  );
}

/** Fourteen days: on-time and late stacked, the expected count as a dashed line. */
function TrendChart({ points }: { points: readonly AttendanceTrendPoint[] }) {
  const { t } = useTranslation();
  const onTime = t('hr.dashboard.trend.onTime');
  const late = t('hr.dashboard.trend.late');
  const expected = t('hr.dashboard.trend.expected');
  const data = points.map((point) => ({
    date: point.date,
    onTime: Math.max(0, point.present - point.late),
    late: point.late,
    expected: point.expected,
  }));
  return (
    <figure aria-label={t('hr.dashboard.trend.title')} className="m-0">
      <div aria-hidden style={{ height: 240 }} className="w-full">
        <ResponsiveContainer
          width="100%"
          height={240}
          initialDimension={{ width: 640, height: 240 }}
        >
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tickFormatter={(value: string) => value.slice(5)}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={32}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: 'var(--accent)' }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                return active && row ? (
                  <div className="rounded-lg bg-popover px-3 py-2 text-xs text-popover-foreground shadow-popover ring-1 ring-black/[0.06]">
                    <p className="mb-1 font-semibold">{row.date}</p>
                    {(
                      [
                        [onTime, row.onTime],
                        [late, row.late],
                        [expected, row.expected],
                      ] as const
                    ).map(([label, value]) => (
                      <p key={label} className="flex justify-between gap-4">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono">{value}</span>
                      </p>
                    ))}
                  </div>
                ) : null;
              }}
            />
            <Bar
              dataKey="onTime"
              name={onTime}
              stackId="day"
              fill="var(--chart-2)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="late"
              name={late}
              stackId="day"
              fill="var(--chart-3)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="expected"
              name={expected}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div
        aria-hidden
        className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"
      >
        <LegendSwatch color="var(--chart-2)" label={onTime} />
        <LegendSwatch color="var(--chart-3)" label={late} />
        <LegendSwatch color="var(--muted-foreground)" dashed label={expected} />
      </div>
      <ul className="sr-only">
        {data.map((row) => (
          <li key={row.date}>
            {`${row.date}: ${onTime} ${row.onTime}, ${late} ${row.late}, ${expected} ${row.expected}`}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/* ------------------------------------------------------------------ month */

function MonthCard({ data }: { data: AttendanceDashboard }) {
  const { t } = useTranslation();
  const worded = useWorded();
  const rows = [...data.month]
    .sort(
      (a, b) =>
        b.lateDays - a.lateDays ||
        b.lateMinutes - a.lateMinutes ||
        a.presentDays / Math.max(1, a.workdays) - b.presentDays / Math.max(1, b.workdays),
    )
    .slice(0, 5);
  const first = data.month[0];
  return (
    <Card className="gap-2" role="region" aria-label={t('hr.dashboard.month.title')}>
      <CardHeader>
        <CardTitle>{t('hr.dashboard.month.title')}</CardTitle>
        {first ? (
          <p className="text-[0.75rem] text-muted-foreground">
            {t('hr.dashboard.month.hint', { from: first.from, to: first.to })}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('hr.dashboard.month.empty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.dashboard.month.employee')}</TableHead>
                <TableHead className="text-right">{t('hr.dashboard.month.rate')}</TableHead>
                <TableHead className="text-right">{t('hr.dashboard.month.lateDays')}</TableHead>
                <TableHead className="text-right">{t('hr.dashboard.month.lateMinutes')}</TableHead>
                <TableHead className="text-right">{t('hr.dashboard.month.avgArrival')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const rate = row.workdays === 0 ? 0 : row.presentDays / row.workdays;
                return (
                  <TableRow key={row.userId}>
                    <TableCell>
                      <Link
                        className="text-link underline-offset-2 hover:underline"
                        to={`/hr/attendance/days?userId=${row.userId}`}
                      >
                        {row.fullName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden
                          className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-fill sm:inline-block"
                        >
                          <span
                            className={cn(
                              'block h-full rounded-full',
                              rate >= 0.9
                                ? 'bg-success'
                                : rate >= 0.7
                                  ? 'bg-warning'
                                  : 'bg-destructive',
                            )}
                            style={{ width: `${Math.round(rate * 100)}%` }}
                          />
                        </span>
                        {t('hr.dashboard.month.rateValue', {
                          present: row.presentDays,
                          workdays: row.workdays,
                        })}
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono',
                        row.lateDays > 0 ? 'text-warning' : 'text-muted-foreground',
                      )}
                    >
                      {row.lateDays}
                    </TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">
                      {row.lateMinutes > 0 ? worded(row.lateMinutes) : t('common.none')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.avgArrivalMinutes === null
                        ? t('common.none')
                        : timeOf(row.avgArrivalMinutes)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ list */

const FILTERS = ['ALL', 'LATE', 'ABSENT', 'IN'] as const;
type Filter = (typeof FILTERS)[number];
const STATUS_ORDER = { ABSENT: 0, LATE: 1, PRESENT: 2, OFF: 3 } as const;

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'employee', kind: 'text', weight: 3, min: 14 },
  { key: 'status', kind: 'status', width: 11 },
  { key: 'firstIn', kind: 'code', width: 5 },
  { key: 'lastOut', kind: 'code', width: 5 },
  { key: 'worked', kind: 'code', width: 7.5 },
  { key: 'late', kind: 'code', width: 6 },
  { key: 'site', kind: 'text', weight: 2, min: 8 },
  { key: 'chevron', kind: 'chevron' },
];

function matches(row: AttendanceDashboardRow, filter: Filter): boolean {
  switch (filter) {
    case 'ALL':
      return true;
    case 'LATE':
      return row.status === 'LATE';
    case 'ABSENT':
      return row.status === 'ABSENT';
    case 'IN':
      return row.state === 'IN';
  }
}

function DayList({ data, today }: { data: AttendanceDashboard; today: boolean }) {
  const { t } = useTranslation();
  const worded = useWorded();
  const roleLabel = useRoleLabel();
  const [filter, setFilter] = useState<Filter>('ALL');
  const rows = [...data.rows]
    .filter((row) => matches(row, filter))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        b.lateMinutes - a.lateMinutes ||
        a.fullName.localeCompare(b.fullName),
    );
  const title = today
    ? t('hr.dashboard.list.title')
    : t('hr.dashboard.list.titleFor', { date: data.date });
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[1.0625rem] font-semibold">{title}</h2>
        <SegmentedControl
          options={FILTERS}
          value={filter}
          label={(value) => t(`hr.dashboard.list.filters.${value}`)}
          onChange={setFilter}
          name={t('hr.dashboard.list.status')}
        />
      </div>
      <ListCard>
        {data.rows.length === 0 ? (
          <EmptyState title={t('hr.dashboard.list.empty')} icon={Users} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('hr.dashboard.list.noMatch')}
            onClearFilters={() => setFilter('ALL')}
          />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.dashboard.list.employee')}</TableHead>
                <TableHead>{t('hr.dashboard.list.status')}</TableHead>
                <TableHead>{t('hr.dashboard.list.firstIn')}</TableHead>
                <TableHead>{t('hr.dashboard.list.lastOut')}</TableHead>
                <TableHead>{t('hr.dashboard.list.worked')}</TableHead>
                <TableHead>{t('hr.dashboard.list.late')}</TableHead>
                <TableHead>{t('hr.dashboard.list.site')}</TableHead>
                <ChevronHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <LinkRow key={row.userId} to={`/hr/attendance/days?userId=${row.userId}`}>
                  <TableCell>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={row.fullName} />
                      <span className="min-w-0">
                        <Link
                          className="block truncate font-medium text-link underline-offset-2 hover:underline"
                          to={`/hr/attendance/days?userId=${row.userId}`}
                          aria-label={t('hr.dashboard.list.open', { name: row.fullName })}
                        >
                          {row.fullName}
                        </Link>
                        <span className="block truncate text-[0.75rem] text-muted-foreground">
                          {roleLabel(row.roles)}
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} inNow={row.state === 'IN'} />
                  </TableCell>
                  <TableCell className="font-mono">
                    <TimeCell iso={row.firstIn} />
                  </TableCell>
                  <TableCell className="font-mono">
                    <TimeCell iso={row.lastOut} />
                  </TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {row.workedMinutes > 0 ? worded(row.workedMinutes) : t('common.none')}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'font-mono whitespace-nowrap',
                      row.lateMinutes > 0 && 'text-warning',
                    )}
                  >
                    {row.lateMinutes > 0 ? worded(row.lateMinutes) : t('common.none')}
                  </TableCell>
                  <TableCell className="truncate text-muted-foreground">
                    {row.siteName ?? t('common.none')}
                  </TableCell>
                </LinkRow>
              ))}
            </TableBody>
          </ListTable>
        )}
      </ListCard>
    </section>
  );
}

/* ------------------------------------------------------------------ page */

/**
 * «Ирцийн самбар» (ADR-0131, hr.attendance.view): one day's attendance at a glance — who is in,
 * who came late, who did not come — the fourteen-day trend and the month's figures per person.
 * The day is in the URL (`?date=`), today by default; the board refreshes every minute.
 */
export function AttendanceDashboardPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const today = businessDate();
  const date = search.get('date') ?? today;
  const valid = DATE.test(date);
  const dashboard = useAttendanceDashboard(valid ? date : null);
  const data = dashboard.data;
  const past = date < today;
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('hr.dashboard.title')}
        description={t('hr.dashboard.description')}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label={t('hr.dashboard.prevDay')}
              title={t('hr.dashboard.prevDay')}
              onClick={() => setParam('date', addDays(date, -1))}
            >
              <ChevronLeft />
            </Button>
            <Input
              type="date"
              aria-label={t('hr.dashboard.date')}
              className="w-40 font-mono"
              value={date}
              max={today}
              onChange={(event) => setParam('date', event.target.value || today)}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label={t('hr.dashboard.nextDay')}
              title={t('hr.dashboard.nextDay')}
              disabled={date >= today}
              onClick={() => setParam('date', addDays(date, 1))}
            >
              <ChevronRight />
            </Button>
            {date !== today ? (
              <Button variant="ghost" onClick={() => setParam('date', null)}>
                {t('hr.dashboard.today')}
              </Button>
            ) : null}
          </div>
        }
      />
      <ProblemAlert problem={problemFromError(dashboard.error)} onRetry={dashboard.refetch} />
      {dashboard.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : null}
      {data ? (
        <>
          <Tiles data={data} past={past} />
          <div className="grid gap-3 xl:grid-cols-2">
            <Card className="gap-2" role="region" aria-label={t('hr.dashboard.trend.title')}>
              <CardHeader>
                <CardTitle>{t('hr.dashboard.trend.title')}</CardTitle>
                <p className="text-[0.75rem] text-muted-foreground">
                  {t('hr.dashboard.trend.hint')}
                </p>
              </CardHeader>
              <CardContent>
                <TrendChart points={data.trend} />
              </CardContent>
            </Card>
            <MonthCard data={data} />
          </div>
          <DayList data={data} today={date === today} />
        </>
      ) : null}
    </div>
  );
}
