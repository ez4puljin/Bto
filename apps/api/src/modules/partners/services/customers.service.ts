import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import {
  type CustomerKind,
  cleanTaxNumber,
  isConsumerNo,
  isTinFor,
  normalizeRegNo,
} from '@tugeel/shared/taxpayer';
import { normalizeName, searchKeys } from '@tugeel/shared/text';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { type Actor, type AuthContext, AuditService, SettingsService } from '../../identity';
import { customerAddresses, customerContacts, customers, type PARTNER_STATUSES } from '../schema';
import { type AddressInput, CustomerAddressesService } from './customer-addresses.service';
import { advisoryLock, LOCKS, nextNumericCode, optionalText, partnerSearch } from './support';

type CustomerRow = typeof customers.$inferSelect;
type AddressRow = typeof customerAddresses.$inferSelect;
type ContactRow = typeof customerContacts.$inferSelect;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export interface CustomerInput {
  /** Omitted: the next free number. */
  code?: string;
  kind: CustomerKind;
  name: string;
  regNo?: string | null;
  tin?: string | null;
  consumerNo?: string | null;
  phone?: string | null;
  vatPayer?: boolean;
  cityPayer?: boolean;
  note?: string | null;
  /** The first delivery address, created as the default one. */
  address?: AddressInput | null;
}

export type CustomerPatch = Partial<Omit<CustomerInput, 'address'>> & { status?: PartnerStatus };

export interface CreditInput {
  /** null = not decided yet (owner answer 2026-10-11). */
  creditLimit: Decimal | null;
  /** null = the company setting credit.payment_term_days. */
  paymentTermDays: number | null;
  creditHold: boolean;
  creditHoldReason: string | null;
}

/** Where the payment term of a customer comes from (the setting is effective-dated). */
export interface PaymentTerm {
  days: number | null;
  source: 'CUSTOMER' | 'DEFAULT' | 'UNSET';
}

export interface CreditTerms {
  creditLimit: Decimal | null;
  paymentTerm: PaymentTerm;
  creditHold: boolean;
}

/** The customer row read under `lockForUpdate`: what an order confirmation decides on. */
export interface LockedCustomer {
  id: number;
  status: PartnerStatus;
  creditLimit: Decimal | null;
  paymentTermDays: number | null;
  creditHold: boolean;
}

export interface CustomerQuery {
  q?: string;
  kind?: CustomerKind;
  status?: PartnerStatus;
  creditHold?: boolean;
  /** Companies without a TIN: receipts wait for it (SPEC §6.10). */
  tinPending?: boolean;
  /** No GPS point on the default address. */
  gpsMissing?: boolean;
  cursor?: string;
  limit?: number;
}

export interface CustomerSummary {
  id: number;
  code: string;
  kind: CustomerKind;
  name: string;
  regNo: string | null;
  tin: string | null;
  phone: string | null;
  status: PartnerStatus;
  creditHold: boolean;
  tinPending: boolean;
  address: string | null;
  hasGps: boolean;
}

/** A contact shown on a list row: the customer's or supplier's first one. */
export interface ListContact {
  name: string | null;
  phone: string | null;
}

/** A row of the customer list screen: the summary plus every other field (ADR-0037). */
export interface CustomerListItem extends CustomerSummary {
  consumerNo: string | null;
  vatPayer: boolean;
  cityPayer: boolean;
  /** null = the payer flags were never checked. */
  taxStatusSource: CustomerRow['taxStatusSource'];
  creditLimit: Decimal | null;
  paymentTerm: PaymentTerm;
  creditHoldReason: string | null;
  note: string | null;
  /** The point of the default address. */
  gps: { lat: Decimal; lng: Decimal } | null;
  contact: ListContact | null;
}

export interface CustomerDetail extends Omit<
  CustomerRow,
  'searchText' | 'searchPhonetic' | 'searchVersion'
> {
  tinPending: boolean;
  paymentTerm: PaymentTerm;
  addresses: AddressRow[];
  contacts: ContactRow[];
}

/** The audit snapshot of a customer row: no derived search keys. */
export function customerAuditView(row: CustomerRow) {
  const { searchText: _text, searchPhonetic: _phonetic, searchVersion: _version, ...rest } = row;
  return rest;
}

/**
 * Customers (SPEC §5.3, §6.2, §6.10; docs/modules/partners.md): every store is its own customer.
 * Credit fields change only through setCredit (partners.credit.manage); reads go through
 * `visibleTo`, the single place that will scope sales reps to their zones in delivery 7.
 */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly addresses: CustomerAddressesService,
  ) {}

  /** The rows a user may read; every customer until sales reps arrive (delivery 7). */
  visibleTo(_ctx: AuthContext): SQL {
    return sql`true`;
  }

  async nextCode(executor: Db | Tx = this.db): Promise<string> {
    return nextNumericCode(executor, 'customers');
  }

  create(actor: Actor, input: CustomerInput): Promise<CustomerDetail> {
    return inTransaction(this.db, async (tx) => {
      const id = await this.createInTx(tx, actor, input);
      return this.get(id, tx);
    });
  }

  /** One customer and its first address in the caller's transaction; returns the new id. */
  async createInTx(tx: Tx, actor: Actor, input: CustomerInput): Promise<number> {
    const values = this.validated(input.kind, {
      regNo: input.regNo,
      tin: input.tin,
      consumerNo: input.consumerNo,
      phone: input.phone,
    });
    await advisoryLock(tx, LOCKS.customerCode);
    const code = input.code ?? (await this.nextCode(tx));
    const name = normalizeName(input.name);
    const keys = searchKeys(name, [code]);
    const payerChecked = input.vatPayer !== undefined || input.cityPayer !== undefined;
    const [row] = await tx
      .insert(customers)
      .values({
        code,
        kind: input.kind,
        name,
        searchText: keys.strict,
        searchPhonetic: keys.phonetic,
        searchVersion: keys.version,
        regNo: values.regNo ?? null,
        tin: values.tin ?? null,
        tinSource: values.tin ? 'MANUAL' : null,
        consumerNo: values.consumerNo ?? null,
        phone: values.phone ?? null,
        vatPayer: input.vatPayer ?? false,
        cityPayer: input.cityPayer ?? false,
        taxStatusSource: payerChecked ? 'MANUAL' : null,
        taxStatusCheckedAt: payerChecked ? sql`now()` : null,
        note: optionalText(input.note) ?? null,
      })
      .returning();
    if (!row) throw new Error('customer insert returned no row');
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'customers',
      entityId: row.id,
      after: customerAuditView(row),
    });
    if (input.address) {
      await this.addresses.addInTx(tx, actor, row.id, input.address, { isDefault: true });
    }
    return row.id;
  }

  update(actor: Actor, id: number, patch: CustomerPatch): Promise<CustomerDetail> {
    return inTransaction(this.db, async (tx) => {
      await this.updateInTx(tx, actor, id, patch);
      return this.get(id, tx);
    });
  }

  async updateInTx(tx: Tx, actor: Actor, id: number, patch: CustomerPatch): Promise<void> {
    const before = await this.lockRow(tx, id);
    const kind = patch.kind ?? before.kind;
    const values = this.validated(kind, {
      regNo: patch.regNo === undefined ? before.regNo : patch.regNo,
      tin: patch.tin === undefined ? before.tin : patch.tin,
      consumerNo: patch.consumerNo === undefined ? before.consumerNo : patch.consumerNo,
      phone: patch.phone === undefined ? before.phone : patch.phone,
    });
    const code = patch.code ?? before.code;
    const name = patch.name === undefined ? before.name : normalizeName(patch.name);
    const keys = searchKeys(name, [code]);
    const payerChanged = patch.vatPayer !== undefined || patch.cityPayer !== undefined;
    const tinChanged = (values.tin ?? null) !== before.tin;
    const [after] = await tx
      .update(customers)
      .set({
        code,
        kind,
        name,
        searchText: keys.strict,
        searchPhonetic: keys.phonetic,
        searchVersion: keys.version,
        regNo: values.regNo ?? null,
        tin: values.tin ?? null,
        ...(tinChanged ? { tinSource: values.tin ? 'MANUAL' : null } : {}),
        consumerNo: values.consumerNo ?? null,
        phone: values.phone ?? null,
        ...(payerChanged
          ? {
              vatPayer: patch.vatPayer ?? before.vatPayer,
              cityPayer: patch.cityPayer ?? before.cityPayer,
              taxStatusSource: 'MANUAL' as const,
              taxStatusCheckedAt: sql`now()`,
            }
          : {}),
        ...(patch.note === undefined ? {} : { note: optionalText(patch.note) ?? null }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        updatedAt: sql`now()`,
      })
      .where(eq(customers.id, id))
      .returning();
    if (!after) throw notFound('customer', id);
    await this.audit.record(tx, actor, {
      action: 'UPDATE',
      entity: 'customers',
      entityId: id,
      before: customerAuditView(before),
      after: customerAuditView(after),
    });
  }

  setCredit(actor: Actor, id: number, input: CreditInput): Promise<CustomerDetail> {
    return inTransaction(this.db, async (tx) => {
      await this.setCreditInTx(tx, actor, id, input);
      return this.get(id, tx);
    });
  }

  /** Credit limit, payment term and credit hold (partners.credit.manage; delivery 3 enforces them). */
  async setCreditInTx(tx: Tx, actor: Actor, id: number, input: CreditInput): Promise<void> {
    const reason = optionalText(input.creditHoldReason) ?? null;
    if (reason !== null && !input.creditHold) {
      throw invalid('creditHoldReason', 'creditHold', 'a reason is kept only while on hold');
    }
    const before = await this.lockRow(tx, id);
    const [after] = await tx
      .update(customers)
      .set({
        creditLimit: input.creditLimit,
        paymentTermDays: input.paymentTermDays,
        creditHold: input.creditHold,
        creditHoldReason: reason,
        updatedAt: sql`now()`,
      })
      .where(eq(customers.id, id))
      .returning();
    if (!after) throw notFound('customer', id);
    const credit = (row: CustomerRow) => ({
      creditLimit: row.creditLimit?.toFixed(2) ?? null,
      paymentTermDays: row.paymentTermDays,
      creditHold: row.creditHold,
      creditHoldReason: row.creditHoldReason,
    });
    await this.audit.record(tx, actor, {
      action: 'CREDIT',
      entity: 'customers',
      entityId: id,
      before: credit(before),
      after: credit(after),
    });
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<CustomerDetail> {
    const [row] = await executor.select().from(customers).where(eq(customers.id, id));
    if (!row) throw notFound('customer', id);
    // One query at a time: inside a transaction the executor is a single connection.
    const addresses = await this.addresses.ofCustomer(id, executor);
    const contacts = await executor
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerId, id))
      .orderBy(asc(customerContacts.id));
    const paymentTerm = await this.paymentTerm(row.paymentTermDays, businessDate(), executor);
    return {
      ...customerAuditView(row),
      tinPending: isTinPending(row),
      paymentTerm,
      addresses,
      contacts,
    };
  }

  async getMany(ids: readonly number[], executor: Db | Tx = this.db): Promise<CustomerSummary[]> {
    if (ids.length === 0) return [];
    const rows = await executor
      .select(this.summaryColumns())
      .from(customers)
      .where(inArray(customers.id, [...ids]));
    return rows.map(toSummary);
  }

  async list(
    ctx: AuthContext,
    query: CustomerQuery,
  ): Promise<{ data: CustomerSummary[]; nextCursor: string | null }> {
    const page = await this.pageRows(ctx, query);
    return { data: page.data.map(toSummary), nextCursor: page.nextCursor };
  }

  /**
   * The customer list screen's rows (ADR-0037): every field of the customer, the point of its
   * default address and its first contact, read with one statement each for the whole page.
   */
  async listItems(
    ctx: AuthContext,
    query: CustomerQuery,
  ): Promise<{ data: CustomerListItem[]; nextCursor: string | null }> {
    const page = await this.pageRows(ctx, query);
    const ids = page.data.map((row) => row.id);
    if (ids.length === 0) return { data: [], nextCursor: page.nextCursor };
    const points = await this.db
      .select({
        customerId: customerAddresses.customerId,
        lat: customerAddresses.lat,
        lng: customerAddresses.lng,
      })
      .from(customerAddresses)
      .where(
        and(
          inArray(customerAddresses.customerId, ids),
          eq(customerAddresses.isDefault, true),
          isNotNull(customerAddresses.lat),
        ),
      );
    const contacts = await this.db
      .selectDistinctOn([customerContacts.customerId], {
        customerId: customerContacts.customerId,
        name: customerContacts.name,
        phone: customerContacts.phone,
      })
      .from(customerContacts)
      .where(inArray(customerContacts.customerId, ids))
      .orderBy(asc(customerContacts.customerId), asc(customerContacts.id));
    const defaultDays = await this.settings.find(
      'credit.payment_term_days',
      businessDate(),
      this.db,
    );
    const pointOf = new Map(points.map((point) => [point.customerId, point]));
    const contactOf = new Map(contacts.map((contact) => [contact.customerId, contact]));
    return {
      data: page.data.map((row) => {
        const point = pointOf.get(row.id);
        const contact = contactOf.get(row.id);
        return {
          ...toSummary(row),
          consumerNo: row.consumerNo,
          vatPayer: row.vatPayer,
          cityPayer: row.cityPayer,
          taxStatusSource: row.taxStatusSource,
          creditLimit: row.creditLimit,
          paymentTerm: termOf(row.paymentTermDays, defaultDays),
          creditHoldReason: row.creditHoldReason,
          note: row.note,
          gps: point?.lat && point.lng ? { lat: point.lat, lng: point.lng } : null,
          contact: contact ? { name: contact.name, phone: contact.phone } : null,
        };
      }),
      nextCursor: page.nextCursor,
    };
  }

  /** One keyset page of customers (search rank, name, id) with every column the lists show. */
  private async pageRows(ctx: AuthContext, query: CustomerQuery) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [this.visibleTo(ctx)];
    if (query.kind) filters.push(eq(customers.kind, query.kind));
    if (query.status) filters.push(eq(customers.status, query.status));
    if (query.creditHold !== undefined) filters.push(eq(customers.creditHold, query.creditHold));
    if (query.tinPending)
      filters.push(sql`${customers.kind} = 'COMPANY' AND ${customers.tin} IS NULL`);
    if (query.gpsMissing) {
      filters.push(sql`NOT EXISTS (SELECT 1 FROM customer_addresses a
        WHERE a.customer_id = customers.id AND a.is_default AND a.lat IS NOT NULL)`);
    }
    const searched = partnerSearch(customers, query.q);
    if (searched) filters.push(searched.match);
    // Without a search every row ranks 0; a bare 0 in ORDER BY would mean "column 0".
    const rank = searched?.rank ?? sql`0`;
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number' && typeof after.rank === 'number') {
      filters.push(
        sql`(${rank}, ${customers.name}, ${customers.id}) > (${after.rank}, (SELECT name FROM ${customers} WHERE id = ${after.id}), ${after.id})`,
      );
    }
    const rows = await this.db
      .select({
        ...this.summaryColumns(),
        consumerNo: customers.consumerNo,
        vatPayer: customers.vatPayer,
        cityPayer: customers.cityPayer,
        taxStatusSource: customers.taxStatusSource,
        creditLimit: customers.creditLimit,
        paymentTermDays: customers.paymentTermDays,
        creditHoldReason: customers.creditHoldReason,
        note: customers.note,
        rank: sql<number>`${rank}`,
      })
      .from(customers)
      .where(and(...filters))
      .orderBy(...(searched ? [searched.rank] : []), asc(customers.name), asc(customers.id))
      .limit(limit + 1);
    return toPage(rows, limit, (row) => ({ id: row.id, rank: row.rank }));
  }

  /** CUSTOMER_INACTIVE (409) for a deactivated customer; NOT_FOUND for an unknown one. */
  async assertActive(tx: Db | Tx, id: number): Promise<void> {
    const [row] = await tx
      .select({ status: customers.status })
      .from(customers)
      .where(eq(customers.id, id));
    if (!row) throw notFound('customer', id);
    if (row.status !== 'ACTIVE') {
      throw new AppError('CUSTOMER_INACTIVE', `customer ${id} is inactive`, { id });
    }
  }

  /**
   * Locks a customer for a credit decision (SPEC §6.2 #3, architecture §5.5) and returns what the
   * decision reads. FOR NO KEY UPDATE serialises credit checks and edits without blocking the
   * foreign-key checks of new orders, addresses or ledger rows that reference the customer.
   */
  async lockForUpdate(tx: Tx, id: number): Promise<LockedCustomer> {
    const [row] = await tx
      .select({
        id: customers.id,
        status: customers.status,
        creditLimit: customers.creditLimit,
        paymentTermDays: customers.paymentTermDays,
        creditHold: customers.creditHold,
      })
      .from(customers)
      .where(eq(customers.id, id))
      .for('no key update');
    if (!row) throw notFound('customer', id);
    return row;
  }

  /** Credit terms on an Ulaanbaatar business date (the payment-term setting is effective-dated). */
  async creditTerms(
    id: number,
    onDate: string = businessDate(),
    executor: Db | Tx = this.db,
  ): Promise<CreditTerms> {
    const [row] = await executor
      .select({
        creditLimit: customers.creditLimit,
        paymentTermDays: customers.paymentTermDays,
        creditHold: customers.creditHold,
      })
      .from(customers)
      .where(eq(customers.id, id));
    if (!row) throw notFound('customer', id);
    return {
      creditLimit: row.creditLimit,
      creditHold: row.creditHold,
      paymentTerm: await this.paymentTerm(row.paymentTermDays, onDate, executor),
    };
  }

  /** Customers by id with every field (an import revert compares what it changed). */
  async findByIds(ids: readonly number[], executor: Db | Tx = this.db) {
    if (ids.length === 0) return [];
    const rows = await executor
      .select()
      .from(customers)
      .where(inArray(customers.id, [...new Set(ids)]));
    return rows.map(customerAuditView);
  }

  /** Customers by code, for the Excel import (week 4): idempotent re-import keyed on the code. */
  async findByCodes(codes: readonly string[], executor: Db | Tx = this.db) {
    if (codes.length === 0) return [];
    const rows = await executor
      .select()
      .from(customers)
      .where(inArray(customers.code, [...codes]));
    return rows.map(customerAuditView);
  }

  private async paymentTerm(
    own: number | null,
    onDate: string,
    executor: Db | Tx,
  ): Promise<PaymentTerm> {
    if (own !== null) return termOf(own, undefined);
    return termOf(null, await this.settings.find('credit.payment_term_days', onDate, executor));
  }

  private async lockRow(tx: Tx, id: number): Promise<CustomerRow> {
    const [row] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .for('no key update');
    if (!row) throw notFound('customer', id);
    return row;
  }

  /** Normalised identifiers and the kind-specific rules of @tugeel/shared/taxpayer. */
  private validated(
    kind: CustomerKind,
    input: Pick<CustomerInput, 'regNo' | 'tin' | 'consumerNo' | 'phone'>,
  ): Pick<CustomerInput, 'regNo' | 'tin' | 'consumerNo' | 'phone'> {
    const regNo = optionalText(input.regNo);
    const tin = optionalText(input.tin);
    const consumerNo = optionalText(input.consumerNo);
    const phone = optionalText(input.phone);
    const cleanTin = tin ? cleanTaxNumber(tin) : tin;
    if (cleanTin && !isTinFor(kind, cleanTin)) {
      throw invalid(
        'tin',
        kind === 'COMPANY' ? 'company' : 'individual',
        'TIN length does not fit the kind',
      );
    }
    const cleanConsumer = consumerNo ? cleanTaxNumber(consumerNo) : consumerNo;
    if (cleanConsumer && kind !== 'INDIVIDUAL') {
      throw invalid('consumerNo', 'kind', 'only citizens have a consumer number');
    }
    if (cleanConsumer && !isConsumerNo(cleanConsumer)) {
      throw invalid('consumerNo', 'format', 'a consumer number has 8 digits');
    }
    const cleanPhone = phone ? normalizeMnPhone(phone) : phone;
    if (phone && !cleanPhone) throw invalid('phone', 'format', 'a Mongolian mobile number');
    return {
      regNo: regNo ? normalizeRegNo(regNo) : regNo,
      tin: cleanTin,
      consumerNo: cleanConsumer,
      phone: cleanPhone,
    };
  }

  private summaryColumns() {
    return {
      id: customers.id,
      code: customers.code,
      kind: customers.kind,
      name: customers.name,
      regNo: customers.regNo,
      tin: customers.tin,
      phone: customers.phone,
      status: customers.status,
      creditHold: customers.creditHold,
      address: sql<string | null>`(SELECT a.address FROM customer_addresses a
        WHERE a.customer_id = customers.id AND a.is_default)`,
      hasGps: sql<boolean>`EXISTS (SELECT 1 FROM customer_addresses a
        WHERE a.customer_id = customers.id AND a.is_default AND a.lat IS NOT NULL)`,
    };
  }
}

/** A customer's own days, else the company setting's, else unset. */
function termOf(own: number | null, setting: number | undefined): PaymentTerm {
  if (own !== null) return { days: own, source: 'CUSTOMER' };
  return setting === undefined
    ? { days: null, source: 'UNSET' }
    : { days: setting, source: 'DEFAULT' };
}

function isTinPending(row: { kind: CustomerKind; tin: string | null }): boolean {
  return row.kind === 'COMPANY' && row.tin === null;
}

function toSummary(row: Omit<CustomerSummary, 'tinPending'>): CustomerSummary {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    name: row.name,
    regNo: row.regNo,
    tin: row.tin,
    phone: row.phone,
    status: row.status,
    creditHold: row.creditHold,
    tinPending: isTinPending(row),
    address: row.address,
    hasGps: row.hasGps,
  };
}
