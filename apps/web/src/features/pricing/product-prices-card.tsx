import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { formatMnt, plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type PriceEntry,
  type PriceList,
  type ProductPrices,
  type UnitPriceView,
  usePricingMutations,
  useProductPrices,
} from './api';
import { lastDayOf, WHOLE_MNT } from './helpers';

const LISTS: readonly PriceList[] = ['WHOLESALE', 'RETAIL'];

const viewsOf = (prices: ProductPrices, list: PriceList) =>
  list === 'WHOLESALE' ? prices.wholesale : prices.retail;

/** «24 ш-тэй хайрцаг» for a unit, its name for the base unit. */
function useUnitLabel(prices: ProductPrices | undefined) {
  const { t } = useTranslation();
  const base = prices?.wholesale.find((unit) => unit.isBase);
  return (unit: UnitPriceView) =>
    unit.isBase || !base
      ? unit.uomName
      : t('catalog.units.factorOf', {
          unit: unit.uomName,
          factor: plainDecimal(unit.factorToBase),
          base: base.uomName,
        });
}

/**
 * Prices of a product on its page (ADR-0041 #1): each current unit in both lists, today's price
 * (its own, or the base unit's × factor), planned changes and past prices. pricing.manage sets
 * them from a day on.
 */
export function ProductPricesCard({ productId }: { productId: number }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('pricing.manage');
  const prices = useProductPrices(productId);
  const [editing, setEditing] = useState(false);
  const data = prices.data;
  const unitLabel = useUnitLabel(data);
  const baseMissing = data ? !data.wholesale.some((unit) => unit.isBase && unit.current) : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pricing.card.title')}</CardTitle>
        {canManage && data ? (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('pricing.card.set')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={problemFromError(prices.error)} />
        {baseMissing ? (
          <p className="text-sm text-destructive">{t('pricing.card.missingBase')}</p>
        ) : null}
        {data ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('pricing.card.unit')}</TableHead>
                {LISTS.map((list) => (
                  <TableHead key={list}>{t(`pricing.lists.${list}`)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.wholesale.map((unit, index) => (
                <TableRow key={unit.productUnitId}>
                  <TableCell className="align-top">{unitLabel(unit)}</TableCell>
                  <TableCell className="align-top">
                    <PriceCell view={unit} />
                  </TableCell>
                  <TableCell className="align-top">
                    <PriceCell view={data.retail[index]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
      {editing && data ? <SetPricesDialog prices={data} onClose={() => setEditing(false)} /> : null}
    </Card>
  );
}

function PriceCell({ view }: { view: UnitPriceView | undefined }) {
  const { t } = useTranslation();
  if (!view) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {view.current ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">
            {t('pricing.money', { amount: formatMnt(view.current.price) })}
          </span>
          {view.current.source === 'DERIVED' ? (
            <Badge variant="outline">{t('pricing.card.derived')}</Badge>
          ) : null}
        </span>
      ) : (
        <span className="text-muted-foreground">{t('pricing.card.none')}</span>
      )}
      {view.scheduled.map((period) => (
        <span key={period.id} className="text-xs text-muted-foreground">
          {t('pricing.card.planned', { date: period.validFrom, price: formatMnt(period.price) })}
        </span>
      ))}
      {view.history.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('pricing.card.history')}</summary>
          {view.history.map((period) => (
            <div key={period.id}>
              {t('pricing.card.historyEntry', {
                from: period.validFrom,
                to: period.validTo ? lastDayOf(period.validTo) : '',
                price: formatMnt(period.price),
              })}
            </div>
          ))}
        </details>
      ) : null}
    </div>
  );
}

/**
 * Prices of every unit in both lists from a day on. A field keeps the unit's own price; emptied,
 * a unit other than the base goes back to the base price × factor. Only changed fields are sent;
 * one Idempotency-Key per dialog.
 */
function SetPricesDialog({ prices, onClose }: { prices: ProductPrices; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = usePricingMutations();
  const action = useAction();
  const unitLabel = useUnitLabel(prices);
  const [key] = useState(randomUuid);
  const [validFrom, setValidFrom] = useState(prices.today);
  const [issue, setIssue] = useState<
    | 'pricing.dialog.noChanges'
    | 'pricing.dialog.invalidPrice'
    | 'pricing.dialog.baseRequired'
    | null
  >(null);
  const own = (view: UnitPriceView) =>
    view.current?.source === 'UNIT' ? plainDecimal(view.current.price) : '';
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      LISTS.flatMap((list) =>
        viewsOf(prices, list).map((view) => [`${list}:${view.productUnitId}`, own(view)]),
      ),
    ),
  );

  const save = async () => {
    setIssue(null);
    const entries: PriceEntry[] = [];
    for (const list of LISTS) {
      for (const view of viewsOf(prices, list)) {
        const value = (values[`${list}:${view.productUnitId}`] ?? '').replace(/[\s,]/g, '');
        if (value === own(view)) continue;
        if (value === '') {
          if (view.isBase) {
            setIssue('pricing.dialog.baseRequired');
            return;
          }
          entries.push({ list, productUnitId: view.productUnitId, price: null });
          continue;
        }
        if (!WHOLE_MNT.test(value)) {
          setIssue('pricing.dialog.invalidPrice');
          return;
        }
        entries.push({ list, productUnitId: view.productUnitId, price: value });
      }
    }
    if (entries.length === 0) {
      setIssue('pricing.dialog.noChanges');
      return;
    }
    const ok = await action.run(() =>
      mutations.setPrices.mutateAsync({ key, productId: prices.productId, validFrom, entries }),
    );
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('pricing.dialog.title')}</DialogTitle>
          <DialogDescription>{t('pricing.dialog.hint')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        {issue ? <p className="text-sm text-destructive">{t(issue)}</p> : null}
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="price-valid-from">{t('pricing.dialog.validFrom')}</Label>
            <Input
              id="price-valid-from"
              type="date"
              min={prices.today}
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
              className="max-w-48"
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('pricing.card.unit')}</TableHead>
                {LISTS.map((list) => (
                  <TableHead key={list}>{t(`pricing.lists.${list}`)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {prices.wholesale.map((unit) => (
                <TableRow key={unit.productUnitId}>
                  <TableCell>
                    {unitLabel(unit)}
                    {unit.isBase ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {t('pricing.dialog.base')}
                      </span>
                    ) : null}
                  </TableCell>
                  {LISTS.map((list) => {
                    const field = `${list}:${unit.productUnitId}`;
                    return (
                      <TableCell key={list}>
                        <Input
                          aria-label={`${t(`pricing.lists.${list}`)}: ${unitLabel(unit)}`}
                          inputMode="numeric"
                          autoComplete="off"
                          className="w-32"
                          value={values[field] ?? ''}
                          onChange={(event) =>
                            setValues((current) => ({ ...current, [field]: event.target.value }))
                          }
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div>
            <Button type="submit" disabled={mutations.setPrices.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
