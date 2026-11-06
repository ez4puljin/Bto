import { Inject, Injectable } from '@nestjs/common';
import { periodDays, splitRegisters } from '@tugeel/shared/ebarimt-check';
import { Decimal } from '@tugeel/shared/money';
import { localMnPhone } from '@tugeel/shared/phone';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { SuppliersService } from '../../partners';
import type { SupplierOrdererChange } from '../../procurement';
import {
  ebarimtCheckEntries,
  ebarimtCheckFiles,
  ebarimtCheckReceiptLinks,
  ebarimtCheckSupplierProfiles,
} from '../schema';

export type EbarimtFileRow = typeof ebarimtCheckFiles.$inferSelect;
export type EbarimtEntryRow = typeof ebarimtCheckEntries.$inferSelect;
export type EbarimtLinkRow = typeof ebarimtCheckReceiptLinks.$inferSelect;

/** A supplier with its values on this page: the record's, unless a typing here replaced them. */
export interface EbarimtSupplier {
  id: number;
  code: string;
  name: string;
  status: string;
  registers: string;
  /** The record's register when `registers` was typed here and differs. */
  registersDefault: string | null;
  phone: string;
  phoneDefault: string | null;
  remark: string;
  /** The registers as compared with the file. */
  registerList: string[];
}

export interface EbarimtTotal {
  amount: Decimal;
  count: number;
  /** The part that came by links. */
  linked: Decimal;
}

export interface EbarimtUnregistered {
  ttd: string;
  name: string;
  amount: Decimal;
  count: number;
}

export interface EbarimtAllocation {
  bySupplier: Map<number, EbarimtTotal>;
  unregistered: Map<string, EbarimtUnregistered>;
}

/**
 * Who a supplier's own orderer was in a month (ADR-0170): the last change by the month's end, so a
 * later change leaves the past alone. Before its first orderer a supplier had nobody, and that first
 * one stands for those months too: nobody is wronged, and the list is not left empty.
 */
export class OrdererTimeline {
  private readonly bySupplier = new Map<number, SupplierOrdererChange[]>();

  /** `changes`: oldest first. */
  constructor(changes: readonly SupplierOrdererChange[]) {
    for (const change of changes) {
      const list = this.bySupplier.get(change.supplierId);
      if (list) list.push(change);
      else this.bySupplier.set(change.supplierId, [change]);
    }
  }

  at(supplierId: number, period: number): number | null {
    const changes = this.bySupplier.get(supplierId);
    const first = changes?.[0];
    if (!changes || !first) return null;
    const end = periodDays(period).to;
    let held = first;
    for (const change of changes) {
      if (change.effectiveDate > end) break;
      held = change;
    }
    return held.userId;
  }
}

/** Who holds which register: a register may stand on several suppliers. */
export function registerOwners(suppliers: readonly EbarimtSupplier[]): Map<string, number[]> {
  const owners = new Map<string, number[]>();
  for (const supplier of suppliers) {
    for (const register of supplier.registerList) {
      const list = owners.get(register);
      if (list) list.push(supplier.id);
      else owners.set(register, [supplier.id]);
    }
  }
  return owners;
}

/**
 * Whose is each line of one month's file: a link's supplier first, so a receipt linked never counts
 * by its register as well; else every supplier holding the register, as the old list counted (a
 * shared register shows on each and is flagged); else nobody's, under its register.
 */
export function allocateEntries(
  entries: readonly EbarimtEntryRow[],
  links: readonly EbarimtLinkRow[],
  owners: ReadonlyMap<string, readonly number[]>,
): EbarimtAllocation {
  const linkOf = new Map(links.map((link) => [link.receiptKey, link]));
  const bySupplier = new Map<number, EbarimtTotal>();
  const unregistered = new Map<string, EbarimtUnregistered>();
  const add = (supplierId: number, amount: Decimal, linked: boolean) => {
    const total = bySupplier.get(supplierId) ?? {
      amount: new Decimal(0),
      count: 0,
      linked: new Decimal(0),
    };
    bySupplier.set(supplierId, {
      amount: total.amount.plus(amount),
      count: total.count + 1,
      linked: linked ? total.linked.plus(amount) : total.linked,
    });
  };
  for (const entry of entries) {
    const link = linkOf.get(entry.receiptKey);
    if (link) {
      add(link.supplierId, entry.totalAmount, true);
      continue;
    }
    const holders = owners.get(entry.ttd);
    if (holders?.length) {
      for (const supplierId of holders) add(supplierId, entry.totalAmount, false);
      continue;
    }
    const row = unregistered.get(entry.ttd) ?? {
      ttd: entry.ttd,
      name: '',
      amount: new Decimal(0),
      count: 0,
    };
    unregistered.set(entry.ttd, {
      ttd: entry.ttd,
      name: row.name || (entry.partnerName ?? ''),
      amount: row.amount.plus(entry.totalAmount),
      count: row.count + 1,
    });
  }
  return { bySupplier, unregistered };
}

/** What the report, the edits and the history all read. */
@Injectable()
export class EbarimtDataService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly suppliers: SuppliersService,
  ) {}

  async suppliersWithProfiles(executor: Db | Tx = this.db): Promise<EbarimtSupplier[]> {
    const [rows, profiles] = await Promise.all([
      this.suppliers.allBrief(executor),
      executor.select().from(ebarimtCheckSupplierProfiles),
    ]);
    const profileOf = new Map(profiles.map((profile) => [profile.supplierId, profile]));
    return rows.map((row) => {
      const profile = profileOf.get(row.id);
      const recordRegisters = [row.regNo, row.tin].filter(Boolean).join(';');
      const recordPhone = localMnPhone(row.phone ?? '');
      const registers = profile?.registers ?? recordRegisters;
      const phone = profile?.phone ?? recordPhone;
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        status: row.status,
        registers,
        registersDefault: registers === recordRegisters ? null : recordRegisters,
        phone,
        phoneDefault: phone === recordPhone ? null : recordPhone,
        remark: profile?.remark ?? '',
        registerList: splitRegisters(registers),
      };
    });
  }

  /** The month's file in force, per period. */
  async activeFiles(
    periods: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, EbarimtFileRow>> {
    if (periods.length === 0) return new Map();
    const rows = await executor
      .select()
      .from(ebarimtCheckFiles)
      .where(
        and(
          eq(ebarimtCheckFiles.status, 'ACTIVE'),
          inArray(ebarimtCheckFiles.period, [...periods]),
        ),
      );
    return new Map(rows.map((row) => [row.period, row]));
  }

  async allActivePeriods(executor: Db | Tx = this.db): Promise<number[]> {
    const rows = await executor
      .select({ period: ebarimtCheckFiles.period })
      .from(ebarimtCheckFiles)
      .where(eq(ebarimtCheckFiles.status, 'ACTIVE'))
      .orderBy(desc(ebarimtCheckFiles.period));
    return rows.map((row) => row.period);
  }

  async entriesOf(
    fileIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<EbarimtEntryRow[]> {
    if (fileIds.length === 0) return [];
    return executor
      .select()
      .from(ebarimtCheckEntries)
      .where(inArray(ebarimtCheckEntries.ebarimtFileId, [...fileIds]))
      .orderBy(asc(ebarimtCheckEntries.ebarimtFileId), asc(ebarimtCheckEntries.rowNo));
  }

  async liveLinks(
    periods: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<EbarimtLinkRow[]> {
    if (periods.length === 0) return [];
    return executor
      .select()
      .from(ebarimtCheckReceiptLinks)
      .where(
        and(
          inArray(ebarimtCheckReceiptLinks.period, [...periods]),
          isNull(ebarimtCheckReceiptLinks.removedAt),
        ),
      )
      .orderBy(asc(ebarimtCheckReceiptLinks.id));
  }
}
