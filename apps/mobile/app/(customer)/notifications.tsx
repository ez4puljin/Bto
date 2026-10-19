import { useRouter } from 'expo-router';
import { Banknote, Bell, Check, Clock, Receipt, X } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useStoreMe } from '../../src/api/customer';
import {
  type StoreNotice,
  type StoreNotification,
  useStoreMarkRead,
  useStoreNotifications,
  useStoreNotificationSummary,
} from '../../src/api/customer-notifications';
import { problemFrom } from '../../src/api/problem';
import { feedDayOf, type LinePart, storeLineOf } from '../../src/customer/feed-lines';
import {
  STORE_TILES,
  type StoreTile,
  storeFactsOf,
  storeTargetOf,
} from '../../src/customer/notifications';
import { ubTime } from '../../src/dates/dates';
import { formatMnt } from '../../src/format/format';
import { type FeedItem, feedOf, unreadIds } from '../../src/notifications/feed';
import { KIND_STYLES, KindIcon } from '../../src/notifications/kinds';
import { useCustomer } from '../../src/state/session';
import { colors, fonts, radii, spacing, type } from '../../src/theme/tokens';
import { Separator } from '../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { BarButton, LargeTitle, NavBar, Page } from '../../src/ui/layout';
import { Text } from '../../src/ui/text';

type Item = FeedItem<StoreNotice, StoreNotification>;

/**
 * «Мэдэгдэл» of «Bto300» (the Notifications board, ADR-0079 #8): the running notices for customers
 * and the store's own notifications (an order confirmed, cancelled or sold, a payment, an invoice
 * due) by day, newest first, one white group a day. A tap marks it read and opens its order,
 * invoice or «Тооцоо», a notice its page; «Бүгдийг уншсан» marks what is loaded.
 */
export default function CustomerNotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { me } = useCustomer();
  const today = useStoreMe().data?.today ?? me.store.today;
  const summary = useStoreNotificationSummary();
  const mine = useStoreNotifications();
  const { mutate: markRead, isPending } = useStoreMarkRead();
  const notices = useMemo(() => summary.data?.notices ?? [], [summary.data]);
  const rows = useMemo(() => mine.data?.pages.flatMap((page) => page.data) ?? [], [mine.data]);
  const sections = useMemo(
    () => feedOf(notices, rows).map((section) => ({ day: section.day, data: section.items })),
    [notices, rows],
  );
  const unread = unreadIds(notices, rows);
  const anyUnread = unread.noticeIds.length + unread.notificationIds.length > 0;

  const dayTitle = (day: string) => {
    const name = feedDayOf(day, today);
    switch (name.kind) {
      case 'today':
        return t('mobile.notifications.today');
      case 'yesterday':
        return t('mobile.customer.notifications.yesterdayDate', { date: name.date });
      case 'date':
        return t('mobile.orders.dayDate', {
          day: name.date,
          weekday: t(`mobile.weekdaysLong.${name.weekday}`),
        });
    }
  };

  const open = (item: Item) => {
    if (item.type === 'notice') {
      // The notice's page marks it read.
      router.push(`/notice/${item.notice.id}`);
      return;
    }
    const notification = item.notification;
    if (!notification.read) markRead({ notificationIds: [notification.id] });
    const target = storeTargetOf(notification);
    if (target === '/account') router.navigate('/account');
    else if (target !== null) router.push(target);
  };

  return (
    <Page>
      <NavBar
        back={t('mobile.tabs.home')}
        onBack={() => router.back()}
        right={
          <BarButton
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
            <LargeTitle style={styles.title}>{t('mobile.notifications.title')}</LargeTitle>
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
          mine.isFetchingNextPage ? (
            <ActivityIndicator style={styles.more} color={colors.primary} />
          ) : null
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
              hint={t('mobile.customer.notifications.emptyHint')}
            />
          )
        }
      />
    </Page>
  );
}

/** The white icon of a notification's tile. */
function TileIcon({ tile }: { tile: StoreTile }) {
  const props = { size: 18, strokeWidth: 2.4, color: colors.primaryForeground };
  switch (tile) {
    case 'check':
      return <Check {...props} strokeWidth={2.6} />;
    case 'cross':
      return <X {...props} strokeWidth={2.6} />;
    case 'clock':
      return <Clock {...props} />;
    case 'money':
      return <Banknote {...props} strokeWidth={2.2} />;
    case 'receipt':
      return <Receipt {...props} strokeWidth={2.2} />;
  }
}

/** The line's parts in words, joined with « · ». */
function useLineText() {
  const { t } = useTranslation();
  return (parts: readonly LinePart[]): string =>
    parts
      .map((part) => {
        switch (part.kind) {
          case 'number':
            return part.value;
          case 'money':
            return t('pricing.money', { amount: formatMnt(part.amount) });
          case 'backordered':
            return t('mobile.customer.orders.backorderedLines', { n: part.lines });
          case 'invoice':
            return t('mobile.notifications.soldInvoice', { number: part.number });
          case 'settled':
            return t('mobile.customer.notifications.settled', { numbers: part.numbers.join(', ') });
          case 'due':
            return t('mobile.customer.notifications.due', { date: part.date });
          case 'reason':
            return t('mobile.customer.notifications.reason', { reason: part.reason });
        }
      })
      .join(' · ');
}

function FeedRow({ item, onPress }: { item: Item; onPress: () => void }) {
  const { t } = useTranslation();
  const lineText = useLineText();
  const read = item.type === 'notice' ? item.notice.read : item.notification.read;
  const tint =
    item.type === 'notice'
      ? KIND_STYLES[item.notice.kind].tint
      : STORE_TILES[item.notification.kind].color;
  const title =
    item.type === 'notice'
      ? item.notice.title
      : t(`notifications.customerKinds.${item.notification.kind}`);
  const text =
    item.type === 'notice'
      ? item.notice.body
      : lineText(
          storeLineOf(
            item.notification.kind,
            storeFactsOf(item.notification.kind, item.notification.payload),
          ),
        );
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.tile, { backgroundColor: tint }]}>
        {item.type === 'notice' ? (
          <KindIcon kind={item.notice.kind} size={18} color={colors.primaryForeground} />
        ) : (
          <TileIcon tile={STORE_TILES[item.notification.kind].tile} />
        )}
      </View>
      <View style={styles.text}>
        <View style={styles.head}>
          <Text style={[styles.rowTitle, !read && styles.unreadTitle]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={type.secondary}>{ubTime(item.at)}</Text>
        </View>
        {text ? (
          <Text style={styles.body} numberOfLines={3}>
            {text}
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
  list: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  title: { marginTop: 2, marginHorizontal: spacing.xs },
  day: { marginTop: 18, marginBottom: spacing.sm, marginHorizontal: spacing.xs },
  cell: { backgroundColor: colors.card },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  pressed: { backgroundColor: colors.accent },
  tile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  more: { marginTop: spacing.lg },
});
