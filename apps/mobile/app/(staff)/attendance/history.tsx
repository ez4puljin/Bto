import { hoursAndMinutes } from '@tugeel/shared/hr';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarX2, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
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
import { colors, spacing, storeType, tabular, TOUCH, type } from '../../../src/theme/tokens';
import { Group } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Pill, StatTile, StatTiles, type Tone } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/** Each day status's pill: present green, late orange, absent red, a day off grey. */
const STATUS_TONES: Record<AttendanceDay['status'], Tone> = {
  PRESENT: 'ok',
  LATE: 'warn',
  ABSENT: 'bad',
  OFF: 'neutral',
};

/**
 * «Миний ирц» (ADR-0131): the month's arrows in the blue header, the month's three figures, then
 * its days newest first in one list — the date and weekday, first in – last out, the worked time
 * and the late minutes, the status pill. Only days up to today are listed; the arrows never go
 * past this month.
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

  const renderDay = (item: AttendanceDay) => {
    const worked = hoursAndMinutes(item.workedMinutes);
    const off = item.status === 'OFF';
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
      <View key={item.date} style={styles.row}>
        <View style={styles.date}>
          <Text style={[type.rowStrong, tabular, off && styles.muted]}>{shortDate(item.date)}</Text>
          <Text style={type.secondary}>
            {t(`mobile.weekdays.${weekdayOf(item.date) as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)}
          </Text>
        </View>
        <View style={styles.grow}>
          <Text style={[type.row, tabular, times === null && styles.muted]} numberOfLines={1}>
            {times ?? t('common.none')}
          </Text>
          {figures.length > 0 ? (
            <Text
              style={[type.secondary, tabular, item.lateMinutes > 0 && styles.warning]}
              numberOfLines={1}
            >
              {figures.join(' · ')}
            </Text>
          ) : null}
        </View>
        <Pill
          label={t(`mobile.attendance.status.${item.status}`)}
          tone={STATUS_TONES[item.status]}
          style={styles.pill}
        />
      </View>
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.attendance.historyTitle')} onBack={() => router.back()}>
        <View style={styles.switcher}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.attendance.previousMonth')}
            accessibilityState={{ disabled: month === null }}
            disabled={month === null}
            onPress={() => {
              if (month) setPicked(shiftMonth(month, -1));
            }}
            style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
          >
            <ChevronLeft size={22} strokeWidth={2.2} color={colors.primaryForeground} />
          </Pressable>
          <Text style={[storeType.headerTitleStrong, styles.month]} numberOfLines={1}>
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
            style={({ pressed }) => [
              styles.arrow,
              pressed && styles.pressed,
              !canForward && styles.arrowOff,
            ]}
          >
            <ChevronRight size={22} strokeWidth={2.2} color={colors.primaryForeground} />
          </Pressable>
        </View>
      </StoreHeader>
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
        ]}
        refreshControl={
          <RefreshControl refreshing={days.isRefetching} onRefresh={() => void days.refetch()} />
        }
      >
        {rows.length > 0 ? (
          <>
            <StatTiles>
              <StatTile
                value={t('mobile.attendance.presentOf', {
                  n: totals.present,
                  of: totals.workdays,
                })}
                label={t('mobile.attendance.presentDays')}
              />
              <StatTile
                value={t('mobile.attendance.daysValue', { n: totals.late })}
                label={t('mobile.attendance.lateDays')}
                {...(totals.late > 0 ? { color: colors.warning } : {})}
              />
              <StatTile
                value={t('mobile.attendance.hoursValue', { h: totals.hours })}
                label={t('mobile.attendance.workedHours')}
              />
            </StatTiles>
            <Group inset={spacing.lg}>{rows.map(renderDay)}</Group>
          </>
        ) : days.isLoading || month === null ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : days.error ? (
          <ProblemText problem={problemFrom(days.error)} style={styles.problem} />
        ) : (
          <EmptyState
            icon={<CalendarX2 size={40} strokeWidth={1.5} color={colors.muted} />}
            title={t('mobile.attendance.noDays')}
          />
        )}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0, gap: 1 },
  switcher: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: 10,
  },
  arrow: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowOff: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
  month: { flex: 1, textAlign: 'center' },
  body: { padding: spacing.lg, gap: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  date: { width: 48, gap: 1 },
  pill: { alignSelf: 'center' },
  loading: { marginTop: spacing.xl },
  problem: { marginTop: 0 },
  muted: { color: colors.muted },
  warning: { color: colors.warning },
});
