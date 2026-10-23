import { TriangleAlert } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatMnt } from '../format/format';
import { colors, fonts, spacing, type } from '../theme/tokens';
import { Text } from '../ui/text';
import type { CreditWarning } from './account';

/** The amount in a sentence set in bold (the Cart board's «<b>350,000₮</b> хугацаа хэтэрсэн…»). */
function strong(text: string, part: string | null): ReactNode {
  const at = part ? text.indexOf(part) : -1;
  if (!part || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <Text style={styles.strong}>{part}</Text>
      {text.slice(at + part.length)}
    </>
  );
}

/**
 * Why the office may not confirm yet (ADR-0079 #5), on the orange note of the Cart and Checkout
 * boards: the overdue amount, a hold (never its reason) or the amount over the limit. The store
 * may still send. The cart's note adds that, and «Тооцоо харах» when `onAccount` is given.
 */
export function CreditNote({
  warning,
  variant,
  onAccount,
}: {
  warning: CreditWarning;
  variant: 'cart' | 'checkout';
  onAccount?: () => void;
}) {
  const { t } = useTranslation();
  const amount =
    warning.kind === 'overdue'
      ? t('pricing.money', { amount: formatMnt(warning.amount) })
      : warning.kind === 'limit'
        ? t('pricing.money', { amount: formatMnt(warning.excess) })
        : null;
  const lead =
    variant === 'cart'
      ? t(`mobile.customer.cart.credit.${warning.kind}`, { amount: amount ?? '' })
      : t(`mobile.customer.checkout.credit.${warning.kind}`, { amount: amount ?? '' });
  const follow =
    variant === 'cart'
      ? warning.kind === 'hold'
        ? t('mobile.customer.cart.credit.maySendHold')
        : // An overdue debt only reminds (ADR-0101): the office confirms as usual.
          warning.kind === 'overdue'
          ? t('mobile.customer.cart.credit.maySendOverdue')
          : t('mobile.customer.cart.credit.maySend')
      : null;
  return (
    <View accessibilityRole="alert" style={styles.box}>
      <TriangleAlert size={19} strokeWidth={2} color={colors.warningText} />
      <View style={styles.text}>
        <Text style={styles.body}>{strong(lead, amount)}</Text>
        {follow ? <Text style={styles.body}>{follow}</Text> : null}
        {onAccount ? (
          <Pressable
            accessibilityRole="link"
            onPress={onAccount}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            style={styles.link}
          >
            <Text style={[styles.body, styles.linkText]}>
              {t('mobile.customer.cart.toAccount')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.warningSoft,
  },
  text: { flex: 1, gap: spacing.xs },
  body: { ...type.body, color: colors.warningText },
  strong: { fontFamily: fonts.bold },
  link: { alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center' },
  linkText: { fontFamily: fonts.semibold, textDecorationLine: 'underline' },
});
