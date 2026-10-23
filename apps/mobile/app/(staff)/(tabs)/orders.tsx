import { Decimal } from '@tugeel/shared/money';
import { useRouter } from 'expo-router';
import { CalendarDays, ClipboardList, SlidersHorizontal } from 'lucide-react-native';
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
import { colors, radii, spacing, type } from '../../../src/theme/tokens';
import { ActiveChip, ChoiceChip, PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { OrderRow } from '../../../src/ui/order-row';
import { StatRow } from '../../../src/ui/stat-row';
import { HeaderIconButton, StoreHeader } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';

const PAGE_PRESETS: readonly RangePreset[] = ['today', 'week', 'month'];

type Opened = 'none' | 'filters' | 'dates';

/**
 * «Миний захиалгууд» (the MyOrders board, ADR-0068 #7; filters instead of a search, the owner
 * 2026-10-18): the days (today, a week, this month, or any range from the calendar), the filters
 * that are on as chips, the range's count, confirmed total and drafts, and the rep's own orders
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
    ? `${t('mobile.orders.drafts')}\n${draftsEstimate}`
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
    <View>
      <View style={styles.chips}>
        {today
          ? PAGE_PRESETS.map((entry) => (
              <ChoiceChip
                key={entry}
                compact
                label={t(`mobile.dateRange.presets.${entry}`)}
                selected={preset === entry}
                onPress={() => pick(presetRange(entry, today))}
              />
            ))
          : null}
        <ChoiceChip
          compact
          label={
            customRange && range
              ? t('mobile.orders.range', { from: monthDay(range.from), to: monthDay(range.to) })
              : t('mobile.orders.pickDates')
          }
          selected={customRange}
          icon={
            <CalendarDays
              size={15}
              strokeWidth={2}
              color={customRange ? colors.primaryForeground : colors.foreground}
            />
          }
          onPress={() => setOpened('dates')}
        />
      </View>
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
              label: draftsLabel,
            },
          ]}
        />
      </View>
      {orders.error ? <ProblemText problem={problemFrom(orders.error)} /> : null}
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
      />
      <SectionList
        sections={sections}
        keyExtractor={(order) => String(order.id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.list, { paddingBottom: inset + spacing.lg }]}
        ListHeaderComponent={header}
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

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: 2,
  },
  active: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.sm },
  stats: { marginTop: spacing.md },
  day: { marginTop: 20, marginBottom: spacing.sm, marginHorizontal: spacing.xs },
  cell: { backgroundColor: colors.card, overflow: 'hidden' },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  loading: { marginTop: spacing.xl },
  empty: { marginTop: spacing.sm, alignItems: 'center', gap: spacing.sm },
});
