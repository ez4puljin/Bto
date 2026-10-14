import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { FieldList } from '@/components/detail';
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
import { type ProductPriceView, usePricingMutations, useProductPrices } from './api';
import { lastDayOf } from './helpers';
import { PriceEntryDialog } from './price-entry-dialog';
import { useProfileSummary, useUnitLabel } from './price-views';

/**
 * Prices of a product on its page (ADR-0048): the warehouse price, the price profile and the pack
 * counted as whole, then what one of each unit costs wholesale (whole or loose) and at the
 * supermarket, planned changes and the history. The price clerk (pricing.prices.manage) sets them
 * from a day on and, while the product waits for its prices, completes it (ADR-0044).
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
        {data ? <PriceTermsView data={data} /> : null}
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

function PriceTermsView({ data }: { data: ProductPriceView }) {
  const { t } = useTranslation();
  const unitLabel = useUnitLabel(data.units);
  const summary = useProfileSummary();
  const base = data.units.find((unit) => unit.isBase);
  const whole = data.units.find((unit) => unit.productUnitId === data.wholeUnitId);
  const current = data.current;
  const hasBulk = data.table.some((row) => row.retailBulk !== null);
  const money = (amount: string) => t('pricing.money', { amount: formatMnt(amount) });

  return (
    <>
      {data.problems.map((problem) => (
        <p
          key={problem}
          className={
            problem === 'NO_TERMS' ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'
          }
        >
          {t(`pricing.card.problems.${problem}`)}
        </p>
      ))}
      {current ? (
        <FieldList
          items={[
            {
              label: t('pricing.card.warehousePrice'),
              value: (
                <span className="font-mono">
                  {t('pricing.card.pricePerUnit', {
                    amount: formatMnt(current.warehousePrice),
                    unit: base?.uomName ?? '',
                  })}
                </span>
              ),
            },
            {
              label: t('pricing.card.profile'),
              value: (
                <Link
                  to={`/pricing/profiles/${current.profileId}`}
                  className="text-link hover:underline"
                >
                  {current.profileName}
                </Link>
              ),
              hint: data.profile?.values ? summary(data.profile.values) : null,
            },
            {
              label: t('pricing.card.wholeUnit'),
              // A product with packs and no working whole unit says why in its problems above.
              value: whole
                ? unitLabel(whole)
                : data.units.some((unit) => !unit.isBase)
                  ? t('common.none')
                  : t('pricing.card.noPacks'),
            },
          ]}
        />
      ) : null}
      {data.table.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pricing.card.columns.unit')}</TableHead>
              <TableHead className="text-right whitespace-normal">
                {t('pricing.card.columns.wholesale')}
              </TableHead>
              <TableHead className="text-right whitespace-normal">
                {t('pricing.card.columns.retail')}
              </TableHead>
              {hasBulk ? (
                <TableHead className="text-right whitespace-normal">
                  {t('pricing.card.columns.retailBulk')}
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.table.map((row) => {
              const unit = data.units.find(
                (candidate) => candidate.productUnitId === row.productUnitId,
              );
              return (
                <TableRow key={row.productUnitId}>
                  <TableCell className="whitespace-normal">
                    {unit ? unitLabel(unit) : null}
                  </TableCell>
                  <TableCell className="text-right whitespace-normal">
                    <span className="font-mono">{money(row.wholesale)}</span>
                    <Badge variant="outline" className="ml-2">
                      {t(`pricing.card.bases.${row.wholesaleBasis}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{money(row.retail)}</TableCell>
                  {hasBulk ? (
                    <TableCell className="text-right font-mono">
                      {row.retailBulk ? money(row.retailBulk) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
      {data.scheduled.map((terms) => (
        <p key={terms.id} className="text-xs text-muted-foreground">
          {t('pricing.card.plannedTerms', {
            date: terms.validFrom,
            amount: formatMnt(terms.warehousePrice),
            profile: terms.profileName,
          })}
        </p>
      ))}
      {data.history.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('pricing.card.history')}</summary>
          {data.history.map((terms) => (
            <div key={terms.id}>
              {t('pricing.card.historyTerms', {
                from: terms.validFrom,
                to: terms.validTo ? lastDayOf(terms.validTo) : '',
                amount: formatMnt(terms.warehousePrice),
                profile: terms.profileName,
              })}
            </div>
          ))}
        </details>
      ) : null}
    </>
  );
}
