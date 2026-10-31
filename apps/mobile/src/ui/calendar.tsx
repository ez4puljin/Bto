import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { type DateRange, monthGrid } from '../dates/calendar';
import { monthOf, shiftMonth } from '../dates/dates';
import { brandSheet } from '../theme/brand';
import { colors, fonts, radii, spacing, tabular, type } from '../theme/tokens';

/** Monday first, as the design draws the week. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * A month of the date sheets (the DateRange board, ADR-0068): «2026 оны 10-р сар» with the month
 * arrows, the week's letters and the days. A range shows its ends filled and the days between
 * tinted; a single day is filled. Days outside `min`…`max` are grey and do nothing.
 */
export function MonthCalendar({
  month,
  onMonth,
  today,
  value,
  min,
  max,
  onPick,
}: {
  /** `YYYY-MM` shown. */
  month: string;
  onMonth: (month: string) => void;
  today: string;
  value: DateRange | string | null;
  min?: string;
  max?: string;
  onPick: (date: string) => void;
}) {
  const { t } = useTranslation();
  const range = typeof value === 'string' ? { from: value, to: value } : value;
  const [year = '', mon = ''] = month.split('-');
  const canBack = !min || monthOf(min) < month;
  const canForward = !max || monthOf(max) > month;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.month}>
          {t('mobile.calendar.month', { year, month: Number.parseInt(mon, 10) })}
        </Text>
        <View style={styles.arrows}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.calendar.previous')}
            accessibilityState={{ disabled: !canBack }}
            disabled={!canBack}
            onPress={() => onMonth(shiftMonth(month, -1))}
            style={styles.arrow}
          >
            <ChevronLeft
              size={22}
              strokeWidth={2.4}
              color={canBack ? colors.primary : colors.input}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.calendar.next')}
            accessibilityState={{ disabled: !canForward }}
            disabled={!canForward}
            onPress={() => onMonth(shiftMonth(month, 1))}
            style={styles.arrow}
          >
            <ChevronRight
              size={22}
              strokeWidth={2.4}
              color={canForward ? colors.primary : colors.input}
            />
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
          const off =
            (min !== undefined && cell.date < min) || (max !== undefined && cell.date > max);
          const edge = range !== null && (cell.date === range.from || cell.date === range.to);
          const inside = range !== null && cell.date > range.from && cell.date < range.to;
          return (
            <View key={cell.date} style={styles.cell}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(
                  cell.date === today ? 'mobile.calendar.dayToday' : 'mobile.calendar.day',
                  { month: Number.parseInt(mon, 10), day: cell.day },
                )}
                accessibilityState={{ disabled: off, selected: edge || inside }}
                disabled={off}
                onPress={() => onPick(cell.date)}
                style={[styles.day, inside && styles.inside, edge && styles.edge]}
              >
                <Text
                  style={[
                    styles.dayText,
                    off && styles.offText,
                    cell.date === today && !edge && styles.todayText,
                    edge && styles.edgeText,
                  ]}
                >
                  {String(cell.day)}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = brandSheet(() =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radii.card,
      paddingTop: 10,
      paddingHorizontal: 10,
      paddingBottom: spacing.md,
    },
    head: {
      height: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 6,
    },
    month: type.heading,
    arrows: { flexDirection: 'row', gap: spacing.xs },
    arrow: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    week: { flexDirection: 'row', paddingTop: spacing.xs, paddingBottom: 2 },
    weekday: {
      flex: 1,
      ...type.sectionHeader,
      textAlign: 'center',
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', paddingTop: spacing.xs, rowGap: spacing.xs },
    cell: { width: `${100 / 7}%`, alignItems: 'center' },
    day: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inside: { backgroundColor: colors.rangeFill },
    edge: { backgroundColor: colors.primary },
    dayText: {
      ...type.row,
      ...tabular,
    },
    offText: { color: colors.input },
    todayText: { color: colors.primary, fontFamily: fonts.bold },
    edgeText: { color: colors.primaryForeground, fontFamily: fonts.semibold },
  }),
);
