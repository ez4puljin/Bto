import type { CustomerOrderState } from '@tugeel/shared/sales';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StoreOrderRow as StoreOrderRowData } from '../api/customer';
import { formatMnt } from '../format/format';
import { colors, fonts, spacing, tabular, type } from '../theme/tokens';
import { PaymentDot } from '../ui/status';
import { Text } from '../ui/text';
import { orderAmount, orderNotes, STATE_TONES, type Taker, takerOf } from './orders';

/** An order's state in the customer's words, on the board's coloured pill (ADR-0079 #6). */
export function StatePill({ state }: { state: CustomerOrderState }) {
  const { t } = useTranslation();
  const tone = STATE_TONES[state];
  return (
    <View style={[styles.pill, { backgroundColor: tone.background }]}>
      <Text style={[styles.pillText, { color: tone.text }]}>
        {t(`sales.customerStates.${state}`)}
      </Text>
    </View>
  );
}

/** «Апп», «Оффис», «Төлөөлөгч Бат». */
export function useTakerText() {
  const { t } = useTranslation();
  return (taker: Taker): string =>
    taker.kind === 'app'
      ? t('mobile.customer.orders.takerApp')
      : taker.kind === 'office'
        ? t('mobile.customer.orders.takerOffice')
        : taker.name
          ? t('mobile.customer.orders.takerRep', { name: taker.name })
          : t('mobile.customer.orders.takerRepNoName');
}

/**
 * An order of the store's lists (the Orders board, and «Сүүлийн захиалга» on «Нүүр»): the number,
 * a line under it (the caller's: the payment, who took it and the time on «Захиалга»; the day on
 * «Нүүр»), the backordered lines or a cancellation's reason, then the amount — «≈» while the
 * office has not confirmed it — and the state. The row opens the order.
 */
export function StoreOrderRow({
  order,
  meta,
  onPress,
}: {
  order: StoreOrderRowData;
  /** The line under the number. */
  meta: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const amount = orderAmount(order);
  const notes = orderNotes(order);
  const cancelled = order.state === 'CANCELLED';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.text}>
        <Text style={styles.number}>{order.number ?? t('common.none')}</Text>
        <View style={styles.meta}>
          <PaymentDot method={order.paymentMethod} />
          <Text style={type.caption} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        {notes.map((note) => (
          <Text
            key={note.kind}
            style={[styles.note, note.kind === 'cancelled' ? styles.noteCancelled : null]}
            numberOfLines={2}
          >
            {note.kind === 'backordered'
              ? t('mobile.customer.orders.backorderedLines', { n: note.lines })
              : note.reason
                ? t('mobile.customer.orders.cancelledReason', { reason: note.reason })
                : t('mobile.customer.orders.cancelledNoReason')}
          </Text>
        ))}
      </View>
      <View style={styles.right}>
        {amount ? (
          <Text
            style={[styles.total, (amount.estimate || cancelled) && styles.soft]}
            numberOfLines={1}
          >
            {amount.estimate
              ? t('mobile.orders.approx', {
                  amount: t('pricing.money', { amount: formatMnt(amount.amount) }),
                })
              : t('pricing.money', { amount: formatMnt(amount.amount) })}
          </Text>
        ) : (
          <Text style={styles.later} numberOfLines={1}>
            {t('mobile.orders.priceLater')}
          </Text>
        )}
        <StatePill state={order.state} />
      </View>
    </Pressable>
  );
}

/** «Бэлнээр · Апп · 09:42»: the Orders board's line under a number. */
export function useOrderMeta() {
  const { t } = useTranslation();
  const taker = useTakerText();
  return (order: StoreOrderRowData): string =>
    [
      t(`sales.paymentMethods.${order.paymentMethod}`),
      taker(takerOf(order)),
      order.createdTime,
    ].join(' · ');
}

const styles = StyleSheet.create({
  pill: { height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: 'center' },
  pillText: { ...type.secondary, fontFamily: fonts.semibold },
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
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  note: { ...type.caption, fontFamily: fonts.semibold, color: colors.warningText },
  noteCancelled: { color: colors.cancelled },
  right: { flexShrink: 0, alignItems: 'flex-end', gap: 6 },
  total: { ...type.sectionTitle, ...tabular, textAlign: 'right' },
  soft: { color: colors.muted },
  later: { ...type.body, color: colors.muted, textAlign: 'right' },
});
