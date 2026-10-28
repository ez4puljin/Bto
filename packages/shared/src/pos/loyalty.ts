import { Decimal, type DecimalInput } from '../money';

/*
 * The supermarket's bonus card (ADR-0112): members registered at the office, found at the till by
 * their phone, earning points on what they pay and spending them with their PIN. One point is one
 * tugrik (owner 2026-10-27).
 */

/** A BLOCKED member earns and spends nothing until the office opens the card again. */
export const LOYALTY_MEMBER_STATUSES = ['ACTIVE', 'BLOCKED'] as const;
export type LoyaltyMemberStatus = (typeof LOYALTY_MEMBER_STATUSES)[number];

/**
 * A line of a member's points history: earned on a sale, spent on a sale, taken back by a return
 * (RETURN_EARN), given back by a return (RETURN_SPEND), or adjusted by hand with a reason.
 */
export const LOYALTY_ENTRY_KINDS = [
  'EARN',
  'SPEND',
  'RETURN_EARN',
  'RETURN_SPEND',
  'ADJUST',
] as const;
export type LoyaltyEntryKind = (typeof LOYALTY_ENTRY_KINDS)[number];

/**
 * What the centre found wrong with a member sale a till already made (ADR-0112 #6): the card was
 * blocked, or the points spent passed the balance the centre knows. The sale is kept and listed.
 */
export const LOYALTY_ISSUES = ['BLOCKED', 'OVERDRAWN'] as const;
export type LoyaltyIssue = (typeof LOYALTY_ISSUES)[number];

export const GENDERS = ['MALE', 'FEMALE'] as const;
export type Gender = (typeof GENDERS)[number];

export const LOYALTY_LIMITS = {
  maxTiers: 10,
  maxTierName: 60,
  maxName: 120,
  maxNote: 300,
  maxReason: 200,
  /** A hand adjustment, whole points either way. */
  maxAdjust: 10_000_000,
  /** A tier's spend threshold, whole MNT. */
  maxTierFrom: 100_000_000_000,
  /** Wrong PINs in a row before the card is locked at the till, and for how long. */
  pinFailures: 5,
  pinLockMinutes: 15,
} as const;

/** A member's PIN: four digits, set at the office (owner 2026-10-27). */
export const MEMBER_PIN_PATTERN = /^[0-9]{4}$/;

export function isMemberPin(value: string): boolean {
  return MEMBER_PIN_PATTERN.test(value);
}

export interface LoyaltyTierRule {
  fromAmount: DecimalInput;
  percent: DecimalInput;
}

/**
 * The tier a lifetime spend has reached: the one with the highest threshold not above it, or null
 * below every tier (no points). The till chooses it on the spend before the sale, so the sale that
 * crosses a threshold still earns at the lower rate and the next one at the higher.
 */
export function tierFor<T extends LoyaltyTierRule>(
  lifetime: DecimalInput,
  tiers: readonly T[],
): T | null {
  const spent = new Decimal(lifetime);
  let best: T | null = null;
  for (const tier of tiers) {
    if (new Decimal(tier.fromAmount).greaterThan(spent)) continue;
    if (!best || new Decimal(tier.fromAmount).greaterThan(best.fromAmount)) best = tier;
  }
  return best;
}

/** The next tier above a lifetime spend, if any: what the till shows as «дараагийн түвшин». */
export function nextTierOf<T extends LoyaltyTierRule>(
  lifetime: DecimalInput,
  tiers: readonly T[],
): T | null {
  const spent = new Decimal(lifetime);
  let next: T | null = null;
  for (const tier of tiers) {
    if (!new Decimal(tier.fromAmount).greaterThan(spent)) continue;
    if (!next || new Decimal(tier.fromAmount).lessThan(next.fromAmount)) next = tier;
  }
  return next;
}

/** The points a sale earns: its money base × the tier's percent, rounded down to whole points. */
export function pointsEarned(base: DecimalInput, percent: DecimalInput): Decimal {
  const points = new Decimal(base).times(percent).dividedBy(100);
  return points.isNegative() ? new Decimal(0) : points.toDecimalPlaces(0, Decimal.ROUND_DOWN);
}

/**
 * What a member sale earns on (owner 2026-10-27): the money paid — cash, card and transfer, the
 * amounts applied, not the cash handed over — after the discounts and coupons, and never the points,
 * the partner vouchers or credit. The lifetime spend grows by the same base.
 */
export function loyaltyEarnBase(
  tenders: readonly { kind: string; amount: DecimalInput }[],
): Decimal {
  return tenders
    .filter(
      (tender) => tender.kind === 'CASH' || tender.kind === 'CARD' || tender.kind === 'TRANSFER',
    )
    .reduce((sum, tender) => sum.plus(tender.amount), new Decimal(0));
}

/** The points a sale spent: its POINTS tender (at most one). */
export function pointsPart(tenders: readonly { kind: string; amount: DecimalInput }[]): Decimal {
  return tenders
    .filter((tender) => tender.kind === 'POINTS')
    .reduce((sum, tender) => sum.plus(tender.amount), new Decimal(0));
}

export interface LoyaltyReturnInput {
  /** What the return pays back in all. */
  refund: DecimalInput;
  sale: { earned: DecimalInput; spent: DecimalInput; earnBase: DecimalInput };
  /** What the sale's earlier returns already gave back, took back and paid back in money. */
  previous: { givenBack: DecimalInput; clawedBack: DecimalInput; money: DecimalInput };
}

export interface LoyaltyReturnSplit {
  /** Points given back to the card, paid back as points instead of money. */
  givenBack: Decimal;
  /** What is paid back in money. */
  money: Decimal;
  /** Earned points taken back, by the share of the money returned. */
  clawback: Decimal;
  /** The lifetime spend's change: minus the money returned, at most what the sale added. */
  spendDelta: Decimal;
}

/**
 * How a member sale's return settles the card (owner 2026-10-27, ADR-0112 #7): the points the sale
 * spent come back first, as points, then the rest is money; the earned points go back by the share
 * of the money returned (rounded half-up, never more than the sale earned), so a card that spent
 * them already may go below zero.
 */
export function loyaltyReturn(input: LoyaltyReturnInput): LoyaltyReturnSplit {
  const refund = new Decimal(input.refund);
  const spentLeft = Decimal.max(new Decimal(input.sale.spent).minus(input.previous.givenBack), 0);
  const givenBack = Decimal.min(spentLeft, refund);
  const money = refund.minus(givenBack);
  const base = new Decimal(input.sale.earnBase);
  const baseLeft = Decimal.max(base.minus(input.previous.money), 0);
  const earnedLeft = Decimal.max(
    new Decimal(input.sale.earned).minus(input.previous.clawedBack),
    0,
  );
  const share = base.isZero()
    ? new Decimal(0)
    : new Decimal(input.sale.earned)
        .times(money)
        .dividedBy(base)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return {
    givenBack,
    money,
    clawback: Decimal.min(share, earnedLeft),
    spendDelta: Decimal.min(money, baseLeft).negated(),
  };
}

/** A phone as the till shows it to the queue: `+97699112233` → `99••••33`. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/^\+976/, '');
  if (digits.length < 4) return digits;
  return `${digits.slice(0, 2)}${'•'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-2)}`;
}
