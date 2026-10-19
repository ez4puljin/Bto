import { useRouter } from 'expo-router';
import { CalendarDays, ClipboardList, SlidersHorizontal } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, SectionList, StyleSheet, View } from 'react-native';
import {
  type StoreOrderRow as StoreOrderRowData,
  useStoreMe,
  useStoreOrders,
} from '../../../src/api/customer';
import { problemFrom } from '../../../src/api/problem';
import { StoreOrderFilterSheet } from '../../../src/customer/order-filter-sheet';
import {
  activeStoreFilters,
  EMPTY_STORE_ORDER_FILTERS,
  type StoreOrderFilterKey,
  type StoreOrderFilters,
  storeOrderParams,
  withoutStoreFilter,
} from '../../../src/customer/order-filters';
import { orderDayOf } from '../../../src/customer/order-lines';
import { StoreOrderRow, useOrderMeta } from '../../../src/customer/order-row';
import { byDay } from '../../../src/customer/orders';
import {
  type DateRange,
  monthDay,
  presetOf,
  presetRange,
  type RangePreset,
} from '../../../src/dates/calendar';
import { shortMoney } from '../../../src/orders/amounts';
import { DateRangeSheet } from '../../../src/orders/date-range-sheet';
import { colors, radii, spacing, type } from '../../../src/theme/tokens';
import { ActiveChip, ChoiceChip, CircleButton, PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { LargeTitle, Page } from '../../../src/ui/layout';
import { StatRow } from '../../../src/ui/stat-row';
import { useTabBarInset } from '../../../src/ui/tab-bar';
import { Text } from '../../../src/ui/text';

/** The days the page offers as chips (the Orders board); the calendar sets any other. */
const PAGE_PRESETS: readonly RangePreset[] = ['today', 'week', 'month'];

/** The page opens on the last 7 days (the Orders board). */
const DEFAULT_PRESET: RangePreset = 'week';

type Opened = 'none' | 'filters' | 'dates';

/**
 * «Захиалга» (the Orders board, ADR-0079 #6): every order of the store from the app, the office and
 * every rep, for today, 7 days, this month or days from the calendar, filtered like the rep app's
 * history (the owner 2026-10-20: who took it — «Апп», «Оффис», «Бүх ХТ» or one rep —, a product,
 * the payment, delivery or pickup, the state); the count, the confirmed total and the orders
 * waiting for the office; the orders by day, newest first, each opening its page.
 */
export default function StoreOrdersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useTabBarInset();
  const meta = useOrderMeta();
  const me = useStoreMe();
  const today = me.data?.today ?? null;
  const [picked, setPicked] = useState<DateRange | null>(null);
  const [filters, setFilters] = useState<StoreOrderFilters>(EMPTY_STORE_ORDER_FILTERS);
  const [opened, setOpened] = useState<Opened>('none');
  const defaultRange = useMemo(() => (today ? presetRange(DEFAULT_PRESET, today) : null), [today]);
  const range = picked ?? defaultRange;
  const query = useMemo(
    () => (range ? { ...range, ...storeOrderParams(filters) } : null),
    [range, filters],
  );
  const orders = useStoreOrders(query);
  const rows = useMemo(() => orders.data?.pages.flatMap((page) => page.data) ?? [], [orders.data]);
  const summary = orders.data?.pages[0]?.summary ?? null;
  const sections = useMemo(
    () => byDay(rows).map((group) => ({ day: group.date, data: group.orders })),
    [rows],
  );
  const preset = range && today ? presetOf(range, today) : null;
  const active = activeStoreFilters(filters);
  const customRange = preset === null && range !== null;

  // The default days follow today (a new day, a new week); only days the store chose stay put.
  const pick = (days: DateRange) => {
    if (!defaultRange) return;
    setPicked(days.from === defaultRange.from && days.to === defaultRange.to ? null : days);
  };

  const dayTitle = (date: string) => {
    const day = orderDayOf(date, today);
    const text = t('mobile.orders.dayDate', {
      day: day.day,
      weekday: t(`mobile.weekdaysLong.${day.weekday}`),
    });
    return day.name
      ? t('mobile.checkout.namedDay', { name: t(`mobile.days.${day.name}`), day: text })
      : text;
  };

  const chipLabel = (key: StoreOrderFilterKey): string => {
    switch (key) {
      case 'taker': {
        const taker = filters.taker;
        if (!taker) return '';
        if (taker.kind === 'APP') return t('mobile.customer.orders.takerApp');
        if (taker.kind === 'OFFICE') return t('mobile.customer.orders.takerOffice');
        return taker.rep
          ? t('mobile.customer.orders.takerRep', { name: taker.rep.name })
          : t('mobile.customer.orderFilter.allReps');
      }
      case 'product':
        return filters.product?.name ?? '';
      case 'paymentMethod':
        return filters.paymentMethod ? t(`sales.paymentMethods.${filters.paymentMethod}`) : '';
      case 'fulfilment':
        return filters.fulfilment ? t(`sales.fulfilments.${filters.fulfilment}`) : '';
      case 'state':
        return filters.state ? t(`sales.customerStates.${filters.state}`) : '';
    }
  };

  const header = (
    <View>
      <View style={styles.bar} />
      <View style={styles.head}>
        <LargeTitle style={styles.title}>{t('mobile.tabs.orders')}</LargeTitle>
        <CircleButton
          icon={<SlidersHorizontal size={22} strokeWidth={1.9} color={colors.foreground} />}
          label={t('mobile.orders.filterButton', { n: active.length })}
          badge={active.length}
          badgeTone="accent"
          badgeRing={colors.canvas}
          onPress={() => setOpened('filters')}
        />
      </View>
      <Text style={[type.row, styles.subtitle]}>{t('mobile.customer.orders.subtitle')}</Text>
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
                onRemove={() => setFilters(withoutStoreFilter(filters, key))}
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
            {
              value: summary ? shortMoney(t, summary.confirmedTotal) : t('common.none'),
              label: t('mobile.orders.confirmed'),
            },
            {
              value: summary ? String(summary.pending) : t('common.none'),
              label: t('mobile.customer.orders.pending'),
            },
          ]}
        />
      </View>
      {me.error ? <ProblemText problem={problemFrom(me.error)} /> : null}
      {orders.error ? <ProblemText problem={problemFrom(orders.error)} /> : null}
    </View>
  );

  const renderOrder = ({
    item,
    index,
    section,
  }: {
    item: StoreOrderRowData;
    index: number;
    section: { data: readonly StoreOrderRowData[] };
  }) => (
    <View
      style={[
        styles.cell,
        index === 0 && styles.firstCell,
        index === section.data.length - 1 && styles.lastCell,
      ]}
    >
      {index > 0 ? <Separator /> : null}
      <StoreOrderRow
        order={item}
        meta={meta(item)}
        onPress={() => router.push(`/order/${item.id}`)}
      />
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
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={[type.sectionHeader, styles.day]}>
            {dayTitle(section.day)}
          </Text>
        )}
        renderItem={renderOrder}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (orders.hasNextPage && !orders.isFetchingNextPage) void orders.fetchNextPage();
        }}
        refreshing={orders.isRefetching && !orders.isFetchingNextPage}
        onRefresh={() => {
          void me.refetch();
          void orders.refetch();
        }}
        ListEmptyComponent={
          orders.isLoading || (!range && !me.error) ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : orders.error || me.error ? null : (
            <View style={styles.empty}>
              <EmptyState
                icon={<ClipboardList size={44} strokeWidth={1.5} color={colors.input} />}
                title={t('mobile.customer.orders.empty')}
                hint={
                  active.length > 0
                    ? t('mobile.orders.emptyHint')
                    : t('mobile.customer.orders.emptyHint')
                }
              />
              {active.length > 0 ? (
                <PillButton
                  title={t('mobile.orders.clearFilters')}
                  variant="soft"
                  height={44}
                  onPress={() => setFilters(EMPTY_STORE_ORDER_FILTERS)}
                />
              ) : (
                <PillButton
                  title={t('mobile.customer.cart.browse')}
                  variant="soft"
                  height={44}
                  onPress={() => router.navigate('/shop')}
                />
              )}
            </View>
          )
        }
        ListFooterComponent={
          orders.isFetchingNextPage ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : null
        }
      />
      {today && range && defaultRange ? (
        <>
          <StoreOrderFilterSheet
            visible={opened === 'filters'}
            today={today}
            range={range}
            defaultRange={defaultRange}
            filters={filters}
            onApply={(next, days) => {
              setFilters(next);
              pick(days);
              setOpened('none');
            }}
            onClose={() => setOpened('none')}
          />
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
        </>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg },
  bar: { height: 38 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { marginHorizontal: spacing.xs, flexShrink: 1 },
  subtitle: { marginTop: 2, marginHorizontal: spacing.xs, color: colors.muted },
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
