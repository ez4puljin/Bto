import { Decimal } from '@tugeel/shared/money';
import { roundPrice } from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { FormField } from '@/components/form';
import { MoneyInput } from '@/components/money-input';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { formatUbMinute } from '@/lib/dayjs';
import { formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type BasePriceEvent,
  type BasePriceView,
  useBasePrice,
  useLocationPriceRules,
  useReceiptPriceChanges,
  useSupplierPricingMutations,
} from './supplier-pricing-api';

const money = (value: string | null, empty: string) =>
  value == null ? empty : formatTugrik(value);
const WARNING_REASONS = [
  'RULE_NOT_CONFIGURED',
  'PRINTED_PRICE_MISSING',
  'PRINTED_PRICE_ZERO',
  'PRINTED_PRICE_CONFLICT',
  'PRICE_OUT_OF_RANGE',
] as const;

/** Public selling-price history; printed acquisition evidence is only present for cost holders. */
export function BasePriceHistory({ events }: { events: readonly BasePriceEvent[] }) {
  const { t } = useTranslation();
  const today = businessDate();
  const empty = t('pricing.settings.unknown');
  const reasonLabel = (event: BasePriceEvent) => {
    if (event.reason == null) return t('common.none');
    const warning = WARNING_REASONS.find((value) => value === event.reason);
    if (warning) return t(`pricing.settings.warnings.${warning}`);
    return event.kind === 'SKIPPED' ? t('pricing.settings.warnings.OTHER') : event.reason;
  };
  if (events.length === 0)
    return <p className="text-sm text-muted-foreground">{t('pricing.settings.noHistory')}</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('pricing.settings.eventDate')}</TableHead>
            <TableHead>{t('inventory.product')}</TableHead>
            <TableHead>{t('pricing.settings.source')}</TableHead>
            <TableHead className="text-right">{t('pricing.settings.oldPrice')}</TableHead>
            <TableHead className="text-right">{t('pricing.settings.newPrice')}</TableHead>
            <TableHead>{t('pricing.settings.reason')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="whitespace-nowrap">
                {formatUbMinute(event.createdAt)}
                {event.validFrom !== undefined && event.validFrom > today ? (
                  <Badge variant="secondary" className="mt-1 block w-fit">
                    {t('pricing.settings.effectiveFrom', { date: event.validFrom })}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>
                <Link className="text-link" to={`/catalog/products/${event.productId}`}>
                  {event.name}
                </Link>
                <span className="block text-xs text-muted-foreground">{event.sku}</span>
              </TableCell>
              <TableCell>
                {event.receiptId !== null ? (
                  <Link className="text-link" to={`/inventory/receipts/${event.receiptId}`}>
                    {event.receiptNumber ??
                      t('pricing.settings.receiptNumber', { id: event.receiptId })}
                  </Link>
                ) : (
                  t(`pricing.settings.sources.${event.kind}`)
                )}
                {event.overrodeManual ? (
                  <Badge className="mt-1 block w-fit" variant="warning">
                    {t('pricing.settings.overrodeManual')}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="text-right font-mono">
                {money(event.oldBasePrice, empty)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {event.kind === 'SKIPPED'
                  ? t('pricing.settings.notUpdated')
                  : money(event.newBasePrice, empty)}
              </TableCell>
              <TableCell className="min-w-40 whitespace-normal text-xs">
                {reasonLabel(event)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ReceiptPriceChanges({ receiptId }: { receiptId: number }) {
  const { t } = useTranslation();
  const changes = useReceiptPriceChanges(receiptId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pricing.settings.receiptChanges')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('pricing.settings.receiptChangesHint')}</p>
      </CardHeader>
      <CardContent>
        <ProblemAlert problem={problemFromError(changes.error)} onRetry={changes.refetch} />
        {changes.data ? (
          <BasePriceHistory events={changes.data} />
        ) : changes.isPending ? (
          <p>{t('common.loading')}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ProductBasePrice({
  productId,
  onDirty,
}: {
  productId: number;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const query = useBasePrice(productId);
  return (
    <>
      <ProblemAlert problem={problemFromError(query.error)} onRetry={query.refetch} />
      {query.data ? (
        <BasePriceEditor
          key={productId}
          view={query.data}
          onDirty={onDirty}
          reload={query.refetch}
        />
      ) : query.isPending ? (
        <p>{t('common.loading')}</p>
      ) : null}
    </>
  );
}

function BasePriceEditor(props: {
  view: BasePriceView;
  onDirty: (dirty: boolean) => void;
  reload: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { view, onDirty } = props;
  const ids = useId();
  const canManage = useHasPermission('pricing.prices.manage');
  const [basis, setBasis] = useState({ price: view.basePrice, eventId: view.lastEventId });
  const [price, setPrice] = useState(view.basePrice ?? '');
  const [reason, setReason] = useState('');
  const mutations = useSupplierPricingMutations();
  const locations = useLocationPriceRules();
  const action = useAction();
  const dirty = price.trim() !== (basis.price ?? '') || reason.trim() !== '';
  const stale = basis.price !== view.basePrice || basis.eventId !== view.lastEventId;
  const valid =
    /^\d{1,12}$/.test(price.trim()) &&
    new Decimal(price).gt(0) &&
    reason.trim().length > 0 &&
    reason.trim().length <= 500;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || stale || !canManage) return;
    void action.run(async () => {
      try {
        const saved = await mutations.base.mutateAsync({
          productId: view.productId,
          expectedPrice: basis.price,
          expectedEventId: basis.eventId,
          price: price.trim(),
          reason: reason.trim(),
        });
        setBasis({ price: saved.basePrice, eventId: saved.lastEventId });
        setPrice(saved.basePrice ?? '');
        setReason('');
        toast.success(t('pricing.settings.saved'));
      } catch (error) {
        if (problemFromError(error)?.status === 409) await props.reload();
        throw error;
      }
    });
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{view.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {view.sku}
            {view.baseUomName ? ` · ${view.baseUomName}` : ''}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 p-3">
            <span>
              {t('pricing.settings.currentBase')}
              <Badge variant="secondary" className="ml-2">
                {t(`pricing.settings.sources.${view.source ?? 'UNKNOWN'}`)}
              </Badge>
            </span>
            <strong className="font-mono">
              {money(view.basePrice, t('pricing.settings.unknown'))}
            </strong>
          </div>
          {view.receiptId !== null ? (
            <Link
              className="text-sm text-link"
              to={`/pricing/settings?receiptId=${view.receiptId}`}
            >
              {t('pricing.settings.viewReceiptChanges', {
                number: view.receiptNumber ?? view.receiptId,
              })}
            </Link>
          ) : null}
          {canManage ? (
            <form onSubmit={save} className="@container flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('pricing.settings.manualHint')}</p>
              <div className="grid gap-3 @xl:grid-cols-2">
                <FormField label={t('pricing.settings.manualPrice')} htmlFor={`${ids}-price`}>
                  <MoneyInput
                    id={`${ids}-price`}
                    value={price}
                    onValueChange={setPrice}
                    disabled={mutations.base.isPending}
                  />
                </FormField>
                <FormField label={t('pricing.settings.reason')} htmlFor={`${ids}-reason`}>
                  <Textarea
                    id={`${ids}-reason`}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={500}
                    disabled={mutations.base.isPending}
                  />
                </FormField>
              </div>
              {stale || action.problem?.status === 409 ? (
                <div role="alert" className="rounded-xl bg-warning-soft p-3 text-sm">
                  <p>
                    {t('pricing.settings.baseChanged', {
                      old: money(basis.price, t('pricing.settings.unknown')),
                      current: money(view.basePrice, t('pricing.settings.unknown')),
                    })}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={mutations.base.isPending}
                    onClick={() => {
                      setBasis({ price: view.basePrice, eventId: view.lastEventId });
                      mutations.resetIntent('base');
                      action.clear();
                    }}
                  >
                    {t('pricing.settings.reviewCurrent')}
                  </Button>
                </div>
              ) : null}
              <ProblemAlert problem={action.problem} />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  pending={mutations.base.isPending}
                  disabled={!dirty || !valid || stale}
                >
                  {t('common.save')}
                </Button>
              </div>
            </form>
          ) : null}
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('pricing.settings.locationPrices')}</h3>
            <ProblemAlert problem={problemFromError(locations.error)} onRetry={locations.refetch} />
            {(locations.data ?? [])
              .filter((rule) => rule.enabled)
              .map((rule) => {
                const base = view.basePrice == null ? null : new Decimal(view.basePrice);
                const amount =
                  base === null
                    ? null
                    : rule.priceType === 'BASE'
                      ? base
                      : Decimal.max(
                          base,
                          roundPrice(
                            base
                              .times(new Decimal(100).plus(rule.markupPct))
                              .div(100)
                              .plus(rule.markupAmount),
                            rule.rounding,
                          ),
                        );
                return (
                  <div
                    key={rule.warehouseId}
                    className="flex justify-between gap-3 border-b py-2 text-sm last:border-0"
                  >
                    <span>
                      {rule.warehouseName}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t(`pricing.settings.types.${rule.priceType}`)}
                      </span>
                    </span>
                    <span className="font-mono">
                      {amount === null
                        ? t('pricing.settings.unknown')
                        : formatTugrik(amount.toFixed(0))}
                    </span>
                  </div>
                );
              })}
            {locations.data?.filter((rule) => rule.enabled).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('pricing.settings.noLocations')}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('pricing.settings.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          <BasePriceHistory events={view.history} />
        </CardContent>
      </Card>
    </div>
  );
}
