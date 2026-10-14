import { businessDate } from '@tugeel/shared/time';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListCard } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { useProduct } from '@/features/catalog/api';
import { ProductSearch } from '@/features/inventory/shared';
import { formatMnt, plainDecimal } from '@/lib/money';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type PriceList, type Quote, type QuoteLine, useQuote } from './api';
import { useProgramText } from './program-text';

interface CartLine {
  key: string;
  productId: number;
  sku: string;
  name: string;
  unitId: number;
  qty: string;
}

/**
 * «Үнэ» → «Үнэ тооцоолох» (ADR-0041 #3): a test cart priced as an order would be, with every
 * discount that applies and why. Nothing is stored; orders use the same quote at SUBMIT.
 */
export function PriceQuotePage() {
  const { t } = useTranslation();
  const quote = useQuote();
  const action = useAction();
  const [list, setList] = useState<PriceList>('WHOLESALE');
  const [date, setDate] = useState(businessDate());
  const [lines, setLines] = useState<CartLine[]>([]);
  const [result, setResult] = useState<Quote | null>(null);

  const change = (next: CartLine[]) => {
    setLines(next);
    setResult(null);
  };
  const calculate = () =>
    void action.run(async () => {
      setResult(
        await quote.mutateAsync({
          list,
          date,
          lines: lines.map((line) => ({ productUnitId: line.unitId, qty: line.qty })),
        }),
      );
    });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('pricing.quote.title')}
        meta={<p className="max-w-3xl">{t('pricing.quote.hint')}</p>}
      />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="quote-list">{t('pricing.quote.list')}</Label>
              <NativeSelect
                id="quote-list"
                className="w-48"
                value={list}
                onChange={(event) => {
                  setList(event.target.value === 'RETAIL' ? 'RETAIL' : 'WHOLESALE');
                  setResult(null);
                }}
              >
                <option value="WHOLESALE">{t('pricing.lists.WHOLESALE')}</option>
                <option value="RETAIL">{t('pricing.lists.RETAIL')}</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="quote-date">{t('pricing.quote.date')}</Label>
              <Input
                id="quote-date"
                type="date"
                className="w-48"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setResult(null);
                }}
              />
            </div>
          </div>
          <ProductSearch
            onPick={(product) =>
              change([
                ...lines,
                {
                  key: randomUuid(),
                  productId: product.id,
                  sku: product.sku,
                  name: product.name,
                  unitId: product.baseUnit.id,
                  qty: '1',
                },
              ])
            }
          />
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pricing.quote.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('pricing.quote.columns.product')}</TableHead>
                  <TableHead>{t('pricing.quote.unit')}</TableHead>
                  <TableHead>{t('pricing.quote.qty')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('pricing.quote.remove')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.key}>
                    <TableCell className="whitespace-normal">
                      <span className="mr-2 font-mono text-muted-foreground">{line.sku}</span>
                      {line.name}
                    </TableCell>
                    <TableCell>
                      <UnitSelect
                        line={line}
                        onChange={(unitId) =>
                          change(
                            lines.map((row) => (row.key === line.key ? { ...row, unitId } : row)),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`${t('pricing.quote.qty')}: ${line.name}`}
                        inputMode="decimal"
                        className="w-28 text-right font-mono"
                        value={line.qty}
                        onChange={(event) =>
                          change(
                            lines.map((row) =>
                              row.key === line.key
                                ? { ...row, qty: event.target.value.trim() }
                                : row,
                            ),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`${t('pricing.quote.remove')}: ${line.name}`}
                        onClick={() => change(lines.filter((row) => row.key !== line.key))}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div>
            <Button disabled={lines.length === 0 || quote.isPending} onClick={calculate}>
              {t('pricing.quote.calculate')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <ProblemAlert problem={action.problem} />
      {result ? <QuoteResult result={result} lines={lines} /> : null}
    </div>
  );
}

function UnitSelect(props: { line: CartLine; onChange: (unitId: number) => void }) {
  const { t } = useTranslation();
  const product = useProduct(props.line.productId);
  const units = (product.data?.units ?? []).filter((unit) => unit.supersededAt === null);
  const base = units.find((unit) => unit.isBase);
  return (
    <NativeSelect
      aria-label={`${t('pricing.quote.unit')}: ${props.line.name}`}
      className="w-44"
      value={props.line.unitId}
      onChange={(event) => props.onChange(Number.parseInt(event.target.value, 10))}
    >
      {units.length === 0 ? <option value={props.line.unitId} /> : null}
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

function QuoteResult({ result, lines }: { result: Quote; lines: CartLine[] }) {
  const { t } = useTranslation();
  const text = useProgramText();
  const money = (value: string | null) =>
    value === null ? '' : t('pricing.money', { amount: formatMnt(value) });
  const applied = (line: QuoteLine) =>
    line.applied.map((entry) => {
      const value = text.value(entry.effect, entry.value);
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('pricing.quote.columns.product')}</TableHead>
            <TableHead className="text-right">{t('pricing.quote.columns.qty')}</TableHead>
            <TableHead className="text-right">{t('pricing.quote.columns.listPrice')}</TableHead>
            <TableHead className="text-right">{t('pricing.quote.columns.unitPrice')}</TableHead>
            <TableHead className="text-right">{t('pricing.quote.columns.subtotal')}</TableHead>
            <TableHead className="text-right">{t('pricing.quote.columns.discount')}</TableHead>
            <TableHead className="text-right">{t('pricing.quote.columns.total')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.lines.map((line, index) => (
            <TableRow key={lines[index]?.key ?? index}>
              <TableCell className="align-top whitespace-normal">
                <div className="font-medium">{lines[index]?.name}</div>
                {line.priced ? (
                  <ul className="text-xs text-muted-foreground">
                    {applied(line).map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-xs text-destructive">{t('pricing.quote.missing')}</span>
                )}
              </TableCell>
              <TableCell className="text-right align-top font-mono">
                {plainDecimal(line.qty)}
              </TableCell>
              <TableCell className="text-right align-top font-mono">
                {money(line.listPrice)}
                {line.priceSource === 'DERIVED' ? (
                  <div className="text-xs text-muted-foreground">{t('pricing.quote.derived')}</div>
                ) : null}
              </TableCell>
              <TableCell className="text-right align-top font-mono">
                {money(line.unitPrice)}
              </TableCell>
              <TableCell className="text-right align-top font-mono">
                {money(line.subtotal)}
              </TableCell>
              <TableCell className="text-right align-top font-mono">
                {money(line.discountAmount)}
              </TableCell>
              <TableCell className="text-right align-top font-mono font-medium">
                {money(line.total)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="border-t border-border/80 px-4 py-3 text-right font-medium">
        {t('pricing.quote.totals', {
          subtotal: formatMnt(result.subtotal),
          discount: formatMnt(result.discountTotal),
          total: formatMnt(result.total),
        })}
      </p>
    </ListCard>
  );
}
