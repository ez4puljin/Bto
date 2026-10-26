import { Inject, Injectable } from '@nestjs/common';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { type Actor, AuditService } from '../../identity';
import { customerContacts, customers, supplierContacts, suppliers } from '../schema';
import { optionalText } from './support';

export interface ContactInput {
  name?: string | null;
  position?: string | null;
  phone?: string | null;
  note?: string | null;
}

export type CustomerContact = typeof customerContacts.$inferSelect;
export type SupplierContact = typeof supplierContacts.$inferSelect;

/** Trimmed fields, the phone in E.164; a contact has a name or a phone at least. */
function validated(input: ContactInput) {
  const phoneText = optionalText(input.phone) ?? null;
  const phone = phoneText === null ? null : normalizeMnPhone(phoneText);
  if (phoneText !== null && phone === null) {
    throw invalid('phone', 'format', 'a Mongolian mobile number');
  }
  const name = optionalText(input.name) ?? null;
  if (name === null && phone === null) throw invalid('name', 'required', 'a name or a phone');
  return {
    name,
    position: optionalText(input.position) ?? null,
    phone,
    note: optionalText(input.note) ?? null,
  };
}

const merged = <T extends ContactInput>(before: T, input: ContactInput): ContactInput => ({
  name: input.name === undefined ? before.name : input.name,
  position: input.position === undefined ? before.position : input.position,
  phone: input.phone === undefined ? before.phone : input.phone,
  note: input.note === undefined ? before.note : input.note,
});

/** People to call at a customer (owner, manager, receiving clerk). */
@Injectable()
export class CustomerContactsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  ofCustomer(customerId: number, executor: Db | Tx = this.db): Promise<CustomerContact[]> {
    return executor
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId))
      .orderBy(asc(customerContacts.id));
  }

  add(actor: Actor, customerId: number, input: ContactInput): Promise<CustomerContact> {
    return inTransaction(this.db, (tx) => this.addInTx(tx, actor, customerId, input));
  }

  /** The customer import adds a contact the customer does not have yet (ADR-0107). */
  async addInTx(
    tx: Tx,
    actor: Actor,
    customerId: number,
    input: ContactInput,
  ): Promise<CustomerContact> {
    const [owner] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, customerId));
    if (!owner) throw notFound('customer', customerId);
    const [row] = await tx
      .insert(customerContacts)
      .values({ customerId, ...validated(input) })
      .returning();
    if (!row) throw new Error('contact insert returned no row');
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'customer_contacts',
      entityId: row.id,
      after: row,
    });
    return row;
  }

  /** The contacts of many customers (the import's "already has it" check). */
  async ofCustomers(
    customerIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<CustomerContact[]> {
    if (customerIds.length === 0) return [];
    return executor
      .select()
      .from(customerContacts)
      .where(inArray(customerContacts.customerId, [...customerIds]))
      .orderBy(asc(customerContacts.customerId), asc(customerContacts.id));
  }

  update(actor: Actor, id: number, input: ContactInput): Promise<CustomerContact> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.find(tx, id);
      const [after] = await tx
        .update(customerContacts)
        .set({ ...validated(merged(before, input)), updatedAt: sql`now()` })
        .where(eq(customerContacts.id, id))
        .returning();
      if (!after) throw notFound('customer contact', id);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'customer_contacts',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  remove(actor: Actor, id: number): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.find(tx, id);
      await tx.delete(customerContacts).where(eq(customerContacts.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'customer_contacts',
        entityId: id,
        before,
      });
    });
  }

  private async find(tx: Tx, id: number): Promise<CustomerContact> {
    const [row] = await tx.select().from(customerContacts).where(eq(customerContacts.id, id));
    if (!row) throw notFound('customer contact', id);
    return row;
  }
}

/** People to call at a supplier (sales agent, accountant). */
@Injectable()
export class SupplierContactsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  ofSupplier(supplierId: number, executor: Db | Tx = this.db): Promise<SupplierContact[]> {
    return executor
      .select()
      .from(supplierContacts)
      .where(eq(supplierContacts.supplierId, supplierId))
      .orderBy(asc(supplierContacts.id));
  }

  add(actor: Actor, supplierId: number, input: ContactInput): Promise<SupplierContact> {
    return inTransaction(this.db, (tx) => this.addInTx(tx, actor, supplierId, input));
  }

  /** A contact of a supplier in the caller's transaction (the supplier import). */
  async addInTx(
    tx: Tx,
    actor: Actor,
    supplierId: number,
    input: ContactInput,
  ): Promise<SupplierContact> {
    const [owner] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));
    if (!owner) throw notFound('supplier', supplierId);
    const [row] = await tx
      .insert(supplierContacts)
      .values({ supplierId, ...validated(input) })
      .returning();
    if (!row) throw new Error('contact insert returned no row');
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'supplier_contacts',
      entityId: row.id,
      after: row,
    });
    return row;
  }

  update(actor: Actor, id: number, input: ContactInput): Promise<SupplierContact> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.find(tx, id);
      const [after] = await tx
        .update(supplierContacts)
        .set({ ...validated(merged(before, input)), updatedAt: sql`now()` })
        .where(eq(supplierContacts.id, id))
        .returning();
      if (!after) throw notFound('supplier contact', id);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'supplier_contacts',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  remove(actor: Actor, id: number): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.find(tx, id);
      await tx.delete(supplierContacts).where(eq(supplierContacts.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'supplier_contacts',
        entityId: id,
        before,
      });
    });
  }

  private async find(tx: Tx, id: number): Promise<SupplierContact> {
    const [row] = await tx.select().from(supplierContacts).where(eq(supplierContacts.id, id));
    if (!row) throw notFound('supplier contact', id);
    return row;
  }
}
