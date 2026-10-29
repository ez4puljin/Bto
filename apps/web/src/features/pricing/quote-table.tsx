import { DISCOUNT_EFFECTS, type DiscountEffect } from '@tugeel/shared/pricing';
import { useTranslation } from 'react-i18next';
import { ListCard, ListTable } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { Badge } from '@/components/ui/badge';
import {
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProduct } from '@/features/catalog/api';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatMnt, plainDecimal } from '@/lib/money';
import type { QuotePart } from './api';
import { useProgramText } from './program-text';

/** The current units of a product, a pack labelled with its count («хайрцаг (24 ш)»). */
export function UnitSelect(props: {
  productId: number;
  unitId: number;
  /** The product's name, for the label. */
  name: string;
  onChange: (unitId: number) => void;
}) {
  const { t } = useTranslation();
  const product = useProduct(props.productId);
  const units = (product.data?.units ?? []).filter((unit) => unit.supersededAt === null);
  const base = units.find((unit) => unit.isBase);
  return (
    <NativeSelect
      aria-label={`${t('pricing.quote.unit')}: ${props.name}`}
      className="w-44"
      value={props.unitId}
      onChange={(event) => props.onChange(Number.parseInt(event.target.value, 10))}
    >
      {units.length === 0 ? <option value={props.unitId} /> : null}
      {units.map((unit) => (
        <option key={unit.id} value={unit.id}>
          {unit.isBase || !base
            ? unit.uomName
            : t('catalog.units.factorOf', {
                unit: unit.uomName,
                factor: plainDecimal(unit.factorToBase),
                base: base.uomName,
              })}
        </option>
      ))}
    </NativeSelect>
  );
}

/** The quote's columns (ADR-0119): the product wraps, the quantity carries its unit. */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'product', kind: 'text', weight: 3, min: 14 },
  { key: 'qty', kind: 'qty', width: 8 },
  { key: 'basis', kind: 'status' },
  { key: 'listPrice', kind: 'money' },
  { key: 'unitPrice', kind: 'money' },
  { key: 'subtotal', kind: 'money' },
  { key: 'discount', kind: 'money' },
  { key: 'total', kind: 'money' },
];

const effectOf = (effect: string): DiscountEffect =>
  DISCOUNT_EFFECTS.find((entry) => entry === effect) ?? 'AMOUNT';

/** A priced part as a quote returns it or an order keeps it. */
export type PartLike = Omit<QuotePart, 'applied'> & {
  applied: { name: string; effect: string; value: string; amount: string | null }[];
};

/** What the table shows: per line its quantity and parts (or that it has no price), then totals. */
export interface PricedRows {
  lines: { priced: boolean; qty: string; parts: PartLike[] }[];
  subtotal: string;
  discountTotal: string;
  total: string;
}

/**
 * The quote's parts per line (ADR-0048 #4): quantity and unit, basis, list and unit price, discount
 * and total, the programs applied, then the totals as the table's foot, under their columns.
 * `names` follows the lines' order.
 */
export function QuoteResult({
  result,
  names,
}: {
  result: PricedRows;
  names: readonly { key: string; name: string }[];
}) {
  const { t } = useTranslation();
  const text = useProgramText();
  const money = (value: string) => t('pricing.money', { amount: formatMnt(value) });
  const applied = (part: PartLike) =>
    part.applied.map((entry) => {
      const value = text.value(effectOf(entry.effect), entry.value);
      return entry.amount === null
        ? t('pricing.quote.applied', { name: entry.name, value })
        : t('pricing.quote.appliedAmount', {
            name: entry.name,
            value,
            amount: formatMnt(entry.amount),
          });
    });

  return (
    <ListCard>
      <ListTable columns={COLUMNS}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('pricing.quote.columns.product')}</TableHead>
            <TableHead className="text-right">{t('pricing.quote.columns.qty')}</TableHead>
            <TableHead>{t('pricing.quote.columns.basis')}</TableHead>
            <TableHead className="text-right">{t('pricing.quote.columns.listPrice')}</TableHead>
            <TableHead className="text-right">{t('pricing.quote.columns.unitPrice')}</TableHead>
            <TableHead className="text-right">{t('pricing.quote.columns.subtotal')}</TableHead>
            <TableHead className="text-right">{t('pricing.quote.columns.discount')}</TableHead>
            <TableHead className="text-right">{t('pricing.quote.columns.total')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.lines.flatMap((line, index) => {
            const name = names[index]?.name;
            const key = names[index]?.key ?? String(index);
            if (!line.priced) {
              return [
                <TableRow key={key}>
                  <TableCell className="align-top whitespace-normal">
                    <div className="font-medium">{name}</div>
                    <span className="text-xs text-destructive">{t('pricing.quote.missing')}</span>
                  </TableCell>
                  <TableCell className="text-right align-top font-mono">
                    {plainDecimal(line.qty)}
                  </TableCell>
                  <TableCell colSpan={6} />
                </TableRow>,
              ];
            }
            return line.parts.map((part, at) => (
              <TableRow key={`${key}:${at}`}>
                <TableCell className="align-top whitespace-normal">
                  {at === 0 ? <div className="font-medium">{name}</div> : null}
                  <ul className="text-xs text-muted-foreground">
                    {applied(part).map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell className="text-right align-top font-mono">
                  {t('pricing.quote.partQty', { qty: plainDecimal(part.qty), unit: part.uomName })}
                </TableCell>
                <TableCell className="align-top">
                  <Badge variant="outline">{t(`pricing.bases.${part.basis}`)}</Badge>
                </TableCell>
                <TableCell className="text-right align-top font-mono">
                  {money(part.listPrice)}
                </TableCell>
                <TableCell className="text-right align-top font-mono">
                  {money(part.unitPrice)}
                </TableCell>
                <TableCell className="text-right align-top font-mono">
                  {money(part.subtotal)}
                </TableCell>
                <TableCell className="text-right align-top font-mono">
                  {money(part.discountAmount)}
                </TableCell>
                <TableCell className="text-right align-top font-mono font-medium">
                  {money(part.total)}
                </TableCell>
              </TableRow>
            ));
          })}
        </TableBody>
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={5}>{t('pricing.quote.footer')}</TableCell>
            <TableCell className="text-right font-mono">{money(result.subtotal)}</TableCell>
            <TableCell className="text-right font-mono">{money(result.discountTotal)}</TableCell>
            <TableCell className="text-right font-mono font-semibold">
              {money(result.total)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </ListTable>
    </ListCard>
  );
}
