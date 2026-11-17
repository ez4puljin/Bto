import { distanceMeters } from '@tugeel/shared/geo';
import { HR_LIMITS, hoursAndMinutes } from '@tugeel/shared/hr';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Bell,
  CalendarDays,
  ChevronDown,
  History,
  LocateFixed,
  MapPin,
  MapPinOff,
  Send,
  UserRound,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AttendanceEvent, useMyAttendance, usePunch } from '../../../src/api/attendance';
import { feedCount, useFeed } from '../../../src/api/community';
import { useNotificationSummary } from '../../../src/api/notifications';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { formatDistance } from '../../../src/attendance/distance';
import { MapSheet } from '../../../src/attendance/map-sheet';
import { PUNCH_SIZE, PunchButton } from '../../../src/attendance/punch-button';
import SiteMap from '../../../src/attendance/site-map';
import {
  blockerOf,
  type Fix,
  isWorkdayFlag,
  liveWorkedMinutes,
  nearestSite,
  nextKind,
} from '../../../src/attendance/status';
import { WeekTable } from '../../../src/attendance/week-table';
import { dotted, ringFill, scheduledMinutes } from '../../../src/attendance/week';
import { ubTime, weekdayOf } from '../../../src/dates/dates';
import { isRep } from '../../../src/state/phase';
import { useSignedIn } from '../../../src/state/session';
import { colors, radii, shadows, spacing, tabular, type } from '../../../src/theme/tokens';
import { CircleButton, PillButton } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { SectionHeader } from '../../../src/ui/layout';
import { Notice, StatTile, StatTiles, TONES } from '../../../src/ui/staff-kit';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

type Whereabouts = 'asking' | 'on' | 'denied' | 'off';
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The worked minutes tick once a minute while the person is in. */
const TICK_MS = 60_000;
/** The sheet's visible height when low (handle, the two buttons, «Өнөөдөр»), without the inset. */
const COLLAPSED = 262;
/** How far the round punch button's bottom reaches into the sheet. */
const PUNCH_OVERLAP = 10;

/**
 * «Ирц» (ADR-0131): a map with the person and their work site's circle, the round punch button
 * with the day's worked time, and a sheet that slides up over the map with today's card and this
 * week's table. The server still accepts a punch only from inside a site's radius with a fix no
 * looser than 200 m; the button looks off (and says why) when the phone already knows it is not.
 * Every signed-in staff member's; opened from «Нүүр» or «Цэс» (ADR-0174).
 */
export default function AttendanceScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { me } = useSignedIn();
  const rep = isRep(me);
  const notifications = useNotificationSummary(rep);
  const feed = useFeed();
  const attendance = useMyAttendance();
  const punch = usePunch();
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [where, setWhere] = useState<Whereabouts>('asking');
  const [clock, setClock] = useState(() => Date.now());
  const [pickedSite, setPickedSite] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focus, setFocus] = useState<{ on: 'me' | 'site'; nonce: number }>({
    on: 'me',
    nonce: 0,
  });
  const [mapFailed, setMapFailed] = useState(false);
  const bell = rep ? (notifications.data?.unread ?? 0) : feedCount(feed.data);

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
  const blocked = where === 'denied' || where === 'off';

  // The site the map shows: the one the person picked, else the nearest, else the first.
  const shown = useMemo(() => {
    const site = sites.find((s) => s.id === pickedSite) ?? nearest?.site ?? sites[0] ?? null;
    if (!site) return null;
    const distanceM = fix
      ? distanceMeters(
          { lat: String(fix.lat), lng: String(fix.lng) },
          { lat: site.lat, lng: site.lng },
        )
      : null;
    return { site, distanceM, inside: distanceM !== null && distanceM <= site.radiusM };
  }, [sites, pickedSite, nearest, fix]);

  const onPunch = () => {
    if (!data) return;
    if (!fix || blocker !== null) {
      if (blockerText) toast.show({ message: blockerText });
      return;
    }
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

  // The line under the site's name: the location blockers first, then inside or outside.
  const stateLine = (() => {
    if (where === 'denied') return t('mobile.attendance.locationDenied');
    if (where === 'off') return t('mobile.attendance.locationOff');
    if (data && sites.length === 0) return t('mobile.attendance.blockers.NO_SITE');
    if (!fix || !shown) return t('mobile.attendance.locating');
    if (blocker === 'IMPRECISE') return blockerText ?? '';
    if (shown.inside) return t('mobile.attendance.stateInside');
    return t('mobile.attendance.stateOutside', { distance: formatDistance(shown.distanceM ?? 0) });
  })();
  const stateGood = !blocked && fix !== null && shown?.inside === true && blocker !== 'IMPRECISE';

  const historyHref = data ? `/attendance/history?today=${data.today}` : '/attendance/history';
  const requestsHref = data ? `/attendance/requests?today=${data.today}` : '/attendance/requests';

  const renderEvent = (event: AttendanceEvent) => {
    const office = event.source === 'OFFICE';
    const details = office
      ? [t('mobile.attendance.officeEdit'), event.note]
      : [event.siteName, event.distanceM !== null ? formatDistance(event.distanceM) : null];
    const tone = office ? TONES.neutral : event.kind === 'IN' ? TONES.ok : TONES.bad;
    return (
      <Row
        key={event.id}
        minHeight={56}
        icon={
          <IconTile color={tone.background}>
            <MapPin size={18} strokeWidth={2.2} color={office ? colors.label2 : tone.text} />
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

  // The round button.
  const day = data?.day;
  const schedule = data?.schedule;
  const workedMinutes = day ? liveWorkedMinutes(day.workedMinutes, state, data.now, clock) : 0;
  const worked = hoursAndMinutes(workedMinutes);
  const fill = ringFill(
    workedMinutes,
    schedule ? scheduledMinutes(schedule.workStart, schedule.workEnd) : 0,
  );
  const punchOff = !data || blocker !== null;

  const sheetBottom = Math.max(insets.bottom, spacing.md);
  const collapsedHeight = COLLAPSED + sheetBottom;
  const expandedHeight = Math.max(collapsedHeight + 80, height - insets.top - spacing.sm);

  const refresh = () => {
    void attendance.refetch();
    if (rep) void notifications.refetch();
  };

  const siteCircle = shown
    ? {
        lat: Number.parseFloat(shown.site.lat),
        lng: Number.parseFloat(shown.site.lng),
        radiusM: shown.site.radiusM,
        inside: shown.inside,
      }
    : null;
  const mapMe = fix ? { lat: fix.lat, lng: fix.lng } : null;

  let sheetBody;
  if (!data || !day || !schedule) {
    sheetBody = attendance.error ? (
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
    const { month, todayEvents } = data;
    const lastIn = [...todayEvents].reverse().find((event) => event.kind === 'IN');
    const monthWorked = hoursAndMinutes(month.workedMinutes);
    const workday = isWorkdayFlag(schedule.workdays, data.today);
    const dateLabel = t(
      workday ? 'mobile.attendance.todayDateHours' : 'mobile.attendance.todayDate',
      {
        date: dotted(data.today),
        day: t(`mobile.weekdays.${weekdayOf(data.today) as Weekday}`),
        start: schedule.workStart,
        end: schedule.workEnd,
      },
    );
    const timeIn = day.firstIn ?? lastIn?.at ?? null;
    const timeOut = state === 'IN' ? null : day.lastOut;
    sheetBody = (
      <>
        <ProblemText problem={problem} style={styles.problem} />
        <View style={styles.buttons}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(historyHref)}
            style={({ pressed }) => [styles.big, styles.bigFilled, pressed && styles.pressed]}
          >
            <CalendarDays size={20} strokeWidth={2.2} color={colors.primaryForeground} />
            <Text style={[type.button, styles.onFilled]} numberOfLines={1}>
              {t('mobile.attendance.timeLog')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(requestsHref)}
            style={({ pressed }) => [styles.big, styles.bigSoft, pressed && styles.pressed]}
          >
            <Send size={20} strokeWidth={2.2} color={colors.link} />
            <Text style={[type.button, styles.onSoft]} numberOfLines={1}>
              {t('mobile.attendance.requestButton')}
            </Text>
          </Pressable>
        </View>

        <View style={styles.todayBlock}>
          <View style={styles.todayHead}>
            <Text style={type.sectionTitle}>{t('mobile.attendance.today')}</Text>
            <Text style={[type.secondary, tabular, styles.grow, styles.right]} numberOfLines={1}>
              {dateLabel}
            </Text>
          </View>
          <FigureRow
            label={t('mobile.attendance.arrivedAt')}
            value={timeIn ? ubTime(timeIn) : t('mobile.attendance.noTime')}
          />
          <FigureRow
            label={t('mobile.attendance.leftAt')}
            value={timeOut ? ubTime(timeOut) : t('mobile.attendance.noTime')}
          />
          <FigureRow
            label={t('mobile.attendance.workedAt')}
            value={t('mobile.attendance.workedCompact', {
              hours: worked.hours,
              minutes: worked.minutes,
            })}
          />
          {day.lateMinutes > 0 ? (
            <FigureRow
              label={t('mobile.attendance.lateAt')}
              value={t('mobile.attendance.minutesValue', { minutes: day.lateMinutes })}
              warn
            />
          ) : null}
          {workday ? null : <Text style={type.secondary}>{t('mobile.attendance.offDay')}</Text>}
          {data.tracked ? null : (
            <Text style={type.secondary}>{t('mobile.attendance.untracked')}</Text>
          )}
        </View>

        <WeekTable today={data.today} workdays={schedule.workdays} workEnd={schedule.workEnd} />

        {/* What «Ирц» showed before and now lives below the week: the punches and the month. */}
        <View style={styles.more}>
          <SectionHeader style={styles.section}>{t('mobile.attendance.todayEvents')}</SectionHeader>
          {todayEvents.length > 0 ? (
            <Group inset={ICON_INSET}>{todayEvents.map(renderEvent)}</Group>
          ) : (
            <Text style={[type.body, styles.mutedText]}>{t('mobile.attendance.noEvents')}</Text>
          )}
          <SectionHeader style={styles.section}>{t('mobile.attendance.month')}</SectionHeader>
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
        </View>
      </>
    );
  }

  const top = insets.top + spacing.sm;

  return (
    <View style={styles.root}>
      <SiteMap
        me={mapMe}
        site={siteCircle}
        focus={focus.on}
        focusNonce={focus.nonce}
        bottomPad={collapsedHeight}
        onMapError={() => {
          setMapFailed(true);
          return Promise.resolve();
        }}
        dom={{ style: styles.map, scrollEnabled: false }}
      />
      {mapFailed ? (
        <View style={styles.mapFailed} pointerEvents="none">
          <MapPinOff size={22} strokeWidth={2} color={colors.muted} />
          <Text style={[type.body, styles.mutedText]}>{t('mobile.attendance.mapFailed')}</Text>
        </View>
      ) : null}

      <View style={[styles.topRow, { top }]} pointerEvents="box-none">
        <CircleButton
          label={t('mobile.tabs.profile')}
          icon={<UserRound size={22} strokeWidth={2} color={colors.foreground} />}
          onPress={() => router.push(rep ? '/profile' : '/me')}
        />
        <View style={styles.centre} pointerEvents="box-none">
          <Pressable
            accessibilityRole={sites.length > 1 ? 'button' : 'text'}
            accessibilityLabel={sites.length > 1 ? t('mobile.attendance.pickSite') : undefined}
            disabled={sites.length < 2}
            onPress={() => setPickerOpen((open) => !open)}
            style={styles.whitePill}
          >
            <Text style={[type.rowStrong, styles.shrink]} numberOfLines={1}>
              {shown?.site.name ?? t('mobile.attendance.title')}
            </Text>
            {sites.length > 1 ? (
              <ChevronDown size={16} strokeWidth={2.4} color={colors.muted} />
            ) : null}
          </Pressable>
          {pickerOpen && sites.length > 1 ? (
            <View style={styles.picker}>
              {sites.map((site) => (
                <Pressable
                  key={site.id}
                  accessibilityRole="button"
                  onPress={() => {
                    setPickedSite(site.id);
                    setPickerOpen(false);
                    setFocus((f) => ({ on: 'site', nonce: f.nonce + 1 }));
                  }}
                  style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}
                >
                  <Text
                    style={[type.body, site.id === shown?.site.id && styles.pickedName]}
                    numberOfLines={1}
                  >
                    {site.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Pressable
            accessibilityRole={blocked ? 'button' : 'text'}
            disabled={!blocked}
            onPress={() => void enableLocation()}
            style={styles.whitePill}
          >
            <Text
              style={[
                type.secondary,
                styles.stateText,
                stateGood ? styles.success : styles.warning,
              ]}
              numberOfLines={2}
            >
              {stateLine}
            </Text>
          </Pressable>
          {blocked ? (
            <PillButton
              title={t('mobile.attendance.enableLocation')}
              variant="soft"
              height={34}
              onPress={() => void enableLocation()}
            />
          ) : null}
          {data && sites.length === 0 ? (
            <View style={styles.notice}>
              <Notice icon={MapPinOff} tone="warn">
                {t('mobile.attendance.noSites')}
              </Notice>
            </View>
          ) : null}
        </View>
        <CircleButton
          label={
            bell > 0
              ? t('mobile.notifications.bellUnread', { n: bell })
              : t('mobile.notifications.title')
          }
          icon={<Bell size={21} strokeWidth={2} color={colors.foreground} />}
          badge={bell}
          onPress={() => router.push(rep ? '/notifications' : '/community')}
        />
      </View>

      <View style={[styles.side, { top: top + 150 }]} pointerEvents="box-none">
        <CircleButton
          label={t('mobile.attendance.myLocation')}
          icon={<LocateFixed size={21} strokeWidth={2} color={colors.primary} />}
          onPress={() => setFocus((f) => ({ on: 'me', nonce: f.nonce + 1 }))}
        />
        <CircleButton
          label={t('mobile.attendance.siteLocation')}
          icon={<MapPin size={21} strokeWidth={2} color={colors.foreground} />}
          onPress={() => setFocus((f) => ({ on: 'site', nonce: f.nonce + 1 }))}
        />
        <CircleButton
          label={t('mobile.attendance.history')}
          icon={<History size={21} strokeWidth={2} color={colors.foreground} />}
          onPress={() => router.push(historyHref)}
        />
      </View>

      <MapSheet
        collapsedHeight={collapsedHeight}
        expandedHeight={expandedHeight}
        floatingRise={PUNCH_SIZE - PUNCH_OVERLAP}
        handleLabel={t('mobile.attendance.sheetHandle')}
        bottomInset={sheetBottom}
        refreshControl={<RefreshControl refreshing={attendance.isRefetching} onRefresh={refresh} />}
        floating={
          <PunchButton
            fill={fill}
            action={t(kind === 'IN' ? 'mobile.attendance.actionIn' : 'mobile.attendance.actionOut')}
            actionColor={kind === 'IN' ? colors.primary : colors.destructive}
            hours={worked.hours}
            minutes={worked.minutes}
            hoursUnit={t('mobile.attendance.unitHours')}
            minutesUnit={t('mobile.attendance.unitMinutes')}
            disabled={punchOff}
            loading={punch.isPending}
            label={t(kind === 'IN' ? 'mobile.attendance.punchIn' : 'mobile.attendance.punchOut')}
            onPress={onPunch}
          />
        }
      >
        {sheetBody}
      </MapSheet>
    </View>
  );
}

/** «Ирсэн цаг … 08:42»: a label on the left, its figure on the right. */
function FigureRow({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <View style={styles.figure}>
      <Text style={[type.body, styles.mutedText]}>{label}</Text>
      <Text style={[type.rowStrong, tabular, warn && styles.warning]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mapFailed: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: COLLAPSED,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  topRow: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  centre: { flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.sm },
  whitePill: {
    maxWidth: '100%',
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.floatingFill,
    boxShadow: shadows.floating,
  },
  shrink: { flexShrink: 1 },
  stateText: { textAlign: 'center' },
  picker: {
    alignSelf: 'stretch',
    padding: spacing.xs,
    borderRadius: radii.field,
    backgroundColor: colors.card,
    boxShadow: shadows.floating,
  },
  pickerRow: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md },
  pickedName: { fontWeight: '600', color: colors.primary },
  notice: { alignSelf: 'stretch' },
  side: { position: 'absolute', right: spacing.md, gap: spacing.sm },
  pressed: { opacity: 0.7 },
  grow: { flex: 1, minWidth: 0 },
  right: { textAlign: 'right' },
  centered: { gap: spacing.md },
  loading: { marginTop: spacing.xl },
  problem: { marginTop: 0 },
  buttons: { flexDirection: 'row', gap: spacing.md },
  big: {
    flex: 1,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.field,
  },
  bigFilled: { backgroundColor: colors.primary },
  bigSoft: { backgroundColor: colors.secondary },
  onFilled: { color: colors.primaryForeground },
  onSoft: { color: colors.link },
  todayBlock: { gap: spacing.sm },
  todayHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  figure: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  more: { gap: spacing.md },
  section: { marginTop: 0, marginBottom: -spacing.sm },
  eventTitle: { ...type.rowStrong, ...tabular },
  success: { color: colors.success },
  warning: { color: colors.warning },
  mutedText: { color: colors.muted },
});
