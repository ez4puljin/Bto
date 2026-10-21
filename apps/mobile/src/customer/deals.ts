import { Decimal } from '@tugeel/shared/money';
import type { StoreDeal, StoreOrderDeal, StoreProduct } from '../api/customer';
import { monthDay } from '../dates/calendar';
import { formatMnt, formatQty } from '../format/format';

// Discount programs on «Bto300»'s cards, the product page and «Сагс» (ADR-0092 #3, #7; ADR-0093
// #4): the server builds the badge (`deal.label`) and prices everything; the app only picks the
// badge's colour, strikes the regular price through and says the program in words.

/** A promotion (a program with an end date) is orange, a discount red. */
export type DealTone = 'promotion' | 'discount';

export function dealToneOf(kind: StoreDeal['kind']): DealTone {
  return kind === 'PROMOTION' ? 'promotion' : 'discount';
}

/**
 * The card's price per base unit: the deal price with the regular one struck through when an
 * unconditional program lowers it (`dealPrice`, ADR-0093 #4), else the regular price; null without
 * a price.
 */
export function cardPriceOf(
  product: Pick<StoreProduct, 'basePrice' | 'dealPrice'>,
): { price: string; old: string | null } | null {
  if (product.basePrice === null) return null;
  if (product.dealPrice !== null && new Decimal(product.dealPrice).lt(product.basePrice)) {
    return { price: product.dealPrice, old: product.basePrice };
  }
  return { price: product.basePrice, old: null };
}

/** When the program's first step applies: a quantity, an amount, or always. */
export type DealCondition =
  | { kind: 'qty'; qty: string; unit: string | null; category: boolean }
  | { kind: 'amount'; amount: string; category: boolean }
  | null;

/** What the first step gives. */
export type DealEffect =
  | { kind: 'percent'; value: string }
  | { kind: 'amount'; value: string; per: string | null }
  | { kind: 'price'; value: string; per: string | null };

/** The product page's sentence in parts: «10/31 хүртэл 20+ хайрцаг авбал 3% хямд.» */
export interface DealSentence {
  /** A promotion's last day, «10/31». */
  until: string | null;
  condition: DealCondition;
  effect: DealEffect;
}

export function dealSentenceOf(deal: StoreDeal): DealSentence {
  const category = deal.scope === 'CATEGORY';
  const threshold = deal.threshold;
  let condition: DealCondition = null;
  if (threshold?.qty) {
    condition = {
      kind: 'qty',
      qty: formatQty(threshold.qty),
      unit: threshold.unitName ? threshold.unitName : null,
      category,
    };
  } else if (threshold?.amount) {
    condition = { kind: 'amount', amount: formatMnt(threshold.amount), category };
  }
  const effect: DealEffect =
    deal.effect === 'PERCENT'
      ? { kind: 'percent', value: formatQty(deal.value) }
      : deal.effect === 'AMOUNT'
        ? { kind: 'amount', value: formatMnt(deal.value), per: deal.perUnitName }
        : { kind: 'price', value: formatMnt(deal.value), per: deal.perUnitName };
  return { until: deal.lastDay ? monthDay(deal.lastDay) : null, condition, effect };
}

/**
 * «Сагс»'s line per order-amount program (ADR-0092 #3): the next step and what the cart still
 * needs for it («500,000₮ хүрвэл 3% хямд · дахиад 120,000₮»), else the step already reached.
 */
export type OrderDealHint =
  | { kind: 'next'; percent: boolean; threshold: string; value: string; missing: string }
  | { kind: 'reached'; percent: boolean; value: string };

export function orderDealHintsOf(deals: readonly StoreOrderDeal[]): OrderDealHint[] {
  return deals.flatMap((deal): OrderDealHint[] => {
    const percent = deal.effect === 'PERCENT';
    const value = (amount: string) => (percent ? formatQty(amount) : formatMnt(amount));
    if (deal.next?.missing) {
      return [
        {
          kind: 'next',
          percent,
          threshold: formatMnt(deal.next.threshold),
          value: value(deal.next.value),
          missing: formatMnt(deal.next.missing),
        },
      ];
    }
    return deal.reached ? [{ kind: 'reached', percent, value: value(deal.reached.value) }] : [];
  });
}
