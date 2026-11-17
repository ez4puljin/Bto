import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { type AttendanceDay, useMyDays } from '../api/attendance';
import { ubTime, weekdayOf } from '../dates/dates';
import { colors, radii, spacing, tabular, type } from '../theme/tokens';
import { Pill, type Tone } from '../ui/staff-kit';
import { Text } from '../ui/text';
import {
  chipOf,
  dotted,
  dottedShort,
  monthsOfWeek,
  paddedHoursAndMinutes,
  type WeekChip,
  weekOf,
} from './week';

const CHIP_TONES: Record<WeekChip, Tone> = {
  OK: 'ok',
  LATE: 'warn',
  EARLY: 'warn',
  ABSENT: 'bad',
  PLANNED: 'neutral',
  OFF: 'warn',
};

/**
 * «Энэ долоо хоногийн ирц»: Monday to Sunday of the week that holds `today`, one row per day —
 * the date over the weekday, first in, last out, worked time and a status chip. Reads the one or
 * two months the week spans (useMyDays).
 */
export function WeekTable({
  today,
  workdays,
  workEnd,
}: {
  today: string;
  workdays: string;
  workEnd: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const week = useMemo(() => weekOf(today), [today]);
  const [firstMonth, lastMonth] = monthsOfWeek(week.dates);
  const first = useMyDays(firstMonth);
  const last = useMyDays(lastMonth);

  const byDate = useMemo(() => {
    const map = new Map<string, AttendanceDay>();
    for (const day of [...(first.data?.data ?? []), ...(last.data?.data ?? [])]) {
      map.set(day.date, day);
    }
    return map;
  }, [first.data, last.data]);
  const ready = first.data !== undefined && last.data !== undefined;

  const openHistory = () => router.push(`/attendance/history?today=${today}`);

  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <View style={styles.grow}>
          <Text style={type.sectionTitle}>{t('mobile.attendance.weekTitle')}</Text>
          <Text style={[type.secondary, tabular]}>
            {`${dotted(week.from)} - ${dotted(week.to)}`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('mobile.attendance.history')}
          hitSlop={12}
          onPress={openHistory}
          style={styles.more}
        >
          <Text style={styles.link}>{t('mobile.attendance.moreDetails')}</Text>
          <ChevronRight size={16} strokeWidth={2.2} color={colors.link} />
        </Pressable>
      </View>

      <View style={styles.table}>
        <View style={[styles.row, styles.header]}>
          <Text style={[styles.headCell, styles.colDay]}>{t('mobile.attendance.colDay')}</Text>
          <Text style={[styles.headCell, styles.colTime]}>{t('mobile.attendance.colIn')}</Text>
          <Text style={[styles.headCell, styles.colTime]}>{t('mobile.attendance.colOut')}</Text>
          <Text style={[styles.headCell, styles.colWorked]}>
            {t('mobile.attendance.colWorked')}
          </Text>
          <Text style={[styles.headCell, styles.colChip, styles.headRight]}>
            {t('mobile.attendance.colState')}
          </Text>
        </View>
        {week.dates.map((date, index) => {
          const day = byDate.get(date);
          const chip = ready
            ? chipOf({ date, today, day, workdays, workEnd, clockOf: ubTime })
            : null;
          const worked =
            day && day.workedMinutes > 0 ? paddedHoursAndMinutes(day.workedMinutes) : null;
          const isToday = date === today;
          return (
            <View
              key={date}
              style={[styles.row, index > 0 && styles.rule, isToday && styles.todayRow]}
            >
              <View style={styles.colDay}>
                <Text style={[type.rowStrong, tabular]}>{dottedShort(date)}</Text>
                <Text style={type.caption}>
                  {t(`mobile.weekdaysLong.${weekdayOf(date) as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)}
                </Text>
              </View>
              <Text style={[styles.cell, tabular, styles.colTime]}>
                {day?.firstIn ? ubTime(day.firstIn) : t('mobile.attendance.noTime')}
              </Text>
              <Text style={[styles.cell, tabular, styles.colTime]}>
                {day?.lastOut && !day.openIn ? ubTime(day.lastOut) : t('mobile.attendance.noTime')}
              </Text>
              <Text style={[styles.cell, tabular, styles.colWorked]}>
                {worked
                  ? t('mobile.attendance.workedPadded', {
                      hours: worked.hours,
                      minutes: worked.minutes,
                    })
                  : t('mobile.attendance.noTime')}
              </Text>
              <View style={styles.colChip}>
                {chip ? (
                  <Pill
                    label={t(`mobile.attendance.chip.${chip}`)}
                    tone={CHIP_TONES[chip]}
                    style={styles.pill}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  more: { flexDirection: 'row', alignItems: 'center' },
  link: { ...type.chip, color: colors.link },
  table: {
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    gap: 4,
  },
  header: { minHeight: 36, backgroundColor: colors.secondary },
  headCell: { ...type.chip, color: colors.link },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairlineStrong },
  todayRow: { backgroundColor: colors.rangeFill },
  cell: { ...type.body },
  colDay: { flex: 1.15, minWidth: 0 },
  colTime: { flex: 1, textAlign: 'center' },
  colWorked: { flex: 1.2, textAlign: 'center' },
  colChip: { flex: 1.6, alignItems: 'flex-end' },
  headRight: { textAlign: 'right' },
  pill: { paddingHorizontal: 6 },
});
