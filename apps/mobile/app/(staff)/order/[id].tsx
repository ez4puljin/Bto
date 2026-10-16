import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { problemFrom } from '../../../src/api/problem';
import { useOrder, useRepContext } from '../../../src/api/rep';
import { dayNameOf, monthDay } from '../../../src/dates/calendar';
import { ubDate, ubTime } from '../../../src/dates/dates';
import { formatMnt, formatQty } from '../../../src/format/format';
import { colors, fonts, radii, spacing, type } from '../../../src/theme/tokens';
import { Group, Row } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { FootNote, NavBar, Page, SectionHeader } from '../../../src/ui/layout';
import { PaymentDot, StatusPill } from '../../../src/ui/status';

/**
 * One of the rep's orders (ADR-0061 #5; the boards' look, ADR-0066): its number and status, the
 * customer, delivery, payment and where it sits, the lines with what was reserved, and the totals.
 */
export default function OrderScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(Number.parseInt(id ?? '0', 10));
  const today = useRepContext().data?.today ?? null;
  const data = order.data;
  const money = (value: string | null) =>
    value === null ? t('common.none') : t('pricing.money', { amount: formatMnt(value) });
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
          <Group>
            {data.lines.map((line) => (
              <View key={line.lineNo} style={styles.line}>
                <View style={styles.grow}>
                  <Text style={styles.lineName} numberOfLines={2}>
                    {line.productName}
                  </Text>
                  <Text style={type.secondary}>
                    {line.parts.length > 0
                      ? line.parts
                          .map((part) =>
                            t('mobile.product.part', {
                              qty: formatQty(part.qty),
                              unit: part.uomName,
                              price: formatMnt(part.unitPrice),
                            }),
                          )
                          .join(' + ')
                      : `${formatQty(line.qty)} ${line.unitName}`}
                  </Text>
                  {data.status !== 'DRAFT' && data.status !== 'CANCELLED' ? (
                    <Text
                      style={[type.caption, formatQty(line.qtyBackordered) !== '0' && styles.short]}
                    >
                      {t('mobile.order.reserved', {
                        reserved: formatQty(line.qtyApproved),
                        short: formatQty(line.qtyBackordered),
                        unit: line.baseUnitName,
                      })}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.lineTotal}>{money(line.total)}</Text>
              </View>
            ))}
          </Group>

          <SectionHeader style={styles.section}>{t('mobile.cart.totals')}</SectionHeader>
          <Group>
            {data.discountTotal && data.discountTotal !== '0' ? (
              <Row title={t('mobile.cart.discount')} value={money(data.discountTotal)} />
            ) : null}
            <View style={styles.totalRow}>
              <Text style={type.heading}>{t('mobile.cart.total')}</Text>
              <Text style={styles.total}>{money(data.total)}</Text>
            </View>
          </Group>
          {data.total === null ? <FootNote>{t('mobile.order.priceLater')}</FootNote> : null}
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
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  grow: { flex: 1, gap: 2 },
  lineName: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, color: colors.foreground },
  short: { color: colors.warning },
  lineTotal: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, color: colors.foreground },
  totalRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.card,
  },
  total: {
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    color: colors.foreground,
  },
});
