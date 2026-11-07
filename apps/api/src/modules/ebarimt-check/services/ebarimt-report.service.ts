import { Inject, Injectable } from '@nestjs/common';
import {
  type EbarimtHistoryField,
  type EbarimtHistoryKind,
  normalizeTaxId,
  periodDays,
  periodOfDate,
} from '@tugeel/shared/ebarimt-check';
import { Decimal } from '@tugeel/shared/money';
import { and, asc, inArray, lte, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { notFound } from '../../../common/errors/app-error';
import { UserNamesService } from '../../identity';
import { ReceiptsService } from '../../inventory';
import { SupplierOrderersService } from '../../procurement';
import {
  ebarimtCheckAccounts,
  ebarimtCheckAssignments,
  ebarimtCheckFiles,
  ebarimtCheckMonthValues,
  ebarimtCheckReceiptLinks,
  ebarimtCheckSupplierProfiles,
} from '../schema';
import {
  allocateEntries,
  type EbarimtEntryRow,
  type EbarimtLinkRow,
  EbarimtDataService,
  type EbarimtSupplier,
  OrdererTimeline,
  registerOwners,
} from './ebarimt-data.service';
import { EbarimtHistoryService } from './ebarimt-history.service';
import { EbarimtSettingsService } from './ebarimt-settings.service';

const ZERO = new Decimal(0);

export interface EbarimtPeriodValues {
  period: number;
  purchaseAmount: Decimal;
  receiptCount: number;
  /** Of those, how many wait for their price check: the amount is the delivery note's for now. */
  pendingCount: number;
  ebarimtAmount: Decimal;
  ebarimtCount: number;
  exemptAmount: Decimal;
  note: string | null;
}

export interface EbarimtEmployeeMonths {
  userId: number | null;
  name: string | null;
  periods: number[];
}

export interface EbarimtHistoryEvent {
  period: number;
  field: EbarimtHistoryField;
  kind: EbarimtHistoryKind;
  amount: Decimal | null;
  userName: string | null;
  source: string | null;
  changedAt: Date;
  changedByName: string | null;
}

export interface EbarimtReportRow {
  supplierId: number;
  code: string;
  name: string;
  status: string;
  registers: string;
  registersDefault: string | null;
  phone: string;
  phoneDefault: string | null;
  remark: string;
  /** Registers that stand on another supplier too: their receipts show on both. */
  sharedRegisters: string[];
  /** The employee of the last period asked for. */
  employeeUserId: number | null;
  employeeName: string | null;
  /** Given to someone else on this page: who the supplier's own orderer is. */
  ordererName: string | null;
  employeeAssigned: boolean;
  /** Who held it in which of the periods, most months first. */
  employeeMonths: EbarimtEmployeeMonths[];
  purchaseAmount: Decimal;
  receiptCount: number;
  pendingCount: number;
  ebarimtAmount: Decimal;
  ebarimtCount: number;
  linkedAmount: Decimal;
  exemptAmount: Decimal;
  /** Purchases less e-Barimt less the exempt amount. */
  diffAmount: Decimal;
  byPeriod: EbarimtPeriodValues[];
  /** What changed by hand, and e-Barimt's total once it moved. */
  history: EbarimtHistoryEvent[];
}

export interface EbarimtUnregisteredRow {
  ttd: string;
  name: string;
  amount: Decimal;
  count: number;
  periods: number[];
}

export interface EbarimtLinkView {
  period: number;
  receiptKey: string;
  ttd: string;
  partnerName: string | null;
  deliveryNoteNo: string | null;
  docDate: string | null;
  amount: Decimal;
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  createdAt: Date;
  createdByName: string | null;
  /** The receipt left the month's file: the link counts for nothing until it returns. */
  stale: boolean;
}

export interface EbarimtReport {
  periods: number[];
  /** What was written here when the rows were read: `version` tells an open page it has moved on. */
  stamp: string;
  /** Asked for but holding no file: e-Barimt is simply unknown there. */
  noFile: number[];
  rows: EbarimtReportRow[];
  unregistered: EbarimtUnregisteredRow[];
  links: EbarimtLinkView[];
  /** The accounts whose receipts were counted. */
  accountCodes: string[];
}

export interface EbarimtReceiptBrief {
  id: number;
  number: string | null;
  period: number;
  day: string;
  supplierDocNo: string | null;
  accountCode: string | null;
  accountName: string | null;
  /** On an account the settings count. */
  counted: boolean;
  pricePending: boolean;
  lineCount: number;
  warehouses: string;
  note: string | null;
  /** Null: posted with neither prices nor the delivery note's total. */
  amount: Decimal | null;
  createdByName: string | null;
}

export interface EbarimtEntryView {
  period: number;
  rowNo: number;
  receiptKey: string;
  ddtd: string | null;
  deliveryNoteNo: string | null;
  docDate: string;
  partnerName: string | null;
  ttd: string;
  vatAmount: Decimal;
  netAmount: Decimal;
  totalAmount: Decimal;
  kind: string | null;
  link: {
    supplierId: number;
    supplierCode: string;
    supplierName: string;
    createdAt: Date;
    createdByName: string | null;
  } | null;
}

export interface EbarimtEntriesResult {
  registers: string[];
  noFile: number[];
  rows: EbarimtEntryView[];
}

/** Worked out on every read: receipts and the file are the only sources, nothing is stored. */
@Injectable()
export class EbarimtReportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly receipts: ReceiptsService,
    private readonly orderers: SupplierOrderersService,
    private readonly userNames: UserNamesService,
    private readonly data: EbarimtDataService,
    private readonly history: EbarimtHistoryService,
    private readonly settings: EbarimtSettingsService,
  ) {}

  async report(periodsAsked: readonly number[]): Promise<EbarimtReport> {
    const periods = [...new Set(periodsAsked)].sort((a, b) => a - b);
    const first = periods[0];
    const last = periods[periods.length - 1];
    if (first === undefined || last === undefined) {
      return {
        periods,
        stamp: '',
        noFile: [],
        rows: [],
        unregistered: [],
        links: [],
        accountCodes: [],
      };
    }
    // First: a write landing during the reads then shows as a change, never hides as none.
    const stamp = await this.version(periods);
    const asked = new Set(periods);
    const [counted, suppliers, files, links, monthValues, assignments, changes, history, posted] =
      await Promise.all([
        this.settings.counted(),
        this.data.suppliersWithProfiles(),
        this.data.activeFiles(periods),
        this.data.liveLinks(periods),
        this.db
          .select()
          .from(ebarimtCheckMonthValues)
          .where(inArray(ebarimtCheckMonthValues.period, periods)),
        this.db
          .select()
          .from(ebarimtCheckAssignments)
          .where(and(lte(ebarimtCheckAssignments.period, last)))
          .orderBy(asc(ebarimtCheckAssignments.period)),
        this.orderers.changes(),
        this.history.ofPeriods(periods, this.db),
        this.receipts.postedBetween(periodDays(first).from, periodDays(last).to),
      ]);
    const entries = await this.data.entriesOf([...files.values()].map((file) => file.id));
    const fileOfEntry = new Map([...files.values()].map((file) => [file.id, file.period]));
    const owners = registerOwners(suppliers);
    const orderers = new OrdererTimeline(changes);

    // Receipts: only months asked for (the span between two chosen months may hold others) and
    // only the accounts that count.
    const purchases = new Map<string, { amount: Decimal; count: number; pending: number }>();
    for (const receipt of posted) {
      const period = periodOfDate(receipt.day);
      if (period === null || !asked.has(period)) continue;
      const code = receipt.counterAccountCode ?? counted.defaultCode;
      if (code === null || !counted.codes.has(code)) continue;
      const key = `${period}:${receipt.supplierId}`;
      const sum = purchases.get(key) ?? { amount: ZERO, count: 0, pending: 0 };
      purchases.set(key, {
        amount: sum.amount.plus(receipt.netAmount ?? ZERO),
        count: sum.count + 1,
        pending: sum.pending + (receipt.costingStatus === 'PENDING' ? 1 : 0),
      });
    }

    // e-Barimt, month by month: a link belongs to its month.
    const allocated = new Map<number, ReturnType<typeof allocateEntries>>();
    const entriesByPeriod = new Map<number, EbarimtEntryRow[]>();
    for (const entry of entries) {
      const period = fileOfEntry.get(entry.ebarimtFileId);
      if (period === undefined) continue;
      const list = entriesByPeriod.get(period);
      if (list) list.push(entry);
      else entriesByPeriod.set(period, [entry]);
    }
    const linksByPeriod = new Map<number, EbarimtLinkRow[]>();
    for (const link of links) {
      const list = linksByPeriod.get(link.period);
      if (list) list.push(link);
      else linksByPeriod.set(link.period, [link]);
    }
    for (const period of periods) {
      allocated.set(
        period,
        allocateEntries(entriesByPeriod.get(period) ?? [], linksByPeriod.get(period) ?? [], owners),
      );
    }

    const valueOf = new Map(
      monthValues.map((value) => [`${value.period}:${value.supplierId}`, value]),
    );

    // Employees: the latest choice on or before each month, else the supplier's own orderer.
    const choicesOf = new Map<number, typeof assignments>();
    for (const choice of assignments) {
      const list = choicesOf.get(choice.supplierId);
      if (list) list.push(choice);
      else choicesOf.set(choice.supplierId, [choice]);
    }
    const employeeAt = (supplierId: number, period: number): number | null => {
      const orderer = orderers.at(supplierId, period);
      let userId = orderer;
      for (const choice of choicesOf.get(supplierId) ?? []) {
        if (choice.period > period) break;
        userId = choice.userId ?? orderer;
      }
      return userId;
    };

    const names = await this.userNames.namesOf([
      ...new Set([
        ...changes.flatMap((row) => (row.userId === null ? [] : [row.userId])),
        ...assignments.flatMap((row) => (row.userId === null ? [] : [row.userId])),
        ...history.flatMap((row) => [row.userId, row.changedBy].flatMap((id) => id ?? [])),
        ...links.flatMap((row) => (row.createdBy === null ? [] : [row.createdBy])),
      ]),
    ]);
    const nameOf = (id: number | null) => (id === null ? null : (names.get(id) ?? null));

    // A hand's change shows from its first line; e-Barimt's first reading alone says nothing.
    const historyOf = new Map<number, EbarimtHistoryEvent[]>();
    const eventCount = new Map<string, number>();
    for (const row of history) {
      const key = `${row.period}:${row.supplierId}:${row.field}`;
      eventCount.set(key, (eventCount.get(key) ?? 0) + 1);
    }
    for (const row of history) {
      const count = eventCount.get(`${row.period}:${row.supplierId}:${row.field}`) ?? 0;
      if (row.field === 'EBARIMT' && row.kind === 'INIT' && count < 2) continue;
      const list = historyOf.get(row.supplierId) ?? [];
      list.push({
        period: row.period,
        field: row.field as EbarimtHistoryField,
        kind: row.kind as EbarimtHistoryKind,
        amount: row.amount,
        userName: nameOf(row.userId),
        source: row.source,
        changedAt: row.changedAt,
        changedByName: nameOf(row.changedBy),
      });
      historyOf.set(row.supplierId, list);
    }

    const rows: EbarimtReportRow[] = [];
    for (const supplier of suppliers) {
      const byPeriod: EbarimtPeriodValues[] = periods.map((period) => {
        const purchase = purchases.get(`${period}:${supplier.id}`);
        const total = allocated.get(period)?.bySupplier.get(supplier.id);
        const value = valueOf.get(`${period}:${supplier.id}`);
        return {
          period,
          purchaseAmount: purchase?.amount ?? ZERO,
          receiptCount: purchase?.count ?? 0,
          pendingCount: purchase?.pending ?? 0,
          ebarimtAmount: total?.amount ?? ZERO,
          ebarimtCount: total?.count ?? 0,
          exemptAmount: value?.exemptAmount ?? ZERO,
          note: value?.note ?? null,
        };
      });
      const sum = (pick: (values: EbarimtPeriodValues) => Decimal) =>
        byPeriod.reduce((total, values) => total.plus(pick(values)), ZERO);
      const purchaseAmount = sum((values) => values.purchaseAmount);
      const ebarimtAmount = sum((values) => values.ebarimtAmount);
      const exemptAmount = sum((values) => values.exemptAmount);
      const hasData =
        !purchaseAmount.isZero() ||
        !ebarimtAmount.isZero() ||
        !exemptAmount.isZero() ||
        byPeriod.some((values) => values.note !== null);
      if (supplier.status !== 'ACTIVE' && !hasData) continue;
      const linkedAmount = periods.reduce(
        (total, period) =>
          total.plus(allocated.get(period)?.bySupplier.get(supplier.id)?.linked ?? ZERO),
        ZERO,
      );
      const employeeUserId = employeeAt(supplier.id, last);
      const orderer = orderers.at(supplier.id, last);
      rows.push({
        supplierId: supplier.id,
        code: supplier.code,
        name: supplier.name,
        status: supplier.status,
        registers: supplier.registers,
        registersDefault: supplier.registersDefault,
        phone: supplier.phone,
        phoneDefault: supplier.phoneDefault,
        remark: supplier.remark,
        sharedRegisters: supplier.registerList.filter(
          (register) => (owners.get(register)?.length ?? 0) > 1,
        ),
        employeeUserId,
        employeeName: nameOf(employeeUserId),
        ordererName: nameOf(orderer),
        employeeAssigned: employeeUserId !== orderer,
        employeeMonths: this.employeeMonths(supplier, periods, employeeAt, nameOf),
        purchaseAmount,
        receiptCount: byPeriod.reduce((count, values) => count + values.receiptCount, 0),
        pendingCount: byPeriod.reduce((count, values) => count + values.pendingCount, 0),
        ebarimtAmount,
        ebarimtCount: byPeriod.reduce((count, values) => count + values.ebarimtCount, 0),
        linkedAmount,
        exemptAmount,
        diffAmount: purchaseAmount.minus(ebarimtAmount).minus(exemptAmount),
        byPeriod,
        history: historyOf.get(supplier.id) ?? [],
      });
    }

    const unregistered = new Map<string, EbarimtUnregisteredRow>();
    for (const period of periods) {
      for (const row of allocated.get(period)?.unregistered.values() ?? []) {
        const sum = unregistered.get(row.ttd) ?? {
          ttd: row.ttd,
          name: '',
          amount: ZERO,
          count: 0,
          periods: [],
        };
        unregistered.set(row.ttd, {
          ttd: row.ttd,
          name: row.name || sum.name,
          amount: sum.amount.plus(row.amount),
          count: sum.count + row.count,
          periods: [...sum.periods, period],
        });
      }
    }

    const supplierOf = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const linkViews: EbarimtLinkView[] = links.map((link) => {
      // A key can stand on several lines of a file, and the supplier's figure counts them all.
      const lines = (entriesByPeriod.get(link.period) ?? []).filter(
        (row) => row.receiptKey === link.receiptKey,
      );
      const entry = lines[0];
      const supplier = supplierOf.get(link.supplierId);
      return {
        period: link.period,
        receiptKey: link.receiptKey,
        ttd: link.ttd,
        partnerName: entry?.partnerName ?? null,
        deliveryNoteNo: entry?.deliveryNoteNo ?? null,
        docDate: entry?.docDate ?? null,
        amount: entry ? lines.reduce((sum, row) => sum.plus(row.totalAmount), ZERO) : link.amount,
        supplierId: link.supplierId,
        supplierCode: supplier?.code ?? '',
        supplierName: supplier?.name ?? '',
        createdAt: link.createdAt,
        createdByName: nameOf(link.createdBy),
        stale: !entry,
      };
    });

    return {
      periods,
      stamp,
      noFile: periods.filter((period) => !files.has(period)),
      rows,
      unregistered: [...unregistered.values()].sort((a, b) => b.amount.comparedTo(a.amount)),
      links: linkViews,
      accountCodes: [...counted.codes].sort(),
    };
  }

  private employeeMonths(
    supplier: EbarimtSupplier,
    periods: readonly number[],
    employeeAt: (supplierId: number, period: number) => number | null,
    nameOf: (id: number | null) => string | null,
  ): EbarimtEmployeeMonths[] {
    const groups = new Map<number | null, number[]>();
    for (const period of periods) {
      const userId = employeeAt(supplier.id, period);
      const list = groups.get(userId);
      if (list) list.push(period);
      else groups.set(userId, [period]);
    }
    return [...groups.entries()]
      .map(([userId, months]) => ({ userId, name: nameOf(userId), periods: months }))
      .sort(
        (a, b) =>
          b.periods.length - a.periods.length ||
          (b.periods[b.periods.length - 1] ?? 0) - (a.periods[a.periods.length - 1] ?? 0),
      );
  }

  /**
   * The receipts behind a supplier's purchases: every posted one of those months, those on an
   * account that does not count marked so, so a figure can be explained rather than wondered at.
   */
  async receiptsOf(
    periodsAsked: readonly number[],
    supplierId: number,
  ): Promise<EbarimtReceiptBrief[]> {
    const periods = [...new Set(periodsAsked)].sort((a, b) => a - b);
    const first = periods[0];
    const last = periods[periods.length - 1];
    if (first === undefined || last === undefined) return [];
    const asked = new Set(periods);
    const [options, posted] = await Promise.all([
      this.settings.options(),
      this.receipts.postedBetween(periodDays(first).from, periodDays(last).to, supplierId),
    ]);
    const optionOf = new Map(options.map((option) => [option.code, option]));
    const defaultCode = options.find((option) => option.isDefault)?.code ?? null;
    const names = await this.userNames.namesOf(
      posted.flatMap((receipt) => (receipt.createdBy === null ? [] : [receipt.createdBy])),
    );
    const rows: EbarimtReceiptBrief[] = [];
    for (const receipt of posted) {
      const period = periodOfDate(receipt.day);
      if (period === null || !asked.has(period)) continue;
      const code = receipt.counterAccountCode ?? defaultCode;
      const option = code === null ? undefined : optionOf.get(code);
      rows.push({
        id: receipt.id,
        number: receipt.number,
        period,
        day: receipt.day,
        supplierDocNo: receipt.supplierDocNo,
        accountCode: code,
        accountName: option?.name ?? null,
        counted: option?.counted ?? false,
        pricePending: receipt.costingStatus === 'PENDING',
        lineCount: receipt.lineCount,
        warehouses: receipt.warehouses,
        note: receipt.note,
        amount: receipt.netAmount,
        createdByName: receipt.createdBy === null ? null : (names.get(receipt.createdBy) ?? null),
      });
    }
    return rows;
  }

  /** e-Barimt's lines behind a figure: a supplier's (registers and links), or one register's. */
  /**
   * A light stamp of what people write on this page for these months (ADR-0170): an open page polls
   * it and offers a reload, instead of moving rows under a typing hand. Compared, never read. One
   * statement, since every open page polls. Not the receipts: those are another screen's.
   */
  async version(periods: readonly number[]): Promise<string> {
    const list = [...periods];
    const last = Math.max(...list);
    const monthValues = ebarimtCheckMonthValues;
    const profiles = ebarimtCheckSupplierProfiles;
    const assignments = ebarimtCheckAssignments;
    const links = ebarimtCheckReceiptLinks;
    const files = ebarimtCheckFiles;
    const accounts = ebarimtCheckAccounts;
    // A sum, not the latest: a slow save stamped before a quick one commits after it, and moves no
    // maximum. An employee chosen later does not touch the months before it.
    const result = await this.db.execute<{ stamp: string }>(sql`
      SELECT concat_ws('|',
        (SELECT count(*) || ':' || coalesce(sum(extract(epoch FROM ${monthValues.updatedAt})), 0)
           FROM ${monthValues} WHERE ${inArray(monthValues.period, list)}),
        (SELECT count(*) || ':' || coalesce(sum(extract(epoch FROM ${profiles.updatedAt})), 0)
           FROM ${profiles}),
        (SELECT count(*) || ':' || coalesce(sum(extract(epoch FROM ${assignments.updatedAt})), 0)
           FROM ${assignments} WHERE ${lte(assignments.period, last)}),
        (SELECT count(*) || ':' || coalesce(sum(extract(epoch FROM ${links.createdAt})), 0)
                || ':' || coalesce(sum(extract(epoch FROM ${links.removedAt})), 0)
           FROM ${links} WHERE ${inArray(links.period, list)}),
        (SELECT count(*) || ':' || coalesce(sum(extract(epoch FROM ${files.uploadedAt})), 0)
                || ':' || coalesce(sum(extract(epoch FROM ${files.closedAt})), 0)
           FROM ${files} WHERE ${inArray(files.period, list)}),
        (SELECT coalesce(string_agg(${accounts.accountCode}, ',' ORDER BY ${accounts.accountCode}), '')
           FROM ${accounts})
      ) AS stamp`);
    return result.rows[0]?.stamp ?? '';
  }

  async entriesOf(
    periodsAsked: readonly number[],
    target: { supplierId?: number; ttd?: string },
  ): Promise<EbarimtEntriesResult> {
    const periods = [...new Set(periodsAsked)].sort((a, b) => a - b);
    const [suppliers, files, links] = await Promise.all([
      this.data.suppliersWithProfiles(),
      this.data.activeFiles(periods),
      this.data.liveLinks(periods),
    ]);
    const supplier =
      target.supplierId === undefined
        ? null
        : (suppliers.find((row) => row.id === target.supplierId) ?? null);
    if (target.supplierId !== undefined && !supplier) throw notFound('supplier', target.supplierId);
    const registers = supplier
      ? supplier.registerList
      : target.ttd
        ? [normalizeTaxId(target.ttd)]
        : [];
    const wanted = new Set(registers);
    const entries = await this.data.entriesOf([...files.values()].map((file) => file.id));
    const periodOfFile = new Map([...files.values()].map((file) => [file.id, file.period]));
    const linkOf = new Map(links.map((link) => [`${link.period}:${link.receiptKey}`, link]));
    const supplierOf = new Map(suppliers.map((row) => [row.id, row]));
    const names = await this.userNames.namesOf(
      links.flatMap((link) => (link.createdBy === null ? [] : [link.createdBy])),
    );
    const rows: EbarimtEntryView[] = [];
    for (const entry of entries) {
      const period = periodOfFile.get(entry.ebarimtFileId);
      if (period === undefined) continue;
      const link = linkOf.get(`${period}:${entry.receiptKey}`);
      const belongs = supplier
        ? link
          ? link.supplierId === supplier.id
          : wanted.has(entry.ttd)
        : wanted.has(entry.ttd);
      if (!belongs) continue;
      const owner = link ? supplierOf.get(link.supplierId) : undefined;
      rows.push({
        period,
        rowNo: entry.rowNo,
        receiptKey: entry.receiptKey,
        ddtd: entry.ddtd,
        deliveryNoteNo: entry.deliveryNoteNo,
        docDate: entry.docDate,
        partnerName: entry.partnerName,
        ttd: entry.ttd,
        vatAmount: entry.vatAmount,
        netAmount: entry.netAmount,
        totalAmount: entry.totalAmount,
        kind: entry.kind,
        link: link
          ? {
              supplierId: link.supplierId,
              supplierCode: owner?.code ?? '',
              supplierName: owner?.name ?? '',
              createdAt: link.createdAt,
              createdByName: link.createdBy === null ? null : (names.get(link.createdBy) ?? null),
            }
          : null,
      });
    }
    rows.sort((a, b) => a.period - b.period || a.docDate.localeCompare(b.docDate));
    return {
      registers,
      noFile: periods.filter((period) => !files.has(period)),
      rows,
    };
  }
}
