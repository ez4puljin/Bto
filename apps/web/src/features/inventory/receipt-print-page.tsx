import { BINS_SOON } from '@/lib/features';
import { Decimal } from '@tugeel/shared/money';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { PrintFrame } from '@/components/print-frame';
import { useCompanyName } from '@/features/company/api';
import { formatMnt, formatQty } from '@/lib/money';
import { cn } from '@/lib/utils';
import { type ReceiptDetail, type ReceiptLine, useReceipt } from './api';

type Kind = 'document' | 'warehouse';

const isKind = (value: string | undefined): value is Kind =>
  value === 'document' || value === 'warehouse';

/**
 * A goods receipt on paper (`/inventory/receipts/:id/print/:kind`, ADR-0099 #6), A4 from the
 * browser (no PDF, ADR-0058): `document` — the delivery note as received, with its prices for cost
 * holders, the discount, VAT, the total weight and the signatures; `warehouse` — a list per
 * warehouse (product, unit, quantity, shelf), each on its own sheet, for the people who put the
 * goods away.
 */
export function ReceiptPrintPage() {
  const { t } = useTranslation();
  const params = useParams();
  const id = Number.parseInt(params.id ?? '', 10);
  const kind: Kind = isKind(params.kind) ? params.kind : 'document';
  const receipt = useReceipt(id, id > 0);
  const number = receipt.data
    ? (receipt.data.number ?? t('inventory.draftNo', { id: receipt.data.id }))
    : '';
  return (
    <PrintFrame
      ready={receipt.data !== undefined}
      error={receipt.error}
      title={
        receipt.data
          ? `${t(kind === 'document' ? 'inventory.receipt.print.documentTitle' : 'inventory.receipt.print.warehouseTitle')} ${number}`
          : ''
      }
    >
      {() =>
        receipt.data ? (
          kind === 'document' ? (
            <DocumentSheet detail={receipt.data} number={number} />
          ) : (
            <WarehouseSheets detail={receipt.data} number={number} />
          )
        ) : null
      }
    </PrintFrame>
  );
}

/** The number, date, supplier and note number above both papers. */
function Heading(props: {
  detail: ReceiptDetail;
  number: string;
  title: string;
  extra?: [string, string][];
}) {
  const { t } = useTranslation();
  const companyName = useCompanyName();
  const { detail } = props;
  const none = t('common.none');
  const rows: [string, string][] = [
    [t('inventory.receipt.print.number'), props.number],
    [t('inventory.receipt.print.date'), detail.supplierDocDate ?? detail.effectiveDate ?? none],
    [t('inventory.receipt.print.supplier'), `${detail.supplierName} · ${detail.supplierCode}`],
    [t('inventory.receipt.print.supplierDoc'), detail.supplierDocNo ?? none],
    ...(props.extra ?? []),
  ];
  return (
    <header className="flex flex-col gap-2 border-b border-foreground pb-3">
      <p className="font-semibold">{companyName}</p>
      <h1 className="text-center text-lg font-bold">{props.title}</h1>
      {detail.status === 'DRAFT' ? (
        <p className="text-center font-semibold tracking-widest">
          {t('inventory.receipt.print.draft')}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="text-muted-foreground print:text-foreground">{label}:</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

function Signatures(props: { labels: string[] }) {
  const { t } = useTranslation();
  return (
    <footer className="mt-10 grid grid-cols-3 gap-6">
      {props.labels.map((label) => (
        <div key={label} className="flex flex-col gap-1">
          <span>{label}:</span>
          <span className="mt-6 border-b border-foreground" />
          <span className="text-center text-xs">{t('inventory.receipt.print.signature')}</span>
        </div>
      ))}
    </footer>
  );
}

const lineWeight = (line: ReceiptLine) =>
  line.weightKg ? new Decimal(line.weightKg).times(line.qtyBase) : null;

function DocumentSheet({ detail, number }: { detail: ReceiptDetail; number: string }) {
  const { t } = useTranslation();
  const canCost = useHasPermission('inventory.costs.manage');
  const prices = canCost && detail.totals !== undefined;
  const totals = detail.totals;
  const weight = new Decimal(detail.weightKg);
  const cell = 'border border-foreground/60 px-1.5 py-1';
  return (
    <article className="flex flex-col gap-4">
      <Heading
        detail={detail}
        number={number}
        title={t('inventory.receipt.print.documentTitle')}
        extra={[
          [
            t('inventory.receipt.print.warehouseName'),
            detail.warehouses.map((warehouse) => warehouse.name).join(', '),
          ],
          [
            t('inventory.receipt.print.payment'),
            t(`inventory.receipt.paymentMethods.${detail.paymentMethod}`),
          ],
        ]}
      />
      <table className="w-full border-collapse text-[0.75rem]">
        <thead>
          <tr className="text-left">
            <th className={cell}>{t('inventory.receipt.form.lineNo')}</th>
            <th className={cell}>{t('inventory.sku')}</th>
            <th className={cell}>{t('inventory.product')}</th>
            <th className={cell}>{t('inventory.unit')}</th>
            <th className={cn(cell, 'text-right')}>{t('inventory.qty')}</th>
            {prices ? (
              <>
                <th className={cn(cell, 'text-right')}>{t('inventory.receipt.form.unitPrice')}</th>
                <th className={cn(cell, 'text-right')}>{t('inventory.receipt.form.amount')}</th>
              </>
            ) : null}
            <th className={cn(cell, 'text-right')}>{t('inventory.receipt.print.totalWeight')}</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((line, index) => {
            const kg = lineWeight(line);
            return (
              <tr key={line.id}>
                <td className={cn(cell, 'text-right')}>{index + 1}</td>
                <td className={cn(cell, 'font-mono')}>{line.productSku}</td>
                <td className={cell}>{line.productName}</td>
                <td className={cell}>{line.unitName}</td>
                <td className={cn(cell, 'text-right font-mono')}>{formatQty(line.enteredQty)}</td>
                {prices ? (
                  <>
                    <td className={cn(cell, 'text-right font-mono')}>
                      {line.freeGoods
                        ? t('inventory.receipt.print.free')
                        : line.docUnitPrice
                          ? formatMnt(line.docUnitPrice)
                          : line.docAmount
                            ? formatMnt(
                                new Decimal(line.docAmount)
                                  .dividedBy(line.enteredQty)
                                  .toDecimalPlaces(2)
                                  .toString(),
                              )
                            : ''}
                    </td>
                    <td className={cn(cell, 'text-right font-mono')}>
                      {line.docAmount ? formatMnt(line.docAmount) : ''}
                    </td>
                  </>
                ) : null}
                <td className={cn(cell, 'text-right font-mono')}>
                  {kg ? formatQty(kg.toDecimalPlaces(2).toString()) : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dl className="ml-auto grid w-72 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
        {prices && totals ? (
          <>
            <dt>{t('inventory.receipt.form.docTotal')}</dt>
            <dd className="text-right font-mono">{formatMnt(totals.docTotal)}</dd>
            {new Decimal(totals.discountTotal).gt(0) ? (
              <>
                {(detail.discounts ?? []).map((discount) => (
                  <Fragment key={discount.id}>
                    <dt>
                      {t(`inventory.receipt.discounts.kinds.${discount.kind}`)}
                      {discount.pct ? ` (${new Decimal(discount.pct).toString()}%)` : ''}
                    </dt>
                    <dd className="text-right font-mono">
                      {discount.total ? `-${formatMnt(discount.total)}` : ''}
                    </dd>
                  </Fragment>
                ))}
                <dt className="font-semibold">{t('inventory.receipt.form.netTotal')}</dt>
                <dd className="text-right font-mono font-semibold">{formatMnt(totals.netTotal)}</dd>
              </>
            ) : null}
            {new Decimal(totals.vatTotal).gt(0) ? (
              <>
                <dt>{t('inventory.receipt.form.vatTotal')}</dt>
                <dd className="text-right font-mono">{formatMnt(totals.vatTotal)}</dd>
              </>
            ) : null}
          </>
        ) : null}
        <dt>{t('inventory.receipt.print.totalWeight')}</dt>
        <dd className="text-right font-mono">
          {t('inventory.receipt.form.weight', {
            kg: formatQty(weight.toDecimalPlaces(2).toString()),
          })}
        </dd>
      </dl>
      {detail.weightMissing > 0 ? (
        <p className="text-xs">
          {t('inventory.receipt.form.weightMissing', { count: detail.weightMissing })}
        </p>
      ) : null}
      <Signatures
        labels={[
          t('inventory.receipt.print.handedBy'),
          t('inventory.receipt.print.receivedBy'),
          t('inventory.receipt.print.accountant'),
        ]}
      />
    </article>
  );
}

/** One sheet per warehouse: what goes onto which shelf, a box to tick per line. */
function WarehouseSheets({ detail, number }: { detail: ReceiptDetail; number: string }) {
  const { t } = useTranslation();
  const cell = 'border border-foreground/60 px-1.5 py-1';
  return (
    <>
      {detail.warehouses.map((warehouse, sheet) => {
        const lines = detail.lines
          .filter((line) => line.warehouseId === warehouse.id)
          .sort(
            (a, b) =>
              a.binCode.localeCompare(b.binCode) || a.productName.localeCompare(b.productName),
          );
        const total = lines.reduce((sum, line) => sum.plus(line.qtyBase), new Decimal(0));
        return (
          <article
            key={warehouse.id}
            className={cn(
              'flex flex-col gap-4',
              sheet < detail.warehouses.length - 1 ? 'mb-10 break-after-page' : undefined,
            )}
          >
            <Heading
              detail={detail}
              number={number}
              title={t('inventory.receipt.print.warehouseTitle')}
              extra={[[t('inventory.receipt.print.warehouseName'), warehouse.name]]}
            />
            <table className="w-full border-collapse text-[0.75rem]">
              <thead>
                <tr className="text-left">
                  <th className={cell}>{t('inventory.receipt.form.lineNo')}</th>
                  {BINS_SOON ? null : <th className={cell}>{t('inventory.bin')}</th>}
                  <th className={cell}>{t('inventory.sku')}</th>
                  <th className={cell}>{t('inventory.product')}</th>
                  <th className={cell}>{t('inventory.unit')}</th>
                  <th className={cn(cell, 'text-right')}>{t('inventory.qty')}</th>
                  <th className={cn(cell, 'w-16')}>{t('inventory.receipt.print.checked')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.id}>
                    <td className={cn(cell, 'text-right')}>{index + 1}</td>
                    {BINS_SOON ? null : (
                      <td className={cn(cell, 'font-mono font-semibold')}>{line.binCode}</td>
                    )}
                    <td className={cn(cell, 'font-mono')}>{line.productSku}</td>
                    <td className={cell}>{line.productName}</td>
                    <td className={cell}>{line.unitName}</td>
                    <td className={cn(cell, 'text-right font-mono')}>
                      {formatQty(line.enteredQty)}
                    </td>
                    <td className={cell} />
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-right">
              {t('inventory.receipt.print.totalQty')}:{' '}
              <span className="font-mono font-semibold">{formatQty(total.toString())}</span>
            </p>
            <Signatures
              labels={[
                t('inventory.receipt.print.handedBy'),
                t('inventory.receipt.print.receivedBy'),
              ]}
            />
          </article>
        );
      })}
    </>
  );
}
