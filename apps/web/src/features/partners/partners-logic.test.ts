import type { components } from '@tugeel/api-client';
import { describe, expect, it } from 'vitest';
import { type ColumnSpec, fitColumns } from '@/lib/column-layout';
import { formatCount, formatMnt, plainDecimal } from '@/lib/money';
import {
  CUSTOMER_COLUMNS,
  CUSTOMER_COLUMNS_LEAVING,
  DEFAULT_HIDDEN_CUSTOMER_COLUMNS,
  WIDE_DEFAULT_HIDDEN_CUSTOMER_COLUMNS,
} from './customer-columns';
import { columnSpecs, isDefaultSet, type ListColumn } from './list-columns';
import {
  creditBody,
  customerCreateBody,
  customerSchema,
  customerUpdateBody,
  customerValues,
  emptyCustomer,
  fieldOfDuplicate,
} from './partner-schema';
import { localPhone, phoneInput } from './phone';
import {
  DEFAULT_HIDDEN_SUPPLIER_COLUMNS,
  SUPPLIER_COLUMNS,
  SUPPLIER_COLUMNS_LEAVING,
  WIDE_DEFAULT_HIDDEN_SUPPLIER_COLUMNS,
} from './supplier-columns';

const CUSTOMER: components['schemas']['CustomerDetail'] = {
  id: 9,
  code: '1001',
  kind: 'COMPANY',
  name: 'Номин дэлгүүр',
  regNo: null,
  tin: null,
  phone: '+97699112233',
  status: 'ACTIVE',
  creditHold: false,
  tinPending: true,
  address: null,
  hasGps: false,
  tinSource: null,
  consumerNo: null,
  vatPayer: false,
  cityPayer: false,
  taxStatusSource: null,
  taxStatusCheckedAt: null,
  creditLimit: '5000000.00',
  settlementGroup: 'MONTH_END',
  creditHoldReason: null,
  categoryId: 4,
  note: null,
  createdAt: '2026-10-01T02:00:00.000Z',
  updatedAt: '2026-10-01T02:00:00.000Z',
  addresses: [],
  contacts: [],
};

describe('money and numbers for reading', () => {
  it('groups tugrik by thousands without a float', () => {
    expect(formatMnt('5000000.00')).toBe('5,000,000');
    expect(formatMnt('1250.5')).toBe('1,250.50');
    expect(formatMnt('-1234567.89')).toBe('-1,234,567.89');
    expect(formatMnt('999')).toBe('999');
    expect(formatMnt('9007199254740993.01')).toBe('9,007,199,254,740,993.01');
  });

  it('groups counts by thousands', () => {
    expect(formatCount(1751)).toBe('1,751');
    expect(formatCount(20000)).toBe('20,000');
    expect(formatCount(0)).toBe('0');
  });

  it('drops trailing zeros of stored decimals', () => {
    expect(plainDecimal('47.918400')).toBe('47.9184');
    expect(plainDecimal('5000000.00')).toBe('5000000');
  });

  it('shows and edits phones in the local form', () => {
    expect(localPhone('+97699112233')).toBe('9911 2233');
    expect(phoneInput('+97699112233')).toBe('99112233');
    expect(phoneInput(null)).toBe('');
  });
});

describe('customer bodies', () => {
  it('leaves the suggested code, the payer check and a company consumer number out', () => {
    const values = {
      ...emptyCustomer('1002'),
      name: 'Тэмүүжин',
      consumerNo: '12345678',
      settlementGroup: 'DAY_20' as const,
    };
    expect(customerCreateBody(values, '1002')).toEqual({
      kind: 'COMPANY',
      name: 'Тэмүүжин',
      regNo: null,
      tin: null,
      consumerNo: null,
      phone: null,
      note: null,
      settlementGroup: 'DAY_20',
    });
    const typed = { ...values, code: '0500', vatPayer: true };
    expect(customerCreateBody(typed, '1002')).toMatchObject({
      code: '0500',
      vatPayer: true,
      cityPayer: false,
    });
  });

  it('requires a settlement group on a new customer and never sends it on update (ADR-0101)', () => {
    const empty = customerSchema.safeParse({ ...emptyCustomer('1002'), name: 'Бүлэггүй' });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['settlementGroup']);
    expect(customerUpdateBody(customerValues(CUSTOMER), CUSTOMER)).not.toHaveProperty(
      'settlementGroup',
    );
  });

  it('sends the category: on create only when chosen, on update always (ADR-0107)', () => {
    const values = { ...emptyCustomer('1002'), name: 'Шинэ', settlementGroup: 'DAY_20' as const };
    expect(customerCreateBody(values, '1002')).not.toHaveProperty('categoryId');
    expect(customerCreateBody({ ...values, categoryId: '12' }, '1002')).toMatchObject({
      categoryId: 12,
    });
    const unchanged = customerValues(CUSTOMER);
    expect(unchanged.categoryId).toBe('4');
    expect(customerUpdateBody(unchanged, CUSTOMER)).toMatchObject({ categoryId: 4 });
    expect(customerUpdateBody({ ...unchanged, categoryId: '' }, CUSTOMER)).toMatchObject({
      categoryId: null,
    });
  });

  it('sends the payer flags on update only when they changed', () => {
    const unchanged = customerValues(CUSTOMER);
    expect(customerUpdateBody(unchanged, CUSTOMER)).not.toHaveProperty('vatPayer');
    expect(customerUpdateBody({ ...unchanged, cityPayer: true }, CUSTOMER)).toMatchObject({
      vatPayer: false,
      cityPayer: true,
    });
  });

  it('clears the hold reason when the hold is lifted and reads grouped amounts', () => {
    expect(
      creditBody({
        creditLimit: '5 000,000',
        settlementGroup: 'MONTH_END',
        creditHold: false,
        creditHoldReason: 'хуучин',
      }),
    ).toEqual({
      creditLimit: '5000000',
      settlementGroup: 'MONTH_END',
      creditHold: false,
      creditHoldReason: null,
    });
  });

  it('maps unique constraints to their form fields', () => {
    expect(fieldOfDuplicate('customers_code_key')).toBe('code');
    expect(fieldOfDuplicate('suppliers_name_key_key')).toBe('name');
    expect(fieldOfDuplicate('product_suppliers_pair_key')).toBeNull();
  });
});

describe('the default columns on the screens the web is built for (ADR-0201)', () => {
  const CHEVRON: ColumnSpec = { key: 'chevron', kind: 'chevron' };
  /**
   * The rem a list's table has on a screen worked with a mouse: the page's gutters (2rem a side)
   * and about 26px of scrollbars go out, and so does what stands beside the list.
   */
  const room = (windowPx: number, rootPx: number, beside = 0) =>
    (windowPx - 26) / rootPx - 4 - beside;
  /** A tablet upright: its scrollbars lie over the page. */
  const TABLET = 768 / 17 - 4;
  /** The suppliers' filters stand beside their list from 1280px: 16rem and a gap of 1rem. */
  const FILTERS = 17;
  /** The columns of a default set that a table with this much room shows. */
  const shown = <Row>(
    columns: readonly ListColumn<Row>[],
    hidden: readonly string[],
    leaving: readonly string[],
    available: number,
  ) => {
    const specs = [
      ...columnSpecs(
        columns.filter((column) => !hidden.includes(column.key)),
        leaving,
      ),
      CHEVRON,
    ];
    const fit = fitColumns(specs, available);
    expect(fit.fits).toBe(true);
    return fit.kept.map((index) => specs[index]?.key).filter((key) => key !== 'chevron');
  };

  it('customers: the least needed columns go first and nothing a row is read for', () => {
    const at = (available: number, hidden = DEFAULT_HIDDEN_CUSTOMER_COLUMNS) =>
      shown(CUSTOMER_COLUMNS, hidden, CUSTOMER_COLUMNS_LEAVING, available);
    const all = ['code', 'name', 'category', 'kind', 'tin', 'phone'];
    const read = ['overdue', 'creditHold', 'status'];
    expect(at(room(1536, 17))).toEqual([...all, ...read]);
    expect(at(room(1366, 17))).toEqual(['code', 'name', 'category', 'kind', 'phone', ...read]);
    expect(at(room(1024, 17))).toEqual(['code', 'name', ...read]);
    expect(at(TABLET)).toEqual(['code', 'name', 'overdue', 'status']);
    // The wide set's two columns wait for the monitor.
    expect(at(room(1600, 18), WIDE_DEFAULT_HIDDEN_CUSTOMER_COLUMNS)).toEqual([...all, ...read]);
    expect(at(room(1920, 19), WIDE_DEFAULT_HIDDEN_CUSTOMER_COLUMNS)).toEqual([
      ...all,
      'creditLimit',
      'settlementGroup',
      ...read,
    ]);
  });

  it('suppliers: the same, beside their filters on a laptop and a monitor', () => {
    const at = (available: number, hidden = DEFAULT_HIDDEN_SUPPLIER_COLUMNS) =>
      shown(SUPPLIER_COLUMNS, hidden, SUPPLIER_COLUMNS_LEAVING, available);
    const tail = ['productCount', 'status'];
    const whole = ['code', 'name', 'category', 'phone', 'contact', ...tail];
    expect(at(room(1536, 17, FILTERS))).toEqual(whole);
    expect(at(room(1366, 17, FILTERS))).toEqual(['code', 'name', 'category', 'phone', ...tail]);
    expect(at(room(1024, 17))).toEqual(['code', 'name', 'category', 'phone', ...tail]);
    expect(at(TABLET)).toEqual(['code', 'name', ...tail]);
    // Of the wide set's five columns the monitor has room for two.
    expect(at(room(1600, 18, FILTERS), WIDE_DEFAULT_HIDDEN_SUPPLIER_COLUMNS)).toEqual(whole);
    expect(at(room(1920, 19, FILTERS), WIDE_DEFAULT_HIDDEN_SUPPLIER_COLUMNS)).toEqual([
      'code',
      'name',
      'category',
      'tin',
      'phone',
      'email',
      'contact',
      ...tail,
    ]);
  });

  it('lets nothing go from a set the user chose', () => {
    expect(isDefaultSet(new Set(['regNo', 'note']), DEFAULT_HIDDEN_SUPPLIER_COLUMNS)).toBe(false);
    expect(
      isDefaultSet(
        new Set(WIDE_DEFAULT_HIDDEN_SUPPLIER_COLUMNS),
        DEFAULT_HIDDEN_SUPPLIER_COLUMNS,
        WIDE_DEFAULT_HIDDEN_SUPPLIER_COLUMNS,
      ),
    ).toBe(true);
    expect(columnSpecs(SUPPLIER_COLUMNS).every((spec) => spec.drop === undefined)).toBe(true);
  });
});
