import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { StoreDeal } from '../api/customer';
import { colors, radii, spacing, type } from '../theme/tokens';
import { Text } from '../ui/text';
import { dealSentenceOf, dealToneOf } from './deals';
import { DealBadge } from './product-card';
import { capitalised } from './shop';

/**
 * A discount program in words (ADR-0092 #7): «10/31 хүртэл 20+ хайрцаг авбал 3% хямд. Хямдрал
 * сагсанд өөрөө орно.» The parts are `dealSentenceOf`'s; the words mn.json's.
 */
export function useDealSentence() {
  const { t } = useTranslation();
  return (deal: StoreDeal): string => {
    const sentence = dealSentenceOf(deal);
    const parts: string[] = [];
    if (sentence.until) parts.push(t('mobile.customer.deal.until', { date: sentence.until }));
    const condition = sentence.condition;
    if (condition?.kind === 'qty') {
      parts.push(
        condition.unit
          ? t(
              condition.category
                ? 'mobile.customer.deal.ifCategoryQty'
                : 'mobile.customer.deal.ifQty',
              { qty: condition.qty, unit: condition.unit },
            )
          : t(
              condition.category
                ? 'mobile.customer.deal.ifCategoryQtyBare'
                : 'mobile.customer.deal.ifQtyBare',
              { qty: condition.qty },
            ),
      );
    } else if (condition?.kind === 'amount') {
      parts.push(
        t(
          condition.category
            ? 'mobile.customer.deal.ifCategoryAmount'
            : 'mobile.customer.deal.ifAmount',
          { amount: condition.amount },
        ),
      );
    }
    const effect = sentence.effect;
    parts.push(
      effect.kind === 'percent'
        ? t('mobile.customer.deal.percent', { value: effect.value })
        : effect.kind === 'amount'
          ? effect.per
            ? t('mobile.customer.deal.amountPer', { per: effect.per, value: effect.value })
            : t('mobile.customer.deal.amount', { value: effect.value })
          : effect.per
            ? t('mobile.customer.deal.pricePer', { per: effect.per, value: effect.value })
            : t('mobile.customer.deal.price', { value: effect.value }),
    );
    return `${capitalised(parts.join(' '))}. ${t('mobile.customer.deal.auto')}`;
  };
}

/** The product page's note under the stock word: the badge and the sentence, orange or red. */
export function DealNote({ deal }: { deal: StoreDeal }) {
  const sentence = useDealSentence();
  const promotion = dealToneOf(deal.kind) === 'promotion';
  return (
    <View style={[styles.note, promotion ? styles.promotion : styles.discount]}>
      <DealBadge deal={deal} />
      <Text
        style={[type.body, styles.text, promotion ? styles.promotionText : styles.discountText]}
      >
        {sentence(deal)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radii.field + 2,
  },
  promotion: { backgroundColor: colors.warningSoft },
  discount: { backgroundColor: colors.destructiveSoft },
  text: { flex: 1 },
  promotionText: { color: colors.warningText },
  discountText: { color: colors.destructiveText },
});
