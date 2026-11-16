import { useRouter } from 'expo-router';
import { Cake, ChevronLeft, ChevronRight, Circle } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  type CalendarItem,
  useCalendar,
  useSetEventDone,
  useToday,
} from '../../../src/api/community';
import { isOnDay } from '../../../src/community/calendar-day';
import { calendarItemTitle, CalendarItemIcon } from '../../../src/community/calendar-item';
import { FirstLoad } from '../../../src/community/parts';
import { monthGrid } from '../../../src/dates/calendar';
import { monthOf, shiftMonth, shortDate, weekdayOf } from '../../../src/dates/dates';
import { colors, fonts, spacing, tabular, type } from '../../../src/theme/tokens';
import { Group, ICON_INSET, Row } from '../../../src/ui/grouped';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { Card, PAGE } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/** Monday first, as `MonthCalendar` draws the week. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

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
    <Card style={styles.month}>
      <View style={styles.monthHead}>
        <Text style={[type.heading, styles.grow]} numberOfLines={1}>
          {t('mobile.calendar.month', { year, month: monthNumber })}
        </Text>
        <View style={styles.arrows}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.calendar.previous')}
            onPress={() => onMonth(shiftMonth(month, -1))}
            hitSlop={4}
            style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}
          >
            <ChevronLeft size={18} strokeWidth={2.4} color={colors.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.calendar.next')}
            onPress={() => onMonth(shiftMonth(month, 1))}
            hitSlop={4}
            style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}
          >
            <ChevronRight size={18} strokeWidth={2.4} color={colors.foreground} />
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
          const marked = items.some((item) => isOnDay(item, cell.date));
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
    </Card>
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
  const setDone = useSetEventDone();
  const items = useMemo(() => calendar.data ?? [], [calendar.data]);
  const day = useMemo(() => items.filter((item) => isOnDay(item, chosen)), [items, chosen]);

  // «11-р сарын 16, Даваа»: the chosen day in words, never the raw date.
  const [, chosenMonth = '1', chosenDay = '1'] = chosen.split('-');
  const chosenLabel = `${t('mobile.calendar.day', {
    month: Number.parseInt(chosenMonth, 10),
    day: Number.parseInt(chosenDay, 10),
  })}, ${t(`mobile.weekdaysLong.${weekdayOf(chosen) as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)}`;

  const showMonth = (next: string) => {
    setMonth(next);
    setChosen(next === monthOf(today) ? today : `${next}-01`);
  };

  const renderItem = (item: CalendarItem, index: number) => {
    const { eventId } = item;
    const title = calendarItemTitle(t, item);
    const lines = [
      item.typeName ?? t(`mobile.community.calendar.kinds.${item.kind}`),
      item.toDate && item.toDate !== item.date
        ? t('mobile.community.calendar.range', {
            from: shortDate(item.date),
            to: shortDate(item.toDate),
          })
        : null,
      item.note,
      item.doneAt ? t('mobile.community.calendar.done') : null,
    ];
    return (
      <Row
        key={`${item.kind}-${item.eventId ?? item.userId ?? index}`}
        minHeight={56}
        icon={<CalendarItemIcon item={item} />}
        title={title}
        subtitle={lines.filter(Boolean).join(' · ')}
        {...(eventId === null
          ? item.kind === 'BIRTHDAY'
            ? { right: <Cake size={18} strokeWidth={2} color={colors.muted} /> }
            : {}
          : {
              role: 'checkbox' as const,
              chevron: false,
              checked: item.doneAt !== null,
              disabled: setDone.isPending,
              accessibilityLabel: t('mobile.community.calendar.doneFor', { title }),
              right:
                item.doneAt === null ? (
                  <Circle size={22} strokeWidth={1.8} color={colors.muted} />
                ) : undefined,
              onPress: () => setDone.mutate({ id: eventId, done: item.doneAt === null }),
            })}
      />
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.community.calendar.title')} onBack={() => router.back()} />
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
        <SectionHeader
          style={styles.section}
          right={
            chosen === today ? <Text style={type.secondary}>{t('mobile.days.today')}</Text> : null
          }
        >
          {chosenLabel}
        </SectionHeader>
        <FirstLoad query={calendar}>
          {day.length > 0 ? (
            <Group inset={ICON_INSET}>{day.map(renderItem)}</Group>
          ) : (
            <Card>
              <Text style={[type.body, styles.empty]}>
                {t('mobile.community.calendar.emptyDay')}
              </Text>
            </Card>
          )}
        </FirstLoad>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  body: { padding: PAGE.padding, gap: PAGE.gap, paddingBottom: 40 },
  /** A label sits 16 px under the block above it and 8 px over its own list. */
  section: { marginTop: 0, marginBottom: -spacing.sm },
  empty: { color: colors.muted, textAlign: 'center' },
  month: { paddingVertical: 14, paddingHorizontal: 10, gap: spacing.sm },
  monthHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  arrows: { flexDirection: 'row', gap: spacing.sm },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowPressed: { backgroundColor: colors.border },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, ...type.caption, textAlign: 'center', paddingVertical: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 2 },
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
