import { conditionDays, type SegmentCondition } from '@tugeel/shared/segments';
import { businessDate } from '@tugeel/shared/time';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { cleanTaxNumber, normalizeRegNo, TIN_PATTERN } from '@tugeel/shared/taxpayer';
import { nameKey, normalizeName, searchKeys } from '@tugeel/shared/text';
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn, onBusinessDays } from '../../../common/db/days';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { type Actor, AuditService } from '../../identity';
import { SUPPLIER_CHANGED_HOOK, type SupplierChangedHook, type SupplierPartyFacts } from '../hooks';
import { productSuppliers, supplierContacts, suppliers } from '../schema';
import { type SupplierContact, SupplierContactsService } from './contacts.service';
import type { ListContact, PartnerStatus } from './customers.service';
import { advisoryLock, LOCKS, nextNumericCode, optionalText, partnerSearch } from './support';

type SupplierRow = typeof suppliers.$inferSelect;

const BANK_ACCOUNT = /^[A-Z0-9]{5,34}$/;
const EMAIL = /^[^@\s]+@[^@\s]+$/;

export interface SupplierInput {
  /** Omitted: the next free number. */
  code?: string;
  name: string;
  regNo?: string | null;
  tin?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  paymentTermDays?: number | null;
  /** A VAT payer: its delivery-note prices hold VAT (ADR-0078). Omitted on create: no. */
  vatPayer?: boolean;
  note?: string | null;
}

export type SupplierPatch = Partial<SupplierInput> & { status?: PartnerStatus };

export type Supplier = Omit<
  SupplierRow,
  'nameKey' | 'searchText' | 'searchPhonetic' | 'searchVersion'
>;

export interface SupplierSummary {
  id: number;
  code: string;
  name: string;
  tin: string | null;
  phone: string | null;
  vatPayer: boolean;
  status: PartnerStatus;
}

/** A row of the supplier list screen: the summary plus every other field (ADR-0037). */
export interface SupplierListItem extends SupplierSummary {
  regNo: string | null;
  email: string | null;
  address: string | null;
  bankName: string | null;
  bankAccount: string | null;
  paymentTermDays: number | null;
  note: string | null;
  contact: ListContact | null;
  /** Products linked to the supplier. */
  productCount: number;
}

export interface SupplierDetail extends Supplier {
  contacts: SupplierContact[];
}

export interface SupplierQuery {
  q?: string;
  status?: PartnerStatus;
  cursor?: string;
  limit?: number;
}

/** What a supplier's Finance Core party carries (F3, ADR-0091). */
export function supplierPartyFacts(row: SupplierRow): SupplierPartyFacts {
  return { id: row.id, name: row.name, tin: row.tin, regNo: row.regNo };
}

/** The audit snapshot and API view of a supplier row: no derived keys. */
export function supplierView(row: SupplierRow): Supplier {
  const {
    nameKey: _key,
    searchText: _text,
    searchPhonetic: _phonetic,
    searchVersion: _version,
    ...rest
  } = row;
  return rest;
}

/**
 * Suppliers (SPEC §5.3): names are unique (by `nameKey`) so the product sheet's supplier column
 * can be matched by name in the Excel import; every signed-in user reads them (receiving). A new
 * supplier, or a change of its name, TIN or register number, reaches its Finance Core party through
 * SUPPLIER_CHANGED_HOOK in the same transaction (F3, ADR-0091).
 */
@Injectable()
export class SuppliersService implements OnModuleInit {
  private changedHook: SupplierChangedHook | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly contacts: SupplierContactsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.changedHook = this.moduleRef.get<SupplierChangedHook>(SUPPLIER_CHANGED_HOOK, {
        strict: false,
      });
    } catch {
      this.changedHook = null;
    }
  }

  async nextCode(executor: Db | Tx = this.db): Promise<string> {
    return nextNumericCode(executor, 'suppliers');
  }

  create(actor: Actor, input: SupplierInput): Promise<SupplierDetail> {
    return inTransaction(this.db, async (tx) => {
      const id = await this.createInTx(tx, actor, input);
      return this.get(id, tx);
    });
  }

  async createInTx(tx: Tx, actor: Actor, input: SupplierInput): Promise<number> {
    const fields = validated(input);
    await advisoryLock(tx, LOCKS.supplierCode);
    const code = input.code ?? (await this.nextCode(tx));
    const name = normalizeName(input.name);
    const keys = searchKeys(name, [code]);
    const [row] = await tx
      .insert(suppliers)
      .values({
        code,
        name,
        nameKey: nameKey(name),
        searchText: keys.strict,
        searchPhonetic: keys.phonetic,
        searchVersion: keys.version,
        ...fields,
      })
      .returning();
    if (!row) throw new Error('supplier insert returned no row');
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'suppliers',
      entityId: row.id,
      after: supplierView(row),
    });
    await this.changedHook?.onSupplierChanged(tx, actor, supplierPartyFacts(row));
    return row.id;
  }

  update(actor: Actor, id: number, patch: SupplierPatch): Promise<SupplierDetail> {
    return inTransaction(this.db, async (tx) => {
      await this.updateInTx(tx, actor, id, patch);
      return this.get(id, tx);
    });
  }

  async updateInTx(tx: Tx, actor: Actor, id: number, patch: SupplierPatch): Promise<void> {
    const [before] = await tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, id))
      .for('no key update');
    if (!before) throw notFound('supplier', id);
    const fields = validated({
      name: patch.name ?? before.name,
      regNo: patch.regNo === undefined ? before.regNo : patch.regNo,
      tin: patch.tin === undefined ? before.tin : patch.tin,
      phone: patch.phone === undefined ? before.phone : patch.phone,
      email: patch.email === undefined ? before.email : patch.email,
      address: patch.address === undefined ? before.address : patch.address,
      bankName: patch.bankName === undefined ? before.bankName : patch.bankName,
      bankAccount: patch.bankAccount === undefined ? before.bankAccount : patch.bankAccount,
      paymentTermDays:
        patch.paymentTermDays === undefined ? before.paymentTermDays : patch.paymentTermDays,
      vatPayer: patch.vatPayer ?? before.vatPayer,
      note: patch.note === undefined ? before.note : patch.note,
    });
    const code = patch.code ?? before.code;
    const name = patch.name === undefined ? before.name : normalizeName(patch.name);
    const keys = searchKeys(name, [code]);
    const [after] = await tx
      .update(suppliers)
      .set({
        code,
        name,
        nameKey: nameKey(name),
        searchText: keys.strict,
        searchPhonetic: keys.phonetic,
        searchVersion: keys.version,
        ...fields,
        ...(patch.status === undefined ? {} : { status: patch.status }),
        updatedAt: sql`now()`,
      })
      .where(eq(suppliers.id, id))
      .returning();
    if (!after) throw notFound('supplier', id);
    await this.audit.record(tx, actor, {
      action: 'UPDATE',
      entity: 'suppliers',
      entityId: id,
      before: supplierView(before),
      after: supplierView(after),
    });
    if (after.name !== before.name || after.tin !== before.tin || after.regNo !== before.regNo) {
      await this.changedHook?.onSupplierChanged(tx, actor, supplierPartyFacts(after));
    }
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<SupplierDetail> {
    const [row] = await executor.select().from(suppliers).where(eq(suppliers.id, id));
    if (!row) throw notFound('supplier', id);
    return { ...supplierView(row), contacts: await this.contacts.ofSupplier(id, executor) };
  }

  async getMany(ids: readonly number[], executor: Db | Tx = this.db): Promise<SupplierSummary[]> {
    if (ids.length === 0) return [];
    return executor
      .select(SUMMARY)
      .from(suppliers)
      .where(inArray(suppliers.id, [...ids]));
  }

  async list(
    query: SupplierQuery,
  ): Promise<{ data: SupplierSummary[]; nextCursor: string | null }> {
    const page = await this.pageRows(query);
    return { data: page.data.map(toSummary), nextCursor: page.nextCursor };
  }

  /**
   * The supplier list screen's rows (ADR-0037): every field, the first contact and the number of
   * linked products, read with one statement each for the whole page.
   */
  async listItems(
    query: SupplierQuery,
    within: readonly number[] | null = null,
  ): Promise<{ data: SupplierListItem[]; nextCursor: string | null }> {
    if (within?.length === 0) return { data: [], nextCursor: null };
    const page = await this.pageRows(query, within);
    const ids = page.data.map((row) => row.id);
    if (ids.length === 0) return { data: [], nextCursor: page.nextCursor };
    const contacts = await this.db
      .selectDistinctOn([supplierContacts.supplierId], {
        supplierId: supplierContacts.supplierId,
        name: supplierContacts.name,
        phone: supplierContacts.phone,
      })
      .from(supplierContacts)
      .where(inArray(supplierContacts.supplierId, ids))
      .orderBy(asc(supplierContacts.supplierId), asc(supplierContacts.id));
    const counts = await this.db
      .select({ supplierId: productSuppliers.supplierId, count: sql<number>`count(*)::int` })
      .from(productSuppliers)
      .where(inArray(productSuppliers.supplierId, ids))
      .groupBy(productSuppliers.supplierId);
    const contactOf = new Map(contacts.map((contact) => [contact.supplierId, contact]));
    const countOf = new Map(counts.map((row) => [row.supplierId, row.count]));
    return {
      data: page.data.map((row) => {
        const contact = contactOf.get(row.id);
        return {
          ...toSummary(row),
          regNo: row.regNo,
          email: row.email,
          address: row.address,
          bankName: row.bankName,
          bankAccount: row.bankAccount,
          paymentTermDays: row.paymentTermDays,
          note: row.note,
          contact: contact ? { name: contact.name, phone: contact.phone } : null,
          productCount: countOf.get(row.id) ?? 0,
        };
      }),
      nextCursor: page.nextCursor,
    };
  }

  /** Every supplier: the universe of a negative condition (ADR-0049 #3). */
  allIds(executor: Db | Tx = this.db): Promise<number[]> {
    return this.idsOf(sql`true`, executor);
  }

  /**
   * The suppliers one segment condition keeps, ascending (ADR-0049 #3): search, status, linked
   * to products, the day it was registered.
   */
  idsWhere(condition: SegmentCondition, executor: Db | Tx = this.db): Promise<number[]> {
    const where = supplierCondition(condition);
    return where ? this.idsOf(where, executor) : Promise.resolve([]);
  }

  private async idsOf(where: SQL, executor: Db | Tx): Promise<number[]> {
    const rows = await executor
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(where)
      .orderBy(asc(suppliers.id));
    return rows.map((row) => row.id);
  }

  /** One keyset page of suppliers (search rank, name, id) with every column the lists show. */
  private async pageRows(query: SupplierQuery, within: readonly number[] | null = null) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (within) filters.push(idIn(suppliers.id, within));
    if (query.status) filters.push(eq(suppliers.status, query.status));
    const searched = partnerSearch(suppliers, query.q);
    if (searched) filters.push(searched.match);
    // Without a search every row ranks 0; a bare 0 in ORDER BY would mean "column 0".
    const rank = searched?.rank ?? sql`0`;
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number' && typeof after.rank === 'number') {
      filters.push(
        sql`(${rank}, ${suppliers.name}, ${suppliers.id}) > (${after.rank}, (SELECT name FROM ${suppliers} WHERE id = ${after.id}), ${after.id})`,
      );
    }
    const rows = await this.db
      .select({
        ...SUMMARY,
        regNo: suppliers.regNo,
        email: suppliers.email,
        address: suppliers.address,
        bankName: suppliers.bankName,
        bankAccount: suppliers.bankAccount,
        paymentTermDays: suppliers.paymentTermDays,
        note: suppliers.note,
        rank: sql<number>`${rank}`,
      })
      .from(suppliers)
      .where(and(...filters))
      .orderBy(...(searched ? [searched.rank] : []), asc(suppliers.name), asc(suppliers.id))
      .limit(limit + 1);
    return toPage(rows, limit, (row) => ({ id: row.id, rank: row.rank }));
  }

  /** SUPPLIER_INACTIVE (409) for a deactivated supplier (goods receipts, delivery 1 week 3). */
  async assertActive(tx: Db | Tx, id: number): Promise<void> {
    const [row] = await tx
      .select({ status: suppliers.status })
      .from(suppliers)
      .where(eq(suppliers.id, id));
    if (!row) throw notFound('supplier', id);
    if (row.status !== 'ACTIVE') {
      throw new AppError('SUPPLIER_INACTIVE', `supplier ${id} is inactive`, { id });
    }
  }

  /** Suppliers by id with every field (an import revert compares what it changed). */
  async findByIds(ids: readonly number[], executor: Db | Tx = this.db): Promise<Supplier[]> {
    if (ids.length === 0) return [];
    const rows = await executor
      .select()
      .from(suppliers)
      .where(inArray(suppliers.id, [...new Set(ids)]));
    return rows.map(supplierView);
  }

  /** Suppliers by code, for the Excel import (week 4). */
  async findByCodes(codes: readonly string[], executor: Db | Tx = this.db): Promise<Supplier[]> {
    if (codes.length === 0) return [];
    const rows = await executor
      .select()
      .from(suppliers)
      .where(inArray(suppliers.code, [...codes]));
    return rows.map(supplierView);
  }

  /** Suppliers by name as the product sheet writes it, matched through `nameKey` (unique). */
  async findByNames(names: readonly string[], executor: Db | Tx = this.db): Promise<Supplier[]> {
    if (names.length === 0) return [];
    const keys = [...new Set(names.map((name) => nameKey(normalizeName(name))))];
    const rows = await executor.select().from(suppliers).where(inArray(suppliers.nameKey, keys));
    return rows.map(supplierView);
  }
}

const SUMMARY = {
  id: suppliers.id,
  code: suppliers.code,
  name: suppliers.name,
  tin: suppliers.tin,
  phone: suppliers.phone,
  vatPayer: suppliers.vatPayer,
  status: suppliers.status,
};

function toSummary(row: SupplierSummary): SupplierSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    tin: row.tin,
    phone: row.phone,
    vatPayer: row.vatPayer,
    status: row.status,
  };
}

/** Normalised optional fields; the database checks the same formats. */
function validated(input: SupplierInput) {
  const regNo = optionalText(input.regNo);
  const tinText = optionalText(input.tin);
  const tin = tinText ? cleanTaxNumber(tinText) : tinText;
  if (tin && !TIN_PATTERN.test(tin)) throw invalid('tin', 'format', 'a TIN has 11–14 digits');
  const phoneText = optionalText(input.phone);
  const phone = phoneText ? normalizeMnPhone(phoneText) : phoneText;
  if (phoneText && !phone) throw invalid('phone', 'format', 'a Mongolian mobile number');
  const email = optionalText(input.email)?.toLowerCase();
  if (email && !EMAIL.test(email)) throw invalid('email', 'format', 'an e-mail address');
  const accountText = optionalText(input.bankAccount);
  const bankAccount = accountText ? accountText.replace(/[\s-]+/g, '').toUpperCase() : accountText;
  if (bankAccount && !BANK_ACCOUNT.test(bankAccount)) {
    throw invalid('bankAccount', 'format', 'letters and digits, 5–34 characters');
  }
  return {
    regNo: regNo ? normalizeRegNo(regNo) : (regNo ?? null),
    tin: tin ?? null,
    phone: phone ?? null,
    email: email ?? null,
    address: optionalText(input.address) ?? null,
    bankName: optionalText(input.bankName) ?? null,
    bankAccount: bankAccount ?? null,
    paymentTermDays: input.paymentTermDays ?? null,
    vatPayer: input.vatPayer ?? false,
    note: optionalText(input.note) ?? null,
  };
}

/** One positive segment condition on suppliers as SQL; null keeps none (ADR-0049 #3). */
function supplierCondition(condition: SegmentCondition): SQL | null {
  switch (condition.field) {
    case 'search':
      return condition.text ? (partnerSearch(suppliers, condition.text)?.match ?? null) : null;
    case 'status':
      return condition.values?.length
        ? sql`${suppliers.status} IN (${sql.join(
            condition.values.map((value) => sql`${value}`),
            sql`, `,
          )})`
        : null;
    case 'products':
      return sql`EXISTS (SELECT 1 FROM product_suppliers ps WHERE ps.supplier_id = suppliers.id)`;
    case 'createdAt':
      return onBusinessDays(suppliers.createdAt, conditionDays(condition, businessDate()));
    default:
      return null;
  }
}
