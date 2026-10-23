import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import type { RepStoreOrder } from '../api/rep';
import { formatMnt } from '../format/format';
import { colors, spacing, tabular, type } from '../theme/tokens';
import { StatusPill } from '../ui/status';
import { Text } from '../ui/text';
import { amountOf, takenAt, takerOf } from './store-orders';

/**
 * An order of a store's history (the owner, 2026-10-18): who took it («Би» for the rep), when,
 * the number and how many products, then the amount and the status as the rep's own rows show
 * them. Only the rep's own order opens (with a chevron); anyone else's is a plain row.
 * `withDate` false leaves the day to the list's day title.
 */
export function StoreOrderRow({
  order,
  onOpen,
  withDate = true,
}: {
  order: RepStoreOrder;
  onOpen: (orderId: number) => void;
  withDate?: boolean;
}) {
  const { t } = useTranslation();
  const taker = takerOf(order);
  const amount = amountOf(order);
  const cancelled = order.status === 'CANCELLED';
  // When first: on a narrow phone the line's end is cut, and that is the number, never the time.
  const meta = [
    takenAt(order, withDate),
    order.number,
    order.lineCount > 0 ? t('mobile.order.kinds', { n: order.lineCount }) : null,
  ]
    .filter((part) => part)
    .join(' · ');
  const content = (
    <>
      <View style={styles.text}>
        <Text style={[styles.taker, taker.kind === 'me' && styles.me]} numberOfLines={1}>
          {taker.kind === 'me'
            ? t('mobile.storeOrders.me')
            : taker.kind === 'name'
              ? taker.name
              : t('mobile.storeOrders.unknown')}
        </Text>
        <Text style={[type.caption, tabular]} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <View style={styles.right}>
        {amount.kind === 'total' ? (
          <Text style={[styles.total, cancelled && styles.struck]} numberOfLines={1}>
            {t('pricing.money', { amount: formatMnt(amount.value) })}
          </Text>
        ) : amount.kind === 'estimate' ? (
          <Text style={[styles.total, styles.estimate]} numberOfLines={1}>
            {t('mobile.orders.approx', {
              amount: t('pricing.money', { amount: formatMnt(amount.value) }),
            })}
          </Text>
        ) : (
          <Text style={styles.later} numberOfLines={1}>
            {t('mobile.orders.priceLater')}
          </Text>
        )}
        <StatusPill status={order.status} />
      </View>
      {order.mine ? <ChevronRight size={16} strokeWidth={2.6} color={colors.input} /> : null}
    </>
  );
  if (!order.mine) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpen(order.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {content}
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
  taker: { ...type.heading },
  me: { color: colors.primary },
  right: { flexShrink: 0, alignItems: 'flex-end', gap: 6 },
  // Bto300's order rows (ADR-0100).
  total: { ...type.sectionTitle, ...tabular, textAlign: 'right' },
  // Not final yet: a softer figure than a confirmed total.
  estimate: { color: colors.muted },
  later: { ...type.body, color: colors.muted, textAlign: 'right' },
  struck: { color: colors.muted, textDecorationLine: 'line-through' },
});
