import { useRouter } from 'expo-router';
import {
  Award,
  Cake,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
  PartyPopper,
  UsersRound,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { type CalendarItem, useCalendar, useToday } from '../../../src/api/community';
import { Avatar, FirstLoad } from '../../../src/community/parts';
import { monthGrid } from '../../../src/dates/calendar';
import { monthOf, shiftMonth, shortDate } from '../../../src/dates/dates';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/** Monday first, as `MonthCalendar` draws the week. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

const KIND_STYLE: Record<CalendarItem['kind'], { Icon: LucideIcon; color: string }> = {
  EVENT: { Icon: CalendarDays, color: colors.tint.blue },
  MEETING: { Icon: UsersRound, color: colors.tint.indigo },
  HOLIDAY: { Icon: PartyPopper, color: colors.tint.red },
  BIRTHDAY: { Icon: Cake, color: colors.tint.pink },
  ANNIVERSARY: { Icon: Award, color: colors.tint.orange },
};

/** Whether an item falls on a day: HR's events can run over several days. */
const isOn = (item: CalendarItem, day: string): boolean =>
  item.date <= day && day <= (item.toDate ?? item.date);

/**
 * The month in `MonthCalendar`'s look with a dot under the days that have items; the kit's calendar
 * has no marks, and this is the only screen that needs them.
 */
function MarkedMonth({
  month,
  onMonth,
  today,
  chosen,
  onPick,
  items,
}: {
  month: string;
  onMonth: (month: string) => void;
  today: string;
  chosen: string;
  onPick: (date: string) => void;
  items: readonly CalendarItem[];
}) {
  const { t } = useTranslation();
  const [year = '', mon = ''] = month.split('-');
  const monthNumber = Number.parseInt(mon, 10);
  return (
    <View style={styles.month}>
      <View style={styles.monthHead}>
        <Text style={type.heading}>{t('mobile.calendar.month', { year, month: monthNumber })}</Text>
        <View style={styles.arrows}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.calendar.previous')}
            onPress={() => onMonth(shiftMonth(month, -1))}
            style={styles.arrow}
          >
            <ChevronLeft size={22} strokeWidth={2.4} color={colors.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.calendar.next')}
            onPress={() => onMonth(shiftMonth(month, 1))}
            style={styles.arrow}
          >
            <ChevronRight size={22} strokeWidth={2.4} color={colors.primary} />
          </Pressable>
        </View>
      </View>
      <View style={styles.week}>
        {WEEK.map((day) => (
          <Text key={day} style={styles.weekday}>
            {t(`mobile.weekdays.${day}`)}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {monthGrid(month).map((cell) => {
          if (cell.kind === 'blank') return <View key={cell.key} style={styles.cell} />;
          const on = cell.date === chosen;
          const marked = items.some((item) => isOn(item, cell.date));
          const label = t(
            cell.date === today ? 'mobile.calendar.dayToday' : 'mobile.calendar.day',
            { month: monthNumber, day: cell.day },
          );
          return (
            <View key={cell.date} style={styles.cell}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  marked ? t('mobile.community.calendar.marked', { label }) : label
                }
                accessibilityState={{ selected: on }}
                onPress={() => onPick(cell.date)}
                style={[styles.day, on && styles.dayOn]}
              >
                <Text
                  style={[
                    styles.dayText,
                    cell.date === today && !on && styles.todayText,
                    on && styles.dayOnText,
                  ]}
                >
                  {String(cell.day)}
                </Text>
                {marked ? <View style={[styles.mark, on && styles.markOn]} /> : null}
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * «Энэ сарын үйл явдлууд» (ADR-0146): the month with marks on the days that have items, and the
 * chosen day's list: HR's events, «… төрсөн өдөр» and «… ажлын N жилийн ой».
 */
export default function CalendarScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const today = useToday();
  const [month, setMonth] = useState(() => monthOf(today));
  const [chosen, setChosen] = useState(today);
  const calendar = useCalendar(month);
  const items = useMemo(() => calendar.data ?? [], [calendar.data]);
  const day = useMemo(() => items.filter((item) => isOn(item, chosen)), [items, chosen]);

  const showMonth = (next: string) => {
    setMonth(next);
    setChosen(next === monthOf(today) ? today : `${next}-01`);
  };

  const renderItem = (item: CalendarItem, index: number) => {
    const { Icon, color } = KIND_STYLE[item.kind];
    const person = item.kind === 'BIRTHDAY' || item.kind === 'ANNIVERSARY';
    const title =
      item.kind === 'BIRTHDAY'
        ? t('mobile.community.calendar.birthday', { name: item.title })
        : item.kind === 'ANNIVERSARY'
          ? t('mobile.community.calendar.anniversary', { name: item.title, years: item.years ?? 0 })
          : item.title;
    const lines = [
      t(`mobile.community.calendar.kinds.${item.kind}`),
      item.toDate && item.toDate !== item.date
        ? t('mobile.community.calendar.range', {
            from: shortDate(item.date),
            to: shortDate(item.toDate),
          })
        : null,
      item.note,
    ];
    return (
      <Row
        key={`${item.kind}-${item.eventId ?? item.userId ?? index}`}
        minHeight={56}
        icon={
          person ? (
            <Avatar name={item.title} photoUrl={item.photoUrl} size={30} />
          ) : (
            <IconTile color={color}>
              <Icon size={16} strokeWidth={2.2} color={colors.primaryForeground} />
            </IconTile>
          )
        }
        title={title}
        subtitle={lines.filter(Boolean).join(' · ')}
      />
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.community.calendar.title')}
        onBack={() => router.back()}
        right={null}
      />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={calendar.isRefetching}
            onRefresh={() => void calendar.refetch()}
          />
        }
      >
        <MarkedMonth
          month={month}
          onMonth={showMonth}
          today={today}
          chosen={chosen}
          onPick={setChosen}
          items={items}
        />
        <Text style={[type.sectionHeader, tabular, styles.head]}>{chosen}</Text>
        <FirstLoad query={calendar}>
          {day.length > 0 ? (
            <Group inset={ICON_INSET}>{day.map(renderItem)}</Group>
          ) : (
            <Text style={[type.body, styles.empty]}>{t('mobile.community.calendar.emptyDay')}</Text>
          )}
        </FirstLoad>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: 14, paddingBottom: 40 },
  head: { marginTop: spacing.lg, marginBottom: 6, paddingHorizontal: spacing.xs },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg },
  month: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingTop: 10,
    paddingHorizontal: 10,
    paddingBottom: spacing.md,
  },
  monthHead: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  arrows: { flexDirection: 'row', gap: spacing.xs },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  week: { flexDirection: 'row', paddingTop: spacing.xs, paddingBottom: 2 },
  weekday: { flex: 1, ...type.sectionHeader, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingTop: spacing.xs, rowGap: spacing.xs },
  cell: { width: `${100 / 7}%`, alignItems: 'center' },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: colors.primary },
  dayText: { ...type.row, ...tabular },
  dayOnText: { color: colors.primaryForeground, fontFamily: fonts.semibold },
  todayText: { color: colors.primary, fontFamily: fonts.bold },
  mark: {
    position: 'absolute',
    bottom: 4,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.tint.orange,
  },
  markOn: { backgroundColor: colors.primaryForeground },
});
