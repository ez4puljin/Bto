import { Injectable } from '@nestjs/common';
import { classifyBarcode } from '@tugeel/shared/gtin';
import type { IssueImportOptions } from '@tugeel/shared/imports';
import { type IssueRecipientKind, MAX_ISSUE_LINES } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { businessDate, isIsoDate } from '@tugeel/shared/time';
import { isValidEnteredQty } from '@tugeel/shared/units';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import { CatalogImportService, type ImportProduct } from '../../catalog';
import { type Actor, UserNamesService } from '../../identity';
import { GoodsIssuesService, IssueExpenseTypesService } from '../../inventory';
import { CustomersService, SuppliersService } from '../../partners';
import {
  type AppliedRow,
  type CheckedRow,
  type CommittedRow,
  type Importer,
  type ImportJobRow,
  type Progress,
  RowCheck,
  type SourceRow,
} from './importer';
import { decimalCell, keyOf } from './lookups';

const QTY_MAX = new Decimal('99999999999');

interface Recipient {
  kind: IssueRecipientKind;
  userId?: number;
  customerId?: number;
  supplierId?: number;
  name?: string;
}

/** One line of a draft issue (JSON: stored as the row's plan). */
export interface IssueRowPlan {
  /** The issue the row belongs to: date, expense type and recipient. */
  group: string;
  date: string;
  expenseTypeId: number;
  recipient: Recipient;
  note: string | null;
  productUnitId: number;
  qty: string;
}

interface IssueChanges {
  issueId: number;
}

export function issueOptionsOf(job: Pick<ImportJobRow, 'options'>): IssueImportOptions {
  const value = job.options as Partial<IssueImportOptions> | null;
  if (!value || typeof value.warehouseId !== 'number') {
    throw new Error('an issues import without its options');
  }
  return { warehouseId: value.warehouseId };
}

/**
 * Goods issues from a sheet (ADR-0081 #7): rows of one date, expense type and recipient make one
 * DRAFT issue in the warehouse chosen for the import. The recipient is a customer or a supplier by
 * code or name, else a staff member by full name, else the name as written; each line leaves the
 * product's fixed shelf (or the fullest). Nothing is posted: the warehouse checks and posts each
 * issue. The revert cancels the drafts while every one of them is untouched.
 */
@Injectable()
export class IssuesImporter implements Importer<IssueRowPlan> {
  readonly kind = 'ISSUES' as const;

  constructor(
    private readonly catalog: CatalogImportService,
    private readonly customers: CustomersService,
    private readonly suppliers: SuppliersService,
    private readonly users: UserNamesService,
    private readonly types: IssueExpenseTypesService,
    private readonly issues: GoodsIssuesService,
  ) {}

  async validate(
    rows: readonly SourceRow[],
    executor: Db | Tx,
    job?: ImportJobRow,
  ): Promise<CheckedRow<IssueRowPlan>[]> {
    if (!job) throw new Error('an issues import is validated with its job');
    issueOptionsOf(job);
    const reference = await this.catalog.reference(executor);
    const uomById = new Map(reference.uoms.map((uom) => [uom.id, uom]));
    const today = businessDate();
    const types = await this.types.byNameKeys(executor);

    const parsed = rows.map((row) => {
      const check = new RowCheck(row);
      return {
        check,
        date: check.text('date', true),
        expenseType: check.text('expenseType', true),
        recipient: check.text('recipient', true),
        sku: check.text('sku'),
        barcode: check.text('barcode'),
        unit: check.text('unit'),
        qty: check.text('qty', true),
        note: check.text('note'),
      };
    });

    // Recipients: customer or supplier by code, then by name, then a staff member by full name.
    const texts = [...new Set(parsed.flatMap((row) => (row.recipient ? [row.recipient] : [])))];
    const customerByCode = new Map(
      (await this.customers.findByCodes(texts, executor)).map((c) => [c.code, c]),
    );
    const supplierByCode = new Map(
      (await this.suppliers.findByCodes(texts, executor)).map((s) => [s.code, s]),
    );
    const supplierByName = new Map(
      (await this.suppliers.findByNames(texts, executor)).map((s) => [keyOf(s.name), s]),
    );
    const customersByName = await this.customers.findActiveByNames(texts, executor);
    const recipients = new Map<string, Recipient>();
    for (const text of texts) {
      const customer = customerByCode.get(text.trim());
      const supplier = supplierByCode.get(text.trim()) ?? supplierByName.get(keyOf(text));
      if (customer?.status === 'ACTIVE') {
        recipients.set(text, { kind: 'CUSTOMER', customerId: customer.id });
      } else if (supplier?.status === 'ACTIVE') {
        recipients.set(text, { kind: 'SUPPLIER', supplierId: supplier.id });
      } else {
        const named = customersByName.filter((row) => keyOf(row.name) === keyOf(text));
        const staff = (await this.users.search(text, 5)).filter(
          (user) => keyOf(user.fullName) === keyOf(text),
        );
        if (named.length === 1 && named[0]) {
          recipients.set(text, { kind: 'CUSTOMER', customerId: named[0].id });
        } else if (staff.length === 1 && staff[0]) {
          recipients.set(text, { kind: 'USER', userId: staff[0].id });
        } else {
          recipients.set(text, { kind: 'OTHER', name: text.slice(0, 200) });
        }
      }
    }

    // Products by code, and by barcode through their owners (a box barcode names the box unit).
    const keyOfBarcode = new Map<string, string>();
    for (const row of parsed) {
      if (!row.barcode) continue;
      const classified = classifyBarcode(row.barcode);
      if (classified.ok) keyOfBarcode.set(row.barcode, classified.value.lookupKey);
    }
    const owners = await this.catalog.barcodeOwners([...keyOfBarcode.values()], executor);
    const products = new Map(
      (
        await this.catalog.productsBySku(
          [
            ...parsed.flatMap((row) => (row.sku ? [row.sku] : [])),
            ...[...owners.values()].map((owner) => owner.sku),
          ],
          executor,
        )
      ).map((product) => [product.sku, product]),
    );

    const planned = parsed.map((row) => {
      const { check } = row;
      let date: string | null = null;
      if (row.date !== null) {
        if (!isIsoDate(row.date)) check.error('date', 'FORMAT');
        else if (row.date > today) check.error('date', 'OUT_OF_RANGE');
        else date = row.date;
      }
      let expenseTypeId: number | null = null;
      if (row.expenseType !== null) {
        const type = types.get(keyOf(row.expenseType));
        if (!type) check.error('expenseType', 'NOT_FOUND', { value: row.expenseType });
        else if (!type.active) check.error('expenseType', 'NOT_ALLOWED');
        else expenseTypeId = type.id;
      }
      const recipient = row.recipient ? recipients.get(row.recipient) : undefined;
      if (row.note !== null && row.note.length > 500) check.error('note', 'TOO_LONG');

      let product: ImportProduct | undefined;
      let barcodeUnitId: number | undefined;
      if (row.sku !== null) {
        product = products.get(row.sku);
        if (!product) check.error('sku', 'NOT_FOUND', { value: row.sku });
      }
      if (row.barcode !== null) {
        const key = keyOfBarcode.get(row.barcode);
        const owner = key ? owners.get(key) : undefined;
        if (!key) check.error('barcode', 'FORMAT');
        else if (!owner) check.error('barcode', 'NOT_FOUND', { value: row.barcode });
        else {
          const owned = products.get(owner.sku);
          if (product && owned && owned.id !== product.id) check.error('barcode', 'MISMATCH');
          product = product ?? owned;
          barcodeUnitId = owned?.units.find((unit) =>
            unit.barcodes.some((barcode) => barcode.lookupKey === key),
          )?.id;
        }
      }
      if (row.sku === null && row.barcode === null) check.error('sku', 'REQUIRED');

      const base = product?.units.find((unit) => unit.isBase);
      let unit = product?.units.find((candidate) => candidate.id === barcodeUnitId) ?? base;
      if (product && row.unit !== null) {
        const key = keyOf(row.unit);
        const code = row.unit.trim().toUpperCase();
        unit = product.units.find((candidate) => {
          const uom = uomById.get(candidate.uomId);
          return uom !== undefined && (uom.nameKey === key || uom.code === code);
        });
        if (!unit) check.error('unit', 'NOT_FOUND', { value: row.unit });
      }
      let qty: Decimal | null = null;
      if (row.qty !== null) {
        const read = decimalCell(row.qty, 3, QTY_MAX);
        if (!read.ok) check.error('qty', read.code);
        else if (read.value.isZero()) check.error('qty', 'NOT_POSITIVE');
        else qty = read.value;
      }
      if (qty && unit && base) {
        const fractional = uomById.get(base.uomId)?.fractional ?? false;
        if (!isValidEnteredQty(qty, unit.factorToBase, fractional)) check.error('qty', 'INEXACT');
      }

      const group =
        date !== null && expenseTypeId !== null && row.recipient !== null
          ? `${date}|${expenseTypeId}|${keyOf(row.recipient)}`
          : null;
      return {
        check,
        group,
        plan:
          group && date && expenseTypeId !== null && recipient && unit && qty
            ? {
                group,
                date,
                expenseTypeId,
                recipient,
                note: row.note,
                productUnitId: unit.id,
                qty: qty.toFixed(),
              }
            : null,
      };
    });

    const perGroup = new Map<string, number>();
    for (const entry of planned) {
      if (entry.group === null) continue;
      const count = (perGroup.get(entry.group) ?? 0) + 1;
      perGroup.set(entry.group, count);
      if (count > MAX_ISSUE_LINES) {
        entry.check.error(null, 'TOO_MANY_LINES', { max: MAX_ISSUE_LINES });
      }
    }
    return planned.map((entry) => entry.check.result('CREATE', null, entry.plan));
  }

  async apply(
    tx: Tx,
    actor: Actor,
    job: ImportJobRow,
    rows: readonly CheckedRow<IssueRowPlan>[],
    progress: Progress,
  ): Promise<AppliedRow[]> {
    const { warehouseId } = issueOptionsOf(job);
    const groups = new Map<string, CheckedRow<IssueRowPlan>[]>();
    for (const row of rows) {
      if (!row.plan) continue;
      groups.set(row.plan.group, [...(groups.get(row.plan.group) ?? []), row]);
    }
    const applied: AppliedRow[] = [];
    let done = 0;
    for (const groupRows of groups.values()) {
      const [first] = groupRows;
      if (!first?.plan) continue;
      const issueId = await this.issues.createInTx(tx, actor, {
        warehouseId,
        issuedOn: first.plan.date,
        expenseTypeId: first.plan.expenseTypeId,
        recipient: first.plan.recipient,
        note: groupRows.find((row) => row.plan?.note)?.plan?.note ?? null,
        lines: groupRows.flatMap((row) =>
          row.plan
            ? [{ productUnitId: row.plan.productUnitId, enteredQty: new Decimal(row.plan.qty) }]
            : [],
        ),
      });
      const changes: IssueChanges = { issueId };
      for (const row of groupRows) {
        applied.push({ rowNo: row.rowNo, action: 'CREATE', targetId: issueId, changes });
      }
      done += groupRows.length;
      await progress(done);
    }
    return applied;
  }

  async revert(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CommittedRow[],
  ): Promise<void> {
    const ids = [
      ...new Set(
        rows.flatMap((row) => {
          const changes = row.changes as IssueChanges | null;
          return changes?.issueId ? [changes.issueId] : [];
        }),
      ),
    ];
    const states = await this.issues.cancelDraftsInTx(tx, actor, ids);
    const blocked = states.find((state) => state.status !== 'DRAFT' || state.touched);
    if (blocked) {
      throw new AppError('IMPORT_REVERT_BLOCKED', 'an issue of the import was posted or changed', {
        reason: blocked.status === 'DRAFT' ? 'CHANGED' : blocked.status,
        issueId: blocked.id,
      });
    }
  }

  appliedNotes(rows: readonly AppliedRow[]): Record<string, number> {
    return { issues: new Set(rows.map((row) => row.targetId)).size };
  }
}
