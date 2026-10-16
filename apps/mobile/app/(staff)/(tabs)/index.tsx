import { useRouter } from 'expo-router';
import { ClipboardList, Package, ScanBarcode, Send, ShoppingCart } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useOrders, useRepContext } from '../../../src/api/rep';
import { monthDay, presetRange } from '../../../src/dates/calendar';
import { weekdayOf } from '../../../src/dates/dates';
import { formatMillions, formatMnt, initialsOf } from '../../../src/format/format';
import { effectiveStage, placeOf } from '../../../src/state/placement';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, radii, spacing, type } from '../../../src/theme/tokens';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { LargeTitle, Page, SectionHeader } from '../../../src/ui/layout';
import { StatRow } from '../../../src/ui/stat-row';
import { useTabBarInset } from '../../../src/ui/tab-bar';

/**
 * «Нүүр» (ADR-0066: its content as before, in the boards' look): who is signed in and the day,
 * this month's orders, where new orders land, and the ways into the shop, the cart, the orders and
 * the scanner.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useTabBarInset();
  const { me } = useSignedIn();
  const { cart, stageId, setStageId, ready } = useShop();
  const context = useRepContext();
  const today = context.data?.today ?? null;
  const orders = useOrders(today ? { ...presetRange('month', today), q: '' } : null);
  const summary = orders.data?.pages[0]?.summary ?? null;

  // A stage the rep may no longer use is dropped; the default (or the only one) is taken.
  useEffect(() => {
    if (!ready || !context.data) return;
    const next = effectiveStage(context.data, stageId);
    if (next !== stageId) setStageId(next);
  }, [ready, context.data, stageId, setStageId]);

  const place = context.data ? placeOf(context.data, stageId) : null;
  const weekday = today ? (weekdayOf(today) as 0 | 1 | 2 | 3 | 4 | 5 | 6) : null;
  const millions = summary ? formatMillions(summary.total) : null;
  const total = summary
    ? millions
      ? t('mobile.orders.millions', { amount: millions })
      : t('pricing.money', { amount: formatMnt(summary.total) })
    : t('common.none');

  return (
    <Page>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: inset + spacing.lg }]}
        refreshControl={
          <RefreshControl
            refreshing={context.isRefetching || orders.isRefetching}
            onRefresh={() => {
              void context.refetch();
              void orders.refetch();
            }}
          />
        }
      >
        <View style={styles.bar} />
        <LargeTitle style={styles.title}>{t('mobile.tabs.home')}</LargeTitle>

        <View style={styles.hello}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initialsOf(me.fullName)}</Text>
          </View>
          <View style={styles.grow}>
            <Text style={styles.helloText} numberOfLines={1}>
              {t('mobile.home.hello', { name: me.fullName })}
            </Text>
            {today && weekday !== null ? (
              <Text style={type.secondary}>
                {t('mobile.home.today', {
                  weekday: t(`mobile.weekdaysLong.${weekday}`),
                  day: monthDay(today),
                })}
              </Text>
            ) : null}
          </View>
        </View>

        <SectionHeader style={styles.section}>{t('mobile.home.month')}</SectionHeader>
        <StatRow
          label={t('mobile.orders.title')}
          onPress={() => router.navigate('/orders')}
          items={[
            {
              value: summary ? String(summary.count) : t('common.none'),
              label: t('mobile.orders.count'),
            },
            { value: total, label: t('mobile.orders.confirmed') },
            {
              value: summary ? String(summary.drafts) : t('common.none'),
              label: t('mobile.orders.drafts'),
            },
          ]}
        />

        <SectionHeader style={styles.section}>{t('mobile.home.landsOn')}</SectionHeader>
        <Group>
          <Row
            icon={
              <IconTile color={place ? colors.tint.orange : colors.tint.red}>
                <Send size={16} color={colors.primaryForeground} />
              </IconTile>
            }
            title={
              place ? `${place.pipelineName} › ${place.stageName}` : t('mobile.settings.notChosen')
            }
            subtitle={
              place
                ? t(place.confirms ? 'mobile.settings.confirms' : 'mobile.settings.drafts')
                : null
            }
            onPress={() => router.push('/settings')}
          />
        </Group>

        <SectionHeader style={styles.section}>{t('mobile.home.actions')}</SectionHeader>
        <Group inset={ICON_INSET}>
          <Row
            icon={
              <IconTile color={colors.tint.blue}>
                <Package size={17} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.home.openShop')}
            onPress={() => router.navigate('/shop')}
          />
          <Row
            icon={
              <IconTile color={colors.tint.green}>
                <ShoppingCart size={16} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.tabs.cart')}
            value={t('mobile.cart.count', { n: cart.lines.length })}
            onPress={() => router.navigate('/cart')}
          />
          <Row
            icon={
              <IconTile color={colors.tint.indigo}>
                <ClipboardList size={16} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.orders.title')}
            onPress={() => router.navigate('/orders')}
          />
          <Row
            icon={
              <IconTile color={colors.tint.gray}>
                <ScanBarcode size={16} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.scan.title')}
            onPress={() => router.push('/scan')}
          />
        </Group>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg },
  bar: { height: 44 },
  title: { marginTop: 2, marginHorizontal: spacing.xs },
  hello: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: radii.tile,
    backgroundColor: colors.card,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: fonts.semibold,
    fontSize: 19,
    lineHeight: 24,
    color: colors.primaryForeground,
  },
  grow: { flex: 1, gap: 2 },
  helloText: { fontFamily: fonts.semibold, fontSize: 19, lineHeight: 24, color: colors.foreground },
  section: { marginTop: 22 },
});
