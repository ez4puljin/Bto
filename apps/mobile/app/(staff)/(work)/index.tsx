import { hoursAndMinutes } from '@tugeel/shared/hr';
import { useRouter } from 'expo-router';
import { Bell, CalendarCheck, ChevronRight, Clock3, LogIn, Plus } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useMyAttendance } from '../../../src/api/attendance';
import { feedCount, useCalendar, useFeed, useToday } from '../../../src/api/community';
import { useNotificationSummary } from '../../../src/api/notifications';
import { isWorkdayFlag, liveWorkedMinutes } from '../../../src/attendance/status';
import { isOnDay } from '../../../src/community/calendar-day';
import { calendarItemTitle, CalendarItemIcon } from '../../../src/community/calendar-item';
import { Avatar } from '../../../src/community/parts';
import { ListHeading } from '../../../src/customer/home-parts';
import { monthOf, ubTime, weekdayOf } from '../../../src/dates/dates';
import { firstNameOf, greetingOf, monthDayOf } from '../../../src/staff/home';
import type { MenuItem } from '../../../src/staff/menu';
import { MENU_LOOK, useFavourites, useStaffMenu } from '../../../src/staff/menu-parts';
import { isRep } from '../../../src/state/phase';
import { useRoleName } from '../../../src/state/role';
import { useSignedIn } from '../../../src/state/session';
import { colors, fonts, radii, spacing, storeType, tabular, type } from '../../../src/theme/tokens';
import { CompanyMark, useAppName } from '../../../src/ui/brand';
import { CountBadge } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { Page } from '../../../src/ui/layout';
import { HeaderIconButton, StoreHeaderBand } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';
import { Text } from '../../../src/ui/text';
import { UpdateCard } from '../../../src/updates/update-card';
import { UpdateCheckPanel } from '../../../src/updates/update-check';
import { useAppUpdate, useUpdateCheck } from '../../../src/updates/use-app-update';

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * «Нүүр» of the staff app, where everyone lands (ADR-0174): the company, a greeting with today's
 * date, today's attendance with the hours and the work time, what is new for the person, their
 * favourite menu rows, today's events, and at the bottom the app's version with «Шинэчлэл
 * шалгах» (#10). A newer version found by the server, or by that button, shows on top.
 */
export default function StaffHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useStoreTabBarInset();
  const appName = useAppName();
  const { me } = useSignedIn();
  const rep = isRep(me);
  const roleName = useRoleName();
  const today = useToday();
  const attendance = useMyAttendance();
  const calendar = useCalendar(monthOf(today));
  const feed = useFeed();
  const notifications = useNotificationSummary(rep);
  const { groups, countOf, open } = useStaffMenu();
  const { favourites } = useFavourites(groups);
  const update = useAppUpdate();
  const updateCheck = useUpdateCheck();
  const scroll = useRef<ScrollView>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [clock, setClock] = useState(() => Date.now());

  const data = attendance.data;
  const state = data?.state ?? null;

  // The worked time and the greeting follow the clock: once a minute while the screen is open.
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // A press that found a newer version: the card on top starts it, so the page goes up to it.
  useEffect(() => {
    if (updateCheck.found > 0) scroll.current?.scrollTo({ y: 0, animated: true });
  }, [updateCheck.found]);

  const events = useMemo(
    () => (calendar.data ?? []).filter((item) => isOnDay(item, today)),
    [calendar.data, today],
  );
  // What is new for the person: the menu rows with a count, in the menu's order.
  const fresh = useMemo(
    () =>
      groups
        .flatMap((group) => group.items)
        .map((item) => ({ item, count: countOf(item.key) }))
        .filter(({ count }) => count > 0),
    [groups, countOf],
  );
  const bell = rep ? (notifications.data?.unread ?? 0) : feedCount(feed.data);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        attendance.refetch(),
        calendar.refetch(),
        feed.refetch(),
        ...(rep ? [notifications.refetch()] : []),
      ]);
      setClock(Date.now());
    } finally {
      setRefreshing(false);
    }
  };

  const { month, day } = monthDayOf(today);
  const dateLine = t('mobile.staffHome.date', {
    month,
    day,
    weekday: t(`mobile.weekdaysLong.${weekdayOf(today) as Weekday}`),
  });

  const offDay = data ? !isWorkdayFlag(data.schedule.workdays, data.today) : false;
  const waiting = !!data && data.tracked && state === null && !offDay;
  // The one thing this card must say: did the person punch today.
  const stateLine = !data
    ? attendance.error
      ? t('mobile.staffHome.attendanceUnknown')
      : t('common.loading')
    : !data.tracked
      ? t('mobile.attendance.untracked')
      : state === 'IN'
        ? t('mobile.staffHome.punchedIn', { time: ubTime(data.day.firstIn ?? data.now) })
        : state === 'OUT'
          ? t('mobile.staffHome.punchedOut', { time: ubTime(data.day.lastOut ?? data.now) })
          : offDay
            ? t('mobile.attendance.offDay')
            : t('mobile.staffHome.notPunched');
  const stateColor = state === 'IN' ? colors.success : waiting ? colors.warning : colors.foreground;
  const tileColor =
    state === 'IN' ? colors.tint.green : waiting ? colors.tint.amber : colors.tint.gray;
  const worked = data
    ? hoursAndMinutes(liveWorkedMinutes(data.day.workedMinutes, state, data.now, clock))
    : null;
  const showWorked = !!data && data.tracked && state !== null && worked !== null;
  const lateLine =
    data && data.day.lateMinutes > 0
      ? t('mobile.attendance.late', { minutes: data.day.lateMinutes })
      : null;

  return (
    <Page edges={[]}>
      <StoreHeaderBand>
        <View style={styles.brandRow}>
          <View style={styles.plate}>
            <CompanyMark size={30} />
          </View>
          <View style={styles.grow}>
            <Text accessibilityRole="header" style={styles.appName} numberOfLines={1}>
              {appName}
            </Text>
            <Text style={styles.onBlueSoft} numberOfLines={1}>
              {t('brand.company')}
            </Text>
          </View>
          <HeaderIconButton
            icon={<Bell size={22} strokeWidth={1.9} color={colors.primaryForeground} />}
            label={
              bell > 0
                ? t('mobile.notifications.bellUnread', { n: bell })
                : t('mobile.notifications.title')
            }
            badge={bell}
            onPress={() => router.push(rep ? '/notifications' : '/community')}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${me.fullName}, ${t('mobile.tabs.profile')}`}
          onPress={() => router.push(rep ? '/profile' : '/me')}
          style={({ pressed }) => [styles.person, pressed && styles.pressed]}
        >
          <View style={styles.avatarRing}>
            <Avatar name={me.fullName} photoUrl={null} size={50} />
          </View>
          <View style={styles.grow}>
            <Text style={styles.onBlueSoft} numberOfLines={1}>
              {t(`mobile.staffHome.greeting.${greetingOf(clock)}`)}
            </Text>
            <Text style={styles.name} numberOfLines={1}>
              {firstNameOf(me.fullName)}
            </Text>
            <Text style={styles.onBlueSoft} numberOfLines={1}>
              {[roleName, dateLine].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <ChevronRight size={18} strokeWidth={2.4} color={colors.primaryForeground} />
        </Pressable>
      </StoreHeaderBand>

      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.body, { paddingBottom: inset + spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {/* A newer APK on the server (ADR-0174 #7, #10): the press downloads and installs it. */}
        {update ? (
          <UpdateCard release={update} autoStart={updateCheck.found} style={styles.update} />
        ) : null}

        {/* Today's attendance: the page punches. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('mobile.staffHome.attendance')}: ${stateLine}`}
          onPress={() => router.push('/attendance')}
          style={({ pressed }) => [styles.card, styles.attendance, pressed && styles.pressedCard]}
        >
          <View style={styles.attendanceHead}>
            <IconTile color={tileColor}>
              <CalendarCheck size={16} strokeWidth={2.2} color={colors.primaryForeground} />
            </IconTile>
            <Text style={[type.rowStrong, styles.grow]} numberOfLines={1}>
              {t('mobile.staffHome.attendance')}
            </Text>
            {data?.tracked ? (
              <View style={styles.chip}>
                <Clock3 size={13} strokeWidth={2.2} color={colors.muted} />
                <Text style={[type.chip, tabular, styles.muted]}>
                  {t('mobile.staffHome.schedule', {
                    start: data.schedule.workStart,
                    end: data.schedule.workEnd,
                  })}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.state, { color: stateColor }]} numberOfLines={2}>
            {stateLine}
          </Text>
          {showWorked || lateLine ? (
            <View style={styles.figures}>
              {showWorked && worked ? (
                <Text style={[type.body, tabular]}>
                  {t('mobile.staffHome.worked', { hours: worked.hours, minutes: worked.minutes })}
                </Text>
              ) : null}
              {lateLine ? <Text style={[type.body, tabular, styles.late]}>{lateLine}</Text> : null}
            </View>
          ) : null}
          {/* Not punched on a workday: the card's one action, said as a button. */}
          {waiting ? (
            <View style={styles.punch}>
              <LogIn size={18} strokeWidth={2.2} color={colors.primaryForeground} />
              <Text style={[type.button, styles.punchText]}>{t('mobile.staffHome.punchNow')}</Text>
            </View>
          ) : null}
        </Pressable>

        {/* What is new: unread notices, news, open polls, the rep's notifications. */}
        {fresh.length > 0 ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={[storeType.sectionTitle, styles.title]}>
              {t('mobile.staffHome.fresh')}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.freshRow}
            >
              {fresh.map(({ item, count }) => (
                <FreshChip key={item.key} item={item} count={count} onPress={() => open(item)} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* The person's favourites, chosen with the stars on «Цэс». */}
        <View style={styles.section}>
          <ListHeading
            title={t('mobile.staffHome.favourites')}
            label={t('mobile.staffHome.editFavourites')}
            onPress={() => router.navigate('/menu')}
          />
          <View style={[styles.card, styles.tiles]}>
            {favourites.map((item) => {
              const { Icon, color } = MENU_LOOK[item.key];
              const label = t(`mobile.staffMenu.items.${item.key}`);
              const count = countOf(item.key);
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityLabel={count > 0 ? `${label}, ${count}` : label}
                  onPress={() => open(item)}
                  style={({ pressed }) => [styles.tile, pressed && styles.pressedTile]}
                >
                  <View style={[styles.tileIcon, { backgroundColor: color }]}>
                    <Icon size={22} strokeWidth={2} color={colors.primaryForeground} />
                    <CountBadge count={count} ring={colors.card} style={styles.tileBadge} />
                  </View>
                  <Text style={styles.tileLabel} numberOfLines={2}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
            {/* The last tile adds more: «Цэс» with its stars. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.staffHome.editFavourites')}
              onPress={() => router.navigate('/menu')}
              style={({ pressed }) => [styles.tile, pressed && styles.pressedTile]}
            >
              <View style={[styles.tileIcon, styles.addIcon]}>
                <Plus size={22} strokeWidth={2.2} color={colors.primary} />
              </View>
              <Text style={[styles.tileLabel, styles.addLabel]} numberOfLines={2}>
                {t('mobile.staffHome.addFavourite')}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Today's events. */}
        <View style={styles.section}>
          <ListHeading
            title={t('mobile.staffHome.events')}
            label={t('mobile.customer.home.seeAll', { title: t('mobile.staffHome.events') })}
            onPress={() => router.push('/community/calendar')}
          />
          {events.length > 0 ? (
            <Group inset={ICON_INSET} style={styles.panel}>
              {events.map((item, index) => (
                <Row
                  key={`${item.kind}-${item.eventId ?? item.userId ?? index}`}
                  minHeight={52}
                  icon={<CalendarItemIcon item={item} />}
                  title={calendarItemTitle(t, item)}
                  subtitle={item.typeName ?? t(`mobile.community.calendar.kinds.${item.kind}`)}
                  onPress={() => router.push('/community/calendar')}
                />
              ))}
            </Group>
          ) : (
            <View style={[styles.card, styles.empty]}>
              <Text style={[type.body, styles.muted]}>
                {calendar.isLoading
                  ? t('common.loading')
                  : calendar.error
                    ? t('mobile.staffHome.eventsUnknown')
                    : t('mobile.staffHome.noEvents')}
              </Text>
            </View>
          )}
        </View>

        {/* The app's version and «Шинэчлэл шалгах» (ADR-0174 #10). */}
        <View style={styles.section}>
          <UpdateCheckPanel
            state={updateCheck.state}
            onCheck={() => void updateCheck.check()}
            style={styles.panel}
          />
        </View>
      </ScrollView>
    </Page>
  );
}

/** A row of «Шинэ мэдээлэл»: the menu row's tile, its name and its count. */
function FreshChip({
  item,
  count,
  onPress,
}: {
  item: MenuItem;
  count: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { Icon, color } = MENU_LOOK[item.key];
  const label = t(`mobile.staffMenu.items.${item.key}`);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${count}`}
      onPress={onPress}
      style={({ pressed }) => [styles.fresh, pressed && styles.pressedCard]}
    >
      <IconTile color={color}>
        <Icon size={16} strokeWidth={2.2} color={colors.primaryForeground} />
      </IconTile>
      <Text style={type.bodyStrong} numberOfLines={1}>
        {label}
      </Text>
      <CountBadge count={count} ring={colors.card} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  muted: { color: colors.muted },
  brandRow: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: 14,
    paddingRight: spacing.xs,
  },
  // The logo is dark green: on the blue it needs a white ground (ADR-0166).
  plate: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: { ...type.heading, color: colors.primaryForeground },
  onBlueSoft: { ...type.secondary, color: colors.primaryForeground, opacity: 0.88 },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingTop: spacing.sm,
    paddingBottom: 18,
  },
  avatarRing: {
    padding: 2,
    borderRadius: 28,
    backgroundColor: colors.onPrimaryHairline,
  },
  name: { ...type.title2, color: colors.primaryForeground },
  body: { paddingTop: 14 },
  update: { marginHorizontal: 14, marginTop: 0, marginBottom: 14 },
  card: {
    marginHorizontal: 14,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  attendance: { padding: spacing.lg, gap: spacing.sm },
  attendanceHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  pressedCard: { backgroundColor: colors.accent },
  state: { ...type.title2, ...tabular },
  figures: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 2 },
  late: { color: colors.warning },
  punch: {
    marginTop: spacing.xs,
    height: 46,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  punchText: { color: colors.primaryForeground },
  section: { paddingTop: 20 },
  title: { marginHorizontal: 14, marginBottom: spacing.sm, textTransform: 'uppercase' },
  freshRow: { paddingHorizontal: 14, gap: spacing.sm },
  fresh: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  panel: { marginHorizontal: 14 },
  empty: { padding: spacing.lg },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  // Three a row: the labels are long words.
  tile: {
    width: `${100 / 3}%`,
    minHeight: 96,
    padding: spacing.sm,
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.card,
  },
  pressedTile: { backgroundColor: colors.accent },
  tileIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.input,
    backgroundColor: colors.secondary,
  },
  tileBadge: { position: 'absolute', top: -4, right: -4 },
  tileLabel: {
    ...type.secondary,
    fontFamily: fonts.medium,
    color: colors.foreground,
    textAlign: 'center',
  },
  addLabel: { color: colors.primary },
});
