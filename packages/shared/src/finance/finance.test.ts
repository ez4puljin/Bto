import { describe, expect, it } from 'vitest';
import {
  agingBucketOf,
  allocateFifo,
  daysBetween,
  FINANCE_NUMBER_DEFAULTS,
  financeNumberIssues,
  invoicePartsFor,
  renderFinanceNumber,
  settlementOf,
  taxSplit,
} from './index';

const plain = (parts: ReturnType<typeof invoicePartsFor>) =>
  parts.map((part) => ({
    unit: part.uomName,
    qty: part.qty.toFixed(),
    qtyBase: part.qtyBase.toFixed(),
    unitPrice: part.unitPrice.toFixed(),
    subtotal: part.subtotal.toFixed(),
    discount: part.discountAmount.toFixed(),
    total: part.total.toFixed(),
  }));

describe('tax split (ADR-0010 #4)', () => {
  it.each([
    ['1110', '10', '1', '100.00', '10.00', '1000.00'],
    ['1000', '10', '0', '90.91', '0.00', '909.09'],
    ['72000', '10', '0', '6545.45', '0.00', '65454.55'],
    ['5000', '0', '0', '0.00', '0.00', '5000.00'],
    ['999', '10', '2', '89.20', '17.84', '891.96'],
  ])('splits %s at VAT %s%% and city tax %s%%', (total, vat, city, vatOut, cityOut, net) => {
    const split = taxSplit(total, vat, city);
    expect(split.vat.toFixed(2)).toBe(vatOut);
    expect(split.cityTax.toFixed(2)).toBe(cityOut);
    expect(split.net.toFixed(2)).toBe(net);
    expect(split.net.plus(split.vat).plus(split.cityTax).eq(total)).toBe(true);
  });
});

describe('invoice parts of a delivered quantity (ADR-0060 #3)', () => {
  const box = {
    productUnitId: 20,
    uomName: 'хайрцаг',
    basis: 'WAREHOUSE',
    qty: '2',
    factorSnapshot: '20',
    qtyBase: '40',
    listPrice: '20000',
    unitPrice: '20000',
    discountAmount: '2000',
  };
  const loose = {
    productUnitId: 10,
    uomName: 'ш',
    basis: 'LOOSE',
    qty: '5',
    factorSnapshot: '1',
    qtyBase: '5',
    listPrice: '1100',
    unitPrice: '1100',
    discountAmount: '0',
  };
  const base = { productUnitId: 10, uomName: 'ш' };

  it('keeps the frozen parts when everything was delivered', () => {
    expect(plain(invoicePartsFor('45', [loose, box], base))).toEqual([
      {
        unit: 'хайрцаг',
        qty: '2',
        qtyBase: '40',
        unitPrice: '20000',
        subtotal: '40000',
        discount: '2000',
        total: '38000',
      },
      {
        unit: 'ш',
        qty: '5',
        qtyBase: '5',
        unitPrice: '1100',
        subtotal: '5500',
        discount: '0',
        total: '5500',
      },
    ]);
  });

  it('fills the packs first and the loose pieces after, the discount following the quantity', () => {
    expect(plain(invoicePartsFor('23', [box, loose], base))).toEqual([
      {
        unit: 'хайрцаг',
        qty: '1',
        qtyBase: '20',
        unitPrice: '20000',
        subtotal: '20000',
        discount: '1000',
        total: '19000',
      },
      {
        unit: 'ш',
        qty: '3',
        qtyBase: '3',
        unitPrice: '1100',
        subtotal: '3300',
        discount: '0',
        total: '3300',
      },
    ]);
  });

  it('prices a remainder without a loose part per base unit from the pack', () => {
    expect(plain(invoicePartsFor('30', [box], base))).toEqual([
      {
        unit: 'хайрцаг',
        qty: '1',
        qtyBase: '20',
        unitPrice: '20000',
        subtotal: '20000',
        discount: '1000',
        total: '19000',
      },
      {
        unit: 'ш',
        qty: '10',
        qtyBase: '10',
        unitPrice: '1000',
        subtotal: '10000',
        discount: '500',
        total: '9500',
      },
    ]);
  });

  it('returns nothing for nothing delivered and keeps fractional loose quantities', () => {
    expect(invoicePartsFor('0', [box, loose], base)).toEqual([]);
    const kg = { ...loose, uomName: 'кг', qty: '2.5', qtyBase: '2.5', unitPrice: '3000' };
    expect(plain(invoicePartsFor('1.25', [kg], { productUnitId: 10, uomName: 'кг' }))).toEqual([
      {
        unit: 'кг',
        qty: '1.25',
        qtyBase: '1.25',
        unitPrice: '3000',
        subtotal: '3750',
        discount: '0',
        total: '3750',
      },
    ]);
  });
});

describe('allocation, aging and settlement', () => {
  it('allocates oldest due first and leaves the rest', () => {
    const invoices = [
      { id: 3, dueDate: '2026-11-15', openAmount: '10000' },
      { id: 1, dueDate: '2026-10-01', openAmount: '5000' },
      { id: 2, dueDate: '2026-10-01', openAmount: '0' },
    ];
    expect(
      allocateFifo('12000', invoices).map((entry) => [entry.invoiceId, entry.amount.toFixed()]),
    ).toEqual([
      [1, '5000'],
      [3, '7000'],
    ]);
    expect(allocateFifo('20000', invoices).map((entry) => entry.amount.toFixed())).toEqual([
      '5000',
      '10000',
    ]);
  });

  it('buckets by days past due', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(agingBucketOf('2026-10-31', '2026-10-16')).toBe('NOT_DUE');
    expect(agingBucketOf('2026-10-16', '2026-10-16')).toBe('NOT_DUE');
    expect(agingBucketOf('2026-10-15', '2026-10-16')).toBe('D1_30');
    expect(agingBucketOf('2026-09-16', '2026-10-16')).toBe('D1_30');
    expect(agingBucketOf('2026-09-15', '2026-10-16')).toBe('D31_60');
    expect(agingBucketOf('2026-07-01', '2026-10-16')).toBe('D90_PLUS');
  });

  it('reads the settlement from the open amount', () => {
    expect(settlementOf('1000', '1000')).toBe('OPEN');
    expect(settlementOf('1000', '400')).toBe('PARTIAL');
    expect(settlementOf('1000', '0')).toBe('PAID');
    expect(settlementOf('1000', '-50')).toBe('PAID');
  });
});

describe('finance numbers', () => {
  it('renders the defaults with the day and accepts them', () => {
    const invoice = FINANCE_NUMBER_DEFAULTS.INVOICE;
    expect(renderFinanceNumber(invoice.pattern, invoice.digits, '2026-10-16', 7)).toBe(
      'Н-20261016-0007',
    );
    expect(financeNumberIssues(invoice.pattern, invoice.digits)).toEqual([]);
    expect(financeNumberIssues('Н-{year}', 4)).toEqual([
      { path: 'pattern', code: 'ENDS_WITH_DIGIT' },
    ]);
  });
});
