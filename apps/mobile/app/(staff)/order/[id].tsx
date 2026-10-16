import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { problemFrom } from '../../../src/api/problem';
import { useOrder } from '../../../src/api/rep';
import { ubDate, ubTime } from '../../../src/dates/dates';
import { formatMnt, formatQty } from '../../../src/format/format';
import { colors, spacing, type } from '../../../src/theme/tokens';
import {
  Card,
  Money,
  PaymentLabel,
  ProblemText,
  Screen,
  SectionTitle,
  StatusPill,
  Title,
} from '../../../src/ui/kit';

/** One of the rep's orders: where it is on the board, its lines, prices and what was reserved. */
export default function OrderScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(Number.parseInt(id ?? '0', 10));
  const data = order.data;

  return (
    <Screen>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <ChevronLeft size={24} color={colors.primary} />
        <Text style={[type.body, { color: colors.link }]}>{t('common.back')}</Text>
      </Pressable>
      {order.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {order.error ? <ProblemText problem={problemFrom(order.error)} /> : null}
      {data ? (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.headRow}>
            <Title>{data.number ?? t('common.none')}</Title>
            <StatusPill status={data.status} />
          </View>
          <Card>
            <Text style={type.heading}>{data.customerName}</Text>
            <Text style={type.secondary}>{data.customerCode}</Text>
            <Text style={type.body}>
              {data.fulfilment === 'DELIVERY'
                ? (data.addressText ?? t('sales.fulfilments.DELIVERY'))
                : t('sales.fulfilments.PICKUP')}
            </Text>
            <Text style={type.body}>{t('mobile.order.delivery', { date: data.deliveryDate })}</Text>
            <PaymentLabel method={data.paymentMethod} />
            {data.note ? <Text style={type.secondary}>{data.note}</Text> : null}
          </Card>
          <Card>
            <Text style={type.caption}>{t('mobile.order.place')}</Text>
            <Text style={type.bodyStrong}>
              {[data.boardName, data.pipelineName, data.stageName].filter(Boolean).join(' › ')}
            </Text>
            <Text style={type.caption}>
              {t('mobile.order.created', {
                date: ubDate(data.createdAt),
                time: ubTime(data.createdAt),
              })}
            </Text>
            {data.status === 'DRAFT' ? (
              <Text style={type.secondary}>{t('mobile.order.draftHint')}</Text>
            ) : null}
            {data.cancelReason ? (
              <Text style={[type.body, { color: colors.destructive }]}>{data.cancelReason}</Text>
            ) : null}
          </Card>

          <SectionTitle>{t('mobile.order.lines')}</SectionTitle>
          {data.lines.map((line) => (
            <Card key={line.lineNo}>
              <Text style={type.bodyStrong}>{line.productName}</Text>
              <Text style={type.caption}>
                {`${line.productSku} · ${formatQty(line.qty)} ${line.unitName}`}
              </Text>
              {line.parts.length > 0 ? (
                <Text style={type.secondary}>
                  {line.parts
                    .map((part) =>
                      t('mobile.cart.part', {
                        qty: formatQty(part.qty),
                        unit: part.uomName,
                        price: formatMnt(part.unitPrice),
                      }),
                    )
                    .join(' + ')}
                </Text>
              ) : null}
              {data.status !== 'DRAFT' && data.status !== 'CANCELLED' ? (
                <Text style={type.caption}>
                  {t('mobile.order.reserved', {
                    reserved: formatQty(line.qtyApproved),
                    short: formatQty(line.qtyBackordered),
                    unit: line.baseUnitName,
                  })}
                </Text>
              ) : null}
              <Money value={line.total} style={styles.right} />
            </Card>
          ))}

          <Card>
            <View style={styles.total}>
              <Text style={type.secondary}>{t('mobile.cart.subtotal')}</Text>
              <Money value={data.subtotal} style={type.body} />
            </View>
            <View style={styles.total}>
              <Text style={type.secondary}>{t('mobile.cart.discount')}</Text>
              <Money value={data.discountTotal} style={type.body} />
            </View>
            <View style={styles.total}>
              <Text style={type.heading}>{t('mobile.cart.total')}</Text>
              <Money value={data.total} style={type.heading} />
            </View>
            {data.total === null ? (
              <Text style={type.caption}>{t('mobile.order.priceLater')}</Text>
            ) : null}
          </Card>
        </ScrollView>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, minHeight: 44 },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  right: { alignSelf: 'flex-end' },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
