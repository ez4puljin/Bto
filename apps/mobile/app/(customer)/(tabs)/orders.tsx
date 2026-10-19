import { useRouter } from 'expo-router';
import { ClipboardList } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, SectionList, StyleSheet, View } from 'react-native';
import {
  type StoreOrderRow as StoreOrderRowData,
  useStoreMe,
  useStoreOrders,
} from '../../../src/api/customer';
import { problemFrom } from '../../../src/api/problem';
import { orderDayOf } from '../../../src/customer/order-lines';
import { StoreOrderRow, useOrderMeta } from '../../../src/customer/order-row';
import { byDay, ORDER_PRESETS, type OrderPreset, presetRange } from '../../../src/customer/orders';
import { shortMoney } from '../../../src/orders/amounts';
import { colors, radii, spacing, type } from '../../../src/theme/tokens';
import { ChoiceChip, PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { LargeTitle, Page } from '../../../src/ui/layout';
import { StatRow } from '../../../src/ui/stat-row';
import { useTabBarInset } from '../../../src/ui/tab-bar';
import { Text } from '../../../src/ui/text';

/**
 * «Захиалга» (the Orders board, ADR-0079 #6): every order of the store from the app, the office and
 * the reps, for today, the last 7 days or this month; the count, the confirmed total and the orders
 * waiting for the office; the orders by day, newest first, each opening its page.
 */
export default function StoreOrdersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useTabBarInset();
  const meta = useOrderMeta();
  const me = useStoreMe();
  const today = me.data?.today ?? null;
  const [preset, setPreset] = useState<OrderPreset>('week');
  const range = useMemo(() => (today ? presetRange(preset, today) : null), [preset, today]);
  const orders = useStoreOrders(range);
  const rows = useMemo(() => orders.data?.pages.flatMap((page) => page.data) ?? [], [orders.data]);
  const summary = orders.data?.pages[0]?.summary ?? null;
  const sections = useMemo(
    () => byDay(rows).map((group) => ({ day: group.date, data: group.orders })),
    [rows],
  );

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

  const header = (
    <View>
      <View style={styles.bar} />
      <LargeTitle style={styles.title}>{t('mobile.tabs.orders')}</LargeTitle>
      <Text style={[type.row, styles.subtitle]}>{t('mobile.customer.orders.subtitle')}</Text>
      <View style={styles.chips}>
        {ORDER_PRESETS.map((entry) => (
          <ChoiceChip
            key={entry}
            compact
            label={t(`mobile.dateRange.presets.${entry}`)}
            selected={preset === entry}
            onPress={() => setPreset(entry)}
          />
        ))}
      </View>
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
                hint={t('mobile.customer.orders.emptyHint')}
              />
              <PillButton
                title={t('mobile.customer.cart.browse')}
                variant="soft"
                height={44}
                onPress={() => router.navigate('/shop')}
              />
            </View>
          )
        }
        ListFooterComponent={
          orders.isFetchingNextPage ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : null
        }
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg },
  bar: { height: 38 },
  title: { marginHorizontal: spacing.xs },
  subtitle: { marginTop: 2, marginHorizontal: spacing.xs, color: colors.muted },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: 2,
  },
  stats: { marginTop: spacing.md },
  day: { marginTop: 20, marginBottom: spacing.sm, marginHorizontal: spacing.xs },
  cell: { backgroundColor: colors.card, overflow: 'hidden' },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  loading: { marginTop: spacing.xl },
  empty: { marginTop: spacing.sm, alignItems: 'center', gap: spacing.sm },
});
