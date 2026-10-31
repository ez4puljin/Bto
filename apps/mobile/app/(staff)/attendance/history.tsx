import { hoursAndMinutes } from '@tugeel/shared/hr';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarX2, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AttendanceDay, useMyAttendance, useMyDays } from '../../../src/api/attendance';
import { problemFrom } from '../../../src/api/problem';
import {
  monthOf,
  shiftMonth,
  shortDate,
  ubDate,
  ubTime,
  weekdayOf,
} from '../../../src/dates/dates';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/** Each day status's pill: present green, late orange, absent red, a day off grey. */
const STATUS_COLORS: Record<AttendanceDay['status'], { background: string; text: string }> = {
  PRESENT: { background: colors.successSoft, text: colors.success },
  LATE: { background: colors.warningSoft, text: colors.warning },
  ABSENT: { background: colors.destructiveSoft, text: colors.destructiveText },
  OFF: { background: colors.fill, text: colors.muted },
};

/**
 * «Миний ирц» (ADR-0131): one month's days newest first — the date and weekday, the status pill,
 * first in – last out, the worked time and the late minutes — with the month's totals at the foot.
 * Only days up to today are listed; the arrows never go past this month.
 */
export default function AttendanceHistoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ today?: string }>();
  const me = useMyAttendance();
  // The server's today (handed over by «Ирц», else read again): never the phone's UTC date.
  const today = params.today ?? me.data?.today ?? (me.data ? ubDate(me.data.now) : null);
  const thisMonth = today ? monthOf(today) : null;
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? thisMonth;
  const days = useMyDays(month ?? '');

  const rows = useMemo(
    () =>
      (days.data?.data ?? [])
        .filter((day) => today === null || day.date <= today)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [days.data, today],
  );
  const totals = useMemo(() => {
    let workdays = 0;
    let present = 0;
    let late = 0;
    let worked = 0;
    for (const day of rows) {
      if (day.status !== 'OFF') workdays += 1;
      if (day.status === 'PRESENT' || day.status === 'LATE') present += 1;
      if (day.status === 'LATE') late += 1;
      worked += day.workedMinutes;
    }
    return { workdays, present, late, hours: hoursAndMinutes(worked).hours };
  }, [rows]);

  const canForward = month !== null && thisMonth !== null && month < thisMonth;
  const [year = '', mon = '01'] = (month ?? '').split('-');

  const renderDay = ({ item }: { item: AttendanceDay }) => {
    const palette = STATUS_COLORS[item.status];
    const worked = hoursAndMinutes(item.workedMinutes);
    const times =
      item.firstIn === null
        ? null
        : item.lastOut === null
          ? t('mobile.attendance.dayOpen', { in: ubTime(item.firstIn) })
          : t('mobile.attendance.dayRange', {
              in: ubTime(item.firstIn),
              out: ubTime(item.lastOut),
            });
    const figures = [
      item.workedMinutes > 0
        ? t('mobile.attendance.dayWorked', { hours: worked.hours, minutes: worked.minutes })
        : null,
      item.lateMinutes > 0 ? t('mobile.attendance.dayLate', { minutes: item.lateMinutes }) : null,
    ].filter(Boolean);
    return (
      <View style={styles.row}>
        <View style={styles.date}>
          <Text style={[type.rowStrong, tabular]}>{shortDate(item.date)}</Text>
          <Text style={type.secondary}>
            {t(`mobile.weekdays.${weekdayOf(item.date) as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)}
          </Text>
        </View>
        <View style={styles.grow}>
          {times ? (
            <Text style={[type.row, tabular]} numberOfLines={1}>
              {times}
            </Text>
          ) : null}
          {figures.length > 0 ? (
            <Text
              style={[type.secondary, tabular, item.lateMinutes > 0 && styles.warning]}
              numberOfLines={1}
            >
              {figures.join(' · ')}
            </Text>
          ) : null}
        </View>
        <View style={[styles.pill, { backgroundColor: palette.background }]}>
          <Text style={[styles.pillText, { color: palette.text }]}>
            {t(`mobile.attendance.status.${item.status}`)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.attendance.historyTitle')}
        onBack={() => router.back()}
        right={null}
      />
      <View style={styles.switcher}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.attendance.previousMonth')}
          accessibilityState={{ disabled: month === null }}
          disabled={month === null}
          onPress={() => {
            if (month) setPicked(shiftMonth(month, -1));
          }}
          hitSlop={8}
          style={styles.arrow}
        >
          <ChevronLeft size={22} strokeWidth={2.4} color={colors.primary} />
        </Pressable>
        <Text style={styles.month}>
          {month ? t('mobile.calendar.month', { year, month: Number.parseInt(mon, 10) }) : ''}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.attendance.nextMonth')}
          accessibilityState={{ disabled: !canForward }}
          disabled={!canForward}
          onPress={() => {
            if (month) setPicked(shiftMonth(month, 1));
          }}
          hitSlop={8}
          style={styles.arrow}
        >
          <ChevronRight
            size={22}
            strokeWidth={2.4}
            color={canForward ? colors.primary : colors.input}
          />
        </Pressable>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(day) => day.date}
        renderItem={renderDay}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Math.max(insets.bottom, spacing.md) },
        ]}
        refreshControl={
          <RefreshControl refreshing={days.isRefetching} onRefresh={() => void days.refetch()} />
        }
        ListEmptyComponent={
          days.isLoading || month === null ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : days.error ? (
            <ProblemText problem={problemFrom(days.error)} />
          ) : (
            <EmptyState
              icon={<CalendarX2 size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.attendance.noDays')}
            />
          )
        }
        ListFooterComponent={
          rows.length > 0 ? (
            <Text style={[type.secondary, tabular, styles.totals]}>
              {t('mobile.attendance.totals', {
                present: totals.present,
                workdays: totals.workdays,
                late: totals.late,
                hours: totals.hours,
              })}
            </Text>
          ) : null
        }
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0, gap: 2 },
  switcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
  },
  arrow: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  month: { ...type.heading, textAlign: 'center' },
  list: { paddingHorizontal: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  date: { width: 48, gap: 1 },
  pill: { height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: 'center' },
  pillText: { ...type.secondary, fontFamily: fonts.semibold },
  separator: { height: spacing.sm },
  loading: { marginTop: spacing.xl },
  warning: { color: colors.warning },
  totals: { textAlign: 'center', paddingVertical: spacing.lg },
});
