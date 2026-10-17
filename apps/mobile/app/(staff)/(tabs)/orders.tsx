import { useRouter } from 'expo-router';
import { CalendarDays } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, SectionList, StyleSheet, View } from 'react-native';
import { Text } from '../../../src/ui/text';
import { problemFrom } from '../../../src/api/problem';
import { type RepOrderSummary, useOrders, useRepContext } from '../../../src/api/rep';
import {
  type DateRange,
  dayNameOf,
  monthDay,
  presetOf,
  presetRange,
  type RangePreset,
} from '../../../src/dates/calendar';
import { ubDate, weekdayOf } from '../../../src/dates/dates';
import { formatMillions, formatMnt } from '../../../src/format/format';
import { DateRangeSheet } from '../../../src/orders/date-range-sheet';
import { useDebounced } from '../../../src/state/use-debounced';
import { colors, radii, spacing, type } from '../../../src/theme/tokens';
import { ChoiceChip, SearchField } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { LargeTitle, Page } from '../../../src/ui/layout';
import { OrderRow } from '../../../src/ui/order-row';
import { StatRow } from '../../../src/ui/stat-row';
import { useTabBarInset } from '../../../src/ui/tab-bar';

const PAGE_PRESETS: readonly RangePreset[] = ['today', 'week', 'month'];

/**
 * «Миний захиалгууд» (the MyOrders board, ADR-0068 #7): a customer search, the days (today, a
 * week, this month, or any range from the calendar), the range's count, confirmed total and drafts,
 * and the rep's own orders by day, newest first.
 */
export default function OrdersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useTabBarInset();
  const context = useRepContext();
  const today = context.data?.today ?? null;
  const [picked, setPicked] = useState<DateRange | null>(null);
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState(false);
  const q = useDebounced(text.trim(), 350);
  const range = picked ?? (today ? presetRange('month', today) : null);
  const orders = useOrders(range ? { ...range, q } : null);
  const rows = useMemo(() => orders.data?.pages.flatMap((page) => page.data) ?? [], [orders.data]);
  const summary = orders.data?.pages[0]?.summary ?? null;
  const preset = range && today ? presetOf(range, today) : null;

  const sections = useMemo(() => {
    const groups: { day: string; data: RepOrderSummary[] }[] = [];
    for (const row of rows) {
      const day = ubDate(row.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.data.push(row);
      else groups.push({ day, data: [row] });
    }
    return groups;
  }, [rows]);

  const dayTitle = (day: string) => {
    const weekday = weekdayOf(day) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const date = t('mobile.orders.dayDate', {
      day: monthDay(day),
      weekday: t(`mobile.weekdaysLong.${weekday}`),
    });
    const name = today ? dayNameOf(day, today) : 'date';
    return name === 'today' || name === 'yesterday'
      ? t('mobile.checkout.namedDay', { name: t(`mobile.days.${name}`), day: date })
      : date;
  };
  const totalText = summary
    ? (() => {
        const millions = formatMillions(summary.total);
        return millions
          ? t('mobile.orders.millions', { amount: millions })
          : t('pricing.money', { amount: formatMnt(summary.total) });
      })()
    : t('common.none');

  const header = (
    <View>
      <View style={styles.bar} />
      <LargeTitle style={styles.title}>{t('mobile.orders.title')}</LargeTitle>
      <SearchField
        value={text}
        onChangeText={setText}
        placeholder={t('mobile.orders.search')}
        accessibilityLabel={t('mobile.orders.search')}
        style={styles.search}
      />
      <View style={styles.chips}>
        {today
          ? PAGE_PRESETS.map((entry) => (
              <ChoiceChip
                key={entry}
                compact
                label={t(`mobile.dateRange.presets.${entry}`)}
                selected={preset === entry}
                onPress={() => setPicked(presetRange(entry, today))}
              />
            ))
          : null}
        <ChoiceChip
          compact
          label={
            preset === null && range
              ? t('mobile.orders.range', { from: monthDay(range.from), to: monthDay(range.to) })
              : t('mobile.orders.pickDates')
          }
          selected={preset === null && range !== null}
          icon={
            <CalendarDays
              size={15}
              strokeWidth={2}
              color={preset === null && range ? colors.primaryForeground : colors.foreground}
            />
          }
          onPress={() => setSheet(true)}
        />
      </View>
      <View style={styles.stats}>
        <StatRow
          items={[
            {
              value: summary ? String(summary.count) : t('common.none'),
              label: t('mobile.orders.count'),
            },
            { value: totalText, label: t('mobile.orders.confirmed') },
            {
              value: summary ? String(summary.drafts) : t('common.none'),
              label: t('mobile.orders.drafts'),
            },
          ]}
        />
      </View>
      {orders.error ? <ProblemText problem={problemFrom(orders.error)} /> : null}
    </View>
  );

  return (
    <Page>
      <SectionList
        sections={sections}
        keyExtractor={(order) => String(order.id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.list, { paddingBottom: inset + spacing.lg }]}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={[type.sectionHeader, styles.day]}>
            {dayTitle(section.day)}
          </Text>
        )}
        renderItem={({ item, index, section }) => (
          <View
            style={[
              styles.cell,
              index === 0 && styles.firstCell,
              index === section.data.length - 1 && styles.lastCell,
            ]}
          >
            {index > 0 ? <Separator /> : null}
            <OrderRow order={item} onPress={() => router.push(`/order/${item.id}`)} />
          </View>
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (orders.hasNextPage && !orders.isFetchingNextPage) void orders.fetchNextPage();
        }}
        refreshing={orders.isRefetching && !orders.isFetchingNextPage}
        onRefresh={() => void orders.refetch()}
        ListEmptyComponent={
          orders.isLoading || !range ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : (
            <View style={styles.empty}>
              <Text style={type.heading}>{t('mobile.orders.empty')}</Text>
              <Text style={[type.body, styles.muted]}>{t('mobile.orders.emptyHint')}</Text>
            </View>
          )
        }
        ListFooterComponent={
          orders.isFetchingNextPage ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : null
        }
      />
      {today && range ? (
        <DateRangeSheet
          visible={sheet}
          today={today}
          range={range}
          onApply={(next) => {
            setPicked(next);
            setSheet(false);
          }}
          onClose={() => setSheet(false)}
        />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg },
  bar: { height: 44 },
  title: { marginTop: 2, marginHorizontal: spacing.xs },
  search: { marginTop: spacing.md },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: 2,
  },
  stats: { marginTop: spacing.md },
  day: { marginTop: 20, marginBottom: spacing.sm, marginHorizontal: spacing.xs },
  cell: { backgroundColor: colors.card },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  muted: { color: colors.muted },
  loading: { marginTop: spacing.xl },
  empty: { marginTop: 40, alignItems: 'center', gap: 6 },
});
