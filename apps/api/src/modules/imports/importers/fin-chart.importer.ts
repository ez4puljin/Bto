import { Injectable } from '@nestjs/common';
import type { Db, Tx } from '../../../common/db/db.types';
import type { FinChartImportApplied, FinChartImportRow } from '../../../finance-core';
import { FinanceImportsService } from '../../finance';
import type { Actor } from '../../identity';
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

/** An account code as the chart keeps it (Bto's account code rule). */
const ACCOUNT_CODE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,15}$/;
/** A group code as the core keeps it. */
const GROUP_CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const MAX_NAME = 200;

/**
 * Erkhet's chart from a sheet (ADR-0102 #4): one account per row by its code — created, or its name,
 * kind, side, control and group brought to the sheet's —, its group made by code, and the posting
 * key of its «Үүрэг» re-pointed to it from today. An account that holds postings keeps its kind,
 * side and control (IN_USE). The revert takes the chart back (FinChartService.revertChartInTx).
 */
@Injectable()
export class FinChartImporter implements Importer<FinChartImportRow> {
  readonly kind = 'FIN_CHART' as const;

  constructor(private readonly finance: FinanceImportsService) {}

  async validate(
    rows: readonly SourceRow[],
    executor: Db | Tx,
  ): Promise<CheckedRow<FinChartImportRow>[]> {
    const facts = await this.finance.chartFacts(executor);
    const parsed = rows.map((row) => {
      const check = new RowCheck(row);
      return {
        check,
        code: check.text('code', true),
        name: check.text('name', true),
        kind: check.text('kind', true),
        groupCode: check.text('groupCode'),
        groupName: check.text('groupName'),
        control: check.text('control'),
        side: check.text('side'),
        role: check.text('role'),
        key: null as string | null,
      };
    });
    for (const row of parsed) {
      if (row.role !== null) row.key = this.finance.keyOfRole(row.role);
    }
    markDuplicates(parsed, 'code', (row) => (row.code ? [row.code] : []));
    markDuplicates(parsed, 'role', (row) => (row.key ? [row.key] : []));

    return parsed.map((row) => {
      const { check } = row;
      if (row.code !== null && !ACCOUNT_CODE.test(row.code)) check.error('code', 'FORMAT');
      if (row.name !== null && row.name.length > MAX_NAME) check.error('name', 'TOO_LONG');
      const kind = row.kind === null ? null : this.finance.kindOf(row.kind);
      if (row.kind !== null && kind === null) check.error('kind', 'NOT_FOUND', { value: row.kind });
      const control = row.control === null ? null : this.finance.controlOf(row.control);
      if (row.control !== null && control === null) {
        check.error('control', 'NOT_FOUND', { value: row.control });
      }
      const side = row.side === null ? null : this.finance.sideOf(row.side);
      if (row.side !== null && side === null) check.error('side', 'NOT_FOUND', { value: row.side });
      if (row.groupCode !== null && !GROUP_CODE.test(row.groupCode)) {
        check.error('groupCode', 'FORMAT');
      }
      if (row.groupName !== null && row.groupCode === null) check.error('groupCode', 'REQUIRED');
      if (row.groupName !== null && row.groupName.length > MAX_NAME) {
        check.error('groupName', 'TOO_LONG');
      }
      if (row.role !== null && row.key === null) {
        check.error('role', 'NOT_FOUND', { value: row.role });
      }

      const existing = row.code === null ? undefined : facts.accounts.get(row.code);
      const finalControl = control ?? existing?.control ?? 'NONE';
      const finalSide =
        side ??
        (existing && existing.kind === kind
          ? existing.normalSide
          : kind === 'ASSET' || kind === 'EXPENSE'
            ? 'DEBIT'
            : 'CREDIT');
      if (existing?.inUse && kind !== null) {
        if (existing.control !== finalControl) check.error('control', 'IN_USE');
        if (existing.kind !== kind) check.error('kind', 'IN_USE');
        else if (existing.normalSide !== finalSide) check.error('side', 'IN_USE');
      }
      if (row.key !== null) {
        const required = facts.keys.get(row.key);
        if (required === undefined) check.error('role', 'NOT_FOUND', { value: row.role ?? '' });
        else if (required !== 'NONE' && required !== finalControl) {
          check.error('role', 'MISMATCH', { value: required });
        }
      }
      if (!check.ok || row.code === null || row.name === null || kind === null) {
        return check.result<FinChartImportRow>(null, null, null);
      }
      const plan: FinChartImportRow = {
        code: row.code,
        name: row.name,
        kind,
        normalSide: side,
        control,
        group: row.groupCode === null ? null : { code: row.groupCode, name: row.groupName },
        key: row.key,
      };
      const group = row.groupCode === null ? undefined : facts.groups.get(row.groupCode);
      const changed =
        !existing ||
        existing.name !== row.name ||
        existing.kind !== kind ||
        existing.normalSide !== finalSide ||
        existing.control !== finalControl ||
        (row.groupCode !== null &&
          (group === undefined ||
            group.id !== existing.groupId ||
            (row.groupName !== null && row.groupName !== group.name))) ||
        (row.key !== null && facts.rules.get(row.key) !== existing.id);
      return check.result(
        !existing ? 'CREATE' : changed ? 'UPDATE' : 'UNCHANGED',
        existing?.id ?? null,
        plan,
      );
    });
  }

  async apply(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CheckedRow<FinChartImportRow>[],
    progress: Progress,
  ): Promise<AppliedRow[]> {
    const planned = rows.flatMap((row) => (row.plan ? [{ rowNo: row.rowNo, plan: row.plan }] : []));
    const applied = await this.finance.importChartInTx(
      tx,
      actor,
      planned.map((row) => row.plan),
    );
    await progress(planned.length);
    return planned.map((row, index) => {
      const done = applied[index];
      if (!done) throw new Error('a chart row was not applied');
      return { rowNo: row.rowNo, action: done.action, targetId: done.accountId, changes: done };
    });
  }

  async revert(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CommittedRow[],
  ): Promise<void> {
    const applied = [...rows]
      .sort((a, b) => a.rowNo - b.rowNo)
      .flatMap((row) => (row.changes ? [row.changes as FinChartImportApplied] : []));
    await this.finance.revertChartInTx(tx, actor, applied);
  }
}
