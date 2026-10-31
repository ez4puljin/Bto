import { HR_LIMITS, hoursAndMinutes } from '@tugeel/shared/hr';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { History, LogIn, LogOut, MapPin, PencilLine } from 'lucide-react-native';
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
import { initialsOf } from '../../../src/format/format';
import { isRep, mayRequestTransfers } from '../../../src/state/phase';
import { useSignedIn } from '../../../src/state/session';
import { colors, fonts, radii, spacing, storeType, tabular, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StatRow } from '../../../src/ui/stat-row';
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
 * Every signed-in staff member lands here when they hold neither the rep's nor the seller's right:
 * the header's initials then open the profile with «Гарах».
 */
export default function AttendanceScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const hasOwnHome = isRep(me) || mayRequestTransfers(me);
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
      // The phone's location is switched off.
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
    return (
      <Row
        key={event.id}
        minHeight={52}
        icon={
          <IconTile
            color={
              office ? colors.tint.gray : event.kind === 'IN' ? colors.tint.green : colors.tint.red
            }
          >
            {office ? (
              <PencilLine size={16} strokeWidth={2.2} color={colors.primaryForeground} />
            ) : event.kind === 'IN' ? (
              <LogIn size={16} strokeWidth={2.2} color={colors.primaryForeground} />
            ) : (
              <LogOut size={16} strokeWidth={2.2} color={colors.primaryForeground} />
            )}
          </IconTile>
        }
        title={t(event.kind === 'IN' ? 'mobile.attendance.eventIn' : 'mobile.attendance.eventOut', {
          time: ubTime(event.at),
        })}
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

    body = (
      <>
        {/* Today */}
        <View style={styles.card}>
          <Text style={type.secondary}>
            {`${ubDate(data.now) || data.today} · ${t(`mobile.weekdaysLong.${weekdayOf(data.today) as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)}`}
          </Text>
          <Text
            style={[
              styles.state,
              state === 'IN' && { color: colors.success },
              state === null && { color: colors.muted },
            ]}
          >
            {stateLine}
          </Text>
          {siteLine ? <Text style={type.body}>{siteLine}</Text> : null}
          <View style={styles.figures}>
            <Text style={[type.body, tabular]}>
              {t('mobile.attendance.worked', { hours: worked.hours, minutes: worked.minutes })}
            </Text>
            {day.lateMinutes > 0 ? (
              <Text style={[type.bodyStrong, tabular, styles.warning]}>
                {t('mobile.attendance.late', { minutes: day.lateMinutes })}
              </Text>
            ) : null}
          </View>
          <Text style={type.secondary}>
            {[
              t('mobile.attendance.schedule', { start: schedule.workStart, end: schedule.workEnd }),
              workday ? null : t('mobile.attendance.offDay'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {data.tracked ? null : (
            <Text style={[type.secondary, styles.warning]}>{t('mobile.attendance.untracked')}</Text>
          )}
        </View>

        {/* Where the phone is */}
        <Text style={styles.sectionTitle}>{t('mobile.attendance.location')}</Text>
        <View style={styles.card}>
          {sites.length === 0 ? (
            <Text style={[type.body, styles.warning]}>{t('mobile.attendance.noSites')}</Text>
          ) : null}
          {where === 'denied' || where === 'off' ? (
            <>
              <Text style={[type.body, styles.warning]}>
                {t(
                  where === 'denied'
                    ? 'mobile.attendance.locationDenied'
                    : 'mobile.attendance.locationOff',
                )}
              </Text>
              <PillButton
                title={t('mobile.attendance.enableLocation')}
                variant="soft"
                height={44}
                onPress={() => void enableLocation()}
              />
            </>
          ) : fix && nearest ? (
            <View style={styles.siteRow}>
              <IconTile color={nearest.inside ? colors.tint.green : colors.tint.orange}>
                <MapPin size={16} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
              <View style={styles.grow}>
                <Text style={type.rowStrong} numberOfLines={1}>
                  {nearest.site.name}
                </Text>
                <Text
                  style={[type.body, tabular, nearest.inside ? styles.success : styles.warning]}
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
                {fix.accuracyM !== null ? (
                  <Text style={[type.secondary, tabular]}>
                    {t('mobile.attendance.accuracy', { m: fix.accuracyM })}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : sites.length > 0 ? (
            <View style={styles.siteRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[type.body, styles.mutedText]}>{t('mobile.attendance.locating')}</Text>
            </View>
          ) : null}
        </View>

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
                <LogOut size={22} strokeWidth={2.4} color={colors.primaryForeground} />
              )
            }
            onPress={onPunch}
          />
          {blockerText ? <Text style={[type.secondary, styles.center]}>{blockerText}</Text> : null}
          <ProblemText problem={problem} />
        </View>

        {/* Today's punches */}
        <Text style={styles.sectionTitle}>{t('mobile.attendance.todayEvents')}</Text>
        {todayEvents.length > 0 ? (
          <Group inset={ICON_INSET}>{todayEvents.map(renderEvent)}</Group>
        ) : (
          <View style={styles.card}>
            <Text style={[type.body, styles.mutedText]}>{t('mobile.attendance.noEvents')}</Text>
          </View>
        )}

        {/* The month */}
        <Text style={styles.sectionTitle}>{t('mobile.attendance.month')}</Text>
        <StatRow
          items={[
            {
              value: t('mobile.attendance.presentOf', { n: month.presentDays, of: month.workdays }),
              label: t('mobile.attendance.presentDays'),
            },
            {
              value: t('mobile.attendance.daysValue', { n: month.lateDays }),
              label: t('mobile.attendance.lateDays'),
            },
            {
              value: t('mobile.attendance.hoursValue', { h: monthWorked.hours }),
              label: t('mobile.attendance.workedHours'),
            },
          ]}
        />
        <Group inset={ICON_INSET} style={styles.historyGroup}>
          <Row
            minHeight={52}
            icon={
              <IconTile color={colors.tint.blue}>
                <History size={16} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.attendance.history')}
            onPress={() => router.push(`/attendance/history?today=${data.today}`)}
          />
        </Group>
      </>
    );
  }

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.attendance.title')}
        {...(hasOwnHome ? { onBack: () => router.back() } : {})}
        right={
          hasOwnHome ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.tabs.profile')}
              onPress={() => router.push('/store-profile')}
              hitSlop={7}
              style={({ pressed }) => [styles.avatar, pressed && styles.faded]}
            >
              <Text style={styles.avatarText}>{initialsOf(me.fullName)}</Text>
            </Pressable>
          )
        }
      />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + 24 },
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
  body: { paddingHorizontal: 14, paddingTop: spacing.md, gap: spacing.md },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  faded: { opacity: 0.7 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: spacing.sm,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...storeType.badge, fontFamily: fonts.bold, color: colors.primary },
  centered: { paddingTop: spacing.xl, gap: spacing.md },
  loading: { marginTop: spacing.xl },
  card: {
    padding: spacing.lg,
    gap: spacing.xs,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  state: { ...type.title, ...tabular, marginTop: spacing.xs },
  figures: { marginTop: spacing.sm, gap: 2 },
  sectionTitle: { ...type.sectionHeader, marginTop: spacing.sm, marginLeft: spacing.xs },
  siteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  punch: { gap: spacing.sm, paddingTop: spacing.xs },
  center: { textAlign: 'center' },
  success: { color: colors.success },
  warning: { color: colors.warning },
  mutedText: { color: colors.muted },
  historyGroup: { marginTop: 0 },
});
