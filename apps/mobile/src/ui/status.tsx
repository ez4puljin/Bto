import type { OrderStatus, PaymentMethod } from '@tugeel/shared/sales';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from './text';
import { brandSheet } from '../theme/brand';
import { colors, fonts, type } from '../theme/tokens';

/** Each order status's pill as the MyOrders board colours it; the stages after them alike. */
const STATUS_COLORS: Record<OrderStatus, { background: string; text: string }> = brandSheet(() => ({
  DRAFT: { background: colors.canvas, text: colors.muted },
  SUBMITTED: { background: colors.secondary, text: colors.secondaryForeground },
  APPROVAL_PENDING: { background: colors.warningSoft, text: colors.warning },
  CONFIRMED: { background: colors.secondary, text: colors.secondaryForeground },
  PICKING: { background: colors.violetSoft, text: colors.violet },
  PACKED: { background: colors.violetSoft, text: colors.violet },
  DISPATCHED: { background: colors.violetSoft, text: colors.violet },
  DELIVERED: { background: colors.successSoft, text: colors.success },
  DELIVERY_FAILED: { background: colors.warningSoft, text: colors.warning },
  INVOICED: { background: colors.successSoft, text: colors.success },
  CLOSED: { background: colors.successSoft, text: colors.success },
  CANCELLED: { background: colors.destructiveSoft, text: colors.cancelled },
}));

export function StatusPill({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const palette = STATUS_COLORS[status];
  return (
    <View style={[styles.pill, { backgroundColor: palette.background }]}>
      <Text style={[styles.pillText, { color: palette.text }]}>
        {t(`sales.statuses.${status}`)}
      </Text>
    </View>
  );
}

/** The payment's colour (ADR-0058 #8): cash green, transfer blue, credit orange. */
export const PAYMENT_DOTS: Record<PaymentMethod, string> = {
  CASH: colors.tint.green,
  BANK_TRANSFER: colors.tint.blue,
  CREDIT: colors.tint.orange,
};

export function PaymentDot({ method, size = 8 }: { method: PaymentMethod; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 4,
        backgroundColor: PAYMENT_DOTS[method],
      }}
    />
  );
}

const styles = StyleSheet.create({
  pill: { height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: 'center' },
  pillText: { ...type.secondary, fontFamily: fonts.semibold },
});
