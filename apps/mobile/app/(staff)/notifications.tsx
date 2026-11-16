import { useRouter } from 'expo-router';
import { Bell, Check, CheckCheck } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/text';
import {
  type MyNotice,
  type MyNotification,
  useMarkRead,
  useMyNotifications,
  useNotificationSummary,
} from '../../src/api/notifications';
import { problemFrom } from '../../src/api/problem';
import { useRepContext } from '../../src/api/rep';
import { monthDay } from '../../src/dates/calendar';
import { ubTime } from '../../src/dates/dates';
import { formatMnt } from '../../src/format/format';
import { dayName, type FeedItem, feedOf, unreadIds } from '../../src/notifications/feed';
import { KIND_STYLES, KindIcon, useNoticeEyebrow } from '../../src/notifications/kinds';
import { colors, spacing, storeType, tabular, TOUCH, type } from '../../src/theme/tokens';
import { Group, ICON_INSET, IconTile } from '../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { Page, SectionHeader } from '../../src/ui/layout';
import { PAGE } from '../../src/ui/staff-kit';
import { StoreHeader } from '../../src/ui/store-header';

type Item = FeedItem<MyNotice, MyNotification>;

/**
 * «Мэдэгдэл» (the Notifications board of 2026-11-16; ADR-0062 #3, ADR-0068): the running notices
 * and the rep's sold orders, by day, newest first, one grouped card a day under the day's label. A
 * notice opens its page, a sold order the order; «Бүгдийг уншсан» on the blue header marks what is
 * loaded.
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
    return name === 'date' ? monthDay(day) : t(`mobile.notifications.${name}`);
  };

  const open = (item: Item) => {
    if (item.type === 'notice') {
      router.push(`/notice/${item.notice.id}`);
      return;
    }
    if (!item.notification.read) markRead({ notificationIds: [item.notification.id] });
    if (item.notification.orderId !== null) router.push(`/order/${item.notification.orderId}`);
  };

  const readAllOff = !anyUnread || isPending;

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.notifications.title')}
        onBack={() => router.back()}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: readAllOff }}
            disabled={readAllOff}
            onPress={() => markRead(unread)}
            hitSlop={8}
            style={[styles.readAll, readAllOff && styles.faded]}
          >
            <CheckCheck size={18} strokeWidth={2} color={colors.primaryForeground} />
            <Text style={storeType.headerButton}>{t('mobile.notifications.readAll')}</Text>
          </Pressable>
        }
      />
      <FlatList
        data={sections}
        keyExtractor={(section) => section.day}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          summary.error || mine.error ? (
            <View style={styles.problems}>
              {summary.error ? (
                <ProblemText problem={problemFrom(summary.error)} style={styles.problem} />
              ) : null}
              {mine.error ? (
                <ProblemText problem={problemFrom(mine.error)} style={styles.problem} />
              ) : null}
            </View>
          ) : null
        }
        renderItem={({ item: section }) => (
          <View style={styles.block}>
            <SectionHeader style={styles.label}>{dayTitle(section.day)}</SectionHeader>
            <Group inset={ICON_INSET}>
              {section.data.map((item) => (
                <FeedRow key={item.key} item={item} onPress={() => open(item)} />
              ))}
            </Group>
          </View>
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            {mine.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null}
            {sections.length > 0 ? (
              <Text style={[type.secondary, styles.note]}>{t('mobile.notifications.footer')}</Text>
            ) : null}
          </View>
        }
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
              icon={<Bell size={36} strokeWidth={1.6} color={colors.muted} />}
              title={t('mobile.notifications.empty')}
              hint={t('mobile.notifications.emptyHint')}
            />
          )
        }
      />
    </Page>
  );
}

/**
 * A row of a day: the kind's tile, the title with its time, what it says, and under it the kind
 * and days of a notice or a sold order's invoice; a blue dot while unread.
 */
function FeedRow({ item, onPress }: { item: Item; onPress: () => void }) {
  const { t } = useTranslation();
  const eyebrow = useNoticeEyebrow();
  const read = item.type === 'notice' ? item.notice.read : item.notification.read;
  const title =
    item.type === 'notice'
      ? item.notice.title
      : t('mobile.notifications.sold', { number: item.notification.orderNumber });
  const text =
    item.type === 'notice'
      ? item.notice.body
      : [
          item.notification.customerName,
          item.notification.orderTotal
            ? t('pricing.money', { amount: formatMnt(item.notification.orderTotal) })
            : null,
        ]
          .filter((part) => part !== null)
          .join(' · ');
  const caption =
    item.type === 'notice'
      ? eyebrow(item.notice)
      : item.notification.invoiceNumber
        ? t('mobile.notifications.soldInvoice', { number: item.notification.invoiceNumber })
        : null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <IconTile
        color={item.type === 'notice' ? KIND_STYLES[item.notice.kind].tint : colors.tint.green}
      >
        {item.type === 'notice' ? (
          <KindIcon kind={item.notice.kind} size={18} color={colors.primaryForeground} />
        ) : (
          <Check size={18} strokeWidth={2.6} color={colors.primaryForeground} />
        )}
      </IconTile>
      <View style={styles.text}>
        <View style={styles.head}>
          <Text style={[read ? type.row : type.rowStrong, styles.grow]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={[type.secondary, tabular]}>{ubTime(item.at)}</Text>
        </View>
        {text ? (
          <Text style={[type.secondary, !read && styles.unreadText]} numberOfLines={3}>
            {text}
          </Text>
        ) : null}
        {caption ? (
          <Text style={type.caption} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      {read ? null : (
        <View style={styles.unread} accessibilityLabel={t('mobile.notifications.unreadDot')} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { ...PAGE, paddingBottom: 40 },
  block: { gap: spacing.sm },
  label: { marginTop: 0, marginBottom: 0 },
  grow: { flex: 1 },
  readAll: {
    height: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  faded: { opacity: 0.5 },
  problems: { gap: spacing.sm },
  problem: { marginTop: 0 },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  pressed: { backgroundColor: colors.accent },
  text: { flex: 1, gap: 2 },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  unreadText: { color: colors.label2 },
  unread: { width: 9, height: 9, borderRadius: 5, marginTop: 6, backgroundColor: colors.primary },
  footer: { gap: spacing.md },
  note: { textAlign: 'center', marginHorizontal: spacing.md },
  loading: { marginTop: spacing.xxl },
});
