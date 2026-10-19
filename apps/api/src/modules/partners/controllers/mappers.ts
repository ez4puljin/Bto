import { Decimal } from '@tugeel/shared/money';
import type { ContactDto } from '../dto/common.dto';
import type {
  AddressDto,
  AddressRequestDto,
  CustomerDetailDto,
  CustomerListItemDto,
  CustomerSummaryDto,
} from '../dto/customers.dto';
import type { customerAddresses } from '../schema';
import type { AddressInput } from '../services/customer-addresses.service';
import type {
  CustomerDetail,
  CustomerListItem,
  CustomerSummary,
} from '../services/customers.service';

type AddressRow = typeof customerAddresses.$inferSelect;

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** A coordinate validated by the DTO pattern as a Decimal (never a JS number: ESLint G3). */
const coordinate = (value: string | null | undefined): Decimal | null | undefined =>
  value === undefined || value === null ? value : new Decimal(value);

export function toAddressInput(body: AddressRequestDto): AddressInput {
  return {
    label: body.label,
    address: body.address,
    lat: coordinate(body.lat),
    lng: coordinate(body.lng),
    note: body.note,
  };
}

export function toAddressDto(row: AddressRow): AddressDto {
  return {
    id: row.id,
    label: row.label,
    address: row.address,
    lat: row.lat?.toFixed(6) ?? null,
    lng: row.lng?.toFixed(6) ?? null,
    gpsSource: row.gpsSource,
    zoneId: row.zoneId,
    note: row.note,
    isDefault: row.isDefault,
    archivedAt: iso(row.archivedAt),
  };
}

export function toContactDto(row: ContactDto): ContactDto {
  return { id: row.id, name: row.name, position: row.position, phone: row.phone, note: row.note };
}

export function toCustomerSummaryDto(row: CustomerSummary): CustomerSummaryDto {
  return { ...row };
}

export function toCustomerListItemDto(row: CustomerListItem): CustomerListItemDto {
  return {
    ...toCustomerSummaryDto(row),
    consumerNo: row.consumerNo,
    vatPayer: row.vatPayer,
    cityPayer: row.cityPayer,
    taxStatusSource: row.taxStatusSource,
    creditLimit: row.creditLimit?.toFixed(2) ?? null,
    paymentTerm: row.paymentTerm,
    creditHoldReason: row.creditHoldReason,
    note: row.note,
    gps: row.gps ? { lat: row.gps.lat.toFixed(6), lng: row.gps.lng.toFixed(6) } : null,
    contact: row.contact,
    appAccount: row.appAccount,
  };
}

export function toCustomerDetailDto(detail: CustomerDetail): CustomerDetailDto {
  const defaultAddress = detail.addresses.find((address) => address.isDefault);
  return {
    id: detail.id,
    code: detail.code,
    kind: detail.kind,
    name: detail.name,
    regNo: detail.regNo,
    tin: detail.tin,
    phone: detail.phone,
    status: detail.status,
    creditHold: detail.creditHold,
    tinPending: detail.tinPending,
    address: defaultAddress?.address ?? null,
    hasGps: defaultAddress?.lat !== null && defaultAddress?.lat !== undefined,
    tinSource: detail.tinSource,
    consumerNo: detail.consumerNo,
    vatPayer: detail.vatPayer,
    cityPayer: detail.cityPayer,
    taxStatusSource: detail.taxStatusSource,
    taxStatusCheckedAt: iso(detail.taxStatusCheckedAt),
    creditLimit: detail.creditLimit?.toFixed(2) ?? null,
    paymentTermDays: detail.paymentTermDays,
    paymentTerm: detail.paymentTerm,
    creditHoldReason: detail.creditHoldReason,
    note: detail.note,
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
    addresses: detail.addresses.map(toAddressDto),
    contacts: detail.contacts.map(toContactDto),
  };
}
