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
import { printFormatParam, usePrintFormat } from '@/lib/print-format';
import { PrintFormatToggle } from '@/components/print-format-toggle';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatQty, formatTugrik } from '@/lib/money';
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
          ? [formatUbDateTime(Date.parse(detail.soldAt)), detail.tillCode, detail.cashierName]
              .filter(Boolean)
              .join(' · ')
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
          [t('pos.fields.subtotal'), formatTugrik(sale.subtotal)],
          [t('pos.fields.discount'), formatTugrik(sale.discountTotal)],
          [t('pos.fields.total'), formatTugrik(sale.total)],
          [t('pos.fields.vat'), formatTugrik(sale.vatTotal)],
        ]}
      />
      <PanelSection title={t('pos.sales.sections.lines')}>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-full">{t('pos.fields.product')}</TableHead>
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
                  <TableCell className="min-w-48 whitespace-normal">
                    <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
                    {line.productName}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatQty(line.qty)}</TableCell>
                  <TableCell>{line.uomName}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatTugrik(line.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatTugrik(line.discountAmount)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatTugrik(line.vatAmount)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatTugrik(line.total)}</TableCell>
                  {sale.kind === 'SALE' ? (
                    <TableCell className="text-right font-mono">
                      {formatQty(line.returnedBase)}
                    </TableCell>
                  ) : (
                    <TableCell>{line.damaged ? t('common.yes') : t('common.no')}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PanelSection>
      {/* Sections with nothing to show are left out rather than saying so (ADR-0066). */}
      {sale.tenders.length > 0 ? (
        <PanelSection title={t('pos.sales.sections.tenders')}>
          <ul className="flex max-w-2xl flex-col divide-y divide-border/80 rounded-lg border border-border text-sm">
            {sale.tenders.map((tender) => (
              <li key={tender.id} className="flex flex-wrap justify-between gap-3 px-3 py-2">
                <span>
                  {t(`pos.tenderKinds.${tender.kind}`)}
                  {tender.terminalId ? ` · ${tender.terminalId}` : ''}
                  {tender.rrn ? ` · RRN ${tender.rrn}` : ''}
                  {tender.maskedPan ? ` · ${tender.maskedPan}` : ''}
                </span>
                <span className="font-mono">
                  {formatTugrik(tender.amount)}
                  {tender.tendered
                    ? ` (${t('pos.fields.tendered')} ${formatTugrik(tender.tendered)})`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}
      {sale.shortfalls.length > 0 ? (
        <PanelSection title={t('pos.sales.sections.shortfalls')}>
          <ul className="flex flex-col divide-y divide-border/80 rounded-lg border border-border text-sm">
            {sale.shortfalls.map((shortfall) => (
              <li key={shortfall.id} className="flex flex-wrap justify-between gap-3 px-3 py-2">
                <span>
                  <span className="font-mono text-muted-foreground">{shortfall.productSku}</span>{' '}
                  {shortfall.productName} · {formatQty(shortfall.qtyBase)}
                </span>
                <span className="text-muted-foreground">
                  {t('pos.sales.shortfallHint', { number: shortfall.adjustmentNumber })}
                  {shortfall.resolvedAt ? ` · ${t('pos.fields.resolved')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}
      {sale.kind === 'SALE' && sale.returns.length > 0 ? (
        <PanelSection title={t('pos.sales.sections.returns')}>
          <ul className="flex max-w-2xl flex-col divide-y divide-border/80 rounded-lg border border-border text-sm">
            {sale.returns.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-3 px-3 py-2">
                <Link
                  className="font-mono text-link underline-offset-2 hover:underline"
                  to={`/pos/sales?sale=${entry.id}`}
                >
                  {entry.number}
                </Link>
                <span className="font-mono">{formatTugrik(entry.total)}</span>
              </li>
            ))}
          </ul>
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
