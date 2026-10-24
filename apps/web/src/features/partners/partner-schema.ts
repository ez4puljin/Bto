import { SETTLEMENT_GROUPS, type SettlementGroup } from '@tugeel/shared/finance';
import { parseCoordinates } from '@tugeel/shared/geo';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import {
  CUSTOMER_KINDS,
  cleanTaxNumber,
  isConsumerNo,
  isTinFor,
  TIN_PATTERN,
} from '@tugeel/shared/taxpayer';
import { z } from 'zod';
import type { ValidationMessage } from '@/lib/forms';
import { plainDecimal } from '@/lib/money';
import type {
  AddressRequest,
  ContactRequest,
  CustomerCreate,
  CustomerCredit,
  CustomerDetail,
  CustomerUpdate,
  SupplierCreate,
  SupplierDetail,
  SupplierUpdate,
} from './api';
import { phoneInput } from './phone';

const CODE = /^[0-9]{1,20}$/;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const DAYS = /^\d{1,3}$/;
const BANK_ACCOUNT = /^[A-Z0-9]{5,34}$/;
const EMAIL = /^[^@\s]+@[^@\s]+$/;
export const PARTNER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

/** Text fields of the forms: trimmed; an empty one is sent as null. */
const text = (max: number) => z.string().trim().max(max, 'validation.tooLong');
const orNull = (value: string) => (value === '' ? null : value);

const GPS_MESSAGES: Record<'SHORT_LINK' | 'FORMAT' | 'OUTSIDE', ValidationMessage> = {
  SHORT_LINK: 'validation.gpsShortLink',
  FORMAT: 'validation.gpsFormat',
  OUTSIDE: 'validation.gpsOutside',
};

/** The GPS text box: empty, or something parseCoordinates reads. */
const gpsField = z
  .string()
  .trim()
  .superRefine((value, context) => {
    if (!value) return;
    const parsed = parseCoordinates(value);
    if (!parsed.ok && parsed.problem !== 'EMPTY') {
      context.addIssue({ code: 'custom', message: GPS_MESSAGES[parsed.problem] });
    }
  });

/** Latitude and longitude for the API from the GPS text box (validated before). */
export function gpsOf(value: string): { lat: string | null; lng: string | null } {
  const parsed = parseCoordinates(value);
  return parsed.ok ? parsed.value : { lat: null, lng: null };
}

/** The stored point as the GPS text box shows it ("47.9184, 106.9177"). */
export function gpsText(lat: string | null, lng: string | null): string {
  return lat && lng ? `${plainDecimal(lat)}, ${plainDecimal(lng)}` : '';
}

const phoneField = text(30).refine(
  (value) => value === '' || normalizeMnPhone(value) !== null,
  'validation.phone',
);

// ---------------------------------------------------------------------------------------------
// Customers

/** The settlement group select (ADR-0101): required, with no default (owner 2026-10-23). */
const settlementGroupField = z
  .union([z.literal(''), z.enum(SETTLEMENT_GROUPS)])
  .refine((value: string) => value.length > 0, 'validation.required');

const customerBase = z.object({
  code: z.string().trim().regex(CODE, 'validation.numericCode'),
  kind: z.enum(CUSTOMER_KINDS),
  name: z.string().trim().min(1, 'validation.required').max(200, 'validation.tooLong'),
  regNo: text(30),
  tin: text(20),
  consumerNo: text(12),
  phone: phoneField,
  vatPayer: z.boolean(),
  cityPayer: z.boolean(),
  note: text(1000),
  status: z.enum(PARTNER_STATUSES),
  /** The category's id as the select holds it; '' = none (ADR-0107). */
  categoryId: z.string(),
  /** Create only: chosen by the office; later changed on the credit card (ADR-0101 #8). */
  settlementGroup: settlementGroupField,
  /** Create only: the first delivery address. */
  address: text(300),
  gps: gpsField,
  addressNote: text(300),
});

/**
 * The customer form: the TIN must fit the kind. The consumer number is a citizen's field only; a
 * company form hides it and the body drops it, so it is not checked there.
 */
export const customerSchema = customerBase.superRefine((values, context) => {
  const tin = cleanTaxNumber(values.tin);
  if (tin && !isTinFor(values.kind, tin)) {
    context.addIssue({
      code: 'custom',
      path: ['tin'],
      message: values.kind === 'COMPANY' ? 'validation.tinCompany' : 'validation.tinIndividual',
    });
  }
  const consumerNo = cleanTaxNumber(values.consumerNo);
  if (values.kind === 'INDIVIDUAL' && consumerNo && !isConsumerNo(consumerNo)) {
    context.addIssue({ code: 'custom', path: ['consumerNo'], message: 'validation.consumerNo' });
  }
});
export type CustomerFormValues = z.infer<typeof customerBase>;

export function emptyCustomer(code: string): CustomerFormValues {
  return {
    code,
    kind: 'COMPANY',
    name: '',
    regNo: '',
    tin: '',
    consumerNo: '',
    phone: '',
    vatPayer: false,
    cityPayer: false,
    note: '',
    status: 'ACTIVE',
    categoryId: '',
    settlementGroup: '',
    address: '',
    gps: '',
    addressNote: '',
  };
}

export function customerValues(customer: CustomerDetail): CustomerFormValues {
  return {
    code: customer.code,
    kind: customer.kind,
    name: customer.name,
    regNo: customer.regNo ?? '',
    tin: customer.tin ?? '',
    consumerNo: customer.consumerNo ?? '',
    phone: phoneInput(customer.phone),
    vatPayer: customer.vatPayer,
    cityPayer: customer.cityPayer,
    note: customer.note ?? '',
    status: customer.status,
    categoryId: customer.categoryId === null ? '' : String(customer.categoryId),
    settlementGroup: customer.settlementGroup,
    address: '',
    gps: '',
    addressNote: '',
  };
}

const identifiers = (values: CustomerFormValues) => ({
  name: values.name,
  regNo: orNull(values.regNo),
  tin: orNull(cleanTaxNumber(values.tin)),
  consumerNo: values.kind === 'INDIVIDUAL' ? orNull(cleanTaxNumber(values.consumerNo)) : null,
  phone: orNull(values.phone),
  note: orNull(values.note),
  categoryId: values.categoryId === '' ? null : Number.parseInt(values.categoryId, 10),
});

/**
 * The create body. The suggested code is left to the server, which allocates it under a lock; the
 * payer flags go only when one is ticked (sending them records a manual check).
 */
export function customerCreateBody(
  values: CustomerFormValues,
  suggestedCode: string,
): CustomerCreate {
  const gps = gpsOf(values.gps);
  const hasAddress = values.address !== '' || gps.lat !== null;
  const payerTicked = values.vatPayer || values.cityPayer;
  return {
    kind: values.kind,
    ...(values.code === suggestedCode ? {} : { code: values.code }),
    ...identifiers(values),
    // The schema refuses an empty group before a body is built.
    settlementGroup: values.settlementGroup as SettlementGroup,
    ...(payerTicked ? { vatPayer: values.vatPayer, cityPayer: values.cityPayer } : {}),
    ...(hasAddress
      ? {
          address: {
            address: orNull(values.address),
            lat: gps.lat,
            lng: gps.lng,
            note: orNull(values.addressNote),
          },
        }
      : {}),
  };
}

/** The update body; payer flags only when changed (sending them records a manual check). */
export function customerUpdateBody(
  values: CustomerFormValues,
  before: CustomerDetail,
): CustomerUpdate {
  const payerChanged = values.vatPayer !== before.vatPayer || values.cityPayer !== before.cityPayer;
  return {
    code: values.code,
    kind: values.kind,
    status: values.status,
    ...identifiers(values),
    ...(payerChanged ? { vatPayer: values.vatPayer, cityPayer: values.cityPayer } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Credit

export const creditSchema = z.object({
  creditLimit: z
    .string()
    .trim()
    .refine((value) => value === '' || MONEY.test(value.replace(/[\s,]/g, '')), 'validation.money'),
  settlementGroup: z.enum(SETTLEMENT_GROUPS),
  creditHold: z.boolean(),
  creditHoldReason: text(300),
});
export type CreditFormValues = z.infer<typeof creditSchema>;

export function creditValues(customer: CustomerDetail): CreditFormValues {
  return {
    creditLimit: customer.creditLimit === null ? '' : plainDecimal(customer.creditLimit),
    settlementGroup: customer.settlementGroup,
    creditHold: customer.creditHold,
    creditHoldReason: customer.creditHoldReason ?? '',
  };
}

export function creditBody(values: CreditFormValues): CustomerCredit {
  return {
    creditLimit: orNull(values.creditLimit.replace(/[\s,]/g, '')),
    settlementGroup: values.settlementGroup,
    creditHold: values.creditHold,
    creditHoldReason: values.creditHold ? orNull(values.creditHoldReason) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Addresses and contacts

export const addressSchema = z
  .object({
    label: text(60),
    address: text(300),
    gps: gpsField,
    note: text(300),
    isDefault: z.boolean(),
  })
  .superRefine((values, context) => {
    if (values.address === '' && values.gps === '') {
      context.addIssue({ code: 'custom', path: ['address'], message: 'validation.addressOrGps' });
    }
  });
export type AddressFormValues = z.infer<typeof addressSchema>;

export function addressBody(values: AddressFormValues): AddressRequest {
  const gps = gpsOf(values.gps);
  return {
    label: orNull(values.label),
    address: orNull(values.address),
    lat: gps.lat,
    lng: gps.lng,
    note: orNull(values.note),
  };
}

export const contactSchema = z
  .object({
    name: text(100),
    position: text(60),
    phone: phoneField,
    note: text(300),
  })
  .superRefine((values, context) => {
    if (values.name === '' && values.phone === '') {
      context.addIssue({ code: 'custom', path: ['name'], message: 'validation.nameOrPhone' });
    }
  });
export type ContactFormValues = z.infer<typeof contactSchema>;

export function contactBody(values: ContactFormValues): ContactRequest {
  return {
    name: orNull(values.name),
    position: orNull(values.position),
    phone: orNull(values.phone),
    note: orNull(values.note),
  };
}

// ---------------------------------------------------------------------------------------------
// Suppliers

export const supplierSchema = z.object({
  code: z.string().trim().regex(CODE, 'validation.numericCode'),
  name: z.string().trim().min(1, 'validation.required').max(200, 'validation.tooLong'),
  regNo: text(30),
  tin: text(20).refine((value) => {
    const tin = cleanTaxNumber(value);
    return tin === '' || TIN_PATTERN.test(tin);
  }, 'validation.tin'),
  phone: phoneField,
  email: text(254).refine((value) => value === '' || EMAIL.test(value), 'validation.email'),
  address: text(300),
  bankName: text(60),
  bankAccount: text(40).refine((value) => {
    const account = value.replace(/[\s-]+/g, '').toUpperCase();
    return account === '' || BANK_ACCOUNT.test(account);
  }, 'validation.bankAccount'),
  paymentTermDays: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || (DAYS.test(value) && Number.parseInt(value, 10) <= 365),
      'validation.days',
    ),
  vatPayer: z.boolean(),
  note: text(1000),
  status: z.enum(PARTNER_STATUSES),
});
export type SupplierFormValues = z.infer<typeof supplierSchema>;

export function emptySupplier(code: string): SupplierFormValues {
  return {
    code,
    name: '',
    regNo: '',
    tin: '',
    phone: '',
    email: '',
    address: '',
    bankName: '',
    bankAccount: '',
    paymentTermDays: '',
    vatPayer: false,
    note: '',
    status: 'ACTIVE',
  };
}

export function supplierValues(supplier: SupplierDetail): SupplierFormValues {
  return {
    code: supplier.code,
    name: supplier.name,
    regNo: supplier.regNo ?? '',
    tin: supplier.tin ?? '',
    phone: phoneInput(supplier.phone),
    email: supplier.email ?? '',
    address: supplier.address ?? '',
    bankName: supplier.bankName ?? '',
    bankAccount: supplier.bankAccount ?? '',
    paymentTermDays: supplier.paymentTermDays === null ? '' : String(supplier.paymentTermDays),
    vatPayer: supplier.vatPayer,
    note: supplier.note ?? '',
    status: supplier.status,
  };
}

function supplierFields(values: SupplierFormValues) {
  return {
    name: values.name,
    regNo: orNull(values.regNo),
    tin: orNull(cleanTaxNumber(values.tin)),
    phone: orNull(values.phone),
    email: orNull(values.email),
    address: orNull(values.address),
    bankName: orNull(values.bankName),
    bankAccount: orNull(values.bankAccount),
    paymentTermDays:
      values.paymentTermDays === '' ? null : Number.parseInt(values.paymentTermDays, 10),
    vatPayer: values.vatPayer,
    note: orNull(values.note),
  };
}

export function supplierCreateBody(
  values: SupplierFormValues,
  suggestedCode: string,
): SupplierCreate {
  return {
    ...(values.code === suggestedCode ? {} : { code: values.code }),
    ...supplierFields(values),
  };
}

export function supplierUpdateBody(values: SupplierFormValues): SupplierUpdate {
  return { code: values.code, status: values.status, ...supplierFields(values) };
}

/** A duplicate code or name is shown on its field rather than as a page error. */
export function fieldOfDuplicate(constraint: unknown): 'code' | 'name' | null {
  if (constraint === 'customers_code_key' || constraint === 'suppliers_code_key') return 'code';
  if (constraint === 'suppliers_name_key_key') return 'name';
  return null;
}
