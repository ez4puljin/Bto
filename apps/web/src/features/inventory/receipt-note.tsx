import { Decimal } from '@tugeel/shared/money';
import { Camera, Check, ImageIcon, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/app/api-client-context';
import { FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatQty } from '@/lib/money';
import { toast } from '@/lib/toast';
import { uploadFile } from '@/lib/upload';
import { useAction } from '@/lib/use-action';
import { type ReceiptDetail, useInventoryMutations } from './api';
import { parseMoney } from './helpers';
import { useWritableWarehouses } from './writable-warehouses';

/** A quantity typed with a comma or spaces, as the API takes it; null when it is not one. */
function parseQty(value: string): string | null {
  const text = value.replace(/\s/g, '').replace(',', '.');
  return /^\d{1,11}(\.\d{1,3})?$/.test(text) ? text : null;
}

/**
 * The delivery note's totals and photo (ADR-0115): the keeper types the note's pieces and amount
 * from the paper; the pieces must equal the lines' (checked when the last warehouse confirms), the
 * amount the payable within 1₮ (checked at the accountant's price check). The photo is optional.
 * Each field is saved when left.
 */
export function ReceiptNoteCard(props: { detail: ReceiptDetail; editable: boolean }) {
  const { detail, editable } = props;
  const { t } = useTranslation();
  const api = useApiClient();
  const mutations = useInventoryMutations();
  const action = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const [qty, setQty] = useState(detail.noteTotalQty ?? '');
  const [amount, setAmount] = useState(detail.noteTotalAmount ?? '');
  const counted = new Decimal(detail.qtyBase);
  const note = detail.noteTotalQty === null ? null : new Decimal(detail.noteTotalQty);
  const diff = note === null ? null : counted.minus(note);

  const save = (field: 'noteTotalQty' | 'noteTotalAmount', value: string) => {
    const text = value.trim();
    const parsed =
      text === '' ? null : field === 'noteTotalQty' ? parseQty(text) : parseMoney(text);
    if (text !== '' && parsed === null) return;
    const before = field === 'noteTotalQty' ? detail.noteTotalQty : detail.noteTotalAmount;
    if (parsed !== null && before !== null && new Decimal(parsed).equals(before)) return;
    if (parsed === null && before === null) return;
    void action.run(() =>
      mutations.updateReceipt.mutateAsync({ id: detail.id, body: { [field]: parsed } }),
    );
  };

  const attach = (file: File | undefined) => {
    if (!file) return;
    void action.run(async () => {
      const fileId = await uploadFile(api, 'inventory.receipt_note', file);
      await mutations.updateReceipt.mutateAsync({
        id: detail.id,
        body: { notePhotoFileId: fileId },
      });
      toast.success(t('inventory.receipt.note.photoAdded'));
    });
  };

  const view = () =>
    void action.run(async () => {
      const { data } = await api.GET('/api/v1/receipts/{id}/note-photo', {
        params: { path: { id: detail.id } },
        parseAs: 'blob',
      });
      if (!(data instanceof Blob)) throw new Error('the delivery note photo did not load');
      window.open(URL.createObjectURL(data), '_blank', 'noopener');
    });

  return (
    <Card role="region" aria-labelledby="receipt-note-title">
      <CardHeader>
        <CardTitle id="receipt-note-title">{t('inventory.receipt.note.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={action.problem} />
        <div className="grid items-end gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-[10rem_12rem_minmax(0,1fr)]">
          <FormField label={t('inventory.receipt.note.qty')} htmlFor="receipt-note-qty">
            <Input
              id="receipt-note-qty"
              inputMode="decimal"
              className="font-mono"
              disabled={!editable}
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              onBlur={() => save('noteTotalQty', qty)}
            />
          </FormField>
          <FormField label={t('inventory.receipt.note.amount')} htmlFor="receipt-note-amount">
            <Input
              id="receipt-note-amount"
              inputMode="decimal"
              className="font-mono"
              disabled={!editable}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              onBlur={() => save('noteTotalAmount', amount)}
            />
          </FormField>
          <div className="flex flex-wrap items-center gap-2 pb-1.5 text-[0.8125rem]">
            <span className="text-muted-foreground">
              {t('inventory.receipt.note.counted', { qty: formatQty(counted.toString()) })}
            </span>
            {diff === null ? null : diff.isZero() ? (
              <Badge variant="success">
                <Check />
                {t('inventory.receipt.note.match')}
              </Badge>
            ) : (
              <Badge variant="warning">
                {t('inventory.receipt.note.mismatch', { diff: formatQty(diff.toString()) })}
              </Badge>
            )}
            {detail.hasNotePhoto ? (
              <Button variant="outline" size="sm" onClick={view}>
                <ImageIcon />
                {t('inventory.receipt.note.photoView')}
              </Button>
            ) : null}
            {editable ? (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="hidden"
                  aria-label={t('inventory.receipt.note.photo')}
                  onChange={(event) => attach(event.target.files?.[0])}
                />
                <Button
                  variant="outline"
                  size="sm"
                  pending={mutations.updateReceipt.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  <Camera />
                  {t('inventory.receipt.note.photoAdd')}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Which warehouses of a draft their keepers confirmed (ADR-0115), with «Буцаах» for the caller's
 * own; the last confirmation posts the receipt.
 */
export function ReceiptConfirmations({ detail }: { detail: ReceiptDetail }) {
  const { t } = useTranslation();
  const writable = useWritableWarehouses();
  const mutations = useInventoryMutations();
  const action = useAction();
  if (detail.status !== 'DRAFT' || detail.warehouses.length === 0) return null;
  const done = new Map(detail.confirmations.map((row) => [row.warehouseId, row]));
  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label={t('inventory.receipt.confirmations.title')}
    >
      <ProblemAlert problem={action.problem} />
      <ul className="flex flex-wrap gap-2 text-[0.8125rem]">
        {detail.warehouses.map((warehouse) => {
          const row = done.get(warehouse.id);
          const mine = writable === null || writable.has(warehouse.id);
          return (
            <li key={warehouse.id} className="flex items-center gap-1.5">
              {row ? (
                <Badge variant="success">
                  <Check />
                  {t('inventory.receipt.confirmations.done', {
                    warehouse: warehouse.name,
                    by: row.confirmedBy ?? '',
                  })}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  {t('inventory.receipt.confirmations.waiting', { warehouse: warehouse.name })}
                </Badge>
              )}
              {row && mine ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('inventory.receipt.confirmations.withdrawFor', {
                    warehouse: warehouse.name,
                  })}
                  title={t('inventory.receipt.confirmations.withdrawFor', {
                    warehouse: warehouse.name,
                  })}
                  onClick={() =>
                    void action.run(async () => {
                      await mutations.withdrawReceiptConfirmation.mutateAsync({
                        id: detail.id,
                        warehouseId: warehouse.id,
                      });
                      toast.success(t('inventory.receipt.confirmations.withdrawn'));
                    })
                  }
                >
                  <Undo2 />
                  {t('inventory.receipt.confirmations.withdraw')}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
