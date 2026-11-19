import { Decimal } from '@tugeel/shared/money';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Bell,
  CalendarCheck,
  ChevronRight,
  MapPin,
  MessageCircle,
  ScanLine,
  Search,
  Send,
  ShoppingCart,
  TriangleAlert,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '../../../src/ui/text';
import { useMyAttendance } from '../../../src/api/attendance';
import { useNotificationSummary } from '../../../src/api/notifications';
import { problemFrom } from '../../../src/api/problem';
import {
  type RepHome,
  useOrders,
  useRepContext,
  useRepHome,
  useRepMap,
} from '../../../src/api/rep';
import { lineOf } from '../../../src/cart/cart';
import { mayAnswerChat } from '../../../src/chat/staff-logic';
import { useStaffChatBadge } from '../../../src/chat/staff-chat';
import {
  BannerCarousel,
  CategoryTile,
  SectionRow,
  useSectionText,
} from '../../../src/customer/home-parts';
import { homeCategoriesOf, sectionRouteOf } from '../../../src/customer/home-sections';
import { presetRange } from '../../../src/dates/calendar';
import { ubTime } from '../../../src/dates/dates';
import { formatMillions, formatMnt } from '../../../src/format/format';
import { allOrdered, countsOf } from '../../../src/map/stores';
import { shortMoney } from '../../../src/orders/amounts';
import { SectionHeading, SIDE } from '../../../src/shop/section-heading';
import { useCartHost } from '../../../src/shop/list-qty-sheet';
import { mayPick, mayRequestTransfers } from '../../../src/state/phase';
import { effectiveStage, placeOf } from '../../../src/state/placement';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import {
  colors,
  fonts,
  radii,
  shadows,
  spacing,
  storeType,
  tabular,
  TOUCH,
  type,
} from '../../../src/theme/tokens';
import { CountBadge, PillButton } from '../../../src/ui/controls';
import { Group, ICON_INSET, ICON_TILE, IconTile, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { OrderRow } from '../../../src/ui/order-row';
import { ProductCard } from '../../../src/ui/product-card';
import { Card } from '../../../src/ui/staff-kit';
import { HeaderIconButton, StoreHeaderBand } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';

const RECENT = 3;

type HomeCategory = RepHome['categories'][number];

/**
 * The first tab of «ХТ захиалга» (ADR-0068; «Bto300»'s shop window on top since ADR-0100 #9;
 * opened from «Цэс» since ADR-0174): the blue header with the way back, the search field (it opens «Бараа» searching), the scanner, the bell and the initials (to
 * «Профайл»), and the upper-case links (categories, discounts, new, the map, the orders); the
 * banners edge to edge; «АНГИЛЛЫН ЖАГСААЛТ ›» with 4×2 pictures; the sections (promotions, the
 * shown segments, discounts, new) as rows of the rep's cards. Below them the rep's own blocks with
 * ›: this month's orders, the cart when it has lines, the stage new orders land on, the store map
 * and the last orders.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useStoreTabBarInset();
  const { me, server } = useSignedIn();
  const { cart, pending, stageId, setStageId, ready } = useShop();
  const notifications = useNotificationSummary();
  const attendance = useMyAttendance();
  const unread = notifications.data?.unread ?? 0;
  const context = useRepContext();
  // «Харилцагчийн чат» (ADR-0224): only for a user with a chat right; the badge is the waiting count.
  const chatter = mayAnswerChat(me);
  const chatBadge = useStaffChatBadge(chatter).badge;
  const today = context.data?.today ?? null;
  const orders = useOrders(today ? { ...presetRange('month', today), q: '' } : null);
  const home = useRepHome();
  const sectionText = useSectionText();
  const host = useCartHost(server);
  const [refreshing, setRefreshing] = useState(false);

  // A stage the rep may no longer use is dropped; the default (or the only one) is taken.
  useEffect(() => {
    if (!ready || !context.data) return;
    const next = effectiveStage(context.data, stageId);
    if (next !== stageId) setStageId(next);
  }, [ready, context.data, stageId, setStageId]);

  const firstPage = orders.data?.pages[0];
  const summary = firstPage?.summary ?? null;
  const recent = firstPage?.data.slice(0, RECENT) ?? [];
  const place = context.data ? placeOf(context.data, stageId) : null;
  const stageKnown = ready && context.data !== undefined;
  const monthLoading = !summary && !orders.error && !context.error;

  // Null when the server is older than the shop window (404): «Нүүр» then has none, quietly.
  const shopWindow = home.data ?? null;
  const sections = shopWindow?.sections ?? [];
  // The links under the search: the categories (once the shop window is there: their page reads
  // it), the discounts and the new products (when the home has them), the store map and the orders.
  const deals = sections.find(
    (section) => section.kind === 'DISCOUNTS' || section.kind === 'DEALS',
  );
  const fresh = sections.find((section) => section.kind === 'NEW');
  const links: { key: string; label: string; onPress: () => void }[] = [
    ...(shopWindow
      ? [
          {
            key: 'categories',
            label: t('mobile.filter.categories'),
            onPress: () => router.push('/categories'),
          },
        ]
      : []),
    ...[deals, fresh].flatMap((section) =>
      section
        ? [
            {
              key: section.key,
              label: sectionText(section).title,
              onPress: () => router.push(sectionRouteOf(section.key)),
            },
          ]
        : [],
    ),
    { key: 'map', label: t('mobile.map.title'), onPress: () => router.push('/map') },
    { key: 'visits', label: t('mobile.visits.title'), onPress: () => router.push('/visits') },
    { key: 'orders', label: t('mobile.tabs.orders'), onPress: () => router.navigate('/orders') },
    // A rep has no work bar, and finds expired goods on a store's shelf too (ADR-0172 #9).
    { key: 'expiry', label: t('mobile.expiry.title'), onPress: () => router.push('/expiry') },
    // A rep who also requests a store's transfers (ADR-0116 #1).
    ...(mayRequestTransfers(me)
      ? [
          {
            key: 'transfers',
            label: t('mobile.transfers.title'),
            onPress: () => router.push('/transfers'),
          },
        ]
      : []),
    // A rep who also picks in a warehouse (ADR-0132).
    ...(mayPick(me)
      ? [
          {
            key: 'picking',
            label: t('mobile.picking.title'),
            onPress: () => router.push('/picking'),
          },
        ]
      : []),
    // The header keeps ←, the search and the bell: «Профайл» is the last link.
    { key: 'profile', label: t('mobile.tabs.profile'), onPress: () => router.push('/profile') },
  ];

  // Four tiles a row; the last row keeps its tiles at their place.
  const categories = homeCategoriesOf(shopWindow?.categories ?? []);
  const tileRows: (HomeCategory | null)[][] = [];
  for (let at = 0; at < categories.length; at += 4) {
    const row: (HomeCategory | null)[] = categories.slice(at, at + 4);
    while (row.length < 4) row.push(null);
    tileRows.push(row);
  }
  const millions = summary ? formatMillions(summary.total) : null;
  const total = summary
    ? millions
      ? t('mobile.orders.millions', { amount: millions })
      : t('pricing.money', { amount: formatMnt(summary.total) })
    : t('common.none');
  // «3 ноорог ≈ 1.2 сая₮»: the drafts at today's prices (a draft without a price adds none).
  const draftsEstimate =
    summary && new Decimal(summary.draftsEstimate).gt(0)
      ? t('mobile.orders.approx', { amount: shortMoney(t, summary.draftsEstimate) })
      : null;

  // The store map's line: how many located stores have no order of the rep lately, and how many
  // the accountant closed (as the map's legend counts them: a closed store is not «stale»).
  const storeMap = useRepMap();
  const mapCounts = storeMap.data ? countsOf(storeMap.data.data) : null;
  const freshDays = storeMap.data?.freshDays ?? 0;
  const mapLine = !storeMap.data
    ? storeMap.isLoading
      ? t('common.loading')
      : null
    : storeMap.data.data.length === 0
      ? t('mobile.map.noStores')
      : mapCounts && !allOrdered(mapCounts)
        ? [
            mapCounts.stale > 0
              ? t('mobile.map.staleCount', { n: mapCounts.stale, days: freshDays })
              : null,
            mapCounts.blocked > 0 ? t('mobile.map.legendBlocked', { n: mapCounts.blocked }) : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : t('mobile.map.allFresh', { days: freshDays });

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        context.refetch(),
        home.refetch(),
        orders.refetch(),
        storeMap.refetch(),
        notifications.refetch(),
        attendance.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const openOrders = () => router.navigate('/orders');

  return (
    <Page edges={[]}>
      <StoreHeaderBand>
        <View style={styles.bar}>
          <HeaderIconButton
            icon={<ArrowLeft size={22} strokeWidth={2} color={colors.primaryForeground} />}
            label={t('common.back')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
          <View style={styles.search}>
            <Pressable
              accessibilityRole="search"
              accessibilityLabel={t('mobile.shop.searchLabel')}
              onPress={() => router.navigate({ pathname: '/shop', params: { search: '1' } })}
              style={styles.searchText}
            >
              <Search size={18} strokeWidth={2.2} color={colors.placeholder} />
              <Text style={[storeType.search, styles.grow]} numberOfLines={1}>
                {t('mobile.customer.home.search')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.scan.title')}
              onPress={() => router.push('/scan')}
              hitSlop={6}
              style={styles.searchScan}
            >
              <ScanLine size={20} strokeWidth={1.8} color={colors.label2} />
            </Pressable>
          </View>
          <HeaderIconButton
            icon={<Bell size={22} strokeWidth={1.9} color={colors.primaryForeground} />}
            label={
              unread > 0
                ? t('mobile.notifications.bellUnread', { n: unread })
                : t('mobile.notifications.title')
            }
            badge={unread}
            onPress={() => router.push('/notifications')}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityLabel={t('mobile.customer.home.quickLinks')}
          contentContainerStyle={styles.links}
        >
          {links.map((link) => (
            <Pressable
              key={link.key}
              accessibilityRole="link"
              onPress={link.onPress}
              hitSlop={{ top: 6, bottom: 6 }}
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <Text style={styles.linkText} numberOfLines={1}>
                {link.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </StoreHeaderBand>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: inset + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {/* «Энэ сар»: the month's confirmed amount, its orders, its drafts and the stores without an order. */}
        <Pressable
          accessibilityRole="button"
          onPress={openOrders}
          style={({ pressed }) => [styles.month, styles.side, pressed && styles.monthPressed]}
        >
          <View style={styles.monthHead}>
            <Text style={[type.body, styles.onBlueMuted, styles.grow]} numberOfLines={1}>
              {`${t('mobile.home.month')} · ${t('mobile.orders.confirmed')}`}
            </Text>
            <View style={styles.monthPill}>
              <Text style={styles.monthPillText}>{t('mobile.tabs.orders')}</Text>
              <ChevronRight size={13} strokeWidth={2.4} color={colors.primaryForeground} />
            </View>
          </View>
          {monthLoading ? (
            <View style={styles.totalSlot}>
              <View style={[styles.block, styles.blockTotal]} />
            </View>
          ) : (
            <Text
              style={styles.total}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {total}
            </Text>
          )}
          <View style={styles.rule} />
          {monthLoading ? (
            <View style={[styles.block, styles.blockCounts]} />
          ) : (
            <View style={styles.counts}>
              <View style={styles.count}>
                <Text style={styles.countValue}>
                  {summary ? String(summary.count) : t('common.none')}
                </Text>
                <Text style={[type.secondary, styles.onBlueMuted]} numberOfLines={2}>
                  {t('mobile.orders.count')}
                </Text>
              </View>
              <View style={styles.count}>
                <Text style={styles.countValue}>
                  {summary ? String(summary.drafts) : t('common.none')}
                </Text>
                <Text style={[type.secondary, styles.onBlueMuted]} numberOfLines={2}>
                  {draftsEstimate
                    ? `${t('mobile.orders.drafts')} · ${draftsEstimate}`
                    : t('mobile.orders.drafts')}
                </Text>
              </View>
              {mapCounts && storeMap.data && storeMap.data.data.length > 0 ? (
                <View style={styles.count}>
                  <Text style={styles.countValue}>{String(mapCounts.stale)}</Text>
                  <Text style={[type.secondary, styles.onBlueMuted]} numberOfLines={2}>
                    {t('mobile.home.staleStores')}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </Pressable>

        {cart.lines.length > 0 ? (
          <Card
            onPress={() => router.navigate('/cart')}
            accessibilityLabel={t('mobile.home.cartTitle', { n: cart.lines.length })}
            style={[styles.side, styles.cart]}
          >
            <View style={styles.cartIcon}>
              <ShoppingCart size={18} strokeWidth={2} color={colors.success} />
            </View>
            <View style={styles.grow}>
              <Text style={type.rowStrong} numberOfLines={1}>
                {t('mobile.home.cartTitle', { n: cart.lines.length })}
              </Text>
              <Text style={type.secondary} numberOfLines={1}>
                {pending !== null
                  ? t('mobile.home.pending')
                  : (cart.customer?.name ?? t('mobile.home.noCustomer'))}
              </Text>
            </View>
            <PillButton
              title={t('mobile.home.continue')}
              height={36}
              style={styles.cartButton}
              onPress={() => router.navigate('/cart')}
            />
          </Card>
        ) : null}

        {shopWindow && shopWindow.banners.length > 0 ? (
          <BannerCarousel banners={shopWindow.banners} server={server} inset={spacing.lg} />
        ) : null}

        {tileRows.length > 0 ? (
          <>
            <SectionHeading
              title={t('mobile.customer.home.categories')}
              label={t('mobile.customer.home.allCategories')}
              onPress={() => router.push('/categories')}
            />
            <Card style={[styles.side, styles.grid]}>
              {tileRows.map((row, index) => (
                <View key={index} style={styles.gridRow}>
                  {row.map((category, at) =>
                    category ? (
                      <CategoryTile
                        key={category.id}
                        category={category}
                        server={server}
                        onPress={() => router.push(`/category/${category.id}`)}
                      />
                    ) : (
                      <View key={`empty-${at}`} style={styles.grow} />
                    ),
                  )}
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {sections.map((section) => (
          <SectionRow
            key={section.key}
            section={section}
            renderCard={(product, size) => (
              <ProductCard
                product={product}
                server={server}
                line={lineOf(cart, product.id)}
                locked={pending !== null}
                onOpen={() => router.push(`/product/${product.id}`)}
                {...host.cardProps(product)}
                {...size}
              />
            )}
            onMore={() => router.push(sectionRouteOf(section.key))}
          />
        ))}

        {home.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : home.error && !shopWindow ? (
          <ProblemText problem={problemFrom(home.error)} style={[styles.side, styles.problem]} />
        ) : null}

        <SectionHeading
          title={t('mobile.home.stage')}
          label={t('mobile.customer.home.seeAll', { title: t('mobile.home.stage') })}
          onPress={() => router.push('/settings')}
        />
        {context.error && !context.data ? (
          // The context did not load: say why instead of «loading» (pull down to try again).
          <ProblemText problem={problemFrom(context.error)} style={[styles.side, styles.problem]} />
        ) : (
          <Group
            inset={ICON_INSET}
            style={[styles.side, stageKnown && !place ? styles.stageWarning : null]}
          >
            <Row
              minHeight={56}
              icon={
                <IconTile
                  color={
                    !stageKnown ? colors.tint.gray : place ? colors.tint.orange : colors.tint.red
                  }
                >
                  {stageKnown && !place ? (
                    <TriangleAlert size={18} strokeWidth={2.2} color={colors.primaryForeground} />
                  ) : (
                    <Send size={18} color={colors.primaryForeground} />
                  )}
                </IconTile>
              }
              title={
                !stageKnown
                  ? t('common.loading')
                  : place
                    ? `${place.pipelineName} › ${place.stageName}`
                    : t('mobile.settings.notChosen')
              }
              subtitle={
                !stageKnown
                  ? null
                  : place
                    ? t(place.confirms ? 'mobile.settings.confirms' : 'mobile.settings.drafts')
                    : t('mobile.home.chooseStage')
              }
              onPress={() => router.push('/settings')}
            />
          </Group>
        )}

        {/* The store map's line, and «Ирц» (ADR-0131): today's state in one row; the page punches. */}
        <Group inset={ICON_INSET} style={styles.side}>
          {chatter ? (
            <Row
              minHeight={56}
              icon={
                <IconTile color={colors.tint.blue}>
                  <MessageCircle size={18} strokeWidth={2.2} color={colors.primaryForeground} />
                </IconTile>
              }
              title={t('mobile.staffChat.title')}
              accessibilityLabel={
                chatBadge > 0
                  ? t('mobile.staffChat.entry', { n: chatBadge })
                  : t('mobile.staffChat.title')
              }
              right={<CountBadge count={chatBadge} tone="red" ring={colors.card} />}
              onPress={() => router.push('/chat')}
            />
          ) : null}
          <Row
            minHeight={56}
            icon={
              <IconTile color={colors.tint.teal}>
                <MapPin size={18} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.map.title')}
            subtitle={mapLine}
            onPress={() => router.push('/map')}
          />
          <Row
            minHeight={56}
            icon={
              <IconTile
                color={attendance.data?.state === 'IN' ? colors.tint.green : colors.tint.gray}
              >
                <CalendarCheck size={18} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.attendance.title')}
            value={
              attendance.data
                ? attendance.data.state === 'IN'
                  ? t('mobile.attendance.homeIn', {
                      time: ubTime(attendance.data.day.firstIn ?? attendance.data.now),
                    })
                  : attendance.data.state === 'OUT'
                    ? t('mobile.attendance.outAt', {
                        time: ubTime(attendance.data.day.lastOut ?? attendance.data.now),
                      })
                    : t('mobile.attendance.homeNotIn')
                : null
            }
            onPress={() => router.push('/attendance')}
          />
        </Group>

        <SectionHeading
          title={t('mobile.home.recent')}
          label={t('mobile.customer.home.seeAll', { title: t('mobile.home.recent') })}
          onPress={openOrders}
        />
        {recent.length > 0 ? (
          <Group style={styles.side}>
            {recent.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                onPress={() => router.push(`/order/${order.id}`)}
              />
            ))}
          </Group>
        ) : firstPage ? (
          <Card style={styles.side}>
            <Text style={[type.body, styles.mutedText, styles.center]}>
              {t('mobile.home.recentEmpty')}
            </Text>
          </Card>
        ) : orders.error ? (
          <ProblemText problem={problemFrom(orders.error)} style={[styles.side, styles.problem]} />
        ) : null}
      </ScrollView>
      {host.sheet}
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  center: { textAlign: 'center' },
  mutedText: { color: colors.muted },
  pressed: { opacity: 0.7 },
  // The header: ←, the white search field and the bell, then the quick links as capsules.
  bar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: 2,
    paddingRight: 6,
  },
  search: {
    flex: 1,
    minWidth: 0,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.field,
    backgroundColor: colors.card,
  },
  searchText: {
    flex: 1,
    height: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
  },
  searchScan: { width: 42, height: 40, alignItems: 'center', justifyContent: 'center' },
  links: { gap: spacing.sm, paddingTop: 6, paddingBottom: spacing.md, paddingHorizontal: SIDE },
  link: {
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.onPrimaryHairline,
  },
  linkText: { ...type.chip, fontFamily: fonts.semibold, color: colors.primaryForeground },
  // The page: 16 px between blocks; a block keeps 16 px from the edges, a strip runs to them.
  content: { paddingTop: spacing.lg, gap: spacing.lg },
  side: { marginHorizontal: SIDE },
  loading: { marginVertical: spacing.sm },
  problem: { marginTop: 0 },
  month: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.primary,
    boxShadow: shadows.accentCard,
  },
  monthPressed: { backgroundColor: colors.primaryPressed },
  monthHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  onBlueMuted: { color: colors.onPrimaryMuted },
  monthPill: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 10,
    paddingRight: 6,
    borderRadius: 12,
    backgroundColor: colors.onPrimaryHairline,
  },
  monthPillText: {
    ...type.secondary,
    fontFamily: fonts.semibold,
    color: colors.primaryForeground,
  },
  total: { ...type.display, ...tabular, color: colors.primaryForeground },
  totalSlot: { height: type.display.lineHeight, justifyContent: 'center' },
  block: { borderRadius: 6, backgroundColor: colors.onPrimaryHairline },
  blockTotal: { width: 160, height: 26 },
  blockCounts: { width: 200, height: 37 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.onPrimaryHairline },
  counts: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  count: { flex: 1, minWidth: 0 },
  countValue: { ...type.heading, ...tabular, color: colors.primaryForeground },
  cart: {
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cartIcon: {
    width: ICON_TILE,
    height: ICON_TILE,
    borderRadius: 10,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartButton: { paddingHorizontal: spacing.lg },
  grid: { gap: 14, paddingHorizontal: spacing.sm },
  gridRow: { flexDirection: 'row', gap: spacing.xs },
  stageWarning: { backgroundColor: colors.warningSoft },
});
