import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { problemFrom } from '../../../src/api/problem';
import { useOrders, useRepContext } from '../../../src/api/rep';
import { monthOf, shiftMonth, shortDate, ubDate } from '../../../src/dates/dates';
import { colors, radii, spacing, type } from '../../../src/theme/tokens';
import {
  Card,
  EmptyState,
  Money,
  PaymentLabel,
  ProblemText,
  Screen,
  StatusPill,
} from '../../../src/ui/kit';

/** «Захиалга»: the rep's own orders of a month, newest first (ADR-0061 #5). */
export default function OrdersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const context = useRepContext();
  const thisMonth = context.data ? monthOf(context.data.today) : null;
  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => {
    if (month === null && thisMonth) setMonth(thisMonth);
  }, [month, thisMonth]);
  const orders = useOrders(month ?? '');
  const rows = useMemo(() => orders.data?.pages.flatMap((page) => page.data) ?? [], [orders.data]);
  const summary = orders.data?.pages[0]?.summary ?? null;

  return (
    <Screen>
      <View style={styles.months}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.orders.previous')}
          onPress={() => month && setMonth(shiftMonth(month, -1))}
          style={styles.arrow}
        >
          <ChevronLeft size={24} color={colors.primary} />
        </Pressable>
        <Text style={type.heading}>{month ?? ''}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.orders.next')}
          disabled={!month || month === thisMonth}
          onPress={() => month && setMonth(shiftMonth(month, 1))}
          style={[styles.arrow, (!month || month === thisMonth) && styles.disabled]}
        >
          <ChevronRight size={24} color={colors.primary} />
        </Pressable>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(order) => String(order.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            {orders.error ? <ProblemText problem={problemFrom(orders.error)} /> : null}
            {summary ? (
              <Card style={styles.summary}>
                <Text style={type.secondary}>
                  {t('mobile.orders.summary', { n: summary.count, drafts: summary.drafts })}
                </Text>
                <Money value={summary.total} style={type.heading} />
              </Card>
            ) : null}
          </>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/order/${item.id}`)}
            style={styles.row}
          >
            <View style={styles.rowHead}>
              <Text style={type.bodyStrong}>{item.number ?? t('common.none')}</Text>
              <StatusPill status={item.status} />
            </View>
            <Text style={type.body} numberOfLines={1}>
              {item.customerName}
            </Text>
            <View style={styles.rowHead}>
              <Text style={type.caption}>
                {t('mobile.orders.line', {
                  created: shortDate(ubDate(item.createdAt)),
                  delivery: shortDate(item.deliveryDate),
                  lines: item.lineCount,
                })}
              </Text>
              <Money value={item.total} />
            </View>
            <View style={styles.rowHead}>
              <Text style={type.caption}>{item.stageName ?? ''}</Text>
              <PaymentLabel method={item.paymentMethod} />
            </View>
          </Pressable>
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (orders.hasNextPage && !orders.isFetchingNextPage) void orders.fetchNextPage();
        }}
        refreshing={orders.isRefetching}
        onRefresh={() => void orders.refetch()}
        ListEmptyComponent={
          orders.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : (
            <EmptyState
              icon={<ClipboardList size={40} color={colors.muted} />}
              title={t('mobile.orders.empty')}
            />
          )
        }
        ListFooterComponent={
          orders.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  months: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.xs,
  },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  loading: { marginTop: spacing.xxl },
});
