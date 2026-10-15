import { daysBetween } from '@tugeel/shared/finance';
import { Ellipsis, Printer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { businessDate } from '@tugeel/shared/time';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type InvoiceDetail, useFinanceMutations, useInvoice } from './api';
import { SettlementBadge } from './badges';
import { CreditNoteDialog } from './credit-note-dialog';
import { FactChips, PanelSection, RecordSheet } from './panel';
import { VoidDialog } from './void-dialog';

/** One invoice in the panel (`?invoice=`): facts, totals, lines, settlements, credit notes. */
export function InvoicePanel({
  invoiceId,
  onClose,
}: {
  invoiceId: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const invoice = useInvoice(invoiceId);
  const detail = invoice.data;
  return (
    <RecordSheet
      open={invoiceId !== null}
      onClose={onClose}
      title={detail ? t('finance.invoices.panelTitle', { number: detail.number }) : ''}
      description={detail ? `${detail.customerName} · ${detail.customerCode}` : ''}
      badges={
        detail ? (
          <SettlementBadge
            settlement={detail.settlement}
            status={detail.status}
            overdue={detail.overdue}
          />
        ) : null
      }
      actions={detail ? <PanelActions invoice={detail} /> : null}
    >
      <ProblemAlert problem={problemFromError(invoice.error)} />
      {detail ? <InvoiceBody invoice={detail} /> : null}
    </RecordSheet>
  );
}

function PanelActions({ invoice }: { invoice: InvoiceDetail }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('finance.invoices.manage');
  const [format, choose] = usePrintFormat();
  const [voiding, setVoiding] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const mutations = useFinanceMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const issued = invoice.status === 'ISSUED';

  const voidInvoice = (reason: string) => {
    void action
      .run(async () => {
        await mutations.voidInvoice.mutateAsync({ id: invoice.id, key, reason });
      })
      .then((ok) => {
        if (ok) {
          toast.success(t('finance.invoices.voided'));
          setVoiding(false);
          setKey(randomUuid());
        }
      });
  };

  return (
    <>
      <PrintFormatToggle value={format} onChange={choose} />
      <Button asChild variant="outline" size="sm">
        <Link
          to={`/finance/invoices/${invoice.id}/print?format=${printFormatParam(format)}`}
          target="_blank"
        >
          <Printer />
          {t('finance.actions.print')}
        </Link>
      </Button>
      {canManage && issued ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={t('finance.actions.other')}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setCrediting(true)}>
              {t('finance.actions.creditNote')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setVoiding(true)}>
              {t('finance.actions.void')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {voiding ? (
        <VoidDialog
          open
          title={t('finance.invoices.voidTitle')}
          description={t('finance.invoices.voidDescription', { number: invoice.number })}
          pending={mutations.voidInvoice.isPending}
          problem={action.problem}
          onClose={() => {
            setVoiding(false);
            action.clear();
          }}
          onConfirm={voidInvoice}
        />
      ) : null}
      {crediting ? (
        <CreditNoteDialog open invoice={invoice} onClose={() => setCrediting(false)} />
      ) : null}
    </>
  );
}

function InvoiceBody({ invoice }: { invoice: InvoiceDetail }) {
  const { t } = useTranslation();
  const today = businessDate();
  const facts = [
    {
      label: t('finance.fields.order'),
      value: invoice.orderId ? (
        <Link
          className="text-link underline-offset-2 hover:underline"
          to={`/sales/boards?order=${invoice.orderId}`}
        >
          {invoice.orderNumber ?? String(invoice.orderId)}
        </Link>
      ) : (
        t('finance.fields.none')
      ),
    },
    { label: t('finance.fields.date'), value: invoice.invoiceDate },
    {
      label: t('finance.fields.dueDate'),
      value: invoice.overdue
        ? `${invoice.dueDate} · ${t('finance.invoices.overdueDays', { count: daysBetween(invoice.dueDate, today) })}`
        : invoice.dueDate,
    },
    {
      label: t('finance.fields.paymentMethod'),
      value: t(`sales.paymentMethods.${invoice.paymentMethod}`),
    },
    ...(invoice.branchName
      ? [{ label: t('finance.fields.branch'), value: invoice.branchName }]
      : []),
    ...(invoice.createdByName
      ? [
          {
            label: t('finance.fields.createdBy'),
            value: `${invoice.createdByName} · ${formatUbDateTime(Date.parse(invoice.createdAt))}`,
          },
        ]
      : []),
    ...(invoice.journalNumber
      ? [
          {
            label: t('finance.fields.journalEntry'),
            value: (
              <Link
                className="font-mono text-link underline-offset-2 hover:underline"
                to={`/finance/journal?entry=${invoice.journalEntryId}`}
              >
                {invoice.journalNumber}
              </Link>
            ),
          },
        ]
      : []),
  ];
  const totals = [
    [t('finance.fields.subtotal'), invoice.subtotal],
    [t('finance.fields.discount'), invoice.discountTotal],
    [t('finance.fields.total'), invoice.total],
    [t('finance.fields.vat'), invoice.vatTotal],
    [t('finance.fields.cityTax'), invoice.cityTaxTotal],
    [t('finance.fields.paid'), subtract(invoice.total, invoice.openAmount)],
    [t('finance.fields.open'), invoice.openAmount],
  ] as const;

  return (
    <div className="flex flex-col gap-5">
      {invoice.status === 'VOID' ? (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive">
          {t('finance.invoices.voidedBy', { name: invoice.voidedByName ?? '' })}
          {invoice.voidReason ? ` — ${invoice.voidReason}` : ''}
        </p>
      ) : null}
      <FactChips facts={facts} />
      <div className="grid gap-2 sm:grid-cols-4">
        {totals.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border px-3 py-2">
            <div className="text-[12px] text-muted-foreground">{label}</div>
            <div className="font-mono text-sm font-semibold">{formatMnt(value)}</div>
          </div>
        ))}
      </div>
      <PanelSection title={t('finance.invoices.sections.lines')}>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('finance.fields.product')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.qty')}</TableHead>
                <TableHead>{t('finance.fields.unit')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.unitPrice')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.discount')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.vat')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.total')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lines.map((line) => (
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PanelSection>
      <PanelSection title={t('finance.invoices.sections.allocations')}>
        {invoice.allocations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('finance.invoices.noAllocations')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('finance.fields.number')}</TableHead>
                  <TableHead>{t('finance.fields.date')}</TableHead>
                  <TableHead>{t('finance.fields.kind')}</TableHead>
                  <TableHead className="text-right">{t('finance.fields.amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.allocations.map((allocation) => (
                  <TableRow
                    key={allocation.id}
                    className={
                      allocation.voidedAt ? 'text-muted-foreground line-through' : undefined
                    }
                  >
                    <TableCell className="font-mono">
                      {allocation.sourceType === 'PAYMENT' ? (
                        <Link
                          className="text-link underline-offset-2 hover:underline"
                          to={`/finance/payments?payment=${allocation.sourceId}`}
                        >
                          {allocation.sourceNumber}
                        </Link>
                      ) : (
                        allocation.sourceNumber
                      )}
                    </TableCell>
                    <TableCell className="font-mono">{allocation.sourceDate}</TableCell>
                    <TableCell>
                      {allocation.sourceType === 'PAYMENT'
                        ? t('finance.arKinds.PAYMENT')
                        : t('finance.arKinds.CREDIT_NOTE')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMnt(allocation.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PanelSection>
      <PanelSection title={t('finance.invoices.sections.creditNotes')}>
        {invoice.creditNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('finance.invoices.noCreditNotes')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {invoice.creditNotes.map((note) => (
              <li key={note.id} className="flex justify-between gap-3">
                <span className="font-mono">
                  {note.number} · {note.noteDate}
                </span>
                <span className="font-mono">{formatMnt(note.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
      {invoice.note ? (
        <PanelSection title={t('sales.order.note')}>
          <p className="text-sm whitespace-pre-wrap">{invoice.note}</p>
        </PanelSection>
      ) : null}
    </div>
  );
}

/** a − b of two money strings, without a float. */
function subtract(a: string, b: string): string {
  const cents = (value: string) => {
    const [whole = '0', fraction = ''] = value.split('.');
    const sign = whole.startsWith('-') ? -1n : 1n;
    return (
      sign * (BigInt(whole.replace('-', '')) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2)))
    );
  };
  const result = cents(a) - cents(b);
  const abs = result < 0n ? -result : result;
  return `${result < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
