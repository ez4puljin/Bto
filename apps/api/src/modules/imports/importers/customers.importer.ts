import { Injectable } from '@nestjs/common';
import type { SettlementGroup } from '@tugeel/shared/finance';
import { parseCoordinates } from '@tugeel/shared/geo';
import { guessCustomerKind } from '@tugeel/shared/imports';
import { Decimal } from '@tugeel/shared/money';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import {
  type CustomerKind,
  cleanTaxNumber,
  isConsumerNo,
  isTinFor,
  normalizeRegNo,
  REG_NO_MAX_LENGTH,
  TIN_PATTERN,
} from '@tugeel/shared/taxpayer';
import { normalizeName } from '@tugeel/shared/text';
import type { Db, Tx } from '../../../common/db/db.types';
import type { Actor } from '../../identity';
import { CustomerAddressesService, CustomersService } from '../../partners';
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
import { decimalCell } from './lookups';

const CODE = /^[0-9]{1,20}$/;
const CREDIT_MAX = new Decimal('999999999999.99');

type Fields = Partial<{
  name: string;
  regNo: string | null;
  tin: string | null;
  consumerNo: string | null;
  phone: string | null;
  note: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}>;

interface Credit {
  creditLimit: string | null;
  settlementGroup: SettlementGroup;
}

/**
 * The settlement group cell (ADR-0101): «Мөрөн» (DAY_20) or «Орон нутаг» (MONTH_END), also the
 * codes themselves; case, spaces and hyphens are ignored.
 */
export function settlementGroupCell(text: string): SettlementGroup | null {
  const word = text
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (['мөрөн', 'морон', 'day20'].includes(word)) return 'DAY_20';
  if (['ороннутаг', 'monthend'].includes(word)) return 'MONTH_END';
  return null;
}

/** What the commit does with one customer row (JSON: stored as the row's plan). */
export interface CustomerPlan {
  code: string;
  kind: CustomerKind;
  customerId: number | null;
  create: (Required<Omit<Fields, 'status'>> & { settlementGroup: SettlementGroup }) | null;
  patch: Fields;
  before: Fields;
  /** A new address (the first one becomes the default). */
  address: { address: string | null; lat: string | null; lng: string | null } | null;
  credit: Credit | null;
  creditBefore: (Credit & { creditHold: boolean; creditHoldReason: string | null }) | null;
  changed: string[];
}

interface CustomerChanges {
  customerId: number;
  created: boolean;
  patch: Fields;
  before: Fields;
  credit: Credit | null;
  creditBefore: CustomerPlan['creditBefore'];
}

/**
 * Customers (SPEC §5.5, ADR-0036): keyed on the code. The sheet has no company/individual column:
 * the kind is read from the registration number, else the TIN's length, else a company with a
 * warning. Empty cells never clear what a customer already has; a new customer needs its settlement
 * group (ADR-0101).
 */
@Injectable()
export class CustomersImporter implements Importer<CustomerPlan> {
  readonly kind = 'CUSTOMERS' as const;

  constructor(
    private readonly customers: CustomersService,
    private readonly addresses: CustomerAddressesService,
  ) {}

  async validate(
    rows: readonly SourceRow[],
    executor: Db | Tx,
  ): Promise<CheckedRow<CustomerPlan>[]> {
    const entries = rows.map((row) => {
      const check = new RowCheck(row);
      const codeText = check.text('code', true);
      const code = codeText !== null && CODE.test(codeText) ? codeText : null;
      if (codeText !== null && code === null) check.error('code', 'FORMAT');
      return { check, code };
    });
    markDuplicates(entries, 'code', (entry) => (entry.code ? [entry.code] : []));
    const existing = new Map(
      (
        await this.customers.findByCodes(
          entries.flatMap((entry) => (entry.code ? [entry.code] : [])),
          executor,
        )
      ).map((customer) => [customer.code, customer]),
    );
    const addressesOf = new Map<number, { address: string | null; lat: Decimal | null }[]>();
    for (const address of await this.addresses.ofCustomers(
      [...existing.values()].map((customer) => customer.id),
      executor,
    )) {
      addressesOf.set(address.customerId, [
        ...(addressesOf.get(address.customerId) ?? []),
        { address: address.address, lat: address.lat },
      ]);
    }

    return entries.map(({ check, code }) => {
      const customer = code ? existing.get(code) : undefined;
      const nameText = check.text('name', true);
      const name = nameText === null ? null : normalizeName(nameText);
      if (name !== null && name.length > 200) check.error('name', 'TOO_LONG');
      const regNoText = check.text('regNo');
      const regNo = regNoText === null ? null : normalizeRegNo(regNoText);
      if (regNo !== null && regNo.length > REG_NO_MAX_LENGTH) check.error('regNo', 'TOO_LONG');
      const tinText = check.text('tin');
      const tin = tinText === null ? null : cleanTaxNumber(tinText);
      if (tin !== null && !TIN_PATTERN.test(tin)) check.error('tin', 'FORMAT');
      let kind: CustomerKind;
      if (customer) {
        kind = customer.kind;
      } else {
        const guess = guessCustomerKind(regNo, tin);
        kind = guess.kind;
        if (guess.source === 'DEFAULT') check.warn(null, 'KIND_GUESSED');
      }
      if (tin !== null && TIN_PATTERN.test(tin) && !isTinFor(kind, tin))
        check.error('tin', 'FORMAT');
      const consumerText = check.text('consumerNo');
      const consumerNo = consumerText === null ? null : cleanTaxNumber(consumerText);
      if (consumerNo !== null) {
        if (kind !== 'INDIVIDUAL') check.error('consumerNo', 'NOT_ALLOWED');
        else if (!isConsumerNo(consumerNo)) check.error('consumerNo', 'FORMAT');
      }
      const phoneText = check.text('phone');
      const phone = phoneText === null ? null : normalizeMnPhone(phoneText);
      if (phoneText !== null && phone === null) check.error('phone', 'FORMAT');
      const note = check.text('note');
      if (note !== null && note.length > 1_000) check.error('note', 'TOO_LONG');
      const addressText = check.text('address');
      if (addressText !== null && addressText.length > 300) check.error('address', 'TOO_LONG');
      const gpsText = check.text('gps');
      let point: { lat: Decimal; lng: Decimal } | null = null;
      if (gpsText !== null) {
        const parsed = parseCoordinates(gpsText);
        if (parsed.ok)
          point = { lat: new Decimal(parsed.value.lat), lng: new Decimal(parsed.value.lng) };
        else check.error('gps', parsed.problem === 'OUTSIDE' ? 'OUT_OF_RANGE' : 'FORMAT');
      }
      const limitText = check.text('creditLimit');
      let creditLimit: Decimal | undefined;
      if (limitText !== null) {
        const read = decimalCell(limitText, 2, CREDIT_MAX);
        if (read.ok) creditLimit = read.value;
        else check.error('creditLimit', read.code);
      }
      const groupText = check.text('settlementGroup');
      let settlementGroup: SettlementGroup | undefined;
      if (groupText !== null) {
        settlementGroup = settlementGroupCell(groupText) ?? undefined;
        if (settlementGroup === undefined) check.error('settlementGroup', 'FORMAT');
      } else if (!customer) {
        check.error('settlementGroup', 'REQUIRED');
      }

      const plan: CustomerPlan = {
        code: code ?? '',
        kind,
        customerId: customer?.id ?? null,
        create: null,
        patch: {},
        before: {},
        address: null,
        credit: null,
        creditBefore: null,
        changed: [],
      };
      if (!customer) {
        plan.create = {
          name: name ?? '',
          regNo,
          tin,
          consumerNo,
          phone,
          note,
          settlementGroup: settlementGroup ?? 'DAY_20',
        };
      } else {
        const set = <K extends keyof Fields>(
          key: K,
          next: Fields[K] | null,
          current: Fields[K],
        ) => {
          if (next === null || next === undefined || next === current) return;
          plan.patch[key] = next;
          plan.before[key] = current;
          plan.changed.push(key);
        };
        set('name', name, customer.name);
        set('regNo', regNo, customer.regNo);
        set('tin', tin, customer.tin);
        set('consumerNo', consumerNo, customer.consumerNo);
        set('phone', phone, customer.phone);
        set('note', note, customer.note);
        if (customer.status === 'INACTIVE') {
          set('status', 'ACTIVE', 'INACTIVE');
          check.warn(null, 'REACTIVATED');
        }
      }
      if (addressText !== null || point !== null) {
        const known = customer ? (addressesOf.get(customer.id) ?? []) : [];
        const same = known.some(
          (entry) =>
            (entry.address ?? null) === addressText &&
            (point === null ? true : entry.lat !== null && entry.lat.eq(point.lat)),
        );
        if (!same) {
          plan.address = {
            address: addressText,
            lat: point?.lat.toFixed() ?? null,
            lng: point?.lng.toFixed() ?? null,
          };
          if (customer) plan.changed.push('address');
        }
      }
      // A new customer takes its group at creation; the credit step then sets only the limit.
      if (creditLimit !== undefined || (customer && settlementGroup !== undefined)) {
        const group = settlementGroup ?? customer?.settlementGroup ?? 'DAY_20';
        const next: Credit = {
          creditLimit: creditLimit?.toFixed(2) ?? customer?.creditLimit?.toFixed(2) ?? null,
          settlementGroup: group,
        };
        const current: Credit = {
          creditLimit: customer?.creditLimit?.toFixed(2) ?? null,
          settlementGroup: customer?.settlementGroup ?? group,
        };
        if (
          !customer ||
          next.creditLimit !== current.creditLimit ||
          next.settlementGroup !== current.settlementGroup
        ) {
          plan.credit = next;
          plan.creditBefore = {
            ...current,
            creditHold: customer?.creditHold ?? false,
            creditHoldReason: customer?.creditHoldReason ?? null,
          };
          if (customer) plan.changed.push('credit');
        }
      }
      const action = !customer ? 'CREATE' : plan.changed.length > 0 ? 'UPDATE' : 'UNCHANGED';
      return check.result(action, customer?.id ?? null, plan);
    });
  }

  async apply(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CheckedRow<CustomerPlan>[],
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
      let customerId = plan.customerId;
      if (plan.create) {
        customerId = await this.customers.createInTx(tx, actor, {
          code: plan.code,
          kind: plan.kind,
          ...plan.create,
          address: plan.address
            ? {
                address: plan.address.address,
                lat: plan.address.lat === null ? null : new Decimal(plan.address.lat),
                lng: plan.address.lng === null ? null : new Decimal(plan.address.lng),
              }
            : null,
        });
      } else if (customerId !== null) {
        if (Object.keys(plan.patch).length > 0) {
          await this.customers.updateInTx(tx, actor, customerId, plan.patch);
        }
        if (plan.address) {
          await this.addresses.addInTx(tx, actor, customerId, {
            address: plan.address.address,
            lat: plan.address.lat === null ? null : new Decimal(plan.address.lat),
            lng: plan.address.lng === null ? null : new Decimal(plan.address.lng),
          });
        }
      }
      if (customerId === null) throw new Error(`customer ${plan.code} has no id`);
      if (plan.credit) {
        await this.customers.setCreditInTx(tx, actor, customerId, {
          creditLimit:
            plan.credit.creditLimit === null ? null : new Decimal(plan.credit.creditLimit),
          settlementGroup: plan.credit.settlementGroup,
          creditHold: plan.creditBefore?.creditHold ?? false,
          creditHoldReason: plan.creditBefore?.creditHoldReason ?? null,
        });
      }
      const changes: CustomerChanges = {
        customerId,
        created: plan.create !== null,
        patch: plan.patch,
        before: plan.before,
        credit: plan.credit,
        creditBefore: plan.creditBefore,
      };
      applied.push({ rowNo: row.rowNo, action: row.action, targetId: customerId, changes });
      done += 1;
      if (done % 250 === 0) await progress(done);
    }
    return applied;
  }

  /**
   * Created customers become inactive; on updated ones, fields and credit terms still holding the
   * imported value get their old value back. Addresses an import added stay (they may be used).
   */
  async revert(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CommittedRow[],
  ): Promise<void> {
    const entries = rows.flatMap((row) => (row.changes ? [row.changes as CustomerChanges] : []));
    const current = new Map(
      (
        await this.customers.findByIds(
          entries.map((entry) => entry.customerId),
          tx,
        )
      ).map((row) => [row.id, row]),
    );
    for (const entry of entries) {
      const customer = current.get(entry.customerId);
      if (!customer) continue;
      if (entry.created) {
        if (customer.status !== 'INACTIVE') {
          await this.customers.updateInTx(tx, actor, entry.customerId, { status: 'INACTIVE' });
        }
        continue;
      }
      const back: Fields = {};
      for (const key of Object.keys(entry.patch) as (keyof Fields)[]) {
        if (customer[key] === entry.patch[key]) Object.assign(back, { [key]: entry.before[key] });
      }
      if (Object.keys(back).length > 0) {
        await this.customers.updateInTx(tx, actor, entry.customerId, back);
      }
      if (entry.credit && entry.creditBefore) {
        const limit = customer.creditLimit?.toFixed(2) ?? null;
        if (
          limit === entry.credit.creditLimit &&
          customer.settlementGroup === entry.credit.settlementGroup
        ) {
          await this.customers.setCreditInTx(tx, actor, entry.customerId, {
            creditLimit:
              entry.creditBefore.creditLimit === null
                ? null
                : new Decimal(entry.creditBefore.creditLimit),
            settlementGroup: entry.creditBefore.settlementGroup,
            creditHold: customer.creditHold,
            creditHoldReason: customer.creditHoldReason,
          });
        }
      }
    }
  }
}
