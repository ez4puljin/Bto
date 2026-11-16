import { Decimal } from '@tugeel/shared/money';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  CircleAlert,
  Info,
  Package,
  StickyNote,
  Store,
  Truck,
  Warehouse,
} from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../src/ui/text';
import { problemFrom } from '../../../src/api/problem';
import { useOrder, useProductsOf, useRepContext } from '../../../src/api/rep';
import { dayNameOf, monthDay } from '../../../src/dates/calendar';
import { ubDate, ubTime } from '../../../src/dates/dates';
import { formatMnt, formatQty } from '../../../src/format/format';
import { useSignedIn } from '../../../src/state/session';
import { colors, fonts, radii, spacing, storeType, tabular, type } from '../../../src/theme/tokens';
import { Group, ICON_INSET, ICON_TILE, IconTile, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { Notice, PAGE, Pill } from '../../../src/ui/staff-kit';
import { PaymentDot, StatusPill } from '../../../src/ui/status';
import { StoreHeader } from '../../../src/ui/store-header';

/** A line's picture (Bto300's order page); the separators start past it. */
const THUMB = 48;
const LINE_INSET = spacing.lg + THUMB + spacing.md;

/**
 * One of the rep's orders (ADR-0061 #5; the boards' look, ADR-0068): its number and status, the
 * customer, delivery, payment and where it sits, the lines (the owner, 2026-10-18: each with its
 * picture, name, «qty unit × price» per part and its total, and «Дутуу …» only when something is
 * short), and the totals. A draft has no prices yet: its lines and total show the estimate at
 * today's prices («≈ …₮»), with a note that the office's confirmation fixes them. The blue header
 * carries the number as its title and, in the band under it, the amount, when it was made and the
 * status (the Order board of 2026-11-16).
 */
export default function OrderScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { server } = useSignedIn();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(Number.parseInt(id ?? '0', 10));
  const today = useRepContext().data?.today ?? null;
  const data = order.data;
  const productIds = useMemo(
    () => [...new Set((data?.lines ?? []).map((line) => line.productId))],
    [data],
  );
  const products = useProductsOf(productIds);
  const thumbs = useMemo(
    () => new Map((products.data ?? []).map((product) => [product.id, product.thumbUrl])),
    [products.data],
  );
  const reserving = data !== undefined && data.status !== 'DRAFT' && data.status !== 'CANCELLED';
  const money = (value: string | null) =>
    value === null ? t('common.none') : t('pricing.money', { amount: formatMnt(value) });
  const approx = (value: string) =>
    t('mobile.orders.approx', { amount: t('pricing.money', { amount: formatMnt(value) }) });
  // A draft's lines were quoted at today's prices; a line without one is «Үнэгүй» only when the
  // others were priced (a refused quote prices none, and says nothing per line).
  const quoted = (data?.lines ?? []).some((line) => line.estimatedTotal !== null);
  const estimate = data && data.total === null ? data.estimatedTotal : null;
  const day = (date: string) => {
    const name = today ? dayNameOf(date, today) : 'date';
    return name === 'date'
      ? monthDay(date)
      : t('mobile.checkout.namedDay', { name: t(`mobile.days.${name}`), day: monthDay(date) });
  };

  return (
    <Page edges={[]}>
      <StoreHeader
        title={data ? (data.number ?? t('common.none')) : t('mobile.tabs.orders')}
        onBack={() => router.back()}
      >
        {data ? (
          // The amount and the status in the blue band, under the order's number.
          <View style={styles.band}>
            <View style={styles.grow}>
              <Text style={styles.bandAmount} numberOfLines={1} adjustsFontSizeToFit>
                {estimate !== null ? approx(estimate) : money(data.total)}
              </Text>
              <Text style={storeType.headerSubtitle} numberOfLines={1}>
                {t('mobile.order.created', {
                  date: day(ubDate(data.createdAt)),
                  time: ubTime(data.createdAt),
                })}
              </Text>
            </View>
            <StatusPill status={data.status} />
          </View>
        ) : null}
      </StoreHeader>
      {order.isLoading ? <ActivityIndicator style={styles.loading} color={colors.primary} /> : null}
      {order.error ? (
        <View style={styles.pad}>
          <ProblemText problem={problemFrom(order.error)} />
        </View>
      ) : null}
      {data ? (
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: spacing.xxl + insets.bottom }]}
        >
          <SectionHeader style={styles.section}>{t('mobile.order.customerDelivery')}</SectionHeader>
          <Group inset={ICON_INSET}>
            <Row
              icon={
                <IconTile color={colors.primary}>
                  <Store size={18} strokeWidth={2} color={colors.primaryForeground} />
                </IconTile>
              }
              title={data.customerName}
              titleStyle={styles.strong}
              subtitle={t('mobile.checkout.code', { code: data.customerCode })}
            />
            {data.contactName || data.contactPhone ? (
              <Row
                title={t('mobile.checkout.contact')}
                value={[data.contactName, data.contactPhone].filter(Boolean).join(' · ')}
              />
            ) : null}
            <Row
              icon={
                <View style={styles.greyTile}>
                  {data.fulfilment === 'DELIVERY' ? (
                    <Truck size={18} strokeWidth={2} color={colors.label2} />
                  ) : (
                    <Warehouse size={18} strokeWidth={2} color={colors.label2} />
                  )}
                </View>
              }
              title={t(`sales.fulfilments.${data.fulfilment}`)}
              subtitle={
                data.fulfilment === 'DELIVERY' ? (data.addressText ?? t('common.none')) : null
              }
            />
            <Row
              title={
                data.fulfilment === 'PICKUP'
                  ? t('mobile.checkout.pickupDay')
                  : t('mobile.checkout.deliveryDay')
              }
              titleStyle={styles.muted}
              right={<Text style={[type.row, tabular]}>{day(data.deliveryDate)}</Text>}
            />
            <Row
              title={t('mobile.checkout.payment')}
              titleStyle={styles.muted}
              right={
                <View style={styles.payment}>
                  <PaymentDot method={data.paymentMethod} size={8} />
                  <Text style={type.row}>{t(`sales.paymentMethods.${data.paymentMethod}`)}</Text>
                </View>
              }
            />
            <Row
              title={t('mobile.order.place')}
              titleStyle={styles.muted}
              right={
                <Text style={[type.row, styles.place]} numberOfLines={2}>
                  {[data.pipelineName, data.stageName].filter(Boolean).join(' › ') ||
                    t('common.none')}
                </Text>
              }
            />
          </Group>
          {data.note ? <Notice icon={StickyNote}>{data.note}</Notice> : null}
          {data.status === 'DRAFT' ? (
            <Notice icon={Info}>{t('mobile.order.draftHint')}</Notice>
          ) : null}
          {data.cancelReason ? (
            <Notice tone="bad" icon={CircleAlert}>
              {data.cancelReason}
            </Notice>
          ) : null}

          <SectionHeader style={styles.section}>
            {t('mobile.order.lines', { n: data.lines.length })}
          </SectionHeader>
          <Group inset={LINE_INSET}>
            {data.lines.map((line) => {
              const thumb = thumbs.get(line.productId) ?? null;
              const parts =
                line.parts.length > 0
                  ? line.parts.map((part) =>
                      t('mobile.product.part', {
                        qty: formatQty(part.qty),
                        unit: part.uomName,
                        price: formatMnt(part.unitPrice),
                      }),
                    )
                  : [`${formatQty(line.qty)} ${line.unitName}`];
              const short = reserving && new Decimal(line.qtyBackordered).gt(0);
              return (
                <View key={line.lineNo} style={styles.line}>
                  <View style={styles.thumb}>
                    {thumb ? (
                      <Image
                        source={{ uri: `${server}${thumb}` }}
                        style={styles.image}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        recyclingKey={thumb}
                      />
                    ) : (
                      <Package size={22} strokeWidth={1.5} color={colors.input} />
                    )}
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.lineName} numberOfLines={2}>
                      {line.productName}
                    </Text>
                    {parts.map((part, index) => (
                      <Text key={index} style={styles.part} numberOfLines={1}>
                        {part}
                      </Text>
                    ))}
                    {short ? (
                      <Pill
                        tone="warn"
                        label={t('mobile.order.short', {
                          short: formatQty(line.qtyBackordered),
                          unit: line.baseUnitName,
                        })}
                        style={styles.shortPill}
                      />
                    ) : null}
                  </View>
                  {line.total !== null ? (
                    <Text style={styles.lineTotal} numberOfLines={1}>
                      {money(line.total)}
                    </Text>
                  ) : line.estimatedTotal !== null ? (
                    <Text style={[styles.lineTotal, styles.estimate]} numberOfLines={1}>
                      {approx(line.estimatedTotal)}
                    </Text>
                  ) : quoted ? (
                    <Text style={[type.body, styles.muted]} numberOfLines={1}>
                      {t('mobile.cart.noPrice')}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </Group>

          <Group>
            <Row
              title={t('mobile.order.items')}
              right={
                <Text style={[type.row, tabular]}>
                  {t('mobile.order.kinds', { n: data.lines.length })}
                </Text>
              }
            />
            {data.discountTotal && new Decimal(data.discountTotal).gt(0) ? (
              <Row
                title={t('mobile.cart.discount')}
                right={
                  <Text style={[type.row, tabular, styles.green]}>{money(data.discountTotal)}</Text>
                }
              />
            ) : null}
            <View style={styles.totalRow}>
              <Text style={type.rowStrong}>{t('mobile.cart.total')}</Text>
              <Text style={[styles.total, estimate !== null && styles.estimate]} numberOfLines={1}>
                {estimate !== null ? approx(estimate) : money(data.total)}
              </Text>
            </View>
          </Group>
          {data.total === null ? (
            <Text style={[type.secondary, styles.foot]}>
              {t(estimate !== null ? 'mobile.order.estimateNote' : 'mobile.order.priceLater')}
            </Text>
          ) : null}
        </ScrollView>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  bandAmount: { ...type.largeTitle, ...tabular, color: colors.primaryForeground },
  loading: { marginTop: spacing.xl },
  pad: { paddingHorizontal: spacing.lg },
  body: { ...PAGE },
  // A label sits 8 px over its card inside the page's 16 px rhythm.
  section: { marginTop: 0, marginBottom: -spacing.sm },
  strong: { fontFamily: fonts.semibold },
  muted: { color: colors.muted },
  green: { color: colors.success },
  greyTile: {
    width: ICON_TILE,
    height: ICON_TILE,
    borderRadius: 10,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payment: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  place: { flexShrink: 1, maxWidth: '65%', textAlign: 'right' },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radii.field,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  lineName: { ...type.rowStrong, marginBottom: 2 },
  part: { ...type.secondary, ...tabular },
  shortPill: { marginTop: spacing.xs },
  lineTotal: { ...type.rowStrong, ...tabular, textAlign: 'right' },
  // A draft's estimate: softer than a confirmed price.
  estimate: { color: colors.muted },
  totalRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  total: { ...type.title3, ...tabular, flexShrink: 1, textAlign: 'right' },
  foot: { marginTop: -spacing.sm, marginHorizontal: spacing.xs },
});
