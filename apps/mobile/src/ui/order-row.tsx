import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './text';
import type { RepOrderSummary } from '../api/rep';
import { ubTime } from '../dates/dates';
import { formatMnt } from '../format/format';
import { colors, spacing, tabular, type } from '../theme/tokens';
import { PaymentDot, StatusPill } from './status';

/**
 * An order of the rep's lists (ADR-0068 #7: «Захиалга» and the home's recent ones): the number, the
 * customer, the payment, stage and time, then the total and the status. The row opens the order.
 */
export function OrderRow({ order, onPress }: { order: RepOrderSummary; onPress: () => void }) {
  const { t } = useTranslation();
  const muted = order.total === null || order.status === 'CANCELLED';
  const meta = [
    t(`sales.paymentMethods.${order.paymentMethod}`),
    order.stageName,
    ubTime(order.createdAt),
  ]
    .filter((part) => part)
    .join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.text}>
        <Text style={styles.number}>{order.number ?? t('common.none')}</Text>
        <Text style={styles.customer} numberOfLines={1}>
          {order.customerName}
        </Text>
        <View style={styles.meta}>
          <PaymentDot method={order.paymentMethod} />
          <Text style={type.caption} numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </View>
      <View style={styles.right}>
        <Text style={[styles.total, muted && styles.muted]}>
          {order.total === null
            ? t('mobile.orders.priceLater')
            : t('pricing.money', { amount: formatMnt(order.total) })}
        </Text>
        <StatusPill status={order.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  pressed: { backgroundColor: colors.accent },
  text: { flex: 1, gap: 2 },
  number: { ...type.heading, ...tabular },
  customer: { ...type.body, color: colors.label2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  right: { alignItems: 'flex-end', gap: 6 },
  total: { ...type.heading, ...tabular },
  muted: { color: colors.muted },
});
