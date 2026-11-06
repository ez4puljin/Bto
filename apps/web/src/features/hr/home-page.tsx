import { ENGAGEMENT_LIMITS } from '@tugeel/shared/hr';
import { addDays, businessDate, businessMonthStart } from '@tugeel/shared/time';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  HeartHandshake,
  MapPin,
  MessagesSquare,
  Newspaper,
  type LucideIcon,
  Send,
  UserCheck,
  Vote,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { EChart } from '@/components/chart/echart';
import { FormField } from '@/components/form';
import { EmptyState, SegmentedControl } from '@/components/list';
import { GeoMap, type MapPoint } from '@/components/map/geo-map';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatUbMinute, formatUbTime } from '@/lib/dayjs';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import { useAttendanceDashboard, useWorkSites } from './api';
import { CalendarItemLine } from './community/calendar-page';
import {
  CALENDAR_MARKS,
  FEEDBACK_STATUS_VARIANT,
  isOnDay,
  messageState,
  MOOD_FACES,
  percentOf,
  sharePoint,
} from './community/community-helpers';
import { PeoplePicker, PersonLine, ShareBar } from './community/community-kit';
import { MonthGrid } from './community/month-grid';
import { OptionBars } from './community/polls-page';
import {
  useEngagementMutations,
  useHrCalendar,
  useHrFeedback,
  useHrMessages,
  useHrMoods,
  useHrPolls,
  useHrShares,
  useHrThanks,
} from './engagement-api';
import { useRequestWhen } from './request-helpers';
import { useStaff, useTimeRequests } from './workforce-api';

/** A card of the page: a title linking on to its page, and a body that scrolls inside it. */
function HomeCard(props: {
  title: string;
  to?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card className={cn('h-[23rem] min-w-0 gap-3 pb-0', props.className)}>
      <CardHeader className="flex min-h-9 items-center justify-between gap-2">
        <CardTitle className="min-w-0 truncate">
          {props.to ? (
            <Link
              to={props.to}
              className="group inline-flex items-center gap-1 hover:text-link"
              aria-label={t('hr.home.openPage', { title: props.title })}
            >
              {props.title}
              <ChevronRight
                aria-hidden
                className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-link"
              />
            </Link>
          ) : (
            props.title
          )}
        </CardTitle>
        {props.action ? (
          <div className="shrink-0 [&_button]:px-2.5 [&_button]:whitespace-nowrap">
            {props.action}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto pb-4 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
        {props.children}
      </CardContent>
    </Card>
  );
}

/** What a card says while it has nothing: a quiet centred line. */
function Empty({ title, icon }: { title: string; icon: LucideIcon }) {
  return (
    <div className="grid h-full place-items-center">
      <EmptyState title={title} icon={icon} />
    </div>
  );
}

function Loading() {
  const { t } = useTranslation();
  return (
    <p role="status" className="text-[0.8125rem] text-muted-foreground">
      {t('common.loading')}
    </p>
  );
}

/* ---------------------------------------------------------------- attendance */

function AttendanceCard({ today }: { today: string }) {
  const { t } = useTranslation();
  const board = useAttendanceDashboard(today);
  const counts = board.data?.counts;
  const onTime = counts ? Math.max(0, counts.present - counts.late) : 0;
  const parts = counts
    ? [
        { key: 'onTime' as const, value: onTime, dot: 'bg-success' },
        { key: 'late' as const, value: counts.late, dot: 'bg-warning' },
        { key: 'absent' as const, value: counts.absent, dot: 'bg-destructive' },
      ]
    : [];
  const label = t('hr.home.attendance.title');
  return (
    <HomeCard title={label} to="/hr/attendance">
      <ProblemAlert problem={problemFromError(board.error)} onRetry={board.refetch} />
      {counts ? (
        <div className="flex h-full flex-col items-center justify-center gap-3">
          <div className="relative w-full max-w-60">
            <EChart
              label={label}
              height={176}
              option={(colors) => ({
                tooltip: { trigger: 'item' },
                series: [
                  {
                    type: 'pie',
                    radius: ['68%', '90%'],
                    avoidLabelOverlap: false,
                    label: { show: false },
                    itemStyle: { borderColor: colors.surface, borderWidth: 2, borderRadius: 5 },
                    data: [
                      {
                        name: t('hr.home.attendance.onTime'),
                        value: onTime,
                        itemStyle: { color: colors.good },
                      },
                      {
                        name: t('hr.home.attendance.late'),
                        value: counts.late,
                        itemStyle: { color: colors.warn },
                      },
                      {
                        name: t('hr.home.attendance.absent'),
                        value: counts.absent,
                        itemStyle: { color: colors.bad },
                      },
                    ],
                  },
                ],
              })}
            >
              <ul>
                {parts.map((part) => (
                  <li key={part.key}>
                    {t(`hr.home.attendance.${part.key}`)}: {formatCount(part.value)}
                  </li>
                ))}
              </ul>
            </EChart>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
            >
              <span className="font-mono text-2xl font-semibold">
                {t('hr.home.ofTotal', {
                  value: formatCount(counts.present),
                  total: formatCount(counts.expected),
                })}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('hr.home.attendance.arrived')}
              </span>
            </div>
          </div>
          <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[0.8125rem]">
            {parts.map((part) => (
              <li key={part.key} className="flex items-center gap-1.5">
                <span aria-hidden className={cn('size-2 rounded-full', part.dot)} />
                <span className="text-muted-foreground">{t(`hr.home.attendance.${part.key}`)}</span>
                <span className="font-mono font-semibold">{formatCount(part.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : board.isPending ? (
        <Loading />
      ) : null}
    </HomeCard>
  );
}

const ARRIVAL_VIEWS = ['LIST', 'MAP'] as const;

function ArrivalsCard({ today }: { today: string }) {
  const { t } = useTranslation();
  const board = useAttendanceDashboard(today);
  const sites = useWorkSites();
  const staff = useStaff();
  const [view, setView] = useState<(typeof ARRIVAL_VIEWS)[number]>('LIST');
  const photos = useMemo(
    () => new Map((staff.data ?? []).map((row) => [row.userId, row.photoUrl])),
    [staff.data],
  );
  const arrivals = useMemo(
    () =>
      (board.data?.rows ?? [])
        .filter((row) => row.firstIn !== null)
        .sort((a, b) => (b.firstIn ?? '').localeCompare(a.firstIn ?? '')),
    [board.data],
  );
  const points = useMemo<MapPoint[]>(
    () =>
      (sites.data ?? []).map((site) => ({
        id: String(site.id),
        lat: Number.parseFloat(site.lat),
        lng: Number.parseFloat(site.lng),
        label: t('hr.home.arrivals.sitePoint', {
          name: site.name,
          count: arrivals.filter((row) => row.siteName === site.name).length,
        }),
        radiusM: site.radiusM,
      })),
    [sites.data, arrivals, t],
  );
  return (
    <HomeCard
      title={t('hr.home.arrivals.title')}
      to="/hr/attendance"
      action={
        <SegmentedControl
          name={t('hr.home.arrivals.view')}
          options={ARRIVAL_VIEWS}
          value={view}
          label={(value) => t(`hr.home.arrivals.views.${value}`)}
          onChange={setView}
        />
      }
    >
      {view === 'MAP' ? (
        <GeoMap
          points={points}
          label={t('hr.home.arrivals.mapLabel')}
          className="h-full min-h-56"
        />
      ) : arrivals.length === 0 ? (
        board.isPending ? (
          <Loading />
        ) : (
          <Empty title={t('hr.home.arrivals.empty')} icon={UserCheck} />
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {arrivals.map((row) => (
            <li key={row.userId} className="flex items-center justify-between gap-2">
              <PersonLine name={row.fullName} photoUrl={photos.get(row.userId)} />
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[0.8125rem]">
                  {row.firstIn ? formatUbTime(row.firstIn) : t('common.none')}
                </span>
                <span
                  role="img"
                  aria-label={t(`hr.statuses.${row.status}`)}
                  title={t(`hr.statuses.${row.status}`)}
                  className={cn(
                    'size-2.5 rounded-full',
                    row.status === 'LATE' ? 'bg-warning' : 'bg-success',
                  )}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}

function RequestsCard({ today }: { today: string }) {
  const { t } = useTranslation();
  const requests = useTimeRequests({ from: today, to: today });
  const when = useRequestWhen();
  const rows = requests.data ?? [];
  return (
    <HomeCard title={t('hr.home.requests.title')} to="/hr/requests">
      <ProblemAlert problem={problemFromError(requests.error)} onRetry={requests.refetch} />
      {requests.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title={t('hr.home.requests.empty')} icon={ClipboardList} />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((request) => (
            <li key={request.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{request.fullName}</p>
                <p className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: request.color }}
                  />
                  <span className="truncate" title={when(request)}>
                    {request.typeName}
                  </span>
                </p>
              </div>
              <Badge
                variant={
                  request.status === 'PENDING'
                    ? 'warning'
                    : request.status === 'APPROVED'
                      ? 'success'
                      : request.status === 'REJECTED'
                        ? 'destructive'
                        : 'outline'
                }
              >
                {t(`hr.requestStatuses.${request.status}`)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}

/* ------------------------------------------------------------------- notice */

/** «Мэдэгдэл илгээх»: a title, the text, people if not everybody; goes at once. */
function SendNoticeCard() {
  const { t } = useTranslation();
  const mutations = useEngagementMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [people, setPeople] = useState<number[]>([]);
  const [tried, setTried] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (title.trim() === '' || body.trim() === '') return;
    const ok = await action.run(() =>
      mutations.createMessage.mutateAsync({
        key,
        kind: 'NOTICE',
        title: title.trim(),
        body: body.trim(),
        popup: true,
        userIds: people,
      }),
    );
    if (ok) {
      toast.success(t('hr.home.notice.sent'));
      setKey(randomUuid());
      setTitle('');
      setBody('');
      setPeople([]);
      setTried(false);
    }
  };
  return (
    <HomeCard title={t('hr.home.notice.title')} to="/hr/notices">
      <form className="flex flex-col gap-2.5" noValidate onSubmit={(event) => void submit(event)}>
        <ProblemAlert problem={action.problem} />
        <FormField
          label={t('hr.home.notice.subject')}
          htmlFor="home-notice-title"
          error={tried && title.trim() === '' ? 'validation.required' : undefined}
        >
          <Input
            id="home-notice-title"
            maxLength={ENGAGEMENT_LIMITS.maxTitle}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <FormField
          label={t('hr.home.notice.body')}
          htmlFor="home-notice-body"
          error={tried && body.trim() === '' ? 'validation.required' : undefined}
        >
          <Textarea
            id="home-notice-body"
            rows={2}
            maxLength={ENGAGEMENT_LIMITS.maxBody}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </FormField>
        <PeoplePicker label={t('hr.home.notice.people')} value={people} onChange={setPeople} />
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-xs text-muted-foreground">
            {people.length === 0
              ? t('hr.home.notice.toAll')
              : t('hr.home.notice.toChosen', { count: people.length })}
          </p>
          <Button type="submit" size="sm" pending={mutations.createMessage.isPending}>
            <Send />
            {t('hr.home.notice.send')}
          </Button>
        </div>
      </form>
    </HomeCard>
  );
}

/* -------------------------------------------------------------------- moods */

const MOOD_RANGES = ['TODAY', 'WEEK', 'MONTH'] as const;
const RANGE_DAYS = { TODAY: 0, WEEK: 6, MONTH: 29 } as const;

function MoodCard({ today }: { today: string }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<(typeof MOOD_RANGES)[number]>('TODAY');
  const moods = useHrMoods(addDays(today, -RANGE_DAYS[range]), today);
  const total = moods.data?.total ?? 0;
  const countOf = (score: number) =>
    moods.data?.scores.find((row) => row.score === score)?.count ?? 0;
  return (
    <HomeCard
      title={t('hr.home.moods.title')}
      action={
        <SegmentedControl
          name={t('hr.home.moods.range')}
          options={MOOD_RANGES}
          value={range}
          label={(value) => t(`hr.home.moods.ranges.${value}`)}
          onChange={setRange}
        />
      }
    >
      <ProblemAlert problem={problemFromError(moods.error)} onRetry={moods.refetch} />
      {moods.isPending ? (
        <Loading />
      ) : (
        <div className="flex h-full flex-col justify-center gap-3">
          <ul className="flex flex-col gap-2.5">
            {MOOD_FACES.map((face) => {
              const Icon = face.icon;
              const count = countOf(face.score);
              return (
                <li key={face.score} className="flex items-center gap-2.5">
                  <Icon
                    role="img"
                    aria-label={t(`hr.home.moods.faces.${face.score}`)}
                    className={cn('size-6 shrink-0', face.text)}
                  />
                  <div
                    aria-hidden
                    className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-fill"
                  >
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-500 ease-apple',
                        face.bar,
                      )}
                      style={{ width: `${percentOf(count, total)}%` }}
                    />
                  </div>
                  <span className="w-7 shrink-0 text-right font-mono text-[0.8125rem] font-semibold">
                    {formatCount(count)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            {t('hr.home.moods.total', { count: total })}
          </p>
        </div>
      )}
    </HomeCard>
  );
}

/* ----------------------------------------------------------------- feedback */

function FeedbackCard() {
  const { t } = useTranslation();
  const feedback = useHrFeedback({});
  const rows = feedback.data ?? [];
  const [index, setIndex] = useState(0);
  const at = Math.min(index, Math.max(0, rows.length - 1));
  const row = rows[at];
  return (
    <HomeCard
      title={t('hr.home.feedback.title')}
      to="/hr/feedback"
      action={
        rows.length > 1 ? (
          <span className="flex items-center gap-1">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t('hr.home.feedback.newer')}
              disabled={at === 0}
              onClick={() => setIndex(at - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="font-mono text-xs text-muted-foreground">
              {t('hr.home.ofTotal', { value: at + 1, total: rows.length })}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t('hr.home.feedback.older')}
              disabled={at >= rows.length - 1}
              onClick={() => setIndex(at + 1)}
            >
              <ChevronRight />
            </Button>
          </span>
        ) : null
      }
    >
      <ProblemAlert problem={problemFromError(feedback.error)} onRetry={feedback.refetch} />
      {feedback.isPending ? (
        <Loading />
      ) : !row ? (
        <Empty title={t('hr.home.feedback.empty')} icon={MessagesSquare} />
      ) : (
        <article className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">
              {t(`hr.community.feedback.categories.${row.category}`)}
            </Badge>
            <Badge variant={FEEDBACK_STATUS_VARIANT[row.status]}>
              {t(`hr.community.feedback.statuses.${row.status}`)}
            </Badge>
          </div>
          <h3 className="font-semibold">{row.title}</h3>
          <p className="text-[0.8125rem] whitespace-pre-wrap">{row.body}</p>
          <p className="text-xs text-muted-foreground">
            {row.fullName ?? t('hr.community.feedback.anonymous')} · {formatUbMinute(row.createdAt)}
          </p>
        </article>
      )}
    </HomeCard>
  );
}

/* --------------------------------------------------------------------- vote */

function VoteCard() {
  const { t } = useTranslation();
  const polls = useHrPolls('VOTE');
  const running = polls.data?.find((poll) => poll.open) ?? polls.data?.[0];
  const question = running?.questions[0];
  return (
    <HomeCard title={t('hr.home.vote.title')} to="/hr/polls">
      <ProblemAlert problem={problemFromError(polls.error)} onRetry={polls.refetch} />
      {polls.isPending ? (
        <Loading />
      ) : !running || !question ? (
        <Empty title={t('hr.home.vote.empty')} icon={Vote} />
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="font-semibold">{running.title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {running.open ? t('hr.home.vote.running') : t('hr.home.vote.ended')} ·{' '}
              {t('hr.home.vote.respondents', {
                value: running.respondents,
                total: running.recipients,
              })}
            </p>
          </div>
          <OptionBars question={question} />
        </div>
      )}
    </HomeCard>
  );
}

/* ------------------------------------------------------------------- thanks */

function ThanksCard({ today }: { today: string }) {
  const { t } = useTranslation();
  const thanks = useHrThanks(businessMonthStart(), today);
  const ranking = thanks.data?.ranking ?? [];
  const items = thanks.data?.items ?? [];
  const top = ranking[0]?.count ?? 0;
  return (
    <HomeCard title={t('hr.home.thanks.title')}>
      <ProblemAlert problem={problemFromError(thanks.error)} onRetry={thanks.refetch} />
      {thanks.isPending ? (
        <Loading />
      ) : ranking.length === 0 && items.length === 0 ? (
        <Empty title={t('hr.home.thanks.empty')} icon={HeartHandshake} />
      ) : (
        <div className="flex flex-col gap-3">
          <ol className="flex flex-col gap-2">
            {ranking.slice(0, 3).map((row) => (
              <li key={row.userId} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <PersonLine name={row.fullName} photoUrl={row.photoUrl} />
                  <span className="shrink-0 font-mono text-[0.8125rem] font-semibold">
                    {formatCount(row.count)}
                  </span>
                </div>
                <ShareBar value={row.count} total={top} />
              </li>
            ))}
          </ol>
          {items.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t('hr.home.thanks.newest')}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {items.slice(0, 4).map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg bg-fill/60 px-2.5 py-1.5 text-[0.8125rem]"
                  >
                    <p className="truncate font-medium">
                      {t('hr.home.thanks.fromTo', { from: item.fromName, to: item.toName })}
                    </p>
                    <p className="text-muted-foreground">{item.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </HomeCard>
  );
}

/* ------------------------------------------------------------------- shares */

function SharesCard({ today }: { today: string }) {
  const { t } = useTranslation();
  const shares = useHrShares(addDays(today, -6), today);
  const rows = useMemo(() => shares.data ?? [], [shares.data]);
  const points = useMemo(() => rows.map(sharePoint), [rows]);
  return (
    <HomeCard title={t('hr.home.shares.title')} to="/hr/shares">
      <ProblemAlert problem={problemFromError(shares.error)} onRetry={shares.refetch} />
      {shares.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title={t('hr.home.shares.empty')} icon={MapPin} />
      ) : (
        <div className="flex h-full flex-col gap-2">
          <GeoMap
            points={points}
            label={t('hr.home.shares.mapLabel')}
            className="h-36 min-h-36 shrink-0"
          />
          <ul className="flex flex-col gap-1.5">
            {rows.slice(0, 6).map((share) => (
              <li key={share.id} className="flex items-center justify-between gap-2">
                <PersonLine name={share.fullName} photoUrl={share.photoUrl} />
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatUbMinute(share.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </HomeCard>
  );
}

/* ----------------------------------------------------------------- calendar */

function MonthCard({ today }: { today: string }) {
  const { t } = useTranslation();
  const month = today.slice(0, 7);
  const calendar = useHrCalendar(month);
  const [day, setDay] = useState(today);
  const items = calendar.data ?? [];
  const onDay = items.filter((item) => isOnDay(item, day));
  return (
    <HomeCard title={t('hr.home.calendar.title')} to="/hr/calendar" className="xl:col-span-2">
      <ProblemAlert problem={problemFromError(calendar.error)} onRetry={calendar.refetch} />
      <div className="grid h-full gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <MonthGrid month={month} items={items} selected={day} onSelect={setDay} />
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground">
            <span aria-hidden className={cn('size-2 rounded-full', CALENDAR_MARKS.EVENT)} />
            {t('hr.home.calendar.dayTitle', { day })}
          </h3>
          {onDay.length === 0 ? (
            calendar.isPending ? (
              <Loading />
            ) : (
              <div className="pt-2">
                <EmptyState title={t('hr.home.calendar.dayEmpty')} icon={CalendarDays} />
              </div>
            )
          ) : (
            <ul className="divide-y divide-border">
              {onDay.map((item) => (
                <CalendarItemLine
                  key={`${item.kind}-${item.eventId ?? item.userId ?? item.title}`}
                  item={item}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </HomeCard>
  );
}

/* --------------------------------------------------------------------- news */

function NewsCard() {
  const { t } = useTranslation();
  const news = useHrMessages('NEWS');
  const rows = (news.data ?? []).filter((row) => messageState(row) === 'PUBLISHED');
  return (
    <HomeCard title={t('hr.home.news.title')} to="/hr/news">
      <ProblemAlert problem={problemFromError(news.error)} onRetry={news.refetch} />
      {news.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title={t('hr.home.news.empty')} icon={Newspaper} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.slice(0, 5).map((row) => (
            <li key={row.id} className="flex gap-2.5">
              {row.imageUrl ? (
                <img
                  src={row.imageUrl}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="h-14 w-20 shrink-0 rounded-lg bg-secondary object-cover"
                />
              ) : null}
              <div className="min-w-0">
                <p className="truncate font-medium" title={row.title}>
                  {row.title}
                </p>
                <p className="line-clamp-2 text-[0.8125rem] text-muted-foreground">{row.body}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.category ? `${row.category} · ` : ''}
                  {formatUbMinute(row.publishAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}

/**
 * «Нүүр хуудас» (ADR-0146, after the structure of timely.mn's home): today's attendance, requests
 * and mood, what the staff wrote and sent, what runs and is coming, each card leading to its page.
 */
export function HrHomePage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('hr.attendance.manage');
  const today = businessDate();
  return (
    <div>
      <PageHeader title={t('nav.hrHome')} description={t('hr.home.description')} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 min-[112.5rem]:grid-cols-4">
        <AttendanceCard today={today} />
        <ArrivalsCard today={today} />
        <RequestsCard today={today} />
        {canManage ? <SendNoticeCard /> : null}
        <MoodCard today={today} />
        <FeedbackCard />
        <VoteCard />
        <ThanksCard today={today} />
        <SharesCard today={today} />
        <MonthCard today={today} />
        <NewsCard />
      </div>
    </div>
  );
}
