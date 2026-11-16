import { HR_LIMITS, hoursAndMinutes } from '@tugeel/shared/hr';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ClipboardPen,
  Clock3,
  History,
  LogIn,
  LogOut,
  MapPin,
  MapPinOff,
  PencilLine,
  TriangleAlert,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AttendanceEvent, useMyAttendance, usePunch } from '../../../src/api/attendance';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { formatDistance } from '../../../src/attendance/distance';
import {
  blockerOf,
  type Fix,
  isWorkdayFlag,
  liveWorkedMinutes,
  nearestSite,
  nextKind,
} from '../../../src/attendance/status';
import { ubDate, ubTime, weekdayOf } from '../../../src/dates/dates';
import { colors, fonts, radii, shadows, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { Card, Notice, PAGE, StatTile, StatTiles, TONES } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

type Whereabouts = 'asking' | 'on' | 'denied' | 'off';

/** The worked minutes tick once a minute while the person is in. */
const TICK_MS = 60_000;

/**
 * «Ирц» (ADR-0131): today's state and figures, where the phone is against the person's work sites,
 * one big button — «ИРСЭН гэж дарах» or «ЯВСАН гэж дарах» — that the server accepts only from
 * inside a site's radius with a fix no looser than 200 m, today's punches and the month's figures.
 * Every signed-in staff member's; opened from «Нүүр» or «Цэс» (ADR-0174).
 */
export default function AttendanceScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const attendance = useMyAttendance();
  const punch = usePunch();
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [where, setWhere] = useState<Whereabouts>('asking');
  const [clock, setClock] = useState(() => Date.now());

  // The phone's position while the screen is open: foreground only, never in the background
  // (app.config.ts blocks background location). The first focus asks; a later focus or a return to
  // the app only reads the permission, so a refused question never comes back by itself.
  const watch = useRef<Location.LocationSubscription | null>(null);
  const starting = useRef(false);
  const declined = useRef(false);
  const alive = useRef(true);
  const asked = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      watch.current?.remove();
      watch.current = null;
    };
  }, []);

  const startLocation = useCallback(async (ask: boolean) => {
    if (watch.current || starting.current) return;
    // Declined once (the phone's location off and the system dialog refused): only «Байршил асаах»
    // tries again — returning to the app would raise the dialog over and over.
    if (!ask && declined.current) return;
    starting.current = true;
    try {
      const permission = ask
        ? await Location.requestForegroundPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();
      if (!alive.current) return;
      if (!permission.granted) {
        setWhere('denied');
        return;
      }
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3_000 },
        (position) => {
          setFix({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyM:
              typeof position.coords.accuracy === 'number' &&
              Number.isFinite(position.coords.accuracy)
                ? Math.round(position.coords.accuracy)
                : null,
          });
          setWhere('on');
        },
        () => setWhere((current) => (current === 'on' ? current : 'off')),
      );
      if (!alive.current) {
        subscription.remove();
        return;
      }
      watch.current = subscription;
      setWhere((current) => (current === 'on' ? current : 'asking'));
    } catch {
      // The phone's location is switched off (or its dialog refused).
      declined.current = true;
      if (alive.current) setWhere('off');
    } finally {
      starting.current = false;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const ask = !asked.current;
      asked.current = true;
      void startLocation(ask);
    }, [startLocation]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void startLocation(false);
    });
    return () => subscription.remove();
  }, [startLocation]);

  /** «Байршил асаах»: the settings when the permission was refused, the phone's switch when off. */
  const enableLocation = async () => {
    if (where === 'denied') {
      await Linking.openSettings();
      return;
    }
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      // The person said no; the next fix attempt tells again.
    }
    // A watch started while the location was off may stay silent: start a new one.
    watch.current?.remove();
    watch.current = null;
    declined.current = false;
    setWhere('asking');
    void startLocation(false);
  };

  // The worked minutes grow with the clock while the person is in.
  const state = attendance.data?.state ?? null;
  useEffect(() => {
    if (state !== 'IN') return;
    const timer = setInterval(() => setClock(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [state]);

  const data = attendance.data;
  const sites = useMemo(() => data?.sites ?? [], [data]);
  const nearest = useMemo(() => (fix ? nearestSite(fix, sites) : null), [fix, sites]);
  const blocker = data ? blockerOf(fix, sites, nearest) : 'NO_FIX';
  const kind = nextKind(state);

  const onPunch = () => {
    if (!fix || blocker !== null) return;
    setProblem(null);
    punch.mutate(
      { kind, lat: String(fix.lat), lng: String(fix.lng), accuracyM: fix.accuracyM },
      {
        onSuccess: (event) => {
          toast.show({
            message: t(
              event.kind === 'IN' ? 'mobile.attendance.punchedIn' : 'mobile.attendance.punchedOut',
              { time: ubTime(event.at) },
            ),
          });
        },
        onError: (error) => setProblem(problemFrom(error)),
      },
    );
  };

  const blockerText = (() => {
    switch (blocker) {
      case null:
        return null;
      case 'NO_SITE':
        return t('mobile.attendance.blockers.NO_SITE');
      case 'NO_FIX':
        return t('mobile.attendance.blockers.NO_FIX');
      case 'IMPRECISE':
        return t('mobile.attendance.blockers.IMPRECISE', {
          m: fix?.accuracyM ?? 0,
          max: HR_LIMITS.maxAccuracyM,
        });
      case 'OUT_OF_RANGE':
        return t('mobile.attendance.blockers.OUT_OF_RANGE', {
          site: nearest?.site.name ?? '',
          radius: nearest?.site.radiusM ?? 0,
        });
    }
  })();

  const renderEvent = (event: AttendanceEvent) => {
    const office = event.source === 'OFFICE';
    const details = office
      ? [t('mobile.attendance.officeEdit'), event.note]
      : [event.siteName, event.distanceM !== null ? formatDistance(event.distanceM) : null];
    const tone = office ? TONES.neutral : event.kind === 'IN' ? TONES.ok : TONES.bad;
    const Icon = office ? PencilLine : event.kind === 'IN' ? LogIn : LogOut;
    return (
      <Row
        key={event.id}
        minHeight={56}
        icon={
          <IconTile color={tone.background}>
            <Icon size={18} strokeWidth={2.2} color={office ? colors.label2 : tone.text} />
          </IconTile>
        }
        title={t(event.kind === 'IN' ? 'mobile.attendance.eventIn' : 'mobile.attendance.eventOut', {
          time: ubTime(event.at),
        })}
        titleStyle={styles.eventTitle}
        subtitle={details.filter(Boolean).join(' · ') || null}
      />
    );
  };

  let body;
  if (!data) {
    body = attendance.error ? (
      <View style={styles.centered}>
        <ProblemText problem={problemFrom(attendance.error)} />
        <PillButton
          title={t('common.retry')}
          variant="soft"
          height={44}
          onPress={() => void attendance.refetch()}
        />
      </View>
    ) : (
      <ActivityIndicator style={styles.loading} color={colors.primary} />
    );
  } else {
    const { day, schedule, month, todayEvents } = data;
    const lastIn = [...todayEvents].reverse().find((event) => event.kind === 'IN');
    const worked = hoursAndMinutes(liveWorkedMinutes(day.workedMinutes, state, data.now, clock));
    const monthWorked = hoursAndMinutes(month.workedMinutes);
    const stateLine =
      state === 'IN'
        ? t('mobile.attendance.inAt', { time: ubTime(lastIn?.at ?? day.firstIn ?? data.now) })
        : state === 'OUT'
          ? t('mobile.attendance.outAt', { time: ubTime(day.lastOut ?? data.now) })
          : t('mobile.attendance.notIn');
    const siteLine = state === 'IN' ? (lastIn?.siteName ?? day.siteName) : null;
    const workday = isWorkdayFlag(schedule.workdays, data.today);
    const blocked = where === 'denied' || where === 'off';

    body = (
      <>
        {/* Today, on the blue card */}
        <View style={styles.today}>
          <View style={styles.todayHead}>
            <Text style={[type.body, styles.onBlueMuted, styles.grow]} numberOfLines={1}>
              {`${ubDate(data.now) || data.today} · ${t(`mobile.weekdaysLong.${weekdayOf(data.today) as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)}`}
            </Text>
            <View
              accessible
              accessibilityLabel={t('mobile.attendance.schedule', {
                start: schedule.workStart,
                end: schedule.workEnd,
              })}
              style={styles.schedule}
            >
              <Clock3 size={13} strokeWidth={2.2} color={colors.primaryForeground} />
              <Text style={[styles.scheduleText, tabular]}>
                {`${schedule.workStart}–${schedule.workEnd}`}
              </Text>
            </View>
          </View>
          <View style={styles.stateBlock}>
            <Text style={[styles.state, tabular]} numberOfLines={1} adjustsFontSizeToFit>
              {stateLine}
            </Text>
            {siteLine ? (
              <Text style={[type.body, styles.onBlueMuted]} numberOfLines={1}>
                {siteLine}
              </Text>
            ) : null}
          </View>
          <View style={styles.todayRule} />
          <View style={styles.figures}>
            <View style={styles.grow}>
              <Text style={[type.secondary, styles.onBlueMuted]}>
                {t('mobile.attendance.workedHours')}
              </Text>
              <Text style={[type.heading, tabular, styles.onBlue]}>
                {t('mobile.attendance.dayWorked', {
                  hours: worked.hours,
                  minutes: worked.minutes,
                })}
              </Text>
            </View>
            <View style={styles.grow}>
              <Text style={[type.secondary, styles.onBlueMuted]}>
                {t('mobile.attendance.lateDays')}
              </Text>
              <Text style={[type.heading, tabular, styles.onBlue]}>
                {t('mobile.attendance.minutesValue', { minutes: day.lateMinutes })}
              </Text>
            </View>
          </View>
          {workday ? null : (
            <Text style={[type.secondary, styles.onBlueMuted]}>
              {t('mobile.attendance.offDay')}
            </Text>
          )}
          {data.tracked ? null : (
            <Text style={[type.secondary, styles.onBlueMuted]}>
              {t('mobile.attendance.untracked')}
            </Text>
          )}
        </View>

        {/* Where the phone is */}
        <SectionHeader style={styles.section}>{t('mobile.attendance.location')}</SectionHeader>
        {sites.length === 0 ? (
          <Notice icon={TriangleAlert} tone="warn">
            {t('mobile.attendance.noSites')}
          </Notice>
        ) : null}
        {blocked ? (
          <Card style={styles.locationOff}>
            <Notice icon={MapPinOff} tone="warn">
              {t(
                where === 'denied'
                  ? 'mobile.attendance.locationDenied'
                  : 'mobile.attendance.locationOff',
              )}
            </Notice>
            <PillButton
              title={t('mobile.attendance.enableLocation')}
              variant="soft"
              height={44}
              onPress={() => void enableLocation()}
            />
          </Card>
        ) : fix && nearest ? (
          <Card style={styles.siteRow}>
            <IconTile color={nearest.inside ? TONES.ok.background : TONES.warn.background}>
              <MapPin
                size={18}
                strokeWidth={2.2}
                color={nearest.inside ? TONES.ok.text : TONES.warn.text}
              />
            </IconTile>
            <View style={styles.site}>
              <Text style={type.rowStrong} numberOfLines={1}>
                {nearest.site.name}
              </Text>
              <Text
                style={[type.secondary, tabular, nearest.inside ? styles.success : styles.warning]}
              >
                {nearest.inside
                  ? t('mobile.attendance.inside', {
                      distance: formatDistance(nearest.distanceM),
                    })
                  : t('mobile.attendance.outside', {
                      distance: formatDistance(nearest.distanceM),
                      radius: nearest.site.radiusM,
                    })}
              </Text>
            </View>
            {fix.accuracyM !== null ? (
              <Text style={[type.caption, tabular]}>
                {t('mobile.attendance.accuracy', { m: fix.accuracyM })}
              </Text>
            ) : null}
          </Card>
        ) : sites.length > 0 ? (
          <Card style={styles.siteRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[type.body, styles.mutedText]}>{t('mobile.attendance.locating')}</Text>
          </Card>
        ) : null}

        {/* The punch */}
        <View style={styles.punch}>
          <PillButton
            title={t(kind === 'IN' ? 'mobile.attendance.punchIn' : 'mobile.attendance.punchOut')}
            variant={kind === 'IN' ? 'primary' : 'destructive'}
            height={56}
            disabled={blocker !== null}
            loading={punch.isPending}
            icon={
              kind === 'IN' ? (
                <LogIn size={22} strokeWidth={2.4} color={colors.primaryForeground} />
              ) : (
                <LogOut size={22} strokeWidth={2.4} color={colors.destructive} />
              )
            }
            onPress={onPunch}
          />
          {blockerText ? <Text style={[type.secondary, styles.center]}>{blockerText}</Text> : null}
          <ProblemText problem={problem} style={styles.problem} />
        </View>

        {/* Today's punches */}
        <SectionHeader style={styles.section}>{t('mobile.attendance.todayEvents')}</SectionHeader>
        {todayEvents.length > 0 ? (
          <Group inset={ICON_INSET}>{todayEvents.map(renderEvent)}</Group>
        ) : (
          <Card>
            <Text style={[type.body, styles.mutedText]}>{t('mobile.attendance.noEvents')}</Text>
          </Card>
        )}

        {/* The month */}
        <SectionHeader
          style={styles.section}
          right={
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t('mobile.attendance.history')}
              hitSlop={14}
              onPress={() => router.push(`/attendance/history?today=${data.today}`)}
            >
              <Text style={styles.link}>{t('mobile.attendance.historyShort')}</Text>
            </Pressable>
          }
        >
          {t('mobile.attendance.month')}
        </SectionHeader>
        <StatTiles>
          <StatTile
            value={t('mobile.attendance.presentOf', { n: month.presentDays, of: month.workdays })}
            label={t('mobile.attendance.presentDays')}
          />
          <StatTile
            value={t('mobile.attendance.daysValue', { n: month.lateDays })}
            label={t('mobile.attendance.lateDays')}
            {...(month.lateDays > 0 ? { color: colors.warning } : {})}
          />
          <StatTile
            value={t('mobile.attendance.hoursValue', { h: monthWorked.hours })}
            label={t('mobile.attendance.workedHours')}
          />
        </StatTiles>
        <Group inset={ICON_INSET}>
          <Row
            icon={
              <IconTile color={colors.tint.blue}>
                <History size={18} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.attendance.history')}
            onPress={() => router.push(`/attendance/history?today=${data.today}`)}
          />
          <Row
            minHeight={56}
            icon={
              <IconTile color={colors.tint.orange}>
                <ClipboardPen size={18} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.requests.entry')}
            subtitle={t('mobile.requests.entryHint')}
            onPress={() => router.push(`/attendance/requests?today=${data.today}`)}
          />
        </Group>
      </>
    );
  }

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.attendance.title')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={attendance.isRefetching}
            onRefresh={() => void attendance.refetch()}
          />
        }
      >
        {body}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: PAGE.padding, gap: PAGE.gap },
  grow: { flex: 1, minWidth: 0 },
  centered: { gap: spacing.md },
  loading: { marginTop: spacing.xl },
  /** A label sits 16 px under the block above it and 8 px over its own card. */
  section: { marginTop: 0, marginBottom: -spacing.sm },
  today: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.primary,
    boxShadow: shadows.accentCard,
  },
  todayHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  schedule: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.onPrimaryHairline,
  },
  scheduleText: { ...type.secondary, fontFamily: fonts.semibold, color: colors.primaryForeground },
  stateBlock: { gap: spacing.xs },
  state: { ...type.display, color: colors.primaryForeground },
  todayRule: { height: 1, backgroundColor: colors.onPrimaryHairline },
  figures: { flexDirection: 'row', gap: spacing.lg },
  onBlue: { color: colors.primaryForeground },
  onBlueMuted: { color: colors.onPrimaryMuted },
  locationOff: { gap: spacing.md },
  siteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  site: { flex: 1, minWidth: 0, gap: 1 },
  punch: { gap: spacing.sm },
  problem: { marginTop: 0 },
  eventTitle: { ...type.rowStrong, ...tabular },
  link: { ...type.chip, color: colors.link },
  center: { textAlign: 'center' },
  success: { color: colors.success },
  warning: { color: colors.warning },
  mutedText: { color: colors.muted },
});
