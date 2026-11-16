import { Decimal } from '@tugeel/shared/money';
import { useRouter } from 'expo-router';
import { CalendarDays, ClipboardList, SlidersHorizontal } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, View } from 'react-native';
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
import { shortMoney } from '../../../src/orders/amounts';
import { DateRangeSheet } from '../../../src/orders/date-range-sheet';
import { OrderFilterSheet } from '../../../src/orders/order-filter-sheet';
import {
  activeOrderFilters,
  EMPTY_ORDER_FILTERS,
  type OrderFilterKey,
  type OrderFilters,
  orderFilterCount,
  orderFilterParams,
  withoutFilter,
} from '../../../src/orders/order-filters';
import { colors, fonts, radii, shadows, spacing, type } from '../../../src/theme/tokens';
import { ActiveChip, PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { OrderRow } from '../../../src/ui/order-row';
import { StatTile, StatTiles } from '../../../src/ui/staff-kit';
import { HeaderIconButton, StoreHeader } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';

const PAGE_PRESETS: readonly RangePreset[] = ['today', 'week', 'month'];

type Opened = 'none' | 'filters' | 'dates';

/**
 * «Миний захиалгууд» (the Orders board of 2026-11-16 on ADR-0068 #7; filters instead of a search,
 * the owner 2026-10-18): the days in the blue band (today, a week, this month, or any range from
 * the calendar), the range's count, confirmed total and drafts as three tiles, the filters that
 * are on as chips, and the rep's own orders
 * by day, newest first. The filter button on Bto300's blue header (ADR-0100) opens customer,
 * product, payment, delivery and state.
 */
export default function OrdersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useStoreTabBarInset();
  const context = useRepContext();
  const today = context.data?.today ?? null;
  const [picked, setPicked] = useState<DateRange | null>(null);
  const [filters, setFilters] = useState<OrderFilters>(EMPTY_ORDER_FILTERS);
  const [opened, setOpened] = useState<Opened>('none');
  // Stable while nothing changes, so an open sheet keeps its draft over a refetch.
  const range = useMemo(
    () => picked ?? (today ? presetRange('month', today) : null),
    [picked, today],
  );
  const orders = useOrders(range ? { ...range, ...orderFilterParams(filters) } : null);
  const rows = useMemo(() => orders.data?.pages.flatMap((page) => page.data) ?? [], [orders.data]);
  const summary = orders.data?.pages[0]?.summary ?? null;
  const preset = range && today ? presetOf(range, today) : null;
  const filterCount = orderFilterCount(filters);

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
  const totalText = summary ? shortMoney(t, summary.total) : t('common.none');
  // The drafts' estimate at today's prices, a line under their count (a draft without a price
  // adds none; nothing when no draft has one).
  const draftsEstimate =
    summary && new Decimal(summary.draftsEstimate).gt(0)
      ? t('mobile.orders.approx', { amount: shortMoney(t, summary.draftsEstimate) })
      : null;
  const draftsLabel = draftsEstimate
    ? `${t('mobile.orders.drafts')} · ${draftsEstimate}`
    : t('mobile.orders.drafts');
  // This month follows today (a new day, a new month); only days the rep chose stay put.
  const pick = (days: DateRange) => {
    if (!today) return;
    const month = presetRange('month', today);
    setPicked(days.from === month.from && days.to === month.to ? null : days);
  };

  const chipLabel = (key: OrderFilterKey): string => {
    switch (key) {
      case 'customer':
        return filters.customer?.name ?? '';
      case 'product':
        return filters.product?.name ?? '';
      case 'paymentMethod':
        return filters.paymentMethod ? t(`sales.paymentMethods.${filters.paymentMethod}`) : '';
      case 'fulfilment':
        return filters.fulfilment ? t(`sales.fulfilments.${filters.fulfilment}`) : '';
      case 'state':
        return filters.state ? t(`mobile.orderFilter.states.${filters.state}`) : '';
    }
  };
  const active = activeOrderFilters(filters);
  const customRange = preset === null && range !== null;

  const header = (
    <View style={styles.head}>
      <StatTiles>
        <StatTile
          value={summary ? String(summary.count) : t('common.none')}
          label={t('mobile.orders.count')}
        />
        <StatTile value={totalText} label={t('mobile.orders.confirmed')} />
        <StatTile value={summary ? String(summary.drafts) : t('common.none')} label={draftsLabel} />
      </StatTiles>
      {active.length > 0 ? (
        <View style={styles.active}>
          {active.map((key) => {
            const label = chipLabel(key);
            return (
              <ActiveChip
                key={key}
                label={label}
                onPress={() => setOpened('filters')}
                onRemove={() => setFilters(withoutFilter(filters, key))}
                removeLabel={t('mobile.orders.removeFilter', { name: label })}
              />
            );
          })}
        </View>
      ) : null}
      {orders.error ? (
        <ProblemText problem={problemFrom(orders.error)} style={styles.problem} />
      ) : null}
    </View>
  );

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.tabs.orders')}
        right={
          <HeaderIconButton
            icon={
              <SlidersHorizontal size={22} strokeWidth={1.9} color={colors.primaryForeground} />
            }
            label={t('mobile.orders.filterButton', { n: filterCount })}
            badge={filterCount}
            onPress={() => setOpened('filters')}
          />
        }
      >
        {/* The period in the blue band: today, a week, this month, or days from the calendar. */}
        <View accessibilityRole="radiogroup" style={styles.periods}>
          {today
            ? PAGE_PRESETS.map((entry) => (
                <Period
                  key={entry}
                  label={t(`mobile.dateRange.presets.${entry}`)}
                  selected={preset === entry}
                  onPress={() => pick(presetRange(entry, today))}
                />
              ))
            : null}
          <Period
            label={
              customRange && range
                ? t('mobile.orders.range', { from: monthDay(range.from), to: monthDay(range.to) })
                : t('mobile.orders.pickDates')
            }
            selected={customRange}
            calendar
            onPress={() => setOpened('dates')}
          />
        </View>
      </StoreHeader>
      <SectionList
        sections={sections}
        keyExtractor={(order) => String(order.id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.list, { paddingBottom: inset + spacing.lg }]}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => (
          <SectionHeader style={styles.day}>{dayTitle(section.day)}</SectionHeader>
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
              <EmptyState
                icon={<ClipboardList size={44} strokeWidth={1.5} color={colors.input} />}
                title={t('mobile.orders.empty')}
                hint={t('mobile.orders.emptyHint')}
              />
              {filterCount > 0 ? (
                <PillButton
                  title={t('mobile.orders.clearFilters')}
                  variant="soft"
                  height={44}
                  onPress={() => setFilters(EMPTY_ORDER_FILTERS)}
                />
              ) : null}
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
        <>
          <DateRangeSheet
            visible={opened === 'dates'}
            today={today}
            range={range}
            onApply={(next) => {
              pick(next);
              setOpened('none');
            }}
            onClose={() => setOpened('none')}
          />
          <OrderFilterSheet
            visible={opened === 'filters'}
            today={today}
            range={range}
            filters={filters}
            onApply={(next, days) => {
              setFilters(next);
              pick(days);
              setOpened('none');
            }}
            onClose={() => setOpened('none')}
          />
        </>
      ) : null}
    </Page>
  );
}

/** One part of the period control on the blue band: white with blue words when chosen. */
function Period({
  label,
  selected,
  calendar = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  calendar?: boolean;
  onPress: () => void;
}) {
  const ink = selected ? colors.link : colors.primaryForeground;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      hitSlop={{ top: 5, bottom: 5 }}
      style={[styles.period, selected && styles.periodOn]}
    >
      {calendar ? <CalendarDays size={15} strokeWidth={2} color={ink} /> : null}
      <Text
        style={[type.chip, { color: ink }, selected && styles.periodStrong]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg },
  periods: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.onPrimaryHairline,
  },
  period: {
    flexGrow: 1,
    flexShrink: 1,
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: 6,
    borderRadius: 9,
  },
  periodOn: { backgroundColor: colors.card, boxShadow: shadows.segment },
  periodStrong: { fontFamily: fonts.semibold },
  head: { paddingTop: spacing.md, gap: spacing.md },
  active: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  problem: { marginTop: 0 },
  day: { marginTop: spacing.lg, marginBottom: spacing.sm },
  cell: { backgroundColor: colors.card, overflow: 'hidden' },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  loading: { marginTop: spacing.xl },
  empty: { marginTop: spacing.sm, alignItems: 'center', gap: spacing.sm },
});
