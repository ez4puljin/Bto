import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type UnitPriceView, usePricingMutations, useProductPrices } from './api';
import { lastDayOf } from './helpers';
import { PriceEntryDialog } from './price-entry-dialog';
import { LISTS, useUnitLabel } from './price-views';

/**
 * Prices of a product on its page (ADR-0041 #1): each current unit in both lists, today's price
 * (its own, or the base unit's × factor), planned changes and past prices. The price clerk
 * (pricing.prices.manage) sets them from a day on and, while the product waits for its prices,
 * completes it once both base prices are in force (ADR-0044).
 */
export function ProductPricesCard({ productId, pending }: { productId: number; pending: boolean }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('pricing.prices.manage');
  const mutations = usePricingMutations();
  const completion = useAction();
  const [completeKey] = useState(randomUuid);
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
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {t('pricing.card.set')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={problemFromError(prices.error)} />
        {pending ? (
          <div className="flex flex-col gap-3 rounded-xl bg-warning-soft px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-warning">{t('pricing.saleReady.pendingNote')}</p>
            {canManage ? (
              <Button
                size="sm"
                className="shrink-0"
                disabled={mutations.completeProducts.isPending}
                onClick={() =>
                  void completion
                    .run(() =>
                      mutations.completeProducts.mutateAsync({
                        key: completeKey,
                        productIds: [productId],
                      }),
                    )
                    .then((ok) =>
                      ok ? toast.success(t('pricing.saleReady.completed')) : undefined,
                    )
                }
              >
                <CircleCheck />
                {t('pricing.saleReady.complete')}
              </Button>
            ) : null}
          </div>
        ) : null}
        <ProblemAlert problem={completion.problem} />
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
      {editing ? (
        <PriceEntryDialog
          productId={productId}
          pending={pending}
          onClose={() => setEditing(false)}
        />
      ) : null}
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
