import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import type { RepStoreOrder } from '../api/rep';
import { formatMnt, initialsOf } from '../format/format';
import { colors, fonts, spacing, tabular, type } from '../theme/tokens';
import { StatusPill } from '../ui/status';
import { Text } from '../ui/text';
import { amountOf, takenAt, takerOf } from './store-orders';

/**
 * An order of a store's history (the owner, 2026-10-18; the StoreOrders board of 2026-11-16): who
 * took it as a round mark («Би» for the rep, initials for anyone else), the number, then when, by
 * whom and how many products, and the amount and the status as the rep's own rows show them. Only the rep's own order opens (with a chevron); anyone else's is a plain row.
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
  const takerName =
    taker.kind === 'me'
      ? t('mobile.storeOrders.me')
      : taker.kind === 'name'
        ? taker.name
        : t('mobile.storeOrders.unknown');
  const meta = [
    takenAt(order, withDate),
    taker.kind === 'me' ? null : takerName,
    order.lineCount > 0 ? t('mobile.order.kinds', { n: order.lineCount }) : null,
  ]
    .filter((part) => part)
    .join(' · ');
  const content = (
    <>
      <View
        accessibilityLabel={takerName}
        style={[styles.avatar, taker.kind !== 'me' && styles.avatarOther]}
      >
        <Text style={styles.avatarText} numberOfLines={1}>
          {taker.kind === 'me'
            ? takerName
            : taker.kind === 'name'
              ? initialsOf(taker.name)
              : t('common.none')}
        </Text>
      </View>
      <View style={styles.text}>
        <Text
          style={[order.mine ? type.rowStrong : type.row, tabular, cancelled && styles.mutedText]}
          numberOfLines={1}
        >
          {order.number ?? t('common.none')}
        </Text>
        <Text style={[type.secondary, tabular]} numberOfLines={1}>
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
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  pressed: { backgroundColor: colors.accent },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.tint.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOther: { backgroundColor: colors.tint.indigo },
  avatarText: { ...type.chip, fontFamily: fonts.semibold, color: colors.primaryForeground },
  text: { flex: 1, minWidth: 0, gap: 1 },
  mutedText: { color: colors.muted },
  right: { flexShrink: 0, alignItems: 'flex-end', gap: spacing.xs },
  total: { ...type.heading, ...tabular, textAlign: 'right' },
  // Not final yet: a softer figure than a confirmed total.
  estimate: { color: colors.muted },
  later: { ...type.body, color: colors.muted, textAlign: 'right' },
  struck: { color: colors.muted, textDecorationLine: 'line-through' },
});
