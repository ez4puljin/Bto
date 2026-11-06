import { businessDate } from '@tugeel/shared/time';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { DateFilter, FilterBar, SegmentedControl } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { saveBlob } from '@/lib/download';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useHrDownloads } from '../workforce-api';
import { AttendanceTab } from './attendance-tab';
import { ATTENDANCE_STARTED, clampAttendanceRange } from './insights-format';
import { RequestsTab } from './requests-tab';
import { WorkforceTab } from './workforce-tab';

/*
 * «Хянах самбар» (ADR-0146 #5): the workforce, attendance and requests in figures that move. The
 * tab and the range live in the URL; the first load of each tab is its own read.
 */

const TABS = ['people', 'attendance', 'requests'] as const;
type Tab = (typeof TABS)[number];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR = /^\d{4}$/;
const YEARS_BACK = 5;

function usableDate(value: string | null): string | null {
  return value !== null && DATE.test(value) ? value : null;
}

export function InsightsPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const downloads = useHrDownloads();

  const tabParam = search.get('tab');
  const tab: Tab = TABS.find((value) => value === tabParam) ?? 'people';

  const today = businessDate();
  const first = usableDate(search.get('from')) ?? `${today.slice(0, 8)}01`;
  const last = usableDate(search.get('to')) ?? today;
  const from = first <= last ? first : last;
  const to = first <= last ? last : first;
  const attendance = clampAttendanceRange(from, to, today);

  const thisYear = Number.parseInt(today.slice(0, 4), 10);
  const yearParam = search.get('year');
  const year =
    yearParam !== null && YEAR.test(yearParam) ? Number.parseInt(yearParam, 10) : thisYear;
  const years = Array.from({ length: YEARS_BACK }, (_, index) => thisYear - index);
  if (!years.includes(year)) years.push(year);

  const download = async () => {
    try {
      saveBlob(await downloads.staff.mutateAsync(), `${t('hr.insights.excelFile')}.xlsx`);
    } catch {
      toast.warning(t('common.retry'));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.hrInsights')}
        description={t('hr.insights.description')}
        actions={
          <Button
            variant="outline"
            pending={downloads.staff.isPending}
            onClick={() => void download()}
          >
            <Download aria-hidden />
            {t('hr.insights.excel')}
          </Button>
        }
      />

      <FilterBar
        end={
          <SegmentedControl
            options={TABS}
            value={tab}
            name={t('hr.insights.tabs.name')}
            label={(value) => t(`hr.insights.tabs.${value}`)}
            onChange={(value) => setParam('tab', value === 'people' ? null : value)}
          />
        }
      >
        {tab === 'requests' ? (
          <NativeSelect
            variant="filter"
            active={false}
            aria-label={t('hr.insights.year')}
            value={String(year)}
            onChange={(event) => setParam('year', event.target.value)}
          >
            {years.map((value) => (
              <option key={value} value={value}>
                {t('common.calendar.year', { year: value })}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <>
            <DateFilter
              label={t('hr.insights.from')}
              value={from}
              onChange={(value) => setParam('from', value)}
            />
            <DateFilter
              label={t('hr.insights.to')}
              value={to}
              onChange={(value) => setParam('to', value)}
            />
          </>
        )}
      </FilterBar>

      {tab === 'people' ? <WorkforceTab from={from} to={to} /> : null}
      {tab === 'attendance' ? (
        <AttendanceTab
          from={attendance.from}
          to={attendance.to}
          clamped={attendance.clamped}
          startNote={t('hr.insights.attendance.started', { date: ATTENDANCE_STARTED })}
        />
      ) : null}
      {tab === 'requests' ? <RequestsTab year={year} /> : null}
    </div>
  );
}
