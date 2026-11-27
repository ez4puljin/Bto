import {
  EXPIRY_QTY_PATTERN,
  type ExpiryCommerceView,
  type ExpiryReceiptSource,
} from '@tugeel/shared/expiry';
import { Decimal } from '@tugeel/shared/money';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { MonthInput } from '@/components/date-input';
import { FormField } from '@/components/form';
import { MoneyInput } from '@/components/money-input';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { FactChips, PanelSection } from '@/components/record-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PayrollSourceDeductions } from '@/features/payroll/source-deductions';
import { formatUbMinute } from '@/lib/dayjs';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type ExpiryItem, useExpiryLiabilityOptions } from './api';
import { type ApprovalBasis, approvalBasisOf, sameApprovalBasis } from './approval-basis';
import {
  type ExpiryPriceContext,
  useExpiryCommerce,
  useExpiryCommerceMutations,
  useExpiryPrices,
  useExpiryReceiptSources,
} from './commerce-api';
import { ExpiryBarcodeLabel } from './expiry-barcode';

const positiveQty = (value: string) => EXPIRY_QTY_PATTERN.test(value) && new Decimal(value).gt(0);
const moneyOrUnknown = (value: string | null | undefined, unknown: string) =>
  value == null ? unknown : formatMnt(value);

/** The public prices never fetch acquisition amounts on behalf of an ordinary shelf user. */
export function ExpiryCommerceSection(props: {
  item: ExpiryItem;
  today: string | undefined;
  onDirty: (dirty: boolean) => void;
  recordDirty: boolean;
  reloadItem: () => Promise<ExpiryItem | undefined>;
}) {
  const { t } = useTranslation();
  const canCosts = useHasPermission('inventory.costs.manage');
  const prices = useExpiryPrices(props.item.id);
  const commerce = useExpiryCommerce(props.item.id, canCosts);
  return (
    <>
      <PanelSection title={t('expiry.commerce.prices')}>
        <p className="mb-2 text-xs text-muted-foreground">
          {t('expiry.commerce.pricesHint', { unit: props.item.product.baseUomName })}
        </p>
        <ProblemAlert problem={problemFromError(prices.error)} onRetry={prices.refetch} />
        <div className="flex flex-col divide-y">
          {(prices.data?.data ?? []).map((price) => (
            <div
              key={`${price.channel}:${price.contextId}:${price.warehouseId}`}
              className="flex justify-between gap-3 py-2 text-sm"
            >
              <span>
                {price.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {t(`expiry.commerce.channels.${price.channel}`)}
                </span>
              </span>
              <span className="font-mono">
                {moneyOrUnknown(price.unitPrice, t('expiry.commerce.unknown'))}
              </span>
            </div>
          ))}
          {prices.data?.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('expiry.commerce.noPrices')}</p>
          ) : null}
        </div>
      </PanelSection>
      {canCosts ? (
        <PanelSection title={t('expiry.commerce.title')}>
          <ProblemAlert problem={problemFromError(commerce.error)} onRetry={commerce.refetch} />
          {commerce.data ? (
            <CommerceBody
              {...props}
              commerce={commerce.data}
              reload={async () => {
                const [detail, item] = await Promise.all([commerce.refetch(), props.reloadItem()]);
                return detail.data && item ? { commerce: detail.data, item } : undefined;
              }}
              prices={prices.data?.data ?? []}
            />
          ) : null}
        </PanelSection>
      ) : null}
    </>
  );
}

function SourceEvidence({ source, unit }: { source: ExpiryReceiptSource | null; unit: string }) {
  const { t } = useTranslation();
  const unknown = t('expiry.commerce.unknown');
  if (!source)
    return <p className="text-sm text-muted-foreground">{t('expiry.commerce.sourceUnknown')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        {source.receiptNumber} · {source.receiptDate}
      </p>
      <FactChips
        facts={[
          {
            label: t('expiry.commerce.originalUnitGross'),
            value:
              source.first?.grossAmount != null &&
              source.first.qtyBase != null &&
              new Decimal(source.first.qtyBase).gt(0)
                ? formatMnt(
                    new Decimal(source.first.grossAmount).div(source.first.qtyBase).toFixed(2),
                  )
                : unknown,
          },
          {
            label: t('expiry.commerce.originalReceivedQty'),
            value:
              source.first?.qtyBase != null
                ? t('inventory.qtyWithUnit', { qty: formatQty(source.first.qtyBase), unit })
                : unknown,
          },
          {
            label: t('expiry.commerce.originalDiscount'),
            value: moneyOrUnknown(source.first?.discountAmount, unknown),
          },
          {
            label: t('expiry.commerce.promotion'),
            value: t(`expiry.commerce.evidence.${source.promotionEvidence}`),
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">{t('expiry.commerce.receiptEvidenceHint')}</p>
    </div>
  );
}

function CommerceBody(
  props: Parameters<typeof ExpiryCommerceSection>[0] & {
    commerce: ExpiryCommerceView;
    reload: () => Promise<{ commerce: ExpiryCommerceView; item: ExpiryItem } | undefined>;
    prices: ExpiryPriceContext[];
  },
) {
  const { t } = useTranslation();
  const { item, commerce, onDirty } = props;
  const canItems = useHasPermission('expiry.items.manage');
  const canLiability = useHasPermission('expiry.liability.manage');
  const canPrices = useHasPermission('pricing.prices.manage');
  const canPayroll = useHasPermission('hr.payroll.view');
  const canPublish = canLiability && canPrices;
  const archived = item.status === 'ARCHIVED';
  const options = useExpiryLiabilityOptions(canLiability);
  const sources = useExpiryReceiptSources(item.id, canItems && !archived);
  const mutations = useExpiryCommerceMutations(item.id);
  const action = useAction();
  const [sourceId, setSourceId] = useState(String(commerce.source?.receiptLineId ?? ''));
  const [sourceQty, setSourceQty] = useState(commerce.sourceQtyBase ?? '');
  const [baseline, setBaseline] = useState({
    id: sourceId,
    qty: sourceQty,
    version: commerce.sourceVersion,
  });
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [contextKey, setContextKey] = useState('');
  const [month, setMonth] = useState('');
  const [shown, setShown] = useState(false);
  const [approvalBasis, setApprovalBasis] = useState<ApprovalBasis | null>(null);
  const [approvalRefused, setApprovalRefused] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [exceptionDirty, setExceptionDirty] = useState<Record<number, boolean>>({});
  const key = useRef(randomUuid());
  const stopKeys = useRef(new Map<number, string>());
  const sourceDirty = sourceId !== baseline.id || sourceQty !== baseline.qty;
  const markdownDirty = Boolean(qty || price || contextKey || month);
  const dirty = sourceDirty || markdownDirty || Object.values(exceptionDirty).some(Boolean);
  const onExceptionDirty = useCallback((id: number, changed: boolean) => {
    setExceptionDirty((previous) => {
      if (Boolean(previous[id]) === changed) return previous;
      const next = { ...previous };
      if (changed) next[id] = true;
      else delete next[id];
      return next;
    });
  }, []);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  // Background reads advance a clean source only; a typed source keeps the version it read.
  useEffect(() => {
    if (sourceDirty || markdownDirty || commerce.sourceVersion === baseline.version) return;
    const id = String(commerce.source?.receiptLineId ?? '');
    const value = commerce.sourceQtyBase ?? '';
    setSourceId(id);
    setSourceQty(value);
    setBaseline({ id, qty: value, version: commerce.sourceVersion });
  }, [commerce, sourceDirty, markdownDirty, baseline.version]);
  useEffect(() => {
    if (!markdownDirty) {
      setApprovalBasis(null);
      setApprovalRefused(false);
    }
  }, [markdownDirty]);
  const startApprovalEdit = () => {
    setApprovalBasis((read) => read ?? approvalBasisOf(item, commerce));
  };
  const approvalChanged =
    approvalRefused ||
    (approvalBasis !== null && !sameApprovalBasis(approvalBasis, item, commerce));
  const shownBasis = approvalBasis ?? approvalBasisOf(item, commerce);
  const selected =
    (sources.data?.data ?? []).find((row) => String(row.receiptLineId) === sourceId) ??
    (String(commerce.source?.receiptLineId) === sourceId ? commerce.source : null);
  const context = props.prices.find(
    (row) => `${row.channel}:${row.contextId}:${row.warehouseId}` === contextKey,
  );
  const sourceValid = Boolean(
    selected && positiveQty(sourceQty) && new Decimal(sourceQty).lte(selected.qtyBase),
  );
  const valid =
    positiveQty(qty) &&
    /^\d{1,10}(\.\d{1,2})?$/.test(price) &&
    new Decimal(price).gt(0) &&
    context !== undefined &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const saveSource = async () => {
    setShown(true);
    if (!sourceValid) return;
    await action.run(async () => {
      try {
        const saved = await mutations.source.mutateAsync({
          expectedVersion: baseline.version,
          receiptLineId: Number(sourceId),
          qtyBase: sourceQty,
        });
        setBaseline({ id: sourceId, qty: sourceQty, version: saved.sourceVersion });
        toast.success(t('expiry.commerce.sourceSaved'));
      } catch (error) {
        const latest = await props.reload();
        if (latest) setBaseline((read) => ({ ...read, version: latest.commerce.sourceVersion }));
        throw error;
      }
    });
  };
  const publish = async () => {
    setShown(true);
    const source = approvalBasis?.source;
    const costingVersion = approvalBasis?.costingVersion;
    const fingerprint = approvalBasis?.liabilityFingerprint;
    if (
      !valid ||
      !context ||
      !approvalBasis ||
      !source?.current ||
      costingVersion == null ||
      !fingerprint ||
      approvalChanged ||
      sourceDirty ||
      props.recordDirty
    )
      return;
    const ok = await action.run(async () => {
      try {
        await mutations.publish.mutateAsync({
          key: key.current,
          body: {
            expectedVersion: approvalBasis.itemVersion,
            expectedSourceVersion: approvalBasis.sourceVersion,
            expectedCostingVersion: costingVersion,
            expectedLiabilityFingerprint: fingerprint,
            receiptLineId: source.receiptLineId,
            qtyBase: qty,
            warehouseId: context.warehouseId,
            channel: context.channel,
            contextId: context.contextId,
            unitPrice: price,
            payrollMonth: month,
          },
        });
      } catch (error) {
        if (problemFromError(error)?.status === 409) {
          setApprovalRefused(true);
          await props.reload();
        }
        throw error;
      }
    });
    if (ok) {
      key.current = randomUuid();
      setQty('');
      setPrice('');
      setContextKey('');
      setMonth('');
      setShown(false);
      toast.success(t('expiry.commerce.published'));
    }
  };
  const reviewCurrentBasis = async () => {
    setReviewing(true);
    await action.run(async () => {
      const latest = await props.reload();
      if (!latest || latest.item.editVersion !== latest.commerce.itemVersion) return;
      setApprovalBasis(approvalBasisOf(latest.item, latest.commerce));
      setApprovalRefused(false);
      key.current = randomUuid();
      if (!sourceDirty) {
        const id = String(latest.commerce.source?.receiptLineId ?? '');
        const value = latest.commerce.sourceQtyBase ?? '';
        setSourceId(id);
        setSourceQty(value);
        setBaseline({ id, qty: value, version: latest.commerce.sourceVersion });
      }
    });
    setReviewing(false);
  };
  return (
    <div className="flex flex-col gap-4">
      <ProblemAlert problem={action.problem} />
      <section aria-label={t('expiry.commerce.approvalBasis')} className="flex flex-col gap-2">
        <SourceEvidence
          source={markdownDirty ? shownBasis.source : selected}
          unit={props.item.product.baseUomName}
        />
        {canPublish ? <ApprovalFacts basis={shownBasis} /> : null}
      </section>
      {canItems && !archived ? (
        <div className="flex flex-col gap-3 rounded-xl bg-fill p-3">
          <ProblemAlert problem={problemFromError(sources.error)} onRetry={sources.refetch} />
          <FormField
            label={t('expiry.commerce.receipt')}
            htmlFor="expiry-source"
            error={shown && !selected ? 'validation.required' : undefined}
          >
            <NativeSelect
              id="expiry-source"
              disabled={reviewing}
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            >
              <option value="">{t('expiry.commerce.chooseReceipt')}</option>
              {(sources.data?.data ?? []).map((row) => (
                <option key={row.receiptLineId} value={row.receiptLineId}>
                  {row.receiptNumber} · {row.receiptDate} · {formatQty(row.qtyBase)}{' '}
                  {item.product.baseUomName}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            label={t('expiry.commerce.sourceQty', { unit: item.product.baseUomName })}
            htmlFor="expiry-source-qty"
            error={shown && !sourceValid ? 'expiry.commerce.sourceQtyInvalid' : undefined}
          >
            <Input
              id="expiry-source-qty"
              disabled={reviewing}
              inputMode="decimal"
              value={sourceQty}
              onChange={(e) => setSourceQty(e.target.value)}
            />
          </FormField>
          <Button
            type="button"
            size="sm"
            className="self-end"
            disabled={!sourceDirty || props.recordDirty || reviewing}
            pending={mutations.source.isPending}
            onClick={() => void saveSource()}
          >
            {t('expiry.commerce.linkSource')}
          </Button>
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">{t('expiry.commerce.lossRule')}</p>
      {canPublish && !archived ? (
        <form
          className="flex flex-col gap-3 rounded-xl border p-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void publish();
          }}
        >
          {approvalChanged ? (
            <section
              aria-label={t('expiry.commerce.currentBasis')}
              className="flex flex-col gap-3 rounded-xl border border-warning p-3"
            >
              <p role="alert" className="text-sm text-warning">
                {t('expiry.commerce.approvalChanged')}
              </p>
              <SourceEvidence source={commerce.source} unit={props.item.product.baseUomName} />
              <ApprovalFacts basis={approvalBasisOf(item, commerce)} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-end"
                pending={reviewing}
                onClick={() => void reviewCurrentBasis()}
              >
                {t('expiry.commerce.reviewCurrentBasis')}
              </Button>
            </section>
          ) : null}
          <FormField label={t('expiry.commerce.context')} htmlFor="expiry-sale-context">
            <NativeSelect
              id="expiry-sale-context"
              value={contextKey}
              onChange={(e) => {
                startApprovalEdit();
                setContextKey(e.target.value);
              }}
            >
              <option value="">{t('expiry.commerce.chooseContext')}</option>
              {props.prices.map((row) => (
                <option
                  key={`${row.channel}:${row.contextId}:${row.warehouseId}`}
                  value={`${row.channel}:${row.contextId}:${row.warehouseId}`}
                >
                  {row.name} · {t(`expiry.commerce.channels.${row.channel}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label={t('expiry.commerce.markdownQty', { unit: item.product.baseUomName })}
              htmlFor="expiry-markdown-qty"
            >
              <Input
                id="expiry-markdown-qty"
                inputMode="decimal"
                value={qty}
                onChange={(e) => {
                  startApprovalEdit();
                  setQty(e.target.value);
                }}
              />
            </FormField>
            <FormField
              label={t('expiry.commerce.salePrice', { unit: item.product.baseUomName })}
              htmlFor="expiry-markdown-price"
            >
              <MoneyInput
                id="expiry-markdown-price"
                value={price}
                onValueChange={(value) => {
                  startApprovalEdit();
                  setPrice(value);
                }}
                suffix="₮"
              />
            </FormField>
          </div>
          <FormField
            label={t('expiry.commerce.payrollMonth')}
            htmlFor="expiry-markdown-month"
            hint={t('expiry.commerce.monthHint')}
          >
            <MonthInput
              id="expiry-markdown-month"
              value={month}
              onChange={(value) => {
                startApprovalEdit();
                setMonth(value);
              }}
            />
          </FormField>
          {shown && !valid ? (
            <p className="text-sm text-destructive" role="alert">
              {t('expiry.commerce.checkFields')}
            </p>
          ) : null}
          {!commerce.source || !commerce.source.current ? (
            <p className="text-sm text-warning">{t('expiry.commerce.sourceRequired')}</p>
          ) : null}
          {props.recordDirty || sourceDirty ? (
            <p className="text-sm text-warning">{t('expiry.commerce.saveFirst')}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t('expiry.commerce.liabilityFrozen')}</p>
          <Button
            type="submit"
            className="self-end"
            disabled={
              !shownBasis.source?.current ||
              !shownBasis.liabilityFingerprint ||
              approvalChanged ||
              sourceDirty ||
              props.recordDirty ||
              reviewing ||
              item.editVersion !== commerce.itemVersion
            }
            pending={mutations.publish.isPending}
          >
            {t('expiry.commerce.publish')}
          </Button>
        </form>
      ) : null}
      {commerce.markdowns.map((offer) => (
        <div key={offer.id} className="flex flex-col gap-3 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {formatMnt(offer.unitPrice)} / {item.product.baseUomName}
            </span>
            <Badge variant={offer.stoppedAt ? 'outline' : 'success'}>
              {t(offer.stoppedAt ? 'expiry.commerce.stopped' : 'expiry.commerce.active')}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {
              props.prices.find(
                (row) =>
                  row.contextId === offer.contextId &&
                  row.channel === offer.channel &&
                  row.warehouseId === offer.warehouseId,
              )?.name
            }{' '}
            · {t(`expiry.commerce.channels.${offer.channel}`)} · {formatUbMinute(offer.startsAt)}
          </p>
          <FactChips
            facts={[
              { label: t('expiry.commerce.allowedQty'), value: formatQty(offer.qtyBudget) },
              { label: t('expiry.commerce.soldQty'), value: formatQty(offer.qtySold) },
              { label: t('expiry.commerce.remainingQty'), value: formatQty(offer.qtyAvailable) },
              ...(canLiability
                ? [
                    {
                      label: t('expiry.commerce.payrollMonth'),
                      value: offer.payrollMonth ?? t('expiry.commerce.noChargeMonth'),
                    },
                    {
                      label: t('expiry.commerce.frozenPeople'),
                      value:
                        offer.liableUserIds
                          .map(
                            (id) =>
                              options.data?.users.find((person) => person.id === id)?.fullName ??
                              `#${id}`,
                          )
                          .join(', ') || t('common.none'),
                    },
                  ]
                : []),
            ]}
          />
          <ExpiryBarcodeLabel
            barcode={offer.barcode}
            name={item.product.name}
            price={formatMnt(offer.unitPrice)}
            expiryDate={offer.expiryDate}
          />
          {canPayroll ? (
            <PayrollSourceDeductions sourceReference={`expiry:${item.id}/markdown:${offer.id}`} />
          ) : null}
          {canPublish && !offer.stoppedAt ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-end"
              pending={mutations.stop.isPending}
              onClick={() => {
                let stopKey = stopKeys.current.get(offer.id);
                if (!stopKey) {
                  stopKey = randomUuid();
                  stopKeys.current.set(offer.id, stopKey);
                }
                void action.run(() => mutations.stop.mutateAsync({ id: offer.id, key: stopKey }));
              }}
            >
              {t('expiry.commerce.stop')}
            </Button>
          ) : null}
        </div>
      ))}
      {(commerce.exceptions ?? []).map((exception) => (
        <SaleException
          key={exception.id}
          exception={exception}
          itemId={item.id}
          canResolve={canPublish}
          onDirty={onExceptionDirty}
        />
      ))}
    </div>
  );
}

function ApprovalFacts({ basis }: { basis: ApprovalBasis }) {
  const { t } = useTranslation();
  return (
    <FactChips
      facts={[
        { label: t('expiry.commerce.approvalExpiryDate'), value: basis.expiryDate },
        {
          label: t('expiry.commerce.approvalPeople'),
          value: basis.liableUsers.map((person) => person.fullName).join(', ') || t('common.none'),
        },
      ]}
    />
  );
}

function SaleException(props: {
  exception: ExpiryCommerceView['exceptions'][number];
  itemId: number;
  canResolve: boolean;
  onDirty: (id: number, dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const { exception, onDirty } = props;
  const [note, setNote] = useState('');
  const key = useRef(randomUuid());
  const mutations = useExpiryCommerceMutations(props.itemId);
  const action = useAction();
  const dirty = note !== '';
  useEffect(() => {
    onDirty(exception.id, dirty);
    return () => onDirty(exception.id, false);
  }, [onDirty, exception.id, dirty]);
  const cancel = () => {
    setNote('');
    key.current = randomUuid();
    action.clear();
  };
  const resolve = async () => {
    if (!note.trim()) return;
    const submitted = note;
    const ok = await action.run(() =>
      mutations.resolve.mutateAsync({ id: exception.id, key: key.current, note: note.trim() }),
    );
    if (ok) setNote((current) => (current === submitted ? '' : current));
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-warning p-3">
      <p className="font-medium">{t('expiry.commerce.exceptionTitle')}</p>
      <p className="text-sm">
        {t(`expiry.commerce.exceptions.${exception.reason}`, {
          defaultValue: t('expiry.commerce.exceptionOther'),
        })}{' '}
        · {formatQty(exception.qtyBase)} · {formatUbMinute(exception.soldAt)}
      </p>
      <p className="text-xs text-muted-foreground">{t('expiry.commerce.exceptionHint')}</p>
      {exception.resolvedAt ? (
        <>
          <p className="text-sm">
            {t('expiry.commerce.exceptionResolved')} · {exception.resolutionNote}
          </p>
          {dirty ? (
            <>
              <p className="text-sm text-warning">{t('expiry.commerce.exceptionNoteHeld')}</p>
              <p className="text-sm whitespace-pre-wrap">{note}</p>
              <Button type="button" variant="outline" size="sm" onClick={cancel}>
                {t('common.cancel')}
              </Button>
            </>
          ) : null}
        </>
      ) : props.canResolve ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void resolve();
          }}
        >
          <ProblemAlert problem={action.problem} />
          <FormField
            label={t('expiry.commerce.resolutionNote')}
            htmlFor={`expiry-exception-${exception.id}`}
          >
            <Textarea
              id={`expiry-exception-${exception.id}`}
              maxLength={500}
              value={note}
              disabled={mutations.resolve.isPending}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="self-end"
            disabled={!note.trim()}
            pending={mutations.resolve.isPending}
          >
            {t('expiry.commerce.resolveException')}
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-end"
              disabled={mutations.resolve.isPending}
              onClick={cancel}
            >
              {t('common.cancel')}
            </Button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
