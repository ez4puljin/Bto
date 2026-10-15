import { businessDate } from '@tugeel/shared/time';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RowAction, RowActions } from '@/components/list';
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
import { ProductSearch } from '@/features/inventory/shared';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type PriceList, type Quote, useQuote } from './api';
import { QuoteResult, UnitSelect } from './quote-table';

interface CartLine {
  key: string;
  productId: number;
  sku: string;
  name: string;
  unitId: number;
  qty: string;
}

/**
 * «Үнэ» → «Үнэ тооцоолох» (ADR-0041 #3, ADR-0048 #4): a test cart priced as an order would be —
 * whole packs and loose pieces apart, or the supermarket's prices — with every discount that
 * applies and why. Nothing is stored; orders use the same quote at SUBMIT.
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
                        productId={line.productId}
                        unitId={line.unitId}
                        name={line.name}
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
                    <RowActions>
                      <RowAction
                        label={`${t('pricing.quote.remove')}: ${line.name}`}
                        icon={Trash2}
                        destructive
                        onClick={() => change(lines.filter((row) => row.key !== line.key))}
                      />
                    </RowActions>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex justify-end">
            <Button disabled={lines.length === 0 || quote.isPending} onClick={calculate}>
              {t('pricing.quote.calculate')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <ProblemAlert problem={action.problem} />
      {result ? <QuoteResult result={result} names={lines} /> : null}
    </div>
  );
}
