import { Injectable } from '@nestjs/common';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import {
  cleanTaxNumber,
  normalizeRegNo,
  REG_NO_MAX_LENGTH,
  TIN_PATTERN,
} from '@tugeel/shared/taxpayer';
import { normalizeName } from '@tugeel/shared/text';
import type { Db, Tx } from '../../../common/db/db.types';
import type { Actor } from '../../identity';
import { type Supplier, SupplierContactsService, SuppliersService } from '../../partners';
import {
  type AppliedRow,
  type CheckedRow,
  type CommittedRow,
  type Importer,
  type ImportJobRow,
  markDuplicates,
  type Progress,
  RowCheck,
  type SourceRow,
} from './importer';
import { integerCell, keyOf } from './lookups';

const CODE = /^[0-9]{1,20}$/;
const EMAIL = /^[^@\s]+@[^@\s]+$/;
const BANK_ACCOUNT = /^[A-Z0-9]{5,34}$/;

type Fields = Partial<{
  name: string;
  regNo: string | null;
  tin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  bankName: string | null;
  bankAccount: string | null;
  paymentTermDays: number | null;
  vatPayer: boolean;
  note: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}>;

/** What the commit does with one supplier row (JSON: stored as the row's plan). */
export interface SupplierPlan {
  code: string | null;
  supplierId: number | null;
  create: Omit<Fields, 'status'> | null;
  patch: Fields;
  before: Fields;
  contact: { name: string | null; phone: string | null } | null;
  changed: string[];
}

interface SupplierChanges {
  supplierId: number;
  created: boolean;
  patch: Fields;
  before: Fields;
}

/**
 * Suppliers (SPEC §5.5, ADR-0036): keyed on the code, or on the name for a row without one (names
 * are unique). A contact person is added when the supplier does not have them yet.
 */
@Injectable()
export class SuppliersImporter implements Importer<SupplierPlan> {
  readonly kind = 'SUPPLIERS' as const;

  constructor(
    private readonly suppliers: SuppliersService,
    private readonly contacts: SupplierContactsService,
  ) {}

  async validate(
    rows: readonly SourceRow[],
    executor: Db | Tx,
  ): Promise<CheckedRow<SupplierPlan>[]> {
    const entries = rows.map((row) => {
      const check = new RowCheck(row);
      const codeText = check.text('code');
      const code = codeText !== null && CODE.test(codeText) ? codeText : null;
      if (codeText !== null && code === null) check.error('code', 'FORMAT');
      const nameText = check.text('name', true);
      const name = nameText === null ? null : normalizeName(nameText);
      if (name !== null && name.length > 200) check.error('name', 'TOO_LONG');
      return { check, code, name };
    });
    markDuplicates(entries, 'code', (entry) => (entry.code ? [entry.code] : []));
    markDuplicates(entries, 'name', (entry) => (entry.name ? [keyOf(entry.name)] : []));
    const byCode = new Map(
      (
        await this.suppliers.findByCodes(
          entries.flatMap((entry) => (entry.code ? [entry.code] : [])),
          executor,
        )
      ).map((supplier) => [supplier.code, supplier]),
    );
    const byName = new Map(
      (
        await this.suppliers.findByNames(
          entries.flatMap((entry) => (entry.name ? [entry.name] : [])),
          executor,
        )
      ).map((supplier) => [keyOf(supplier.name), supplier]),
    );
    const contactsOf = new Map<number, { name: string | null; phone: string | null }[]>();
    for (const supplier of new Set([...byCode.values(), ...byName.values()])) {
      contactsOf.set(supplier.id, await this.contacts.ofSupplier(supplier.id, executor));
    }

    return entries.map(({ check, code, name }) => {
      const named = name ? byName.get(keyOf(name)) : undefined;
      const supplier: Supplier | undefined = code ? byCode.get(code) : named;
      // A new code with a name another supplier already has would break the unique names.
      if (code && !supplier && named)
        check.error('name', 'TAKEN', { value: name ?? '', owner: named.code });
      if (code && supplier && named && named.id !== supplier.id) {
        check.error('name', 'TAKEN', { value: name ?? '', owner: named.code });
      }
      const fields = this.fields(check);
      const plan: SupplierPlan = {
        code,
        supplierId: supplier?.id ?? null,
        create: null,
        patch: {},
        before: {},
        contact: null,
        changed: [],
      };
      if (!supplier) {
        plan.create = { name: name ?? '', ...withoutUndefined(fields) };
      } else {
        const set = <K extends keyof Fields>(
          key: K,
          next: Fields[K] | undefined,
          current: Fields[K],
        ) => {
          if (next === undefined || next === null || next === current) return;
          plan.patch[key] = next;
          plan.before[key] = current;
          plan.changed.push(key);
        };
        set('name', name ?? undefined, supplier.name);
        for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
          set(key, fields[key], supplier[key]);
        }
        if (supplier.status === 'INACTIVE') {
          set('status', 'ACTIVE', 'INACTIVE');
          check.warn(null, 'REACTIVATED');
        }
      }
      const contactName = check.text('contactName');
      const contactPhoneText = check.text('contactPhone');
      const contactPhone = contactPhoneText === null ? null : normalizeMnPhone(contactPhoneText);
      if (contactPhoneText !== null && contactPhone === null) check.error('contactPhone', 'FORMAT');
      if (contactName !== null && contactName.length > 100) check.error('contactName', 'TOO_LONG');
      if (contactName !== null || contactPhone !== null) {
        const known = supplier ? (contactsOf.get(supplier.id) ?? []) : [];
        const same = known.some(
          (contact) =>
            (contactName === null || contact.name === contactName) &&
            (contactPhone === null || contact.phone === contactPhone),
        );
        if (!same) {
          plan.contact = { name: contactName, phone: contactPhone };
          if (supplier) plan.changed.push('contact');
        }
      }
      const action = !supplier ? 'CREATE' : plan.changed.length > 0 ? 'UPDATE' : 'UNCHANGED';
      return check.result(action, supplier?.id ?? null, plan);
    });
  }

  async apply(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CheckedRow<SupplierPlan>[],
    progress: Progress,
  ): Promise<AppliedRow[]> {
    const applied: AppliedRow[] = [];
    let done = 0;
    for (const row of rows) {
      const plan = row.plan;
      if (!plan || row.action === null || row.action === 'UNCHANGED') {
        applied.push({
          rowNo: row.rowNo,
          action: row.action ?? 'UNCHANGED',
          targetId: row.targetId,
          changes: null,
        });
        continue;
      }
      let supplierId = plan.supplierId;
      if (plan.create) {
        supplierId = await this.suppliers.createInTx(tx, actor, {
          ...(plan.code === null ? {} : { code: plan.code }),
          ...plan.create,
          name: plan.create.name ?? '',
        });
      } else if (supplierId !== null && Object.keys(plan.patch).length > 0) {
        await this.suppliers.updateInTx(tx, actor, supplierId, plan.patch);
      }
      if (supplierId === null) throw new Error(`supplier row ${row.rowNo} has no id`);
      if (plan.contact) await this.contacts.addInTx(tx, actor, supplierId, plan.contact);
      const changes: SupplierChanges = {
        supplierId,
        created: plan.create !== null,
        patch: plan.patch,
        before: plan.before,
      };
      applied.push({ rowNo: row.rowNo, action: row.action, targetId: supplierId, changes });
      done += 1;
      if (done % 250 === 0) await progress(done);
    }
    return applied;
  }

  /** Created suppliers become inactive; updated fields still holding the imported value go back. */
  async revert(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CommittedRow[],
  ): Promise<void> {
    const entries = rows.flatMap((row) => (row.changes ? [row.changes as SupplierChanges] : []));
    const current = new Map(
      (
        await this.suppliers.findByIds(
          entries.map((entry) => entry.supplierId),
          tx,
        )
      ).map((row) => [row.id, row]),
    );
    for (const entry of entries) {
      const supplier = current.get(entry.supplierId);
      if (!supplier) continue;
      if (entry.created) {
        if (supplier.status !== 'INACTIVE') {
          await this.suppliers.updateInTx(tx, actor, entry.supplierId, { status: 'INACTIVE' });
        }
        continue;
      }
      const back: Fields = {};
      for (const key of Object.keys(entry.patch) as (keyof Fields)[]) {
        if (supplier[key] === entry.patch[key]) Object.assign(back, { [key]: entry.before[key] });
      }
      if (Object.keys(back).length > 0) {
        await this.suppliers.updateInTx(tx, actor, entry.supplierId, back);
      }
    }
  }

  /** The optional fields of a row, normalised as the supplier service stores them. */
  private fields(check: RowCheck): Omit<Fields, 'name' | 'status'> {
    const regNoText = check.text('regNo');
    const regNo = regNoText === null ? undefined : normalizeRegNo(regNoText);
    if (regNo !== undefined && regNo.length > REG_NO_MAX_LENGTH) check.error('regNo', 'TOO_LONG');
    const tinText = check.text('tin');
    const tin = tinText === null ? undefined : cleanTaxNumber(tinText);
    if (tin !== undefined && !TIN_PATTERN.test(tin)) check.error('tin', 'FORMAT');
    const phoneText = check.text('phone');
    const phone = phoneText === null ? undefined : normalizeMnPhone(phoneText);
    if (phone === null) check.error('phone', 'FORMAT');
    const emailText = check.text('email');
    const email = emailText === null ? undefined : emailText.toLowerCase();
    if (email !== undefined && (!EMAIL.test(email) || email.length > 254))
      check.error('email', 'FORMAT');
    const address = check.text('address') ?? undefined;
    if (address !== undefined && address.length > 300) check.error('address', 'TOO_LONG');
    const bankName = check.text('bankName') ?? undefined;
    if (bankName !== undefined && bankName.length > 60) check.error('bankName', 'TOO_LONG');
    const accountText = check.text('bankAccount');
    const bankAccount =
      accountText === null ? undefined : accountText.replace(/[\s-]+/g, '').toUpperCase();
    if (bankAccount !== undefined && !BANK_ACCOUNT.test(bankAccount))
      check.error('bankAccount', 'FORMAT');
    const termText = check.text('paymentTermDays');
    let paymentTermDays: number | undefined;
    if (termText !== null) {
      const read = integerCell(termText, 0, 365);
      if (read.ok) paymentTermDays = read.value;
      else check.error('paymentTermDays', read.code);
    }
    // A VAT payer (ADR-0078): «Тийм» / «Үгүй» (also yes / no, 1 / 0); empty keeps it.
    const vatText = check.text('vatPayer');
    let vatPayer: boolean | undefined;
    if (vatText !== null) {
      const word = vatText.trim().toLowerCase();
      if (['тийм', 'yes', 'y', '1', 'x', 'true'].includes(word)) vatPayer = true;
      else if (['үгүй', 'no', 'n', '0', 'false'].includes(word)) vatPayer = false;
      else check.error('vatPayer', 'FORMAT');
    }
    const note = check.text('note') ?? undefined;
    if (note !== undefined && note.length > 1_000) check.error('note', 'TOO_LONG');
    return {
      regNo,
      tin,
      phone: phone ?? undefined,
      email,
      address,
      bankName,
      bankAccount,
      paymentTermDays,
      vatPayer,
      note,
    };
  }
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
