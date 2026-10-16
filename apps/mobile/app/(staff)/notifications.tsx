import { useRouter } from 'expo-router';
import { Bell, ChevronLeft } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import {
  type MyNotice,
  type MyNotification,
  useMarkRead,
  useMyNotifications,
  useNotificationSummary,
} from '../../src/api/notifications';
import { problemFrom } from '../../src/api/problem';
import { useRepContext } from '../../src/api/rep';
import { ubTime } from '../../src/dates/dates';
import { formatMnt } from '../../src/format/format';
import { dayName, type FeedItem, feedOf, unreadIds } from '../../src/notifications/feed';
import { FeedBadge, useNoticeEyebrow } from '../../src/notifications/kinds';
import { colors, radii, spacing, type } from '../../src/theme/tokens';
import { EmptyState, ProblemText, Screen, Title } from '../../src/ui/kit';

type Item = FeedItem<MyNotice, MyNotification>;

/**
 * «Мэдэгдэл» (ADR-0062 #3): the running notices and the rep's sold orders, newest first by day.
 * A notice opens its page, a sold order the order; «Бүгдийг уншсан» marks what is loaded.
 */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const context = useRepContext();
  const summary = useNotificationSummary();
  const mine = useMyNotifications();
  const { mutate: markRead, isPending } = useMarkRead();
  const notices = useMemo(() => summary.data?.notices ?? [], [summary.data]);
  const rows = useMemo(() => mine.data?.pages.flatMap((page) => page.data) ?? [], [mine.data]);
  const sections = useMemo(
    () => feedOf(notices, rows).map((section) => ({ day: section.day, data: section.items })),
    [notices, rows],
  );
  const unread = unreadIds(notices, rows);
  const anyUnread = unread.noticeIds.length + unread.notificationIds.length > 0;
  const today = context.data?.today ?? null;
  const dayTitle = (day: string) => {
    const name = today ? dayName(day, today) : 'date';
    return name === 'date' ? day : t(`mobile.notifications.${name}`);
  };

  const open = (item: Item) => {
    if (item.type === 'notice') {
      router.push(`/notice/${item.notice.id}`);
      return;
    }
    if (!item.notification.read) markRead({ notificationIds: [item.notification.id] });
    if (item.notification.orderId !== null) router.push(`/order/${item.notification.orderId}`);
  };

  return (
    <Screen>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <ChevronLeft size={24} color={colors.primary} />
          <Text style={[type.body, { color: colors.link }]}>{t('common.back')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !anyUnread || isPending }}
          disabled={!anyUnread || isPending}
          onPress={() => markRead(unread)}
          style={styles.readAll}
        >
          <Text style={[type.body, { color: anyUnread ? colors.link : colors.muted }]}>
            {t('mobile.notifications.readAll')}
          </Text>
        </Pressable>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={styles.head}>
            <Title>{t('mobile.notifications.title')}</Title>
            {summary.error ? <ProblemText problem={problemFrom(summary.error)} /> : null}
            {mine.error ? <ProblemText problem={problemFrom(mine.error)} /> : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[type.caption, styles.day]}>{dayTitle(section.day)}</Text>
        )}
        renderItem={({ item }) => <FeedRow item={item} onPress={() => open(item)} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (mine.hasNextPage && !mine.isFetchingNextPage) void mine.fetchNextPage();
        }}
        refreshing={summary.isRefetching || mine.isRefetching}
        onRefresh={() => {
          void summary.refetch();
          void mine.refetch();
        }}
        ListEmptyComponent={
          summary.isLoading || mine.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : (
            <EmptyState
              icon={<Bell size={40} color={colors.muted} />}
              title={t('mobile.notifications.empty')}
              hint={t('mobile.notifications.emptyHint')}
            />
          )
        }
        ListFooterComponent={
          mine.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null
        }
      />
    </Screen>
  );
}

function FeedRow({ item, onPress }: { item: Item; onPress: () => void }) {
  const { t } = useTranslation();
  const eyebrow = useNoticeEyebrow();
  const read = item.type === 'notice' ? item.notice.read : item.notification.read;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <FeedBadge kind={item.type === 'notice' ? item.notice.kind : 'ORDER_SOLD'} />
      <View style={styles.grow}>
        <View style={styles.rowHead}>
          <Text style={[type.bodyStrong, styles.grow]} numberOfLines={2}>
            {item.type === 'notice'
              ? item.notice.title
              : t('mobile.notifications.sold', { number: item.notification.orderNumber })}
          </Text>
          <Text style={type.caption}>{ubTime(item.at)}</Text>
          {read ? null : (
            <View style={styles.unread} accessibilityLabel={t('mobile.notifications.unreadDot')} />
          )}
        </View>
        {item.type === 'notice' ? (
          <>
            <Text style={type.secondary} numberOfLines={2}>
              {item.notice.body}
            </Text>
            <Text style={type.caption}>{eyebrow(item.notice)}</Text>
          </>
        ) : (
          <>
            <Text style={type.secondary} numberOfLines={1}>
              {item.notification.customerName}
            </Text>
            <Text style={type.caption}>
              {[
                item.notification.orderTotal
                  ? t('mobile.notifications.soldTotal', {
                      amount: t('pricing.money', {
                        amount: formatMnt(item.notification.orderTotal),
                      }),
                    })
                  : null,
                item.notification.invoiceNumber
                  ? t('mobile.notifications.soldInvoice', {
                      number: item.notification.invoiceNumber,
                    })
                  : null,
              ]
                .filter((part) => part !== null)
                .join(' · ')}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, minHeight: 44 },
  readAll: { padding: spacing.md, minHeight: 44, justifyContent: 'center' },
  head: { gap: spacing.sm, marginBottom: spacing.sm },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  day: { marginTop: spacing.md, marginBottom: spacing.xs, textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.md,
  },
  grow: { flex: 1, gap: 2 },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  unread: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    backgroundColor: colors.primary,
  },
  loading: { marginTop: spacing.xxl },
});
