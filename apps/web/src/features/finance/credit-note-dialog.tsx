import { Decimal } from '@tugeel/shared/money';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogFormFooter, FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useWarehouses } from '@/features/identity/api';
import { WarehouseSelect } from '@/features/inventory/shared';
import { formatMnt } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type InvoiceDetail, useFinanceMutations } from './api';

const QTY = /^\d{1,11}(\.\d{1,3})?$/;

/**
 * «Кредит нот» on an invoice (ADR-0060 #6): how much of each line comes back, into which warehouse
 * (its RETURNS bin) or none for a price correction, and why. The amounts follow the invoiced
 * prices; the server settles the invoice up to its open amount.
 */
export function CreditNoteDialog({
  open,
  invoice,
  onClose,
}: {
  open: boolean;
  invoice: InvoiceDetail;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const warehouses = useWarehouses();
  const mutations = useFinanceMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [reason, setReason] = useState('');
  const [warehouseId, setWarehouseId] = useState<number | undefined>(undefined);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState(false);

  const lines = invoice.lines.map((line) => {
    const factor = new Decimal(line.factorSnapshot);
    const remaining = new Decimal(line.qtyBase).minus(line.returnedBase).div(factor);
    const typed = quantities[line.id] ?? '';
    const qty = QTY.test(typed) ? new Decimal(typed) : null;
    const valid = qty === null ? typed === '' : qty.gt(0) && qty.lte(remaining);
    return { line, remaining, typed, qty, valid };
  });
  const chosen = lines.filter((entry) => entry.qty !== null && entry.qty.gt(0) && entry.valid);
  const total = chosen.reduce(
    (sum, entry) =>
      sum.plus(
        new Decimal(entry.line.unitPrice)
          .times(entry.qty ?? 0)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP),
      ),
    new Decimal(0),
  );
  const allValid = lines.every((entry) => entry.valid);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!reason.trim() || chosen.length === 0 || !allValid) return;
    void action
      .run(async () => {
        const note = await mutations.createCreditNote.mutateAsync({
          key,
          body: {
            invoiceId: invoice.id,
            reason: reason.trim(),
            warehouseId: warehouseId ?? null,
            binId: null,
            lines: chosen.map((entry) => ({
              invoiceLineId: entry.line.id,
              qty: entry.qty?.toFixed() ?? '0',
            })),
          },
        });
        toast.success(t('finance.creditNote.created', { number: note.number }));
      })
      .then((ok) => {
        if (ok) onClose();
      });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('finance.creditNote.title')}</DialogTitle>
          <DialogDescription>{t('finance.creditNote.description')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('finance.fields.product')}</TableHead>
                  <TableHead className="text-right">{t('finance.fields.unitPrice')}</TableHead>
                  <TableHead>{t('finance.creditNote.qtyToReturn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map(({ line, remaining, typed, valid }) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <div>{line.productName}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('finance.creditNote.remaining', {
                          qty: remaining.toFixed(),
                          unit: line.uomName,
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMnt(line.unitPrice)}
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`${t('finance.creditNote.qtyToReturn')}: ${line.productName}`}
                        inputMode="decimal"
                        className="w-28 font-mono"
                        value={typed}
                        aria-invalid={!valid || undefined}
                        disabled={remaining.lte(0)}
                        onChange={(event) =>
                          setQuantities((previous) => ({
                            ...previous,
                            [line.id]: event.target.value,
                          }))
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {checked && chosen.length === 0 ? (
            <p role="alert" className="text-sm text-destructive">
              {t('finance.creditNote.nothingChosen')}
            </p>
          ) : null}
          <p className="text-sm">
            {t('finance.creditNote.total')}:{' '}
            <span className="font-mono font-semibold">{formatMnt(total.toFixed(2))}</span>
          </p>
          <FormField label={t('finance.creditNote.warehouse')} htmlFor="credit-note-warehouse">
            <WarehouseSelect
              id="credit-note-warehouse"
              options={warehouses.data ?? []}
              value={warehouseId}
              onChange={setWarehouseId}
              emptyLabel={t('finance.creditNote.noWarehouse')}
            />
          </FormField>
          <FormField
            label={t('finance.creditNote.reason')}
            htmlFor="credit-note-reason"
            error={checked && !reason.trim() ? t('validation.required') : undefined}
          >
            <Textarea
              id="credit-note-reason"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
          <ProblemAlert problem={action.problem} />
          <DialogFormFooter
            pending={mutations.createCreditNote.isPending}
            onCancel={onClose}
            submitLabel={t('finance.creditNote.submit')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
