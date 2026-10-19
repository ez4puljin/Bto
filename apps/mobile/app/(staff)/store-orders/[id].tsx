import { useLocalSearchParams, useRouter } from 'expo-router';
import { ClipboardList } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, SectionList, StyleSheet, View } from 'react-native';
import { problemFrom } from '../../../src/api/problem';
import { useRepContext, useStoreOrders } from '../../../src/api/rep';
import { dayNameOf, monthDay } from '../../../src/dates/calendar';
import { weekdayOf } from '../../../src/dates/dates';
import { StoreOrderRow } from '../../../src/orders/store-order-row';
import { byDay } from '../../../src/orders/store-orders';
import { colors, radii, spacing, type } from '../../../src/theme/tokens';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { FootNote, LargeTitle, NavBar, Page } from '../../../src/ui/layout';
import { Text } from '../../../src/ui/text';

/**
 * «Захиалгын түүх» of a store (the owner, 2026-10-18), opened from its card on the map: every
 * order of the store, anyone's (the office, other reps, the rep's own), by day, newest first, with
 * who took it, when, the amount and the status. Only the rep's own orders open.
 */
export default function StoreOrdersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const customerId = Number.parseInt(id ?? '', 10);
  const orders = useStoreOrders(Number.isFinite(customerId) ? customerId : null);
  const today = useRepContext().data?.today ?? null;
  const rows = useMemo(() => orders.data?.pages.flatMap((page) => page.data) ?? [], [orders.data]);
  const sections = useMemo(() => byDay(rows), [rows]);

  const dayTitle = (day: string) => {
    const weekday = weekdayOf(day) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const date = t('mobile.orders.dayDate', {
      day: monthDay(day),
      weekday: t(`mobile.weekdaysLong.${weekday}`),
    });
    const named = today ? dayNameOf(day, today) : 'date';
    return named === 'today' || named === 'yesterday'
      ? t('mobile.checkout.namedDay', { name: t(`mobile.days.${named}`), day: date })
      : date;
  };

  return (
    <Page>
      <NavBar
        back={t('mobile.map.title')}
        onBack={() => router.back()}
        {...(name ? { title: t('mobile.storeOrders.title') } : {})}
      />
      <SectionList
        sections={sections}
        keyExtractor={(order) => String(order.id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <LargeTitle style={styles.title}>{name || t('mobile.storeOrders.title')}</LargeTitle>
            {orders.error ? <ProblemText problem={problemFrom(orders.error)} /> : null}
          </View>
        }
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
            <StoreOrderRow
              order={item}
              withDate={false}
              onOpen={(orderId) => router.push(`/order/${orderId}`)}
            />
          </View>
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (orders.hasNextPage && !orders.isFetchingNextPage) void orders.fetchNextPage();
        }}
        refreshing={orders.isRefetching && !orders.isFetchingNextPage}
        onRefresh={() => void orders.refetch()}
        ListEmptyComponent={
          orders.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : orders.error ? null : (
            <EmptyState
              icon={<ClipboardList size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.storeOrders.empty')}
              hint={t('mobile.storeOrders.emptyHint')}
            />
          )
        }
        ListFooterComponent={
          <View>
            {orders.isFetchingNextPage ? (
              <ActivityIndicator style={styles.loading} color={colors.primary} />
            ) : null}
            {sections.length > 0 ? <FootNote>{t('mobile.storeOrders.footer')}</FootNote> : null}
          </View>
        }
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  title: { marginTop: 2, marginHorizontal: spacing.xs },
  day: { marginTop: 22, marginBottom: spacing.sm, marginHorizontal: spacing.xs },
  cell: { backgroundColor: colors.card },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  loading: { marginTop: spacing.xl },
});
