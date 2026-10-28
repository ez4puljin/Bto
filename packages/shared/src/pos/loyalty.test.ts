import { describe, expect, it } from 'vitest';
import {
  isMemberPin,
  loyaltyEarnBase,
  loyaltyReturn,
  maskPhone,
  nextTierOf,
  pointsEarned,
  pointsPart,
  tierFor,
} from './loyalty';

const TIERS = [
  { name: 'Мөнгөн', fromAmount: '10000000', percent: '1.5' },
  { name: 'Энгийн', fromAmount: '0', percent: '1' },
  { name: 'Алтан', fromAmount: '20000000', percent: '2' },
];

describe('bonus card tiers (ADR-0112)', () => {
  it('takes the highest threshold reached, the next one above', () => {
    expect(tierFor('0', TIERS)?.name).toBe('Энгийн');
    expect(tierFor('9999999.99', TIERS)?.name).toBe('Энгийн');
    expect(tierFor('10000000', TIERS)?.name).toBe('Мөнгөн');
    expect(tierFor('20000000', TIERS)?.name).toBe('Алтан');
    expect(nextTierOf('10000000', TIERS)?.name).toBe('Алтан');
    expect(nextTierOf('25000000', TIERS)).toBeNull();
  });

  it('earns nothing without a tier', () => {
    expect(tierFor('5000', [])).toBeNull();
    expect(tierFor('5000', [{ name: 'Дээд', fromAmount: '10000', percent: '3' }])).toBeNull();
  });
});

describe('bonus card points (ADR-0112)', () => {
  it('rounds the points down to whole tugriks', () => {
    expect(pointsEarned('13000', '1').toFixed(2)).toBe('130.00');
    expect(pointsEarned('1299.50', '1').toFixed(2)).toBe('12.00');
    expect(pointsEarned('1350', '1.5').toFixed(2)).toBe('20.00');
    expect(pointsEarned('99', '1').toFixed(2)).toBe('0.00');
  });

  it('earns on cash, card and transfer only, the amounts applied, not the change', () => {
    const tenders = [
      { kind: 'CASH', amount: '9000' },
      { kind: 'CARD', amount: '500' },
      { kind: 'TRANSFER', amount: '250' },
      { kind: 'POINTS', amount: '100' },
      { kind: 'VOUCHER', amount: '5000' },
    ];
    expect(loyaltyEarnBase(tenders).toFixed(2)).toBe('9750.00');
    expect(pointsPart(tenders).toFixed(2)).toBe('100.00');
  });

  it('checks the PIN and hides the phone', () => {
    expect(isMemberPin('1234')).toBe(true);
    expect(isMemberPin('123456')).toBe(false);
    expect(isMemberPin('12a4')).toBe(false);
    expect(maskPhone('+97699112233')).toBe('99••••33');
  });
});

describe('bonus card returns (ADR-0112)', () => {
  const sale = { earned: '90', spent: '100', earnBase: '9000' };
  const none = { givenBack: '0', clawedBack: '0', money: '0' };

  it('gives the spent points back first, then money, and takes earned points by share', () => {
    const split = loyaltyReturn({ refund: '2600', sale, previous: none });
    expect(split.givenBack.toFixed(2)).toBe('100.00');
    expect(split.money.toFixed(2)).toBe('2500.00');
    expect(split.clawback.toFixed(2)).toBe('25.00');
    expect(split.spendDelta.toFixed(2)).toBe('-2500.00');
  });

  it('gives only points back while the refund is below the points spent', () => {
    const split = loyaltyReturn({ refund: '60', sale, previous: none });
    expect(split.givenBack.toFixed(2)).toBe('60.00');
    expect(split.money.isZero()).toBe(true);
    expect(split.clawback.isZero()).toBe(true);
  });

  it('counts earlier returns and never takes back more than was earned', () => {
    const first = loyaltyReturn({ refund: '4600', sale, previous: none });
    expect(first.clawback.toFixed(2)).toBe('45.00');
    const rest = loyaltyReturn({
      refund: '4500',
      sale,
      previous: {
        givenBack: first.givenBack.toString(),
        clawedBack: first.clawback.toString(),
        money: first.money.toString(),
      },
    });
    expect(rest.givenBack.isZero()).toBe(true);
    expect(rest.money.toFixed(2)).toBe('4500.00');
    expect(rest.clawback.toFixed(2)).toBe('45.00');
    expect(rest.spendDelta.toFixed(2)).toBe('-4500.00');
  });

  it('rounds the share half up and caps it at what is left', () => {
    const odd = loyaltyReturn({
      refund: '1500',
      sale: { earned: '13', spent: '0', earnBase: '2600' },
      previous: { givenBack: '0', clawedBack: '10', money: '1300' },
    });
    // 13 × 1 500 / 2 600 = 7.5 → 8, but only 3 are left.
    expect(odd.clawback.toFixed(2)).toBe('3.00');
    expect(odd.spendDelta.toFixed(2)).toBe('-1300.00');
  });
});
