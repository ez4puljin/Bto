import { Decimal } from '@tugeel/shared/money';
import { useRouter } from 'expo-router';
import { Bell, ScanBarcode, Send, ShoppingCart, TriangleAlert } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../src/ui/text';
import { useNotificationSummary } from '../../../src/api/notifications';
import { problemFrom } from '../../../src/api/problem';
import { useOrders, useProducts, useRepContext, useRepMap } from '../../../src/api/rep';
import { lineOf } from '../../../src/cart/cart';
import { ListHeading, ROW_CARD_WIDTH } from '../../../src/customer/home-parts';
import { presetRange } from '../../../src/dates/calendar';
import { formatMillions, formatMnt, initialsOf } from '../../../src/format/format';
import { dateLineOf, givenNameOf, newProductsOf } from '../../../src/home/home';
import { allOrdered, countsOf } from '../../../src/map/stores';
import { shortMoney } from '../../../src/orders/amounts';
import { EMPTY_FILTERS } from '../../../src/shop/filters';
import { useAddOne } from '../../../src/shop/use-add';
import { effectiveStage, placeOf } from '../../../src/state/placement';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, spacing, storeType, tabular, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Group, IconTile, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { OrderRow } from '../../../src/ui/order-row';
import { ProductCard } from '../../../src/ui/product-card';
import { HeaderIconButton, StoreHeaderBand } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';

const RECENT = 3;
/** A row's card, as on «Bto300»'s home (ADR-0095 #7). */
const ROW_PICTURE = 146;
const CARD_GAP = 10;

/**
 * «Нүүр» (ADR-0068, in «Bto300»'s look since ADR-0100): the blue header with «Bto», who is signed
 * in and the day, the scanner, the bell and the initials (to «Профайл»); then upper-case sections
 * with ›: this month's orders, the cart when it has lines, the stage new orders land on, the store
 * map, the newest products as a row of cards and the last orders. No search by name or code here
 * (the owner 2026-10-18: «Бараа» searches).
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useStoreTabBarInset();
  const { me, server } = useSignedIn();
  const { cart, pending, stageId, setStageId, ready } = useShop();
  const unread = useNotificationSummary().data?.unread ?? 0;
  const context = useRepContext();
  const today = context.data?.today ?? null;
  const orders = useOrders(today ? { ...presetRange('month', today), q: '' } : null);
  const products = useProducts({ ...EMPTY_FILTERS, q: '' });
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
  const fresh = useMemo(() => newProductsOf(products.data?.pages[0]?.data ?? []), [products.data]);
  const place = context.data ? placeOf(context.data, stageId) : null;
  const stageKnown = ready && context.data !== undefined;
  const monthLoading = !summary && !orders.error && !context.error;

  const date = today ? dateLineOf(today) : null;
  const dateLine = date
    ? t('mobile.home.dateLong', {
        weekday: t(`mobile.weekdaysLong.${date.weekday}`),
        month: date.month,
        day: date.day,
      })
    : ' ';
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
        orders.refetch(),
        products.refetch(),
        storeMap.refetch(),
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
          <Text accessibilityRole="header" style={[storeType.wordmark, styles.grow]}>
            {t('app.name')}
          </Text>
          <HeaderIconButton
            icon={<ScanBarcode size={22} strokeWidth={1.9} color={colors.primaryForeground} />}
            label={t('mobile.scan.title')}
            onPress={() => router.push('/scan')}
          />
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
        <View style={styles.hello}>
          <Text style={storeType.headerTitle} numberOfLines={1}>
            {t('mobile.home.hello', { name: givenNameOf(me.fullName) || me.username })}
          </Text>
          <Text style={[storeType.search, styles.onMuted]} numberOfLines={1}>
            {dateLine}
          </Text>
        </View>
      </StoreHeaderBand>

      <ScrollView
        contentContainerStyle={{ paddingBottom: inset + spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
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

        {products.isLoading || fresh.length > 0 ? (
          <View style={styles.section}>
            <ListHeading
              title={t('mobile.home.newProducts')}
              icon={{ icon: 'sparkles', tone: 'new' }}
              label={t('mobile.customer.home.seeAll', { title: t('mobile.home.newProducts') })}
              onPress={() => router.navigate('/shop')}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cards}
            >
              {products.isLoading
                ? [0, 1, 2].map((index) => <View key={index} style={styles.cardSkeleton} />)
                : fresh.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      server={server}
                      line={lineOf(cart, product.id)}
                      locked={pending !== null}
                      onOpen={() => router.push(`/product/${product.id}`)}
                      onAdd={() => add(product)}
                      width={ROW_CARD_WIDTH}
                      pictureHeight={ROW_PICTURE}
                    />
                  ))}
            </ScrollView>
          </View>
        ) : null}

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
  pressed: { opacity: 0.7 },
  onMuted: { color: colors.onPrimaryMuted },
  bar: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 14,
    paddingRight: spacing.sm,
  },
  avatar: {
    width: 30,
    height: 30,
    marginLeft: 6,
    borderRadius: 15,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...storeType.badge, fontFamily: fonts.bold, color: colors.primary },
  hello: { gap: 1, paddingTop: 2, paddingBottom: 12, paddingHorizontal: 14 },
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
  cards: { gap: CARD_GAP, paddingHorizontal: 14, paddingBottom: spacing.xs },
  cardSkeleton: {
    width: ROW_CARD_WIDTH,
    height: ROW_PICTURE + 120,
    borderRadius: 10,
    backgroundColor: colors.fill,
  },
  empty: { padding: 20 },
  problem: { marginTop: 0, marginHorizontal: 14 },
});
