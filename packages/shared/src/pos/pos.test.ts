import { describe, expect, it } from 'vitest';
import {
  cashVariance,
  creditPart,
  expectedCash,
  handoverAmount,
  isPin,
  isTillCode,
  lineMoney,
  lineVat,
  normalizeTillCode,
  tillCodeLookKey,
  parseEdgeToken,
  posSaleNumber,
  posShiftNumber,
  refundSplit,
  saleTotals,
  tendersTotal,
  withinReturnWindow,
} from './index';

describe('POS numbers (ADR-0063 #3)', () => {
  it('prints the till, the day and a four-digit counter', () => {
    expect(posSaleNumber('К3', '2026-10-16', 45)).toBe('К3-261016-0045');
    expect(posShiftNumber('К3', '2026-10-16', 1)).toBe('К3-261016-Э1');
  });

  it('accepts Latin and Cyrillic till codes, refuses the rest', () => {
    expect(normalizeTillCode(' к3 ')).toBe('К3');
    expect(isTillCode('К3')).toBe(true);
    expect(isTillCode('TILL-8')).toBe(true);
    expect(isTillCode('касс 3')).toBe(false);
    expect(isTillCode('123456789')).toBe(false);
  });

  it('matches a Latin look-alike till code to the Cyrillic one', () => {
    expect(tillCodeLookKey('k1')).toBe(tillCodeLookKey('К1'));
    expect(tillCodeLookKey('TILL-8')).toBe('ТILL-8');
    expect(tillCodeLookKey('K2')).not.toBe(tillCodeLookKey('К1'));
  });

  it('wants a six-digit PIN', () => {
    expect(isPin('123456')).toBe(true);
    expect(isPin('12345')).toBe(false);
    expect(isPin('12345a')).toBe(false);
  });
});

describe('POS money', () => {
  it('computes a line and its VAT without a float', () => {
    const money = lineMoney('1.5', '3000', '0');
    expect(money.subtotal.toFixed(2)).toBe('4500.00');
    expect(money.total.toFixed(2)).toBe('4500.00');
    expect(lineVat(money.total, '10').toFixed(2)).toBe('409.09');
    expect(lineVat('1000', '0').toFixed(2)).toBe('0.00');
  });

  it('sums the header from the lines', () => {
    const totals = saleTotals([
      { subtotal: '4500', discountAmount: '500', total: '4000', vatAmount: '363.64' },
      { subtotal: '1000', discountAmount: '0', total: '1000', vatAmount: '90.91' },
    ]);
    expect(totals.subtotal.toFixed(2)).toBe('5500.00');
    expect(totals.discountTotal.toFixed(2)).toBe('500.00');
    expect(totals.total.toFixed(2)).toBe('5000.00');
    expect(totals.vatTotal.toFixed(2)).toBe('454.55');
    expect(tendersTotal([{ amount: '3000' }, { amount: '2000' }]).toFixed(2)).toBe('5000.00');
  });

  it('reckons the drawer at the close (ADR-0064 #2)', () => {
    const expected = expectedCash({
      openingFloat: '50000',
      cashSales: '320000',
      cashRefunds: '5000',
    });
    expect(expected.toFixed(2)).toBe('365000.00');
    expect(cashVariance('364000', expected).toFixed(2)).toBe('-1000.00');
    expect(cashVariance('366000', expected).toFixed(2)).toBe('1000.00');
    expect(handoverAmount('364000', '50000').toFixed(2)).toBe('314000.00');
    expect(handoverAmount('40000', '50000').toFixed(2)).toBe('0.00');
  });

  it('keeps returns inside the window', () => {
    expect(withinReturnWindow('2026-10-02', '2026-10-16', 14)).toBe(true);
    expect(withinReturnWindow('2026-10-01', '2026-10-16', 14)).toBe(false);
    expect(withinReturnWindow('2026-10-17', '2026-10-16', 14)).toBe(false);
  });
});

describe('edge tokens (ADR-0063 #6)', () => {
  it('parses the node id and the secret', () => {
    expect(parseEdgeToken('tgs_12_abcdefghijklmnopqrstuvwxyz012345')).toEqual({
      nodeId: 12,
      secret: 'abcdefghijklmnopqrstuvwxyz012345',
    });
    expect(parseEdgeToken('tgs_0_abcdefghijklmnopqrstuvwxyz012345')).toBeNull();
    expect(parseEdgeToken('Bearer x')).toBeNull();
  });
});

describe('credit at the till (ADR-0109)', () => {
  it('sums the credit part of the tenders', () => {
    expect(
      creditPart([
        { kind: 'CASH', amount: '2000' },
        { kind: 'CREDIT', amount: '5000.00' },
      ]).toFixed(2),
    ).toBe('5000.00');
    expect(creditPart([{ kind: 'CARD', amount: '7000' }]).toFixed(2)).toBe('0.00');
  });

  it('pays a credit sale back off the debt first, the rest in cash', () => {
    const split = (saleCredit: string, creditRefunded: string, total: string) => {
      const result = refundSplit({ saleCredit, creditRefunded, total });
      return [result.credit.toFixed(2), result.cash.toFixed(2)];
    };
    expect(split('2900', '0', '3900')).toEqual(['2900.00', '1000.00']);
    expect(split('2900', '0', '1300')).toEqual(['1300.00', '0.00']);
    expect(split('2900', '2600', '1300')).toEqual(['300.00', '1000.00']);
    expect(split('2900', '2900', '1300')).toEqual(['0.00', '1300.00']);
    expect(split('0', '0', '1300')).toEqual(['0.00', '1300.00']);
  });
});
