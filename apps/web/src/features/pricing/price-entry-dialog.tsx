import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
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
import { WHOLE_MNT } from './helpers';
import { LISTS, useUnitLabel, viewsOf } from './price-views';

type Issue =
  'pricing.dialog.noChanges' | 'pricing.dialog.invalidPrice' | 'pricing.dialog.baseRequired';

/**
 * Prices of every unit of a product in both lists (ADR-0041 #1), from the product page or the list
 * of products waiting for their prices. A field keeps the unit's own price; emptied, a unit other
 * than the base goes back to the base price × factor. Only changed fields are sent, one
 * Idempotency-Key per save. While the product waits for its prices (ADR-0044) they start today and
 * «Бүрэн болгох» saves what changed, then completes the product.
 */
export function PriceEntryDialog(props: {
  productId: number;
  /** «10023 Кока кола 0.5 л», when the page around does not say which product it is. */
  productLabel?: string;
  pending: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const prices = useProductPrices(props.productId);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('pricing.dialog.title')}</DialogTitle>
          <DialogDescription>
            {props.productLabel ? (
              <span className="block font-medium text-foreground">{props.productLabel}</span>
            ) : null}
            {props.pending ? t('pricing.dialog.pendingHint') : t('pricing.dialog.hint')}
          </DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={problemFromError(prices.error)} />
        {prices.data ? (
          <PriceEntryForm prices={prices.data} pending={props.pending} onClose={props.onClose} />
        ) : prices.error ? null : (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PriceEntryForm(props: { prices: ProductPrices; pending: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { prices, pending, onClose } = props;
  const mutations = usePricingMutations();
  const action = useAction();
  const unitLabel = useUnitLabel(prices);
  const [key, setKey] = useState(randomUuid);
  const [completeKey] = useState(randomUuid);
  const [validFrom, setValidFrom] = useState(prices.today);
  const [issue, setIssue] = useState<Issue | null>(null);
  const own = (view: UnitPriceView) =>
    view.current?.source === 'UNIT' ? plainDecimal(view.current.price) : '';
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      LISTS.flatMap((list) =>
        viewsOf(prices, list).map((view) => [`${list}:${view.productUnitId}`, own(view)]),
      ),
    ),
  );
  const busy = mutations.setPrices.isPending || mutations.completeProducts.isPending;
  const pricesMissing = action.problem?.code === 'PRICE_MISSING';

  /** The changed prices, or null after naming what is wrong. */
  const changes = (): PriceEntry[] | null => {
    setIssue(null);
    const entries: PriceEntry[] = [];
    for (const list of LISTS) {
      for (const view of viewsOf(prices, list)) {
        const value = (values[`${list}:${view.productUnitId}`] ?? '').replace(/[\s,]/g, '');
        if (value === own(view)) continue;
        if (value === '') {
          if (view.isBase) {
            setIssue('pricing.dialog.baseRequired');
            return null;
          }
          entries.push({ list, productUnitId: view.productUnitId, price: null });
          continue;
        }
        if (!WHOLE_MNT.test(value)) {
          setIssue('pricing.dialog.invalidPrice');
          return null;
        }
        entries.push({ list, productUnitId: view.productUnitId, price: value });
      }
    }
    return entries;
  };

  const store = async (entries: PriceEntry[]) => {
    await mutations.setPrices.mutateAsync({
      key,
      productId: prices.productId,
      validFrom: pending ? prices.today : validFrom,
      entries,
    });
    // Saved: the next save is a new intent.
    setKey(randomUuid());
  };

  const save = async () => {
    const entries = changes();
    if (!entries) return;
    if (entries.length === 0) {
      setIssue('pricing.dialog.noChanges');
      return;
    }
    if (await action.run(() => store(entries))) onClose();
  };

  const complete = async () => {
    const entries = changes();
    if (!entries) return;
    const ok = await action.run(async () => {
      if (entries.length > 0) await store(entries);
      await mutations.completeProducts.mutateAsync({
        key: completeKey,
        productIds: [prices.productId],
      });
    });
    if (ok) {
      toast.success(t('pricing.saleReady.completed'));
      onClose();
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void (pending ? complete() : save());
      }}
    >
      {/* A refused completion says which prices it needs rather than the generic message. */}
      <ProblemAlert problem={pricesMissing ? null : action.problem} />
      {pricesMissing ? (
        <p className="text-sm text-destructive">{t('pricing.dialog.bothRequired')}</p>
      ) : null}
      {issue ? <p className="text-sm text-destructive">{t(issue)}</p> : null}
      {pending ? (
        <p className="text-sm text-muted-foreground">
          {t('pricing.dialog.fromToday', { date: prices.today })}
        </p>
      ) : (
        <FormField label={t('pricing.dialog.validFrom')} htmlFor="price-valid-from">
          <Input
            id="price-valid-from"
            type="date"
            min={prices.today}
            value={validFrom}
            onChange={(event) => setValidFrom(event.target.value)}
            className="sm:w-44"
          />
        </FormField>
      )}
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
              {LISTS.map((list: PriceList) => {
                const field = `${list}:${unit.productUnitId}`;
                return (
                  <TableCell key={list}>
                    <Input
                      aria-label={`${t(`pricing.lists.${list}`)}: ${unitLabel(unit)}`}
                      inputMode="numeric"
                      autoComplete="off"
                      className="w-24 sm:w-32"
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
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        {pending ? (
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void save()}>
              {t('common.save')}
            </Button>
            <Button type="submit" disabled={busy}>
              <CircleCheck />
              {t('pricing.saleReady.complete')}
            </Button>
          </>
        ) : (
          <Button type="submit" disabled={busy}>
            {t('common.save')}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
