import { Inject, Injectable } from '@nestjs/common';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { asc, eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { AuditService, type AuthContext } from '../../identity';
import { companyContacts, CONTACT_LIMITS } from '../schema';

export interface CompanyContact {
  id: number;
  role: string;
  name: string;
  phone: string;
  shown: boolean;
}

export interface CompanyContactInput {
  role: string;
  name: string;
  phone: string;
  shown: boolean;
}

/**
 * «Холбоо барих» (ADR-0079 #14): the company's contact people the customer app lists on «Нүүр»,
 * the same for every store. Admins save the whole list in its order; the app reads the shown rows.
 */
@Injectable()
export class CompanyContactsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Every contact in its order (the admin's page). */
  list(): Promise<CompanyContact[]> {
    return this.db
      .select({
        id: companyContacts.id,
        role: companyContacts.role,
        name: companyContacts.name,
        phone: companyContacts.phone,
        shown: companyContacts.shown,
      })
      .from(companyContacts)
      .orderBy(asc(companyContacts.position));
  }

  /** The contacts the app shows, in order. */
  async shown(): Promise<CompanyContact[]> {
    return (await this.list()).filter((contact) => contact.shown);
  }

  /**
   * Replaces the list with `input`, in that order (one transaction, one audit row): the phones in
   * E.164, the role and the name trimmed and required.
   */
  async save(ctx: AuthContext, input: readonly CompanyContactInput[]): Promise<CompanyContact[]> {
    if (input.length > CONTACT_LIMITS.maxContacts) {
      throw invalid('contacts', 'maxItems', `at most ${CONTACT_LIMITS.maxContacts} contacts`);
    }
    const rows = input.map((contact, index) => {
      const role = contact.role.trim();
      const name = contact.name.trim();
      const phone = normalizeMnPhone(contact.phone);
      if (!role || role.length > CONTACT_LIMITS.maxRole) {
        throw invalid(`contacts.${index}.role`, 'length', 'a role of 1–60 characters');
      }
      if (!name || name.length > CONTACT_LIMITS.maxName) {
        throw invalid(`contacts.${index}.name`, 'length', 'a name of 1–80 characters');
      }
      if (!phone) throw invalid(`contacts.${index}.phone`, 'phone', 'a Mongolian mobile number');
      return {
        role,
        name,
        phone,
        shown: contact.shown,
        position: index + 1,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      };
    });
    await inTransaction(this.db, async (tx) => {
      const before = await tx.select().from(companyContacts).orderBy(asc(companyContacts.position));
      for (const row of before)
        await tx.delete(companyContacts).where(eq(companyContacts.id, row.id));
      if (rows.length > 0) await tx.insert(companyContacts).values(rows);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'company_contacts',
        entityId: 'list',
        before: before.map(({ role, name, phone, shown }) => ({ role, name, phone, shown })),
        after: rows.map(({ role, name, phone, shown }) => ({ role, name, phone, shown })),
      });
    });
    return this.list();
  }
}
