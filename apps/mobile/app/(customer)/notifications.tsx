import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Banknote, Bell, Check, Clock, Megaphone, Receipt, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
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
  type NoticeTab,
  noticeTabsOf,
  STORE_TILES,
  type StoreTile,
  storeFactsOf,
  storeTargetOf,
} from '../../src/customer/notifications';
import { ubTime } from '../../src/dates/dates';
import { formatMnt } from '../../src/format/format';
import { feedOf, unreadIds } from '../../src/notifications/feed';
import { KIND_STYLES, KindIcon, useNoticeEyebrow } from '../../src/notifications/kinds';
import { useCustomer } from '../../src/state/session';
import { colors, fonts, spacing, storeType, type } from '../../src/theme/tokens';
import { Separator } from '../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { HeaderTextButton, StoreHeader } from '../../src/ui/store-header';
import { Page } from '../../src/ui/layout';
import { Text } from '../../src/ui/text';

/**
 * «Мэдэгдэл» of «Bto300» (the Notifications board, ADR-0079 #8, ADR-0092 #8) in two tabs:
 * «Захиалга» holds the store's own notifications (an order confirmed, cancelled or sold, a payment,
 * an invoice due) by day, newest first; «Урамшуулал» the admin's notices as picture cards. Each tab
 * counts its unread and the screen opens on the first with any. A tap marks a notification read and
 * opens its order, invoice or «Тооцоо», a notice its page; «Бүгдийг уншсан» marks what is loaded.
 */
export default function CustomerNotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { me } = useCustomer();
  const today = useStoreMe().data?.today ?? me.store.today;
  const summary = useStoreNotificationSummary();
  const mine = useStoreNotifications();
  const { mutate: markRead, isPending } = useStoreMarkRead();
  const notices = useMemo(
    () =>
      [...(summary.data?.notices ?? [])].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      ),
    [summary.data],
  );
  const rows = useMemo(() => mine.data?.pages.flatMap((page) => page.data) ?? [], [mine.data]);
  const sections = useMemo(
    () => feedOf([], rows).map((section) => ({ day: section.day, data: section.items })),
    [rows],
  );
  const tabs = noticeTabsOf(notices, rows);
  const [chosen, setChosen] = useState<NoticeTab | null>(null);
  const loaded = summary.data !== undefined && mine.data !== undefined;
  // The tab is picked once, when both lists are in: reading a notice must not flip it.
  const first = tabs.first;
  useEffect(() => {
    if (loaded && chosen === null) setChosen(first);
  }, [loaded, chosen, first]);
  const tab = chosen ?? 'orders';
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

  const openNotification = (notification: StoreNotification) => {
    if (!notification.read) markRead({ notificationIds: [notification.id] });
    const target = storeTargetOf(notification);
    if (target === '/account') router.navigate('/account');
    else if (target !== null) router.push(target);
  };

  const tabLabel = (name: NoticeTab, n: number) => {
    const label = t(`mobile.customer.notifications.tabs.${name}`);
    return n > 0 ? t('mobile.customer.notifications.tabs.count', { tab: label, n }) : label;
  };

  const head = (
    <View>
      <View
        accessibilityRole="tablist"
        accessibilityLabel={t('mobile.customer.notifications.tabs.label')}
        style={styles.tabs}
      >
        {(['orders', 'promos'] as const).map((name) => (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === name }}
            onPress={() => setChosen(name)}
            style={[styles.tabButton, tab === name ? styles.tabOn : styles.tabOff]}
          >
            <Text style={storeType.tabButton} numberOfLines={1}>
              {tabLabel(name, name === 'orders' ? tabs.orders : tabs.promos)}
            </Text>
          </Pressable>
        ))}
      </View>
      {summary.error ? <ProblemText problem={problemFrom(summary.error)} /> : null}
      {mine.error && tab === 'orders' ? <ProblemText problem={problemFrom(mine.error)} /> : null}
    </View>
  );
  const loading = <ActivityIndicator style={styles.loading} color={colors.primary} />;

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
      {tab === 'orders' ? (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={head}
          renderSectionHeader={({ section }) => (
            <Text accessibilityRole="header" style={[type.sectionHeader, styles.day]}>
              {dayTitle(section.day)}
            </Text>
          )}
          renderItem={({ item, index, section }) =>
            item.type === 'notification' ? (
              <View
                style={[
                  styles.cell,
                  index === 0 && styles.firstCell,
                  index === section.data.length - 1 && styles.lastCell,
                ]}
              >
                {index > 0 ? <Separator /> : null}
                <NotificationRow
                  notification={item.notification}
                  onPress={() => openNotification(item.notification)}
                />
              </View>
            ) : null
          }
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
            mine.isLoading ? (
              loading
            ) : (
              <EmptyState
                icon={<Bell size={40} strokeWidth={1.5} color={colors.input} />}
                title={t('mobile.customer.notifications.ordersEmpty')}
                hint={t('mobile.customer.notifications.ordersEmptyHint')}
              />
            )
          }
        />
      ) : (
        <FlatList
          data={notices}
          keyExtractor={(notice) => String(notice.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={head}
          renderItem={({ item }) => (
            <PromoCard notice={item} onPress={() => router.push(`/notice/${item.id}`)} />
          )}
          refreshing={summary.isRefetching}
          onRefresh={() => void summary.refetch()}
          ListEmptyComponent={
            summary.isLoading ? (
              loading
            ) : (
              <EmptyState
                icon={<Megaphone size={40} strokeWidth={1.5} color={colors.input} />}
                title={t('mobile.customer.notifications.promosEmpty')}
                hint={t('mobile.customer.notifications.promosEmptyHint')}
              />
            )
          }
        />
      )}
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

/** «Захиалга батлагдлаа · 20261017_0005 · 200,800₮» with its tile, time and unread dot. */
function NotificationRow({
  notification,
  onPress,
}: {
  notification: StoreNotification;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const lineText = useLineText();
  const tile = STORE_TILES[notification.kind];
  const text = lineText(
    storeLineOf(notification.kind, storeFactsOf(notification.kind, notification.payload)),
  );
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.tile, { backgroundColor: tile.color }]}>
        <TileIcon tile={tile.tile} />
      </View>
      <View style={styles.text}>
        <View style={styles.head}>
          <Text
            style={[styles.rowTitle, !notification.read && styles.unreadTitle]}
            numberOfLines={2}
          >
            {t(`notifications.customerKinds.${notification.kind}`)}
          </Text>
          <Text style={type.secondary}>{ubTime(notification.createdAt)}</Text>
        </View>
        {text ? (
          <Text style={styles.body} numberOfLines={3}>
            {text}
          </Text>
        ) : null}
      </View>
      {notification.read ? null : (
        <View style={styles.unread} accessibilityLabel={t('mobile.notifications.unreadDot')} />
      )}
    </Pressable>
  );
}

/**
 * An admin's notice as a picture card (the Notifications board's «Урамшуулал»): its picture, or its
 * kind's colour and icon; «Урамшуулал · 10/20 – 10/31»; the title and the text; the unread dot.
 */
function PromoCard({ notice, onPress }: { notice: StoreNotice; onPress: () => void }) {
  const { t } = useTranslation();
  const { server } = useCustomer();
  const eyebrow = useNoticeEyebrow();
  const kind = KIND_STYLES[notice.kind];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={[styles.hero, { backgroundColor: kind.soft }]}>
        {notice.imageUrl ? (
          <Image
            source={{ uri: `${server}${notice.imageUrl}` }}
            style={styles.heroImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={notice.imageUrl}
            transition={120}
          />
        ) : (
          <KindIcon kind={notice.kind} size={44} />
        )}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.head}>
          <Text style={[styles.eyebrow, { color: kind.strong }]} numberOfLines={1}>
            {eyebrow(notice)}
          </Text>
          {notice.read ? null : (
            <View style={styles.unread} accessibilityLabel={t('mobile.notifications.unreadDot')} />
          )}
        </View>
        <Text style={[styles.cardTitle, !notice.read && styles.unreadTitle]} numberOfLines={2}>
          {notice.title}
        </Text>
        {notice.body ? (
          <Text style={styles.body} numberOfLines={3}>
            {notice.body}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  tabs: { flexDirection: 'row', gap: spacing.md, marginTop: 14, marginBottom: spacing.xs },
  tabButton: {
    flex: 1,
    height: 38,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: { backgroundColor: colors.primary },
  tabOff: { backgroundColor: colors.placeholder },
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
  card: {
    marginTop: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  cardPressed: { opacity: 0.85 },
  hero: { height: 150, alignItems: 'center', justifyContent: 'center' },
  heroImage: { width: '100%', height: '100%' },
  cardBody: { padding: 14, gap: spacing.xs },
  eyebrow: { ...type.secondary, fontFamily: fonts.semibold, flex: 1 },
  cardTitle: { ...type.heading },
});
