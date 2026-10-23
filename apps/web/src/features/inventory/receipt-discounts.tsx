import { Decimal } from '@tugeel/shared/money';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RowAction, RowActions } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMnt, formatQty, formatTugrik } from '@/lib/money';
import type { ReceiptLine } from './api';
import { parseMoney } from './helpers';
import { type PanelLine, ReceiptLinePanel } from './receipt-line-panel';
import type { DiscountDraft } from './receipt-prices';

type Adding = 'free' | 'LINES' | 'NOTE' | null;

type DiscountTextKey =
  | 'title'
  | 'add'
  | 'freeList'
  | 'list'
  | 'kind'
  | 'appliesTo'
  | 'value'
  | 'valueKind'
  | 'total'
  | 'wholeNote'
  | 'chooseLines'
  | 'valueInvalid'
  | 'empty'
  | 'tooLarge'
  | 'kinds.FREE'
  | 'kinds.LINES'
  | 'kinds.NOTE';

/** A percentage with up to two decimals in (0, 100], as typed. */
function parsePct(text: string): string | null {
  const value = text.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const pct = new Decimal(value);
  return pct.gt(0) && pct.lte(100) ? pct.toString() : null;
}

/**
 * «Хөнгөлөлт, урамшуулал» under the lines (ADR-0103, owner 2026-10-23), for cost holders: free goods
 * (a product and a quantity, costed at zero) in their own list, discounts on chosen lines (a
 * percentage or an amount spread over them) and at most one on the whole note, taken after the
 * line discounts. «Нэмэх» opens the form of each; the list is saved as a whole (`onChange`).
 */
export function ReceiptDiscountsCard(props: {
  lines: readonly ReceiptLine[];
  discounts: readonly DiscountDraft[];
  editable: boolean;
  pending?: boolean;
  /** A discount exceeds the lines it applies to. */
  tooLarge?: boolean;
  onChange?: (discounts: DiscountDraft[]) => void;
  /** Free goods are added and removed on a draft only. */
  free?: {
    supplierId?: number;
    pending: boolean;
    onAdd: (line: PanelLine) => Promise<boolean>;
    onRemove: (lineId: number) => void;
  };
}) {
  const { t } = useTranslation();
  const ids = useId();
  const [adding, setAdding] = useState<Adding>(null);
  const [kind, setKind] = useState<'pct' | 'amount'>('pct');
  const [value, setValue] = useState('');
  const [chosen, setChosen] = useState<number[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const text = (key: DiscountTextKey) => t(`inventory.receipt.discounts.${key}`);

  const freeLines = props.lines.filter((line) => line.freeGoods);
  const priced = props.lines.filter((line) => !line.freeGoods);
  const hasNote = props.discounts.some((discount) => discount.kind === 'NOTE');
  const nameOf = (lineId: number) => {
    const line = props.lines.find((candidate) => candidate.id === lineId);
    return line ? `${line.productName} (${line.unitName})` : `#${lineId}`;
  };

  const open = (next: Adding) => {
    setAdding(next);
    setKind('pct');
    setValue('');
    setChosen([]);
    setProblem(null);
  };

  const save = () => {
    const pct = kind === 'pct' ? parsePct(value) : null;
    const amount = kind === 'amount' ? parseMoney(value) : null;
    if (pct === null && (amount === null || !new Decimal(amount).gt(0))) {
      setProblem(text('valueInvalid'));
      return;
    }
    if (adding === 'LINES' && chosen.length === 0) {
      setProblem(text('chooseLines'));
      return;
    }
    if (adding !== 'LINES' && adding !== 'NOTE') return;
    props.onChange?.([...props.discounts, { kind: adding, pct, amount, lineIds: chosen }]);
    setAdding(null);
  };

  const remove = (index: number) =>
    props.onChange?.(props.discounts.filter((_, at) => at !== index));

  const valueOf = (discount: DiscountDraft) =>
    discount.pct
      ? `${new Decimal(discount.pct).toString()}%`
      : formatTugrik(discount.amount ?? '0');

  return (
    <Card role="region" aria-labelledby={`${ids}-title`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle id={`${ids}-title`}>{text('title')}</CardTitle>
        {props.editable ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={props.pending}>
                <Plus />
                {text('add')}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {props.free ? (
                <DropdownMenuItem onSelect={() => open('free')}>
                  {text('kinds.FREE')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem disabled={priced.length === 0} onSelect={() => open('LINES')}>
                {text('kinds.LINES')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={hasNote} onSelect={() => open('NOTE')}>
                {text('kinds.NOTE')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {adding === 'free' && props.free ? (
          <ReceiptLinePanel
            free
            editing={null}
            pending={props.free.pending}
            supplierId={props.free.supplierId}
            onSubmit={props.free.onAdd}
            onCancelEdit={() => setAdding(null)}
            onClose={() => setAdding(null)}
          />
        ) : null}
        {adding === 'LINES' || adding === 'NOTE' ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{text(`kinds.${adding}`)}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-value`}>{text('value')}</Label>
                <div className="flex gap-2">
                  <Input
                    id={`${ids}-value`}
                    autoFocus
                    inputMode="decimal"
                    autoComplete="off"
                    className="w-36 text-right font-mono"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        save();
                      }
                    }}
                  />
                  <NativeSelect
                    aria-label={text('valueKind')}
                    className="w-20"
                    value={kind}
                    onChange={(event) =>
                      setKind(event.target.value === 'amount' ? 'amount' : 'pct')
                    }
                  >
                    <option value="pct">%</option>
                    <option value="amount">₮</option>
                  </NativeSelect>
                </div>
              </div>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => setAdding(null)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={save}>{t('common.save')}</Button>
              </div>
            </div>
            {adding === 'LINES' ? (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 text-[13px] text-muted-foreground">
                  {text('chooseLines')}
                </legend>
                {priced.map((line) => {
                  const id = `${ids}-line-${line.id}`;
                  return (
                    <div key={line.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={id}
                        checked={chosen.includes(line.id)}
                        onCheckedChange={(checked) =>
                          setChosen((before) =>
                            checked === true
                              ? [...before, line.id]
                              : before.filter((candidate) => candidate !== line.id),
                          )
                        }
                      />
                      <Label htmlFor={id} className="font-normal">
                        {nameOf(line.id)}
                        {line.docAmount ? (
                          <span className="ml-2 font-mono text-muted-foreground">
                            {formatMnt(line.docAmount)}
                          </span>
                        ) : null}
                      </Label>
                    </div>
                  );
                })}
              </fieldset>
            ) : null}
            {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
          </div>
        ) : null}

        {freeLines.length > 0 ? (
          <section aria-labelledby={`${ids}-free`} className="flex flex-col gap-1">
            <h3 id={`${ids}-free`} className="text-sm font-medium">
              {text('freeList')}
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.sku')}</TableHead>
                  <TableHead>{t('inventory.product')}</TableHead>
                  <TableHead>{t('inventory.warehouse')}</TableHead>
                  <TableHead>{t('inventory.unit')}</TableHead>
                  <TableHead className="text-right">{t('inventory.qty')}</TableHead>
                  {props.free ? (
                    <TableHead>
                      <span className="sr-only">{t('common.actions')}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {freeLines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-mono text-[13px]">{line.productSku}</TableCell>
                    <TableCell className="whitespace-normal">{line.productName}</TableCell>
                    <TableCell>{line.warehouseName}</TableCell>
                    <TableCell>{line.unitName}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatQty(line.enteredQty)}
                    </TableCell>
                    {props.free ? (
                      <RowActions>
                        <RowAction
                          label={`${t('inventory.remove')}: ${nameOf(line.id)}`}
                          icon={Trash2}
                          destructive
                          onClick={() => props.free?.onRemove(line.id)}
                        />
                      </RowActions>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : null}

        {props.discounts.length > 0 ? (
          <section aria-labelledby={`${ids}-list`} className="flex flex-col gap-1">
            <h3 id={`${ids}-list`} className="text-sm font-medium">
              {text('list')}
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{text('kind')}</TableHead>
                  <TableHead>{text('appliesTo')}</TableHead>
                  <TableHead className="text-right">{text('value')}</TableHead>
                  <TableHead className="text-right">{text('total')}</TableHead>
                  {props.editable ? (
                    <TableHead>
                      <span className="sr-only">{t('common.actions')}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.discounts.map((discount, index) => (
                  <TableRow key={discount.id ?? `new-${index}`}>
                    <TableCell>{text(`kinds.${discount.kind}`)}</TableCell>
                    <TableCell className="whitespace-normal">
                      {discount.kind === 'NOTE'
                        ? text('wholeNote')
                        : (discount.lineIds ?? []).map(nameOf).join(', ')}
                    </TableCell>
                    <TableCell className="text-right font-mono">{valueOf(discount)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {discount.total ? `-${formatTugrik(discount.total)}` : t('common.none')}
                    </TableCell>
                    {props.editable ? (
                      <RowActions>
                        <RowAction
                          label={`${t('inventory.remove')}: ${text(`kinds.${discount.kind}`)}`}
                          icon={Trash2}
                          destructive
                          onClick={() => remove(index)}
                        />
                      </RowActions>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : null}

        {freeLines.length === 0 && props.discounts.length === 0 && adding === null ? (
          <p className="text-sm text-muted-foreground">{text('empty')}</p>
        ) : null}
        {props.tooLarge ? <p className="text-sm text-destructive">{text('tooLarge')}</p> : null}
      </CardContent>
    </Card>
  );
}
