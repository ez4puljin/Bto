import { Decimal } from '@tugeel/shared/money';
import { useRouter } from 'expo-router';
import { Bell, ScanLine, Send, ShoppingCart, TriangleAlert } from 'lucide-react-native';
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
import {
  BannerCarousel,
  CategoryTile,
  ListHeading,
  SectionRow,
  useSectionText,
} from '../../../src/customer/home-parts';
import { homeCategoriesOf, sectionRouteOf } from '../../../src/customer/home-sections';
import { presetRange } from '../../../src/dates/calendar';
import { formatMillions, formatMnt, initialsOf } from '../../../src/format/format';
import { allOrdered, countsOf } from '../../../src/map/stores';
import { shortMoney } from '../../../src/orders/amounts';
import { useAddOne } from '../../../src/shop/use-add';
import { mayPick, mayRequestTransfers } from '../../../src/state/phase';
import { effectiveStage, placeOf } from '../../../src/state/placement';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, spacing, storeType, tabular, TOUCH, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Group, IconTile, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { OrderRow } from '../../../src/ui/order-row';
import { ProductCard } from '../../../src/ui/product-card';
import { HeaderIconButton, StoreHeaderBand } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';

const RECENT = 3;

type HomeCategory = RepHome['categories'][number];

/**
 * «Нүүр» (ADR-0068; «Bto300»'s shop window on top since ADR-0100 #9): the blue header with «Bto»,
 * the search field (it opens «Бараа» searching), the scanner, the bell and the initials (to
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
  const unread = notifications.data?.unread ?? 0;
  const context = useRepContext();
  const today = context.data?.today ?? null;
  const orders = useOrders(today ? { ...presetRange('month', today), q: '' } : null);
  const home = useRepHome();
  const sectionText = useSectionText();
  const add = useAddOne();
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
    { key: 'orders', label: t('mobile.tabs.orders'), onPress: () => router.navigate('/orders') },
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
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const heading = (title: string, onPress: () => void, subtitle?: string | null) => (
    <ListHeading
      title={title}
      subtitle={subtitle ?? null}
      label={t('mobile.customer.home.seeAll', { title })}
      onPress={onPress}
    />
  );

  return (
    <Page white edges={[]}>
      <StoreHeaderBand>
        <View style={styles.bar}>
          <Text accessibilityRole="header" style={storeType.wordmark}>
            {t('app.name')}
          </Text>
          <View style={styles.search}>
            <Pressable
              accessibilityRole="search"
              accessibilityLabel={t('mobile.shop.searchLabel')}
              onPress={() => router.navigate({ pathname: '/shop', params: { search: '1' } })}
              style={styles.searchText}
            >
              <Text style={storeType.search} numberOfLines={1}>
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
              <ScanLine size={19} strokeWidth={1.8} color={colors.label2} />
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.tabs.profile')}
            onPress={() => router.push('/profile')}
            hitSlop={7}
            style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
          >
            <Text style={styles.avatarText}>{initialsOf(me.fullName)}</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityLabel={t('mobile.customer.home.quickLinks')}
          contentContainerStyle={styles.links}
        >
          {links.map((link) => (
            <Pressable key={link.key} accessibilityRole="link" onPress={link.onPress} hitSlop={8}>
              <Text style={[storeType.headerLink, styles.upper]} numberOfLines={1}>
                {link.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </StoreHeaderBand>

      <ScrollView
        contentContainerStyle={{ paddingBottom: inset + spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {shopWindow ? <BannerCarousel banners={shopWindow.banners} server={server} /> : null}

        {tileRows.length > 0 ? (
          <>
            <View style={styles.categoriesHead}>
              <ListHeading
                big
                title={t('mobile.customer.home.categories')}
                label={t('mobile.customer.home.allCategories')}
                onPress={() => router.push('/categories')}
              />
            </View>
            <View style={styles.grid}>
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
            </View>
            <View style={styles.divider} />
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
                onAdd={() => add(product)}
                {...size}
              />
            )}
            onMore={() => router.push(sectionRouteOf(section.key))}
          />
        ))}

        {home.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : home.error && !shopWindow ? (
          <ProblemText problem={problemFrom(home.error)} style={styles.homeProblem} />
        ) : null}
        {sections.length > 0 ? <View style={styles.divider} /> : null}

        <View style={styles.section}>
          {heading(t('mobile.home.month'), () => router.navigate('/orders'))}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate('/orders')}
            style={({ pressed }) => [styles.panel, styles.month, pressed && styles.pressedPanel]}
          >
            {monthLoading ? (
              <View style={styles.totalSlot}>
                <View style={[styles.block, styles.blockTotal]} />
              </View>
            ) : (
              <Text
                style={styles.total}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {total}
              </Text>
            )}
            <Text style={type.secondary}>{t('mobile.orders.confirmed')}</Text>
            <View style={styles.rule} />
            {monthLoading ? (
              <View style={[styles.block, styles.blockCounts]} />
            ) : (
              <View style={styles.counts}>
                <View style={styles.count}>
                  <Text style={styles.countValue}>
                    {summary ? String(summary.count) : t('common.none')}
                  </Text>
                  <Text style={type.secondary}>{t('mobile.orders.count')}</Text>
                </View>
                <View style={[styles.count, styles.shrink]}>
                  {summary && summary.drafts > 0 ? <View style={styles.draftDot} /> : null}
                  <Text style={styles.countValue}>
                    {summary ? String(summary.drafts) : t('common.none')}
                  </Text>
                  <Text style={type.secondary}>{t('mobile.orders.drafts')}</Text>
                  {draftsEstimate ? (
                    <Text style={[type.secondary, styles.shrink]} numberOfLines={1}>
                      {draftsEstimate}
                    </Text>
                  ) : null}
                </View>
              </View>
            )}
          </Pressable>
        </View>

        {cart.lines.length > 0 ? (
          <View style={[styles.panel, styles.cart]}>
            <View style={styles.cartIcon}>
              <ShoppingCart size={20} strokeWidth={2} color={colors.success} />
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
              height={34}
              style={styles.cartButton}
              onPress={() => router.navigate('/cart')}
            />
          </View>
        ) : null}

        <View style={styles.section}>
          {heading(t('mobile.home.stage'), () => router.push('/settings'))}
          {context.error && !context.data ? (
            // The context did not load: say why instead of «loading» (pull down to try again).
            <ProblemText problem={problemFrom(context.error)} style={styles.problem} />
          ) : (
            <Group style={[styles.panel, stageKnown && !place ? styles.stageWarning : null]}>
              <Row
                minHeight={56}
                icon={
                  <IconTile
                    color={
                      !stageKnown ? colors.tint.gray : place ? colors.tint.orange : colors.tint.red
                    }
                  >
                    {stageKnown && !place ? (
                      <TriangleAlert size={16} strokeWidth={2.2} color={colors.primaryForeground} />
                    ) : (
                      <Send size={16} color={colors.primaryForeground} />
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
        </View>

        <View style={styles.section}>
          {heading(t('mobile.map.title'), () => router.push('/map'), mapLine)}
        </View>

        <View style={styles.section}>
          <ListHeading
            title={t('mobile.home.recent')}
            icon={{ icon: 'history', tone: 'muted' }}
            label={t('mobile.customer.home.seeAll', { title: t('mobile.home.recent') })}
            onPress={() => router.navigate('/orders')}
          />
          {recent.length > 0 ? (
            <Group style={styles.panel}>
              {recent.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  onPress={() => router.push(`/order/${order.id}`)}
                />
              ))}
            </Group>
          ) : firstPage ? (
            <View style={[styles.panel, styles.empty]}>
              <Text style={[type.body, styles.mutedText, styles.center]}>
                {t('mobile.home.recentEmpty')}
              </Text>
            </View>
          ) : orders.error ? (
            <ProblemText problem={problemFrom(orders.error)} style={styles.problem} />
          ) : null}
        </View>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  center: { textAlign: 'center' },
  mutedText: { color: colors.muted },
  upper: { textTransform: 'uppercase' },
  pressed: { opacity: 0.7 },
  // «Bto300»'s header bar and search pill (ADR-0100 #9).
  bar: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 14,
    paddingRight: spacing.sm,
  },
  search: {
    flex: 1,
    minWidth: 0,
    height: 34,
    marginLeft: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 17,
    backgroundColor: colors.card,
  },
  searchText: { flex: 1, height: TOUCH, justifyContent: 'center', paddingLeft: 14 },
  searchScan: { width: 36, height: 34, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...storeType.badge, fontFamily: fonts.bold, color: colors.primary },
  links: { gap: 20, paddingTop: 2, paddingBottom: 10, paddingHorizontal: 14 },
  categoriesHead: { paddingTop: 12 },
  grid: { gap: 12, paddingHorizontal: 6 },
  gridRow: { flexDirection: 'row', gap: spacing.xs },
  divider: { height: 2, marginTop: 16, marginHorizontal: 10, backgroundColor: colors.border },
  loading: { marginTop: spacing.xl },
  homeProblem: { marginTop: spacing.lg, marginHorizontal: 14 },
  section: { paddingTop: 18 },
  // «Bto300»'s white panel with a hairline and 10 px corners (ADR-0095 #4).
  panel: {
    marginHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  pressedPanel: { backgroundColor: colors.accent },
  month: { paddingVertical: 14, paddingHorizontal: spacing.lg },
  total: { ...type.title2, ...tabular },
  totalSlot: { height: type.title2.lineHeight, justifyContent: 'center' },
  block: { borderRadius: 6, backgroundColor: colors.fill },
  blockTotal: { width: 140, height: 22 },
  blockCounts: { width: 90, height: 16, marginVertical: 2.5 },
  rule: { height: 1, marginVertical: spacing.md, backgroundColor: colors.border },
  counts: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  count: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  countValue: { ...type.heading, ...tabular },
  draftDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    alignSelf: 'center',
    backgroundColor: colors.tint.amber,
  },
  cart: {
    marginTop: 18,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cartIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartButton: { paddingHorizontal: 14 },
  stageWarning: { backgroundColor: colors.warningSoft },
  empty: { padding: 20 },
  problem: { marginTop: 0, marginHorizontal: 14 },
});
