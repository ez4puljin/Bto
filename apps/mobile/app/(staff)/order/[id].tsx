import { Decimal } from '@tugeel/shared/money';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Package } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../src/ui/text';
import { problemFrom } from '../../../src/api/problem';
import { useOrder, useProductsOf, useRepContext } from '../../../src/api/rep';
import { dayNameOf, monthDay } from '../../../src/dates/calendar';
import { ubDate, ubTime } from '../../../src/dates/dates';
import { formatMnt, formatQty } from '../../../src/format/format';
import { useSignedIn } from '../../../src/state/session';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { Group, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { FootNote, NavBar, Page, SectionHeader } from '../../../src/ui/layout';
import { PaymentDot, StatusPill } from '../../../src/ui/status';

/** A line's picture; the separators start past it. */
const THUMB = 52;
const LINE_INSET = spacing.lg + THUMB + spacing.md;

/**
 * One of the rep's orders (ADR-0061 #5; the boards' look, ADR-0068): its number and status, the
 * customer, delivery, payment and where it sits, the lines (the owner, 2026-10-18: each with its
 * picture, name, «qty unit × price» per part and its total, and «Дутуу …» only when something is
 * short), and the totals. A draft has no prices yet: its lines and total show the estimate at
 * today's prices («≈ …₮»), with a note that the office's confirmation fixes them.
 */
export default function OrderScreen() {
  const { t } = useTranslation();
  const router = useRouter();
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
    <Page>
      <NavBar back={t('mobile.tabs.orders')} onBack={() => router.back()} />
      {order.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      <View style={styles.pad}>
        {order.error ? <ProblemText problem={problemFrom(order.error)} /> : null}
      </View>
      {data ? (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.head}>
            <Text accessibilityRole="header" style={[type.title, styles.number]}>
              {data.number ?? t('common.none')}
            </Text>
            <StatusPill status={data.status} />
          </View>
          <Text style={[type.body, styles.muted, styles.created]}>
            {t('mobile.order.created', {
              date: day(ubDate(data.createdAt)),
              time: ubTime(data.createdAt),
            })}
          </Text>

          <SectionHeader style={styles.section}>{t('mobile.checkout.customer')}</SectionHeader>
          <Group>
            <Row
              title={data.customerName}
              subtitle={t('mobile.checkout.code', { code: data.customerCode })}
            />
            {data.contactName || data.contactPhone ? (
              <Row
                title={t('mobile.checkout.contact')}
                value={[data.contactName, data.contactPhone].filter(Boolean).join(' · ')}
              />
            ) : null}
          </Group>

          <SectionHeader style={styles.section}>{t('mobile.checkout.delivery')}</SectionHeader>
          <Group>
            <Row
              title={t(`sales.fulfilments.${data.fulfilment}`)}
              value={data.fulfilment === 'DELIVERY' ? (data.addressText ?? t('common.none')) : null}
            />
            <Row
              title={
                data.fulfilment === 'PICKUP'
                  ? t('mobile.checkout.pickupDay')
                  : t('mobile.checkout.deliveryDay')
              }
              value={day(data.deliveryDate)}
            />
            <Row
              title={t('mobile.checkout.payment')}
              right={
                <View style={styles.payment}>
                  <PaymentDot method={data.paymentMethod} size={9} />
                  <Text style={[type.body, styles.muted]}>
                    {t(`sales.paymentMethods.${data.paymentMethod}`)}
                  </Text>
                </View>
              }
            />
            <Row
              title={t('mobile.order.place')}
              value={
                [data.pipelineName, data.stageName].filter(Boolean).join(' › ') || t('common.none')
              }
            />
          </Group>
          {data.note ? <FootNote>{data.note}</FootNote> : null}
          {data.status === 'DRAFT' ? <FootNote>{t('mobile.order.draftHint')}</FootNote> : null}
          {data.cancelReason ? (
            <Text style={[type.body, styles.cancelled]}>{data.cancelReason}</Text>
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
                      <View style={styles.shortPill}>
                        <Text style={styles.shortText}>
                          {t('mobile.order.short', {
                            short: formatQty(line.qtyBackordered),
                            unit: line.baseUnitName,
                          })}
                        </Text>
                      </View>
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

          <SectionHeader style={styles.section}>{t('mobile.cart.totals')}</SectionHeader>
          <Group>
            <Row
              title={t('mobile.order.items')}
              value={t('mobile.order.kinds', { n: data.lines.length })}
            />
            {data.discountTotal && new Decimal(data.discountTotal).gt(0) ? (
              <Row title={t('mobile.cart.discount')} value={money(data.discountTotal)} />
            ) : null}
            <View style={styles.totalRow}>
              <Text style={type.heading}>{t('mobile.cart.total')}</Text>
              <Text style={[styles.total, estimate !== null && styles.estimate]} numberOfLines={1}>
                {estimate !== null ? approx(estimate) : money(data.total)}
              </Text>
            </View>
          </Group>
          {data.total === null ? (
            <FootNote>
              {t(estimate !== null ? 'mobile.order.estimateNote' : 'mobile.order.priceLater')}
            </FootNote>
          ) : null}
        </ScrollView>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing.lg },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xs,
  },
  number: { flexShrink: 1, fontVariant: ['tabular-nums'] },
  created: { marginTop: 2, marginHorizontal: spacing.xs },
  muted: { color: colors.muted },
  section: { marginTop: 22 },
  payment: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cancelled: { marginTop: 10, marginHorizontal: spacing.xs, color: colors.destructive },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radii.control,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  grow: { flex: 1, gap: 2 },
  lineName: { ...type.rowStrong, marginBottom: 2 },
  part: { ...type.secondary, ...tabular },
  shortPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.warningSoft,
  },
  shortText: { ...type.caption, fontFamily: fonts.semibold, color: colors.warningText },
  lineTotal: { ...type.rowStrong, ...tabular, textAlign: 'right' },
  // A draft's estimate: softer than a confirmed price.
  estimate: { color: colors.label2 },
  totalRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  total: { ...type.title2, ...tabular, flexShrink: 1, textAlign: 'right' },
});
