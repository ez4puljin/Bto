import { ArrowDown, ArrowUp, ChevronRight, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { RowAction, RowActions } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useBanners } from '@/features/customer-app/api';
import { type Segment, useSegmentMutations, useSegments } from '@/features/segments/api';
import {
  type AppHomeSections,
  HOME_SECTIONS,
  requestOf,
  useAppSettings,
  useSaveAppSettings,
} from './api';

/**
 * «Апп» → «Аппын нүүр» (ADR-0127, customer.home.manage): what «Bto300»'s home shows — the banners
 * (their own page), the built-in sections switched on or off, and the product segments shown as
 * sections, in their order.
 */
export function AppHomePage() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader
        title={t('appSettings.home.title')}
        description={t('appSettings.home.description')}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <BannersCard />
          <SectionsCard />
        </div>
        <SegmentsCard />
      </div>
    </div>
  );
}

/** «Баннер» (ADR-0092 #5): how many banners the app shows now, and their page. */
function BannersCard() {
  const { t } = useTranslation();
  const banners = useBanners();
  const running = (banners.data ?? []).filter((banner) => banner.state === 'RUNNING').length;
  return (
    <Card role="region" aria-label={t('customerApp.banners.title')}>
      <CardHeader>
        <CardTitle>{t('customerApp.banners.title')}</CardTitle>
        <CardDescription>{t('customerApp.banners.cardDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={problemFromError(banners.error)} onRetry={banners.refetch} />
        {banners.isSuccess ? (
          <p className="text-sm">
            {t('customerApp.banners.runningCount', { n: formatCount(running) })}
          </p>
        ) : null}
        <Button asChild variant="link" size="sm" className="self-start px-0">
          <Link to="/app/home/banners">
            {t('customerApp.banners.manage')}
            <ChevronRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * «Нүүрний хэсгүүд»: the three built-in sections, each a switch that saves at once (the whole row
 * with the changed flag); read-only text without customer.home.manage.
 */
function SectionsCard() {
  const { t } = useTranslation();
  const canManage = useHasPermission('customer.home.manage');
  const settings = useAppSettings();
  const save = useSaveAppSettings();
  const action = useAction();
  const data = settings.data;

  const toggle = async (section: keyof AppHomeSections, shown: boolean) => {
    if (!data) return;
    const ok = await action.run(() =>
      save.mutateAsync({
        ...requestOf(data),
        homeSections: { ...data.homeSections, [section]: shown },
      }),
    );
    if (ok) toast.success(t('appSettings.home.sections.saved'));
  };

  return (
    <Card role="region" aria-label={t('appSettings.home.sections.title')}>
      <CardHeader>
        <CardTitle>{t('appSettings.home.sections.title')}</CardTitle>
        <CardDescription>{t('appSettings.home.sections.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={problemFromError(settings.error)} onRetry={settings.refetch} />
        <ProblemAlert problem={action.problem} />
        {settings.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {data
          ? HOME_SECTIONS.map((section) => (
              <div key={section} className="flex items-center justify-between gap-3">
                <Label htmlFor={`app-section-${section}`}>
                  {t(`appSettings.home.sections.${section}`)}
                </Label>
                {canManage ? (
                  <Switch
                    id={`app-section-${section}`}
                    checked={data.homeSections[section]}
                    disabled={save.isPending}
                    onCheckedChange={(next) => void toggle(section, next)}
                  />
                ) : (
                  <Badge
                    id={`app-section-${section}`}
                    variant={data.homeSections[section] ? 'success' : 'secondary'}
                  >
                    {data.homeSections[section]
                      ? t('appSettings.home.sections.shown')
                      : t('appSettings.home.sections.hidden')}
                  </Badge>
                )}
              </div>
            ))
          : null}
      </CardContent>
    </Card>
  );
}

const byRank = (a: Segment, b: Segment) => (a.appRank ?? 0) - (b.appRank ?? 0);

/**
 * «Сегментүүд» (ADR-0092 #2): the product segments the home shows, in their order — moved up or
 * down, taken off — and a picker adding one of the live segments not shown yet.
 */
function SegmentsCard() {
  const { t } = useTranslation();
  const canManage = useHasPermission('customer.home.manage');
  const segments = useSegments('PRODUCT');
  const mutations = useSegmentMutations();
  const action = useAction();
  const [picked, setPicked] = useState('');
  const all = segments.data ?? [];
  const shown = all.filter((segment) => segment.appRank !== null).sort(byRank);
  const hidden = all.filter((segment) => segment.appRank === null);
  const busy = mutations.showInApp.isPending || mutations.moveInApp.isPending;

  const move = (segment: Segment, direction: 'UP' | 'DOWN') =>
    void action.run(() => mutations.moveInApp.mutateAsync({ id: segment.id, direction }));
  const show = async (id: number, next: boolean) => {
    const ok = await action.run(() => mutations.showInApp.mutateAsync({ id, shown: next }));
    if (!ok) return;
    toast.success(
      next ? t('appSettings.home.segments.added') : t('appSettings.home.segments.removed'),
    );
    if (next) setPicked('');
  };

  return (
    <Card role="region" aria-label={t('appSettings.home.segments.title')}>
      <CardHeader>
        <CardTitle>{t('appSettings.home.segments.title')}</CardTitle>
        <CardDescription>{t('appSettings.home.segments.description')}</CardDescription>
      </CardHeader>
      <CardContent className={shown.length ? 'flex flex-col gap-3 px-0' : 'flex flex-col gap-3'}>
        <ProblemAlert problem={problemFromError(segments.error)} onRetry={segments.refetch} />
        <ProblemAlert problem={action.problem} />
        {segments.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {segments.isSuccess && shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('appSettings.home.segments.empty')}</p>
        ) : null}
        {shown.length ? (
          <Table>
            <TableBody>
              {shown.map((segment, index) => (
                <TableRow key={segment.id}>
                  <TableCell className="w-8 text-muted-foreground tabular-nums">
                    {index + 1}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link to={`/segments/${segment.id}`} className="text-link hover:underline">
                      {segment.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t(`segments.kinds.${segment.kind}`)}</Badge>
                  </TableCell>
                  {canManage ? (
                    <RowActions>
                      <RowAction
                        label={`${t('appSettings.home.segments.up')}: ${segment.name}`}
                        icon={ArrowUp}
                        disabled={index === 0 || busy}
                        onClick={() => move(segment, 'UP')}
                      />
                      <RowAction
                        label={`${t('appSettings.home.segments.down')}: ${segment.name}`}
                        icon={ArrowDown}
                        disabled={index === shown.length - 1 || busy}
                        onClick={() => move(segment, 'DOWN')}
                      />
                      <RowAction
                        label={`${t('appSettings.home.segments.remove')}: ${segment.name}`}
                        icon={X}
                        destructive
                        disabled={busy}
                        onClick={() => void show(segment.id, false)}
                      />
                    </RowActions>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {canManage && segments.isSuccess ? (
          <div
            className={
              shown.length ? 'flex flex-col gap-1.5 px-(--card-spacing)' : 'flex flex-col gap-1.5'
            }
          >
            <Label htmlFor="app-segment-pick">{t('appSettings.home.segments.pick')}</Label>
            {hidden.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <NativeSelect
                  id="app-segment-pick"
                  className="sm:w-72"
                  value={picked}
                  onChange={(event) => setPicked(event.target.value)}
                >
                  <option value="">{t('appSettings.home.segments.choose')}</option>
                  {hidden.map((segment) => (
                    <option key={segment.id} value={String(segment.id)}>
                      {segment.name}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={picked === '' || busy}
                  onClick={() => void show(Number.parseInt(picked, 10), true)}
                >
                  <Plus />
                  {t('appSettings.home.segments.add')}
                </Button>
              </div>
            ) : (
              <p id="app-segment-pick" className="text-sm text-muted-foreground">
                {t('appSettings.home.segments.allShown')}
              </p>
            )}
          </div>
        ) : null}
        <p
          className={
            shown.length
              ? 'px-(--card-spacing) text-[0.8125rem] text-muted-foreground'
              : 'text-[0.8125rem] text-muted-foreground'
          }
        >
          {t('appSettings.home.segments.orderHint')}
        </p>
      </CardContent>
    </Card>
  );
}
