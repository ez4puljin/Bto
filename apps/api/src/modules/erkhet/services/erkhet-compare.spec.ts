import { Decimal } from '@tugeel/shared/money';
import {
  type BtoCustomer,
  type BtoProduct,
  compareCustomers,
  compareProducts,
  firstPhone,
  itemLookupKeys,
} from './erkhet-compare';
import type { ErkhetCustomerRow, ErkhetItemRow } from './erkhet-sheets';

// Synthetic rows only: no line here comes from Erkhet or from the company's data.

const customer = (over: Partial<BtoCustomer> & Pick<BtoCustomer, 'id' | 'code'>): BtoCustomer => ({
  name: `Дэлгүүр ${over.code}`,
  status: 'ACTIVE',
  kind: 'COMPANY',
  categoryId: 1,
  settlementGroup: 'DAY_20',
  ...over,
});

const erkhetCustomer = (
  code: string,
  over: Partial<ErkhetCustomerRow> = {},
): ErkhetCustomerRow => ({
  code,
  name: `Дэлгүүр ${code}`,
  groupCode: '501',
  groupName: '1-р хороо',
  phone: '',
  ...over,
});

const categories = (groupName: string) =>
  groupName === '1-р хороо'
    ? { id: 1, active: true }
    : groupName === 'Сум'
      ? { id: 2, active: true }
      : groupName === 'Хуучин'
        ? { id: 3, active: false }
        : null;

const issuesOf = (items: { issue: string; erkhetCode: string | null; btoCode: string | null }[]) =>
  items.map((item) => `${item.issue}:${item.erkhetCode ?? item.btoCode}`).sort();

describe('Erkhet customers against Bto (ADR-0203 #3)', () => {
  it('matches by code and reports what differs on either side', () => {
    const bto = [
      customer({ id: 1, code: '50001' }),
      customer({ id: 2, code: '50002', name: 'Хуучин нэр' }),
      customer({ id: 3, code: '50003', status: 'INACTIVE' }),
      customer({ id: 4, code: '50004' }),
    ];
    const erkhet = [
      erkhetCustomer('50001'),
      erkhetCustomer('50002', { name: 'Шинэ нэр' }),
      erkhetCustomer('50003'),
      erkhetCustomer('50005'),
      erkhetCustomer('80001', { groupCode: '82', groupName: 'Хархорин' }),
      erkhetCustomer('60001', { groupName: 'Хуучин' }),
    ];
    const { items, summary } = compareCustomers(erkhet, bto, categories);
    expect(issuesOf(items)).toEqual([
      'GROUP_NOT_TAKEN:60001',
      'GROUP_NOT_TAKEN:80001',
      'INACTIVE_IN_BTO:50003',
      'MISSING_IN_BTO:50005',
      'MISSING_IN_ERKHET:50004',
      'NAME_DIFFERS:50002',
    ]);
    expect(summary).toEqual({
      erkhet: 6,
      bto: 3,
      agreed: 1,
      issues: {
        GROUP_NOT_TAKEN: 2,
        INACTIVE_IN_BTO: 1,
        MISSING_IN_BTO: 1,
        MISSING_IN_ERKHET: 1,
        NAME_DIFFERS: 1,
      },
    });
  });

  it('plans a new customer like most customers of its category', () => {
    const bto = [
      customer({ id: 1, code: '20001', categoryId: 2, settlementGroup: 'MONTH_END' }),
      customer({
        id: 2,
        code: '20002',
        categoryId: 2,
        settlementGroup: 'MONTH_END',
        kind: 'INDIVIDUAL',
      }),
      customer({
        id: 3,
        code: '20003',
        categoryId: 2,
        settlementGroup: 'DAY_20',
        kind: 'INDIVIDUAL',
      }),
      customer({ id: 4, code: '50001' }),
    ];
    const erkhet = [
      erkhetCustomer('20009', { groupName: 'Сум', phone: '70123456, 99112233' }),
      ...bto.map((one) => erkhetCustomer(one.code)),
    ];
    const { items } = compareCustomers(erkhet, bto, categories);
    expect(items).toHaveLength(1);
    expect(items[0]?.plan).toEqual({
      categoryId: 2,
      settlementGroup: 'MONTH_END',
      kind: 'INDIVIDUAL',
      phone: '+97670123456',
    });
  });

  it('shows a code Bto cannot hold without a plan to add it', () => {
    const { items } = compareCustomers([erkhetCustomer('5000A')], [], categories);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ issue: 'MISSING_IN_BTO', erkhetCode: '5000A', plan: null });
  });

  it('reads names as Bto stores them and takes a repeated code once', () => {
    const bto = [customer({ id: 1, code: '50001', name: 'Дэлгүүр  нэг' })];
    const erkhet = [
      erkhetCustomer('50001', { name: 'Дэлгүүр нэг' }),
      erkhetCustomer('50001', { name: 'Өөр' }),
    ];
    const { items, summary } = compareCustomers(erkhet, bto, categories);
    expect(items).toEqual([]);
    expect(summary.erkhet).toBe(1);
  });

  it('finds the first number that reads as a phone', () => {
    expect(firstPhone('99112233')).toBe('+97699112233');
    expect(firstPhone('утас: 9911-2233; 88001122')).toBe('+97688001122');
    expect(firstPhone('байхгүй')).toBeNull();
  });
});

const product = (over: Partial<BtoProduct> & Pick<BtoProduct, 'id' | 'sku'>): BtoProduct => ({
  name: `Бараа ${over.sku}`,
  status: 'ACTIVE',
  barcodes: 1,
  ...over,
});

const item = (code: string, barcodes: string[], price: string | null): ErkhetItemRow => ({
  code,
  name: `Бараа ${code}`,
  category: 'Ундаа',
  barcodes,
  price: price === null ? null : new Decimal(price),
  unitCode: 'ш',
  unitName: 'ширхэг',
  packRatio: '0.0833333333333',
  weight: '0.5',
});

// Valid EAN-13 codes, stored in Bto under their GTIN-14.
const EAN_A = '4006381333931';
const EAN_B = '5901234123457';
const key = (ean: string) => `0${ean}`;

describe('Erkhet items against Bto products (ADR-0203 #4)', () => {
  const bto = [
    product({ id: 1, sku: '100001' }),
    product({ id: 2, sku: '100002' }),
    product({ id: 3, sku: '100003', barcodes: 0 }),
    product({ id: 4, sku: '100004' }),
    product({ id: 5, sku: '100005', status: 'INACTIVE' }),
    product({ id: 6, sku: '100006' }),
  ];
  const owners = new Map([
    [key(EAN_A), 1],
    [key(EAN_B), 2],
    ['ABC-1', 4],
    ['OLD-5', 5],
    ['NOPRICE', 6],
  ]);
  const prices = new Map([
    [1, new Decimal('1500')],
    [2, new Decimal('2000')],
    [3, new Decimal('300')],
    [4, new Decimal('990')],
  ]);

  it('finds a product by barcode whatever its code, and compares the warehouse price', () => {
    const erkhet = [
      item('900001', [EAN_A], '1500'),
      item('900002', [EAN_B], '2100'),
      item('100003', [], '300'),
      item('900004', ['abc-1'], '990.4'),
    ];
    const { items, summary } = compareProducts(erkhet, bto, owners, prices);
    expect(issuesOf(items)).toEqual(['MISSING_IN_ERKHET:100006', 'PRICE_DIFFERS:900002']);
    const differs = items.find((one) => one.issue === 'PRICE_DIFFERS');
    expect(differs?.btoId).toBe(2);
    expect(differs?.btoCode).toBe('100002');
    expect(differs?.erkhetPrice?.toFixed(2)).toBe('2100.00');
    expect(differs?.btoPrice?.toFixed(2)).toBe('2000.00');
    expect(summary).toMatchObject({ erkhet: 4, bto: 5, agreed: 3 });
  });

  it('reports what cannot be matched or compared', () => {
    const erkhet = [
      item('900010', ['0000000000000'], '100'),
      item('900011', [EAN_A, EAN_B], '100'),
      item('100001', [], '100'),
      item('777777', [], '100'),
      item('900012', ['OLD-5'], '100'),
      item('900013', ['NOPRICE'], '100'),
    ];
    const { items } = compareProducts(erkhet, bto, owners, prices);
    expect(issuesOf(items)).toEqual([
      'AMBIGUOUS:900011',
      'INACTIVE_IN_BTO:900012',
      'MISSING_IN_BTO:900010',
      'MISSING_IN_ERKHET:100003',
      'MISSING_IN_ERKHET:100004',
      'NO_BARCODE:100001',
      'NO_BARCODE:777777',
      'NO_BTO_PRICE:900013',
    ]);
    // A missing product keeps what «Bto-д нэмэх» needs of Erkhet's list (ADR-0222); others none.
    expect(items.find((one) => one.issue === 'MISSING_IN_BTO')?.plan).toEqual({
      unitCode: 'ш',
      unitName: 'ширхэг',
      packRatio: '0.0833333333333',
      weight: '0.5',
    });
    expect(items.filter((one) => one.issue !== 'MISSING_IN_BTO' && one.plan !== null)).toEqual([]);
    // A code alone settles nothing when the Bto product of that code has barcodes of its own.
    expect(items.find((one) => one.erkhetCode === '100001')?.btoId).toBe(1);
    expect(items.find((one) => one.issue === 'AMBIGUOUS')?.btoCode).toBe('100001, 100002');
  });

  it('leaves a price alone when Erkhet has none, and reads a small difference as none', () => {
    const erkhet = [
      item('900001', [EAN_A], null),
      item('900002', [EAN_B], '0'),
      item('900004', ['ABC-1'], '990.5'),
    ];
    const { items } = compareProducts(erkhet, bto, owners, prices);
    expect(items.filter((one) => one.issue === 'PRICE_DIFFERS')).toEqual([]);
  });

  it('collects every key a barcode may be stored under', () => {
    expect(itemLookupKeys([item('1', [EAN_A, 'abc-1'], null), item('2', [EAN_A], null)])).toEqual([
      key(EAN_A),
      'ABC-1',
    ]);
  });
});
