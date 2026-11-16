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
import { monthOf, ubTime, weekdayOf } from '../../../src/dates/dates';
import { initialsOf } from '../../../src/format/format';
import { StaffWordmarkHeader } from '../../../src/staff/brand';
import { firstNameOf, greetingOf, monthDayOf } from '../../../src/staff/home';
import type { MenuItem } from '../../../src/staff/menu';
import { MENU_LOOK, useFavourites, useStaffMenu } from '../../../src/staff/menu-parts';
import { isRep } from '../../../src/state/phase';
import { useRoleName } from '../../../src/state/role';
import { useSignedIn } from '../../../src/state/session';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { CountBadge, PillButton } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { Card, PAGE, Pill, TONES } from '../../../src/ui/staff-kit';
import { HeaderIconButton, StoreHeaderBand } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';
import { Text } from '../../../src/ui/text';
import { UpdateCard } from '../../../src/updates/update-card';
import { UpdateCheckPanel } from '../../../src/updates/update-check';
import { useAppUpdate, useUpdateCheck } from '../../../src/updates/use-app-update';

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * «Нүүр» of the staff app, where everyone lands (ADR-0174; the Main board of 2026-11-16): the
 * wordmark with the bell, a greeting with today's date, today's attendance with the hours and the
 * work time, what is new for the person as chips, their favourite menu rows in one card, today's
 * events as a grouped list, and at the bottom the app's version with «Шалгах» (#10). A newer
 * version found by the server, or by that button, shows on top.
 */
export default function StaffHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useStoreTabBarInset();
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
  // The tile is soft, in the state's tone: green once in, orange while waiting, grey otherwise.
  const tile = state === 'IN' ? TONES.ok : waiting ? TONES.warn : TONES.neutral;
  const tileIcon = state === 'IN' || waiting ? tile.text : colors.label2;
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
        <StaffWordmarkHeader
          right={
            <HeaderIconButton
              icon={<Bell size={23} strokeWidth={1.9} color={colors.primaryForeground} />}
              label={
                bell > 0
                  ? t('mobile.notifications.bellUnread', { n: bell })
                  : t('mobile.notifications.title')
              }
              badge={bell}
              onPress={() => router.push(rep ? '/notifications' : '/community')}
            />
          }
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${me.fullName}, ${t('mobile.tabs.profile')}`}
          onPress={() => router.push(rep ? '/profile' : '/me')}
          style={({ pressed }) => [styles.person, pressed && styles.pressed]}
        >
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initialsOf(me.fullName)}</Text>
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
          <ChevronRight size={20} strokeWidth={2.2} color={colors.onPrimaryMuted} />
        </Pressable>
      </StoreHeaderBand>

      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.body, { paddingBottom: inset + spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {/* A newer APK on the server (ADR-0174 #7, #10): the press downloads and installs it. */}
        {update ? <UpdateCard release={update} autoStart={updateCheck.found} /> : null}

        {/* Today's attendance: the page punches. */}
        <Card
          accessibilityLabel={`${t('mobile.staffHome.attendance')}: ${stateLine}`}
          onPress={() => router.push('/attendance')}
          style={styles.attendance}
        >
          <View style={styles.attendanceHead}>
            <IconTile color={tile.background}>
              <CalendarCheck size={18} strokeWidth={2.2} color={tileIcon} />
            </IconTile>
            <Text style={[type.heading, styles.grow]} numberOfLines={1}>
              {t('mobile.staffHome.attendance')}
            </Text>
            {data?.tracked ? (
              <Pill
                icon={Clock3}
                label={t('mobile.staffHome.schedule', {
                  start: data.schedule.workStart,
                  end: data.schedule.workEnd,
                })}
                style={styles.schedule}
              />
            ) : null}
          </View>
          <View style={styles.stateBlock}>
            <Text style={[styles.state, { color: stateColor }]} numberOfLines={2}>
              {stateLine}
            </Text>
            {showWorked || lateLine ? (
              <View style={styles.figures}>
                {showWorked && worked ? (
                  <Text style={[type.secondary, tabular]}>
                    {t('mobile.staffHome.worked', { hours: worked.hours, minutes: worked.minutes })}
                  </Text>
                ) : null}
                {lateLine ? (
                  <Text style={[type.secondary, tabular, styles.late]}>{lateLine}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
          {/* Not punched on a workday: the card's one action, a real button. */}
          {waiting ? (
            <PillButton
              height={44}
              icon={<LogIn size={18} strokeWidth={2.2} color={colors.primaryForeground} />}
              title={t('mobile.staffHome.punchNow')}
              onPress={() => router.push('/attendance')}
            />
          ) : null}
        </Card>

        {/* What is new: unread notices, news, open polls, the rep's notifications. */}
        {fresh.length > 0 ? (
          <View style={styles.block}>
            <SectionHeader style={styles.label}>{t('mobile.staffHome.fresh')}</SectionHeader>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.freshScroll}
              contentContainerStyle={styles.freshRow}
            >
              {fresh.map(({ item, count }) => (
                <FreshChip key={item.key} item={item} count={count} onPress={() => open(item)} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* The person's favourites, chosen with the stars on «Цэс». */}
        <View style={styles.block}>
          <SectionHeader
            style={styles.label}
            right={
              <LabelLink
                title={t('common.edit')}
                label={t('mobile.staffHome.editFavourites')}
                onPress={() => router.navigate('/menu')}
              />
            }
          >
            {t('mobile.staffHome.favourites')}
          </SectionHeader>
          <Card style={styles.tiles}>
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
                    <Icon size={24} strokeWidth={2} color={colors.primaryForeground} />
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
                <Plus size={24} strokeWidth={2.2} color={colors.link} />
              </View>
              <Text style={[styles.tileLabel, styles.addLabel]} numberOfLines={2}>
                {t('mobile.staffHome.addFavourite')}
              </Text>
            </Pressable>
          </Card>
        </View>

        {/* Today's events. */}
        <View style={styles.block}>
          <SectionHeader
            style={styles.label}
            right={
              <LabelLink
                title={t('common.all')}
                label={t('mobile.customer.home.seeAll', { title: t('mobile.staffHome.events') })}
                onPress={() => router.push('/community/calendar')}
              />
            }
          >
            {t('mobile.staffHome.events')}
          </SectionHeader>
          {events.length > 0 ? (
            <Group inset={ICON_INSET}>
              {events.map((item, index) => (
                <Row
                  key={`${item.kind}-${item.eventId ?? item.userId ?? index}`}
                  minHeight={56}
                  icon={<CalendarItemIcon item={item} />}
                  title={calendarItemTitle(t, item)}
                  titleStyle={type.rowStrong}
                  subtitle={item.typeName ?? t(`mobile.community.calendar.kinds.${item.kind}`)}
                  chevron={false}
                  onPress={() => router.push('/community/calendar')}
                />
              ))}
            </Group>
          ) : (
            <Card>
              <Text style={[type.body, styles.muted]}>
                {calendar.isLoading
                  ? t('common.loading')
                  : calendar.error
                    ? t('mobile.staffHome.eventsUnknown')
                    : t('mobile.staffHome.noEvents')}
              </Text>
            </Card>
          )}
        </View>

        {/* The app's version and «Шалгах» (ADR-0174 #10). */}
        <UpdateCheckPanel state={updateCheck.state} onCheck={() => void updateCheck.check()} />
      </ScrollView>
    </Page>
  );
}

/** The link at the right of a section's label: «Засах», «Бүгд». */
function LabelLink({
  title,
  label,
  onPress,
}: {
  title: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={14}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Text style={styles.link}>{title}</Text>
    </Pressable>
  );
}

/** A chip of «Шинэ мэдээлэл»: the menu row's icon in its tint, its name and its count. */
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
      style={({ pressed }) => [styles.fresh, pressed && styles.pressedChip]}
    >
      <Icon size={16} strokeWidth={2.2} color={color} />
      <Text style={styles.freshText} numberOfLines={1}>
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
  onBlueSoft: { ...type.secondary, color: colors.primaryForeground, opacity: 0.82 },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: 10,
    paddingBottom: 18,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.dotOnImageIdle,
    backgroundColor: colors.onPrimaryHairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { ...type.title3, fontFamily: fonts.semibold, color: colors.primaryForeground },
  name: { ...type.title2, color: colors.primaryForeground },
  body: PAGE,
  block: { gap: spacing.sm },
  label: { marginTop: 0, marginBottom: 0 },
  link: { ...type.chip, color: colors.link },
  attendance: { gap: spacing.md },
  attendanceHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  schedule: { alignSelf: 'center' },
  stateBlock: { gap: spacing.xs },
  state: { ...type.title2, ...tabular },
  figures: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 2 },
  late: { color: colors.warning },
  // The chips run to the screen's edges: the row undoes the page's side padding.
  freshScroll: { marginHorizontal: -PAGE.padding },
  freshRow: { paddingHorizontal: PAGE.padding, gap: spacing.sm },
  fresh: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  pressedChip: { backgroundColor: colors.accent },
  freshText: { ...type.chip, color: colors.label2 },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  // Three a row: the labels are long words.
  tile: {
    width: `${100 / 3}%`,
    minHeight: 88,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 14,
  },
  pressedTile: { backgroundColor: colors.accent },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: {
    borderWidth: 1.5,
    borderColor: colors.rangeFill,
    backgroundColor: colors.secondary,
  },
  tileBadge: { position: 'absolute', top: -6, right: -6 },
  tileLabel: {
    ...type.secondary,
    fontFamily: fonts.medium,
    color: colors.foreground,
    textAlign: 'center',
  },
  addLabel: { color: colors.link },
});
