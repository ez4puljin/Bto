import { Check, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ListTable } from '@/components/list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatTugrik } from '@/lib/money';
import type { IssueDetail, IssueLine } from './api';
import { hasCosts, isDamageCharge, postedWarehouses } from './issue-helpers';

/**
 * The lines table: №, product, warehouse, unit, shelf, quantity, the sale price and charge of a
 * «Хүнд тооцох» issue, then the costs when the API sent them.
 */
export function LinesTable(props: {
  detail: IssueDetail | null;
  lines: readonly IssueLine[];
  actions: boolean;
  cells: (
    line: IssueLine,
    name: string,
  ) => { warehouse?: ReactNode; qty: ReactNode; actions?: ReactNode };
}) {
  const { t } = useTranslation();
  const none = t('common.none');
  const costs = hasCosts(props.detail);
  const sale = isDamageCharge(props.detail);
  const frozen = postedWarehouses(props.detail);
  // One entry per cell, under the same conditions as the header cells (ADR-0119). While the lines
  // are edited the warehouse is a select and the quantity a box.
  const columns: ColumnSpec[] = [
    { key: 'lineNo', kind: 'count', width: 3 },
    { key: 'product', kind: 'text', weight: 3, min: 14 },
    { key: 'warehouse', kind: 'text', weight: 1, min: props.actions ? 10.5 : 8 },
    { key: 'unit', kind: 'text', weight: 1, min: 4 },
    // The shelf, or «Нярав батлахад тогтоно» until the keeper confirms.
    { key: 'bin', kind: 'code', width: 11 },
    { key: 'qty', kind: 'qty', width: props.actions ? 8 : 6.5 },
    ...(sale
      ? [
          { key: 'salePrice', kind: 'money' } as const,
          { key: 'saleAmount', kind: 'money' } as const,
        ]
      : []),
    ...(costs
      ? [{ key: 'unitCost', kind: 'money' } as const, { key: 'amount', kind: 'money' } as const]
      : []),
    ...(props.actions ? [{ key: 'actions', kind: 'actions', actions: 1 } as const] : []),
  ];
  return (
    <ListTable columns={columns}>
      <TableHeader>
        <TableRow>
          <TableHead className="text-right">{t('inventory.receipt.form.lineNo')}</TableHead>
          <TableHead>{t('inventory.product')}</TableHead>
          <TableHead>{t('inventory.issues.lineWarehouse')}</TableHead>
          <TableHead>{t('inventory.unit')}</TableHead>
          <TableHead>{t('inventory.bin')}</TableHead>
          <TableHead className="text-right">{t('inventory.qty')}</TableHead>
          {sale ? (
            <>
              <TableHead className="text-right">{t('inventory.issues.salePrice')}</TableHead>
              <TableHead className="text-right">{t('inventory.issues.saleAmount')}</TableHead>
            </>
          ) : null}
          {costs ? (
            <>
              <TableHead className="text-right">{t('inventory.issues.unitCost')}</TableHead>
              <TableHead className="text-right">{t('inventory.issues.amount')}</TableHead>
            </>
          ) : null}
          {props.actions ? (
            <TableHead>
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.lines.map((line, index) => {
          const cells = props.cells(
            line,
            t('inventory.productUnit', { product: line.productName, unit: line.unitName }),
          );
          const locked = frozen.has(line.warehouseId);
          return (
            <TableRow key={line.id} data-state={locked ? 'locked' : undefined}>
              <TableCell className="text-right font-mono text-muted-foreground">
                {index + 1}
              </TableCell>
              <TableCell className="whitespace-normal">
                {line.productName}{' '}
                <span className="font-mono text-[13px] text-muted-foreground">
                  {line.productSku}
                </span>
              </TableCell>
              <TableCell>
                {cells.warehouse ?? (
                  <span className="flex items-center gap-1">
                    {line.warehouseName}
                    {locked && props.actions ? (
                      <Lock
                        className="size-3.5 text-muted-foreground"
                        aria-label={t('inventory.issues.lockedLine')}
                      />
                    ) : null}
                  </span>
                )}
              </TableCell>
              <TableCell>{line.unitName}</TableCell>
              <TableCell>
                {line.binCode ? (
                  <span className="font-mono">{line.binCode}</span>
                ) : (
                  <span className="text-[13px] text-muted-foreground">
                    {t('inventory.issues.binPending')}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">{cells.qty}</TableCell>
              {sale ? (
                <>
                  <TableCell className="text-right font-mono">
                    {line.saleUnitPrice ? formatTugrik(line.saleUnitPrice) : none}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {line.saleAmount ? formatTugrik(line.saleAmount) : none}
                  </TableCell>
                </>
              ) : null}
              {costs ? (
                <>
                  <TableCell className="text-right font-mono">
                    {line.unitCost ? formatTugrik(line.unitCost) : none}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {line.amount ? formatTugrik(line.amount) : none}
                  </TableCell>
                </>
              ) : null}
              {props.actions ? cells.actions : null}
            </TableRow>
          );
        })}
      </TableBody>
    </ListTable>
  );
}

/** «Нийт өртөг» for cost holders once a part left; «Нийт тооцох дүн» for a «Хүнд тооцох» issue. */
export function IssueTotals({ detail }: { detail: IssueDetail }) {
  const { t } = useTranslation();
  const sale = isDamageCharge(detail);
  return (
    <div className="flex flex-col items-end gap-1 text-sm">
      {sale ? (
        detail.saleTotal ? (
          <p>
            {t('inventory.issues.saleTotal')}:{' '}
            <span className="font-mono font-medium">{formatTugrik(detail.saleTotal)}</span>
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t('inventory.issues.salePending')}</p>
        )
      ) : null}
      {hasCosts(detail) ? (
        detail.total ? (
          <p>
            {t('inventory.issues.total')}:{' '}
            <span className="font-mono font-medium">{formatTugrik(detail.total)}</span>
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t('inventory.issues.costHint')}</p>
        )
      ) : null}
    </div>
  );
}

/**
 * Each warehouse's part (ADR-0117 #2): confirmed by whom and when, how many lines its keeper ticked
 * while the issue is sent, or left unchanged by a correction. Nothing is withdrawn.
 */
export function IssueConfirmations({ detail }: { detail: IssueDetail }) {
  const { t } = useTranslation();
  if (detail.warehouses.length === 0) return null;
  if (detail.status === 'DRAFT' && detail.confirmations.length === 0) return null;
  const rows = new Map(detail.confirmations.map((row) => [row.warehouseId, row]));
  return (
    <ul
      className="flex flex-wrap gap-2 text-[13px]"
      aria-label={t('inventory.issues.confirmations.title')}
    >
      {detail.warehouses.map((warehouse) => {
        const row = rows.get(warehouse.warehouseId);
        if (row?.unchanged) {
          return (
            <li key={warehouse.warehouseId}>
              <Badge variant="outline">
                {t('inventory.issues.confirmations.unchanged', {
                  warehouse: warehouse.warehouseName,
                })}
              </Badge>
            </li>
          );
        }
        if (row) {
          return (
            <li key={warehouse.warehouseId}>
              <Badge variant="success" title={formatUbDateTime(Date.parse(row.confirmedAt))}>
                <Check />
                {t('inventory.issues.confirmations.done', {
                  warehouse: warehouse.warehouseName,
                  by: row.confirmedBy ?? '',
                })}
              </Badge>
            </li>
          );
        }
        return (
          <li key={warehouse.warehouseId}>
            <Badge variant="secondary">
              {detail.status === 'SENT'
                ? t('inventory.issues.confirmations.checked', {
                    warehouse: warehouse.warehouseName,
                    checked: warehouse.checkedCount,
                    total: warehouse.lineCount,
                  })
                : t('inventory.issues.confirmations.waiting', {
                    warehouse: warehouse.warehouseName,
                  })}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

/** The keeper's note on an issue sent back (ADR-0117 #1). */
export function ReturnedBanner({ detail }: { detail: IssueDetail }) {
  const { t } = useTranslation();
  if (detail.status !== 'RETURNED' || !detail.returnNote) return null;
  return (
    <Alert className="border-transparent bg-warning-soft text-warning">
      <AlertTitle>{t('inventory.issues.returnedTitle')}</AlertTitle>
      <AlertDescription>
        {t('inventory.issues.returnedBanner', {
          by: detail.returnedBy ?? '',
          note: detail.returnNote,
        })}
      </AlertDescription>
    </Alert>
  );
}

/** The links between a correction and the issue it corrects (ADR-0117 #5). */
export function CorrectionLinks({ detail }: { detail: IssueDetail }) {
  const { t } = useTranslation();
  if (detail.correctsIssueId === null && detail.correctedByIssueId === null) return null;
  return (
    <p className="text-sm">
      {detail.correctsIssueId !== null ? (
        <Link
          className="text-link underline-offset-4 hover:underline"
          to={`/inventory/issues/${detail.correctsIssueId}`}
        >
          {t('inventory.issues.correctsOf', { number: detail.correctsIssueNumber ?? '' })}
        </Link>
      ) : null}
      {detail.correctedByIssueId !== null ? (
        <Link
          className="text-link underline-offset-4 hover:underline"
          to={`/inventory/issues/${detail.correctedByIssueId}`}
        >
          {t('inventory.issues.correctedBy', { number: detail.correctedByIssueNumber ?? '' })}
        </Link>
      ) : null}
    </p>
  );
}
