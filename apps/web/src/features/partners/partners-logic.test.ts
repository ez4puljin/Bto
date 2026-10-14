import type { components } from '@tugeel/api-client';
import { describe, expect, it } from 'vitest';
import { formatCount, formatMnt, plainDecimal } from '@/lib/money';
import {
  creditBody,
  customerCreateBody,
  customerUpdateBody,
  customerValues,
  emptyCustomer,
  fieldOfDuplicate,
} from './partner-schema';
import { localPhone, phoneInput } from './phone';

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
  paymentTermDays: null,
  paymentTerm: { days: null, source: 'UNSET' },
  creditHoldReason: null,
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
    const values = { ...emptyCustomer('1002'), name: 'Тэмүүжин', consumerNo: '12345678' };
    expect(customerCreateBody(values, '1002')).toEqual({
      kind: 'COMPANY',
      name: 'Тэмүүжин',
      regNo: null,
      tin: null,
      consumerNo: null,
      phone: null,
      note: null,
    });
    const typed = { ...values, code: '0500', vatPayer: true };
    expect(customerCreateBody(typed, '1002')).toMatchObject({
      code: '0500',
      vatPayer: true,
      cityPayer: false,
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
        paymentTermDays: '',
        creditHold: false,
        creditHoldReason: 'хуучин',
      }),
    ).toEqual({
      creditLimit: '5000000',
      paymentTermDays: null,
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
