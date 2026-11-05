import { REPORT_STATUSES, type ReportStatus, WORKFORCE_LIMITS } from '@tugeel/shared/hr';
import { addDays, businessDate, businessMonthStart } from '@tugeel/shared/time';
import { CalendarRange, Download } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Combobox } from '@/components/combobox';
import {
  DateFilter,
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  SegmentedControl,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbTime } from '@/lib/dayjs';
import { saveBlob } from '@/lib/download';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useWorded, WEEKDAYS } from './hr-helpers';
import { Avatar } from './hr-kit';
import {
  type HrReportRow,
  useDivisions,
  useHrDownloads,
  useHrReport,
  useStaff,
} from './workforce-api';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TABS = ['days', 'employees', 'grid'] as const;
type Tab = (typeof TABS)[number];

const STATUS_VARIANT = {
  PRESENT: 'success',
  LATE: 'warning',
  ABSENT: 'destructive',
  OFF: 'outline',
  LEAVE: 'default',
  AWAY: 'secondary',
  OPEN: 'warning',
} as const satisfies Record<ReportStatus, string>;

const CELL_TONE: Record<ReportStatus, string> = {
  PRESENT: 'bg-success-soft text-success',
  LATE: 'bg-warning-soft text-warning',
  ABSENT: 'bg-danger-soft text-destructive',
  OFF: 'text-muted-foreground/60',
  LEAVE: 'bg-info-soft text-link',
  AWAY: 'bg-fill text-foreground',
  OPEN: 'bg-warning-soft text-warning',
};

const DAY_COLUMNS: readonly ColumnSpec[] = [
  { key: 'date', kind: 'date', width: 8.25 },
  { key: 'employee', kind: 'text', weight: 3, min: 12 },
  { key: 'plan', kind: 'code', width: 7.5 },
  { key: 'firstIn', kind: 'code', width: 5 },
  { key: 'lastOut', kind: 'code', width: 5 },
  { key: 'arrival', kind: 'text', weight: 1, min: 7 },
  { key: 'worked', kind: 'code', width: 7.5 },
  { key: 'overtime', kind: 'code', width: 6.5 },
  { key: 'status', kind: 'status', width: 9 },
  { key: 'request', kind: 'text', weight: 1, min: 7 },
];

const EMPLOYEE_COLUMNS: readonly ColumnSpec[] = [
  { key: 'employee', kind: 'text', weight: 3, min: 12 },
  { key: 'division', kind: 'text', weight: 2, min: 8 },
  { key: 'workdays', kind: 'count', width: 6 },
  { key: 'present', kind: 'count', width: 5.5 },
  { key: 'lateDays', kind: 'count', width: 6.5 },
  { key: 'absent', kind: 'count', width: 6 },
  { key: 'leave', kind: 'count', width: 5 },
  { key: 'scheduled', kind: 'code', width: 8 },
  { key: 'worked', kind: 'code', width: 8 },
  { key: 'late', kind: 'code', width: 7 },
  { key: 'overtime', kind: 'code', width: 7 },
  { key: 'rate', kind: 'percent' },
];

interface EmployeeTotals {
  userId: number;
  fullName: string;
  photoUrl: string | null;
  divisionName: string | null;
  workdays: number;
  present: number;
  lateDays: number;
  absent: number;
  leave: number;
  scheduled: number;
  worked: number;
  late: number;
  overtime: number;
}

function totalsByEmployee(rows: readonly HrReportRow[]): EmployeeTotals[] {
  const byUser = new Map<number, EmployeeTotals>();
  for (const row of rows) {
    let entry = byUser.get(row.userId);
    if (!entry) {
      entry = {
        userId: row.userId,
        fullName: row.fullName,
        photoUrl: row.photoUrl,
        divisionName: row.divisionName,
        workdays: 0,
        present: 0,
        lateDays: 0,
        absent: 0,
        leave: 0,
        scheduled: 0,
        worked: 0,
        late: 0,
        overtime: 0,
      };
      byUser.set(row.userId, entry);
    }
    if (row.scheduledMinutes > 0) entry.workdays += 1;
    if (row.status === 'PRESENT' || row.status === 'LATE' || row.status === 'AWAY')
      entry.present += 1;
    if (row.status === 'LATE') entry.lateDays += 1;
    if (row.status === 'ABSENT') entry.absent += 1;
    if (row.status === 'LEAVE') entry.leave += 1;
    entry.scheduled += row.scheduledMinutes;
    entry.worked += row.workedMinutes;
    entry.late += row.lateMinutes;
    entry.overtime += row.overtimeMinutes;
  }
  return [...byUser.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'mn'));
}

function datesOf(from: string, to: string): string[] {
  const dates: string[] = [];
  for (
    let date = from;
    date <= to && dates.length <= WORKFORCE_LIMITS.maxReportDays;
    date = addDays(date, 1)
  ) {
    dates.push(date);
  }
  return dates;
}

function weekdayKey(date: string): (typeof WEEKDAYS)[number] {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return WEEKDAYS[day === 0 ? 6 : day - 1] ?? 'd0';
}

function Tile(props: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-control">
      <p className="text-xs text-muted-foreground">{props.label}</p>
      <p className={cn('mt-1 font-mono text-lg font-semibold', props.tone)}>{props.value}</p>
      {props.hint ? <p className="text-xs text-muted-foreground">{props.hint}</p> : null}
    </div>
  );
}

/**
 * «Цагийн тайлан» (ADR-0144, hr.attendance.view): a period of at most 62 days of every tracked
 * employee — the schedule's hours, the punches and the approved requests — as days, as one row per
 * employee, or as a grid of letters (timely's «Ерөнхий»), with the period's tiles and Excel.
 */
export function HrReportPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const worded = useWorded();
  const today = businessDate();
  const from = search.get('from') ?? businessMonthStart();
  const to = search.get('to') ?? today;
  const tabParam = search.get('tab');
  const tab: Tab = TABS.find((value) => value === tabParam) ?? 'days';
  const divisionParam = search.get('division') ?? '';
  const userParam = search.get('userId') ?? '';
  const validRange = DATE.test(from) && DATE.test(to) && from <= to;
  const tooLong = validRange && addDays(from, WORKFORCE_LIMITS.maxReportDays - 1) < to;
  const query = {
    from,
    to,
    divisionId: /^\d+$/.test(divisionParam) ? Number(divisionParam) : undefined,
    userId: /^\d+$/.test(userParam) ? Number(userParam) : undefined,
  };
  const report = useHrReport(query, validRange && !tooLong);
  const divisions = useDivisions();
  const staff = useStaff();
  const downloads = useHrDownloads();
  const rows = useMemo(() => report.data?.rows ?? [], [report.data]);
  const totals = report.data?.totals;
  const employees = useMemo(() => totalsByEmployee(rows), [rows]);
  const dates = useMemo(
    () => (validRange && !tooLong ? datesOf(from, to) : []),
    [from, to, validRange, tooLong],
  );
  const cells = useMemo(() => {
    const map = new Map<string, HrReportRow>();
    for (const row of rows) map.set(`${row.userId}:${row.date}`, row);
    return map;
  }, [rows]);
  const dayRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) => b.date.localeCompare(a.date) || a.fullName.localeCompare(b.fullName, 'mn'),
      ),
    [rows],
  );
  const timeText = (minutes: number) => (minutes > 0 ? worded(minutes) : t('common.none'));

  const exportReport = async () => {
    try {
      saveBlob(
        await downloads.report.mutateAsync(query),
        `${t('hr.report.title')} ${from} – ${to}.xlsx`,
      );
    } catch {
      toast.warning(t('common.retry'));
    }
  };

  const arrivalText = (row: HrReportRow): string | null => {
    if (row.arrivalDiff === null) return null;
    if (row.arrivalDiff > 0) return t('hr.report.lateBy', { minutes: row.arrivalDiff });
    if (row.arrivalDiff < 0) return t('hr.report.early', { minutes: -row.arrivalDiff });
    return null;
  };

  return (
    <div>
      <PageHeader
        title={t('hr.report.title')}
        description={t('hr.report.description')}
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!report.data}
            pending={downloads.report.isPending}
            onClick={() => void exportReport()}
          >
            <Download />
            {t('hr.report.export')}
          </Button>
        }
      />
      <FilterBar
        end={
          <SegmentedControl
            options={TABS}
            value={tab}
            label={(value) => t(`hr.report.tabs.${value}`)}
            onChange={(value) => setParam('tab', value === 'days' ? null : value)}
          />
        }
      >
        <DateFilter
          label={t('hr.report.from')}
          value={from}
          onChange={(value) => setParam('from', value ?? null)}
        />
        <DateFilter
          label={t('hr.report.to')}
          value={to}
          onChange={(value) => setParam('to', value ?? null)}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('hr.report.division')}
          value={divisionParam}
          onChange={(event) => setParam('division', event.target.value || null)}
        >
          <option value="">{t('hr.report.allDivisions')}</option>
          {(divisions.data ?? []).map((division) => (
            <option key={division.id} value={division.id}>
              {division.name}
            </option>
          ))}
        </NativeSelect>
        <Combobox
          aria-label={t('hr.report.employee')}
          value={userParam}
          emptyLabel={t('hr.report.allEmployees')}
          options={(staff.data ?? [])
            .filter((row) => row.tracked)
            .map((row) => ({
              value: String(row.userId),
              label: row.fullName,
              hint: row.divisionName ?? undefined,
            }))}
          onChange={(value) => setParam('userId', value || null)}
        />
      </FilterBar>
      {tooLong ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{t('hr.report.rangeTooLong')}</AlertDescription>
        </Alert>
      ) : null}
      <ProblemAlert problem={problemFromError(report.error)} onRetry={report.refetch} />
      {totals ? (
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Tile label={t('hr.report.tiles.scheduled')} value={timeText(totals.scheduledMinutes)} />
          <Tile
            label={t('hr.report.tiles.worked')}
            value={timeText(totals.workedMinutes)}
            tone="text-success"
          />
          <Tile
            label={t('hr.report.tiles.late')}
            value={timeText(totals.lateMinutes)}
            hint={t('hr.report.tiles.lateDays', { count: totals.lateDays })}
            tone={totals.lateMinutes > 0 ? 'text-warning' : undefined}
          />
          <Tile
            label={t('hr.report.tiles.absent')}
            value={String(totals.absentDays)}
            tone={totals.absentDays > 0 ? 'text-destructive' : undefined}
          />
          <Tile
            label={t('hr.report.tiles.leave')}
            value={String(totals.leaveDays)}
            tone="text-link"
          />
          <Tile label={t('hr.report.tiles.overtime')} value={timeText(totals.overtimeMinutes)} />
        </div>
      ) : null}
      <ListCard scroll>
        {report.data && rows.length === 0 ? (
          <EmptyState title={t('hr.report.empty')} icon={CalendarRange} />
        ) : null}
        {tab === 'days' && (rows.length > 0 || report.isPending) ? (
          <ListTable columns={DAY_COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.report.columns.date')}</TableHead>
                <TableHead>{t('hr.report.columns.employee')}</TableHead>
                <TableHead>{t('hr.report.columns.plan')}</TableHead>
                <TableHead>{t('hr.report.columns.firstIn')}</TableHead>
                <TableHead>{t('hr.report.columns.lastOut')}</TableHead>
                <TableHead>{t('hr.report.columns.arrival')}</TableHead>
                <TableHead>{t('hr.report.columns.worked')}</TableHead>
                <TableHead>{t('hr.report.columns.overtime')}</TableHead>
                <TableHead>{t('hr.report.columns.status')}</TableHead>
                <TableHead>{t('hr.report.columns.request')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.isPending ? <SkeletonRows columns={10} /> : null}
              {dayRows.map((row) => {
                const arrival = arrivalText(row);
                return (
                  <TableRow key={`${row.userId}:${row.date}`}>
                    <TableCell className="font-mono">{row.date}</TableCell>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar
                          name={row.fullName}
                          src={row.photoUrl}
                          className="size-7 text-[0.6875rem]"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{row.fullName}</p>
                          {row.divisionName ? (
                            <p className="truncate text-[0.6875rem] text-muted-foreground">
                              {row.divisionName}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[0.75rem]">
                      {row.flexible
                        ? t('hr.report.flexible', {
                            hours: +(row.scheduledMinutes / 60).toFixed(1),
                          })
                        : row.planStart && row.planEnd
                          ? `${row.planStart}–${row.planEnd}`
                          : t('common.none')}
                    </TableCell>
                    <TableCell className="font-mono">
                      {row.firstIn ? formatUbTime(row.firstIn) : t('common.none')}
                    </TableCell>
                    <TableCell className="font-mono">
                      {row.lastOut ? formatUbTime(row.lastOut) : t('common.none')}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-[0.75rem]',
                        row.arrivalDiff !== null && row.arrivalDiff > 0
                          ? 'text-warning'
                          : 'text-muted-foreground',
                      )}
                    >
                      {arrival ?? t('common.none')}
                    </TableCell>
                    <TableCell className="font-mono whitespace-nowrap">
                      {timeText(row.workedMinutes)}
                    </TableCell>
                    <TableCell className="font-mono whitespace-nowrap">
                      {timeText(row.overtimeMinutes)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status]}>
                        {t(`hr.reportStatuses.${row.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="truncate text-muted-foreground">
                      {row.requestName ?? t('common.none')}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </ListTable>
        ) : null}
        {tab === 'employees' && employees.length > 0 ? (
          <ListTable columns={EMPLOYEE_COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.report.columns.employee')}</TableHead>
                <TableHead>{t('hr.report.columns.division')}</TableHead>
                <TableHead className="text-right">{t('hr.report.columns.workdays')}</TableHead>
                <TableHead className="text-right">{t('hr.report.columns.present')}</TableHead>
                <TableHead className="text-right">{t('hr.report.columns.lateDays')}</TableHead>
                <TableHead className="text-right">{t('hr.report.columns.absent')}</TableHead>
                <TableHead className="text-right">{t('hr.report.columns.leave')}</TableHead>
                <TableHead>{t('hr.report.columns.scheduled')}</TableHead>
                <TableHead>{t('hr.report.columns.worked')}</TableHead>
                <TableHead>{t('hr.report.columns.late')}</TableHead>
                <TableHead>{t('hr.report.columns.overtime')}</TableHead>
                <TableHead className="text-right">{t('hr.report.columns.rate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((entry) => (
                <TableRow key={entry.userId}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar
                        name={entry.fullName}
                        src={entry.photoUrl}
                        className="size-7 text-[0.6875rem]"
                      />
                      <span className="truncate font-medium">{entry.fullName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="truncate text-muted-foreground">
                    {entry.divisionName ?? t('common.none')}
                  </TableCell>
                  <TableCell className="text-right font-mono">{entry.workdays}</TableCell>
                  <TableCell className="text-right font-mono">{entry.present}</TableCell>
                  <TableCell
                    className={cn('text-right font-mono', entry.lateDays > 0 && 'text-warning')}
                  >
                    {entry.lateDays}
                  </TableCell>
                  <TableCell
                    className={cn('text-right font-mono', entry.absent > 0 && 'text-destructive')}
                  >
                    {entry.absent}
                  </TableCell>
                  <TableCell className="text-right font-mono">{entry.leave}</TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {timeText(entry.scheduled)}
                  </TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {timeText(entry.worked)}
                  </TableCell>
                  <TableCell
                    className={cn('font-mono whitespace-nowrap', entry.late > 0 && 'text-warning')}
                  >
                    {timeText(entry.late)}
                  </TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {timeText(entry.overtime)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {entry.scheduled > 0
                      ? `${Math.round((Math.min(entry.worked, entry.scheduled) / entry.scheduled) * 100)}%`
                      : t('common.none')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ListTable>
        ) : null}
        {tab === 'grid' && employees.length > 0 ? (
          <div>
            <table className="w-full border-separate border-spacing-0 text-[0.75rem]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th className="sticky left-0 z-10 min-w-44 border-b bg-card px-3 py-2 text-left font-semibold">
                    {t('hr.report.columns.employee')}
                  </th>
                  {dates.map((date) => {
                    const weekday = weekdayKey(date);
                    return (
                      <th
                        key={date}
                        className={cn(
                          'min-w-8 border-b px-0.5 py-1 text-center font-medium',
                          (weekday === 'd5' || weekday === 'd6') && 'text-muted-foreground',
                        )}
                      >
                        <span className="block text-[0.625rem]">{t(`hr.weekdays.${weekday}`)}</span>
                        <span className="font-mono">{date.slice(8)}</span>
                      </th>
                    );
                  })}
                  <th className="border-b px-2 py-1 text-right font-semibold">
                    {t('hr.report.columns.worked')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.map((entry) => (
                  <tr key={entry.userId}>
                    <th
                      scope="row"
                      className="sticky left-0 z-[1] border-b bg-card px-3 py-1.5 text-left font-normal"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar
                          name={entry.fullName}
                          src={entry.photoUrl}
                          className="size-6 text-[0.625rem]"
                        />
                        <span className="truncate font-medium">{entry.fullName}</span>
                      </span>
                    </th>
                    {dates.map((date) => {
                      const cell = cells.get(`${entry.userId}:${date}`);
                      return (
                        <td key={date} className="border-b px-0.5 py-1 text-center">
                          {cell ? (
                            <span
                              className={cn(
                                'mx-auto grid size-6 place-items-center rounded-md font-semibold',
                                CELL_TONE[cell.status],
                              )}
                              title={`${date} · ${t(`hr.reportStatuses.${cell.status}`)}${
                                cell.requestName ? ` · ${cell.requestName}` : ''
                              }${cell.workedMinutes > 0 ? ` · ${worded(cell.workedMinutes)}` : ''}`}
                            >
                              {t(`hr.report.letters.${cell.status}`)}
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                    <td className="border-b px-2 py-1 text-right font-mono whitespace-nowrap">
                      {timeText(entry.worked)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center gap-3 border-t px-3 py-2 text-[0.75rem] text-muted-foreground">
              <span>{t('hr.report.legend')}:</span>
              {REPORT_STATUSES.map((status) => (
                <span key={status} className="inline-flex items-center gap-1.5">
                  <span
                    className={cn(
                      'grid size-5 place-items-center rounded font-semibold',
                      CELL_TONE[status],
                    )}
                  >
                    {t(`hr.report.letters.${status}`)}
                  </span>
                  {t(`hr.reportStatuses.${status}`)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </ListCard>
    </div>
  );
}
