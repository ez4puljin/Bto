import { useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, View } from 'react-native';
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
import { FeedBadge, useNoticeEyebrow } from '../../src/notifications/kinds';
import { brandSheet } from '../../src/theme/brand';
import { colors, fonts, spacing, type } from '../../src/theme/tokens';
import { Separator } from '../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { FootNote, Page } from '../../src/ui/layout';
import { HeaderTextButton, StoreHeader } from '../../src/ui/store-header';

type Item = FeedItem<MyNotice, MyNotification>;

/**
 * «Мэдэгдэл» (the Notifications board; ADR-0062 #3, ADR-0068): the running notices and the rep's
 * sold orders, by day, newest first, in one group a day with a hairline on the white page
 * («Bto300»'s look, ADR-0100). A notice opens its page, a sold order the order; «Бүгдийг уншсан»
 * on the blue header marks what is loaded.
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

  return (
    <Page white edges={[]}>
      <StoreHeader
        title={t('mobile.notifications.title')}
        onBack={() => router.back()}
        right={
          <HeaderTextButton
            title={t('mobile.notifications.readAll')}
            disabled={!anyUnread || isPending}
            onPress={() => markRead(unread)}
          />
        }
      />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            {summary.error ? <ProblemText problem={problemFrom(summary.error)} /> : null}
            {mine.error ? <ProblemText problem={problemFrom(mine.error)} /> : null}
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
            <FeedRow item={item} onPress={() => open(item)} />
          </View>
        )}
        ListFooterComponent={
          <View>
            {mine.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null}
            {sections.length > 0 ? <FootNote>{t('mobile.notifications.footer')}</FootNote> : null}
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
              icon={<Bell size={40} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.notifications.empty')}
              hint={t('mobile.notifications.emptyHint')}
            />
          )
        }
      />
    </Page>
  );
}

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
      ? [item.notice.body, eyebrow(item.notice)].join(' · ')
      : [
          item.notification.customerName,
          item.notification.orderTotal
            ? t('pricing.money', { amount: formatMnt(item.notification.orderTotal) })
            : null,
          item.notification.invoiceNumber
            ? t('mobile.notifications.soldInvoice', { number: item.notification.invoiceNumber })
            : null,
        ]
          .filter((part) => part !== null)
          .join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <FeedBadge kind={item.type === 'notice' ? item.notice.kind : 'ORDER_SOLD'} />
      <View style={styles.text}>
        <View style={styles.head}>
          <Text style={[styles.rowTitle, !read && styles.unreadTitle]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={type.secondary}>{ubTime(item.at)}</Text>
        </View>
        <Text style={styles.body} numberOfLines={3}>
          {text}
        </Text>
      </View>
      {read ? null : (
        <View style={styles.unread} accessibilityLabel={t('mobile.notifications.unreadDot')} />
      )}
    </Pressable>
  );
}

const styles = brandSheet(() =>
  StyleSheet.create({
    list: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
    day: { marginTop: 18, marginBottom: spacing.sm, marginHorizontal: spacing.xs },
    cell: {
      backgroundColor: colors.card,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: colors.border,
    },
    firstCell: { borderTopWidth: 1, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
    lastCell: { borderBottomWidth: 1, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
    row: {
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
    rowTitle: { ...type.rowStrong, flex: 1 },
    unreadTitle: { fontFamily: fonts.bold },
    body: { ...type.body, color: colors.label2 },
    unread: { width: 9, height: 9, borderRadius: 5, marginTop: 6, backgroundColor: colors.primary },
    loading: { marginTop: spacing.xxl },
  }),
);
