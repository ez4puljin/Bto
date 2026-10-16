import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ProblemAlert } from '@/components/problem-alert';
import { FactChips, PanelSection, RecordSheet, TotalsGrid } from '@/components/record-sheet';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { printFormatParam, usePrintFormat } from '@/features/sales/print-format';
import { PrintFormatToggle } from '@/features/sales/print-format-toggle';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { type SaleDetail, useSale } from './api';
import { EbarimtBadge, SaleKindBadge } from './badges';

/** One sale or return in the panel (`?sale=`): facts, totals, lines, tenders, shortfalls, returns. */
export function SalePanel({ saleId, onClose }: { saleId: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const sale = useSale(saleId);
  const detail = sale.data;
  return (
    <RecordSheet
      open={saleId !== null}
      onClose={onClose}
      title={
        detail
          ? t('pos.sales.panelTitle', {
              kind: t(`pos.saleKinds.${detail.kind}`),
              number: detail.number,
            })
          : ''
      }
      description={
        detail
          ? `${formatUbDateTime(Date.parse(detail.soldAt))} · ${detail.tillCode} · ${detail.cashierName ?? ''}`
          : ''
      }
      badges={
        detail ? (
          <>
            <SaleKindBadge kind={detail.kind} />
            <EbarimtBadge status={detail.ebarimtStatus} />
          </>
        ) : null
      }
      actions={detail ? <PanelActions sale={detail} /> : null}
    >
      <ProblemAlert problem={problemFromError(sale.error)} />
      {detail ? <SaleBody sale={detail} /> : null}
    </RecordSheet>
  );
}

function PanelActions({ sale }: { sale: SaleDetail }) {
  const { t } = useTranslation();
  const [format, choose] = usePrintFormat();
  return (
    <>
      <PrintFormatToggle value={format} onChange={choose} />
      <Button asChild variant="outline" size="sm">
        <Link to={`/pos/sales/${sale.id}/print?format=${printFormatParam(format)}`} target="_blank">
          <Printer />
          {t('pos.actions.printCopy')}
        </Link>
      </Button>
    </>
  );
}

function SaleBody({ sale }: { sale: SaleDetail }) {
  const { t } = useTranslation();
  const facts = [
    {
      label: t('pos.fields.shift'),
      value: (
        <Link
          className="font-mono text-link underline-offset-2 hover:underline"
          to={`/pos/shifts?shift=${sale.shiftId}`}
        >
          {sale.shiftNumber}
        </Link>
      ),
    },
    { label: t('pos.fields.receiptType'), value: t(`pos.receiptTypes.${sale.receiptType}`) },
    ...(sale.customerTin
      ? [
          {
            label: t('pos.fields.customerTin'),
            value: `${sale.customerTin}${sale.customerName ? ` · ${sale.customerName}` : ''}`,
          },
        ]
      : []),
    ...(sale.approvedByName
      ? [{ label: t('pos.fields.approvedBy'), value: sale.approvedByName }]
      : []),
    ...(sale.refundsSaleId
      ? [
          {
            label: t('pos.fields.refunds'),
            value: (
              <Link
                className="font-mono text-link underline-offset-2 hover:underline"
                to={`/pos/sales?sale=${sale.refundsSaleId}`}
              >
                {sale.refundsSaleNumber ?? String(sale.refundsSaleId)}
              </Link>
            ),
          },
        ]
      : []),
    { label: t('pos.fields.ddtd'), value: sale.ddtd ?? t('pos.sales.noReceipt') },
  ];
  return (
    <div className="flex flex-col gap-5">
      <FactChips facts={facts} />
      <TotalsGrid
        items={[
          [t('pos.fields.subtotal'), formatMnt(sale.subtotal)],
          [t('pos.fields.discount'), formatMnt(sale.discountTotal)],
          [t('pos.fields.total'), formatMnt(sale.total)],
          [t('pos.fields.vat'), formatMnt(sale.vatTotal)],
        ]}
      />
      <PanelSection title={t('pos.sales.sections.lines')}>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('pos.fields.product')}</TableHead>
                <TableHead className="text-right">{t('pos.fields.qty')}</TableHead>
                <TableHead>{t('pos.fields.unit')}</TableHead>
                <TableHead className="text-right">{t('pos.fields.unitPrice')}</TableHead>
                <TableHead className="text-right">{t('pos.fields.discount')}</TableHead>
                <TableHead className="text-right">{t('pos.fields.vat')}</TableHead>
                <TableHead className="text-right">{t('pos.fields.lineTotal')}</TableHead>
                {sale.kind === 'SALE' ? (
                  <TableHead className="text-right">{t('pos.fields.returned')}</TableHead>
                ) : (
                  <TableHead>{t('pos.fields.damaged')}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sale.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
                    {line.productName}
                  </TableCell>
                  <TableCell className="text-right font-mono">{line.qty}</TableCell>
                  <TableCell>{line.uomName}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMnt(line.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMnt(line.discountAmount)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMnt(line.vatAmount)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatMnt(line.total)}</TableCell>
                  {sale.kind === 'SALE' ? (
                    <TableCell className="text-right font-mono">{line.returnedBase}</TableCell>
                  ) : (
                    <TableCell>{line.damaged ? t('common.yes') : t('common.no')}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PanelSection>
      <PanelSection title={t('pos.sales.sections.tenders')}>
        {sale.tenders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('pos.sales.noTenders')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {sale.tenders.map((tender) => (
              <li key={tender.id} className="flex flex-wrap justify-between gap-3">
                <span>
                  {t(`pos.tenderKinds.${tender.kind}`)}
                  {tender.terminalId ? ` · ${tender.terminalId}` : ''}
                  {tender.rrn ? ` · RRN ${tender.rrn}` : ''}
                  {tender.maskedPan ? ` · ${tender.maskedPan}` : ''}
                </span>
                <span className="font-mono">
                  {formatMnt(tender.amount)}
                  {tender.tendered
                    ? ` (${t('pos.fields.tendered')} ${formatMnt(tender.tendered)})`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
      <PanelSection title={t('pos.sales.sections.shortfalls')}>
        {sale.shortfalls.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('pos.sales.noShortfalls')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {sale.shortfalls.map((shortfall) => (
              <li key={shortfall.id} className="flex flex-wrap justify-between gap-3">
                <span>
                  <span className="font-mono text-muted-foreground">{shortfall.productSku}</span>{' '}
                  {shortfall.productName} · {shortfall.qtyBase}
                </span>
                <span className="text-muted-foreground">
                  {t('pos.sales.shortfallHint', { number: shortfall.adjustmentNumber })}
                  {shortfall.resolvedAt ? ` · ${t('pos.fields.resolved')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
      {sale.kind === 'SALE' ? (
        <PanelSection title={t('pos.sales.sections.returns')}>
          {sale.returns.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pos.sales.noReturns')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {sale.returns.map((entry) => (
                <li key={entry.id} className="flex justify-between gap-3">
                  <Link
                    className="font-mono text-link underline-offset-2 hover:underline"
                    to={`/pos/sales?sale=${entry.id}`}
                  >
                    {entry.number}
                  </Link>
                  <span className="font-mono">{formatMnt(entry.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </PanelSection>
      ) : null}
      {sale.note ? (
        <PanelSection title={t('pos.fields.note')}>
          <p className="text-sm whitespace-pre-wrap">{sale.note}</p>
        </PanelSection>
      ) : null}
    </div>
  );
}
