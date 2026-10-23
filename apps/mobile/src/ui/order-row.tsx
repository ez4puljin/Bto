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
 * customer, the payment, stage and time, then the amount as the row's strong figure (the owner,
 * 2026-10-18) and the status; a cancelled one is struck through. A draft has no amount yet: it
 * shows its estimate at today's prices as «≈ …₮» over its muted «Ноорог» pill, or «үнэ батлахад»
 * when a line has no price. The row opens the order.
 */
export function OrderRow({ order, onPress }: { order: RepOrderSummary; onPress: () => void }) {
  const { t } = useTranslation();
  const cancelled = order.status === 'CANCELLED';
  const estimate = order.total === null ? order.estimatedTotal : null;
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
        {order.total !== null ? (
          <Text style={[styles.total, cancelled && styles.struck]} numberOfLines={1}>
            {t('pricing.money', { amount: formatMnt(order.total) })}
          </Text>
        ) : estimate !== null ? (
          <Text style={[styles.total, styles.estimate]} numberOfLines={1}>
            {t('mobile.orders.approx', {
              amount: t('pricing.money', { amount: formatMnt(estimate) }),
            })}
          </Text>
        ) : (
          <Text style={styles.later} numberOfLines={1}>
            {t('mobile.orders.priceLater')}
          </Text>
        )}
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
  right: { flexShrink: 0, alignItems: 'flex-end', gap: 6 },
  total: { ...type.sectionTitle, ...tabular, textAlign: 'right' },
  // Not final yet: a softer figure than a confirmed total (Bto300's rows, ADR-0100).
  estimate: { color: colors.muted },
  later: { ...type.body, color: colors.muted, textAlign: 'right' },
  struck: { color: colors.muted, textDecorationLine: 'line-through' },
});
