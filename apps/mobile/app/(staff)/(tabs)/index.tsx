import { Decimal } from '@tugeel/shared/money';
import { useRouter } from 'expo-router';
import {
  Bell,
  ChevronRight,
  Map as MapIcon,
  ScanBarcode,
  Send,
  ShoppingCart,
  TriangleAlert,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../src/ui/text';
import { useNotificationSummary } from '../../../src/api/notifications';
import { problemFrom } from '../../../src/api/problem';
import { useOrders, useProducts, useRepContext, useRepMap } from '../../../src/api/rep';
import { presetRange } from '../../../src/dates/calendar';
import { formatMillions, formatMnt, initialsOf } from '../../../src/format/format';
import { dateLineOf, givenNameOf, newProductsOf } from '../../../src/home/home';
import { countsOf } from '../../../src/map/stores';
import { shortMoney } from '../../../src/orders/amounts';
import { EMPTY_FILTERS } from '../../../src/shop/filters';
import { effectiveStage, placeOf } from '../../../src/state/placement';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, radii, shadows, spacing, tabular, type } from '../../../src/theme/tokens';
import { CircleButton, PillButton } from '../../../src/ui/controls';
import { Group, IconTile, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader, SectionTitle } from '../../../src/ui/layout';
import { OrderRow } from '../../../src/ui/order-row';
import { ProductTile, TILE_WIDTH } from '../../../src/ui/product-tile';
import { useTabBarInset } from '../../../src/ui/tab-bar';

const TILE_GAP = 12;
const RECENT = 3;

/**
 * «Нүүр» (ADR-0068, the owner 2026-10-17: more modern, larger text): who is signed in and the day
 * with the scanner and the bell (no search by name or code here, the owner 2026-10-18: «Бараа»
 * searches), this month's orders on the blue card, the cart when it has lines, the stage new orders
 * land on, the newest products and the last orders. The tab bar is the way to the other tabs, so
 * the home does not repeat it.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useTabBarInset();
  const { me } = useSignedIn();
  const { cart, pending, stageId, setStageId, ready } = useShop();
  const unread = useNotificationSummary().data?.unread ?? 0;
  const context = useRepContext();
  const today = context.data?.today ?? null;
  const orders = useOrders(today ? { ...presetRange('month', today), q: '' } : null);
  const products = useProducts({ ...EMPTY_FILTERS, q: '' });
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

  // The store map's card: how many located stores have no order of the rep lately.
  const storeMap = useRepMap();
  const mapCounts = storeMap.data ? countsOf(storeMap.data.data) : null;
  const mapLine = !storeMap.data
    ? storeMap.isLoading
      ? t('common.loading')
      : null
    : storeMap.data.data.length === 0
      ? t('mobile.map.noStores')
      : mapCounts && mapCounts.stale > 0
        ? t('mobile.map.staleCount', { n: mapCounts.stale, days: storeMap.data.freshDays })
        : t('mobile.map.allFresh', { days: storeMap.data.freshDays });

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

  return (
    <Page>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: inset + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initialsOf(me.fullName)}</Text>
          </View>
          <View style={styles.grow}>
            <Text style={type.secondary} numberOfLines={1}>
              {dateLine}
            </Text>
            <Text accessibilityRole="header" style={type.title3} numberOfLines={1}>
              {t('mobile.home.hello', { name: givenNameOf(me.fullName) || me.username })}
            </Text>
          </View>
          <CircleButton
            icon={<ScanBarcode size={22} strokeWidth={1.9} color={colors.foreground} />}
            label={t('mobile.scan.title')}
            onPress={() => router.push('/scan')}
          />
          <CircleButton
            icon={<Bell size={22} strokeWidth={1.9} color={colors.foreground} />}
            label={
              unread > 0
                ? t('mobile.notifications.bellUnread', { n: unread })
                : t('mobile.notifications.title')
            }
            badge={unread}
            badgeRing={colors.canvas}
            onPress={() => router.push('/notifications')}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.navigate('/orders')}
          style={({ pressed }) => [
            styles.month,
            { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
          ]}
        >
          <View style={styles.monthTop}>
            <Text style={[type.sectionHeader, styles.onMuted, styles.grow]}>
              {t('mobile.home.month')}
            </Text>
            <ChevronRight size={16} strokeWidth={2.4} color={colors.onPrimaryMuted} />
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
              minimumFontScale={0.8}
            >
              {total}
            </Text>
          )}
          <Text style={[type.secondary, styles.onMuted]}>{t('mobile.orders.confirmed')}</Text>
          <View style={styles.hairline} />
          {monthLoading ? (
            <View style={[styles.block, styles.blockCounts]} />
          ) : (
            <View style={styles.counts}>
              <View style={styles.count}>
                <Text style={styles.countValue}>
                  {summary ? String(summary.count) : t('common.none')}
                </Text>
                <Text style={[type.secondary, styles.onMuted]}>{t('mobile.orders.count')}</Text>
              </View>
              <View style={[styles.count, styles.shrink]}>
                {summary && summary.drafts > 0 ? <View style={styles.draftDot} /> : null}
                <Text style={styles.countValue}>
                  {summary ? String(summary.drafts) : t('common.none')}
                </Text>
                <Text style={[type.secondary, styles.onMuted]}>{t('mobile.orders.drafts')}</Text>
                {draftsEstimate ? (
                  <Text style={[type.secondary, styles.onMuted, styles.shrink]} numberOfLines={1}>
                    {draftsEstimate}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        </Pressable>

        {cart.lines.length > 0 ? (
          <View style={styles.cart}>
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

        <SectionHeader>{t('mobile.home.stage')}</SectionHeader>
        {context.error && !context.data ? (
          // The context did not load: say why instead of «loading» (pull down to try again).
          <ProblemText problem={problemFrom(context.error)} style={styles.flush} />
        ) : (
          <Group style={stageKnown && !place ? styles.stageWarning : null}>
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

        <Group style={styles.mapCard}>
          <Row
            minHeight={56}
            icon={
              <IconTile color={colors.tint.teal}>
                <MapIcon size={16} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.map.title')}
            subtitle={mapLine}
            onPress={() => router.push('/map')}
          />
        </Group>

        {products.isLoading || fresh.length > 0 ? (
          <>
            <SectionTitle
              action={t('mobile.home.seeAll')}
              onAction={() => router.navigate('/shop')}
            >
              {t('mobile.home.newProducts')}
            </SectionTitle>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.strip}
              contentContainerStyle={styles.stripContent}
              snapToInterval={TILE_WIDTH + TILE_GAP}
              decelerationRate="fast"
            >
              {products.isLoading
                ? [0, 1, 2].map((index) => <View key={index} style={styles.tileSkeleton} />)
                : fresh.map((product) => <ProductTile key={product.id} product={product} />)}
            </ScrollView>
          </>
        ) : null}

        <SectionTitle action={t('mobile.home.seeAll')} onAction={() => router.navigate('/orders')}>
          {t('mobile.home.recent')}
        </SectionTitle>
        {recent.length > 0 ? (
          <Group>
            {recent.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                onPress={() => router.push(`/order/${order.id}`)}
              />
            ))}
          </Group>
        ) : firstPage ? (
          <View style={styles.empty}>
            <Text style={[type.body, styles.mutedText, styles.center]}>
              {t('mobile.home.recentEmpty')}
            </Text>
          </View>
        ) : orders.error ? (
          <ProblemText problem={problemFrom(orders.error)} style={styles.flush} />
        ) : null}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg },
  grow: { flex: 1 },
  center: { textAlign: 'center' },
  mutedText: { color: colors.muted },
  header: {
    paddingTop: spacing.sm,
    minHeight: 52 + spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { ...type.rowStrong, letterSpacing: 0, color: colors.primaryForeground },
  month: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.tile,
    boxShadow: shadows.accentCard,
  },
  monthTop: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  onMuted: { color: colors.onPrimaryMuted },
  total: { ...type.display, ...tabular, color: colors.primaryForeground },
  totalSlot: { height: type.display.lineHeight, justifyContent: 'center' },
  block: { borderRadius: 8, backgroundColor: colors.onPrimaryHairline },
  blockTotal: { width: 140, height: 30 },
  blockCounts: { width: 90, height: 16, marginVertical: 2.5 },
  hairline: { height: 1, marginVertical: 14, backgroundColor: colors.onPrimaryHairline },
  counts: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  count: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  shrink: { flexShrink: 1 },
  countValue: { ...type.heading, ...tabular, color: colors.primaryForeground },
  draftDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    alignSelf: 'center',
    backgroundColor: colors.tint.amber,
  },
  cart: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.card,
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
  mapCard: { marginTop: spacing.md },
  // Edge to edge: the strip scrolls under the page's margins.
  strip: { marginHorizontal: -spacing.lg },
  stripContent: { paddingHorizontal: spacing.lg, gap: TILE_GAP },
  tileSkeleton: {
    width: TILE_WIDTH,
    height: TILE_WIDTH,
    borderRadius: 18,
    backgroundColor: colors.fill,
  },
  empty: { padding: 20, borderRadius: radii.card, backgroundColor: colors.card },
  flush: { marginTop: 0 },
});
