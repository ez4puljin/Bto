import { defaultWholeUomId } from '@tugeel/shared/pricing';
import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
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
import { formatMnt, plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type PriceProfile,
  type ProductPriceView,
  type SetPriceTermsRequest,
  usePriceProfileChoices,
  usePricingMutations,
  useProductPrices,
} from './api';
import { WHOLE_MNT } from './helpers';
import { previewTable, useProfileSummary, useUnitLabel } from './price-views';

type Issue =
  | 'pricing.dialog.noChanges'
  | 'pricing.dialog.invalidPrice'
  | 'pricing.dialog.profileRequired'
  | 'pricing.dialog.wholeRequired';

/**
 * A product's price terms (ADR-0048 #2), from the product page or the list of products waiting for
 * their prices: the warehouse price of one base unit, the price profile and the pack counted as
 * whole, with every unit's prices previewed by the shared functions. One Idempotency-Key per save.
 * While the product waits for its prices (ADR-0044) the terms start today and «Бүрэн болгох» saves
 * them, then completes the product.
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
  const profiles = usePriceProfileChoices();
  const loadProblem = problemFromError(prices.error) ?? problemFromError(profiles.error);
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
        <ProblemAlert problem={loadProblem} />
        {prices.data && profiles.data ? (
          <PriceEntryForm
            view={prices.data}
            profiles={profiles.data}
            pending={props.pending}
            onClose={props.onClose}
          />
        ) : loadProblem ? null : (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PriceEntryForm(props: {
  view: ProductPriceView;
  profiles: readonly PriceProfile[];
  pending: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { view, profiles, pending, onClose } = props;
  const mutations = usePricingMutations();
  const action = useAction();
  const unitLabel = useUnitLabel(view.units);
  const summary = useProfileSummary();
  const packs = view.units.filter((unit) => !unit.isBase);
  const base = view.units.find((unit) => unit.isBase);
  const current = view.current;
  const [key, setKey] = useState(randomUuid);
  const [completeKey] = useState(randomUuid);
  const [price, setPrice] = useState(current ? plainDecimal(current.warehousePrice) : '');
  const [profileId, setProfileId] = useState<number | undefined>(() =>
    current && profiles.some((profile) => profile.id === current.profileId)
      ? current.profileId
      : profiles.length === 1
        ? profiles[0]?.id
        : undefined,
  );
  const [wholeUomId, setWholeUomId] = useState<number | null>(() => {
    const kept = packs.find((unit) => unit.uomId === current?.wholeUomId);
    return kept ? kept.uomId : defaultWholeUomId(packs);
  });
  const [validFrom, setValidFrom] = useState(view.today);
  const [issue, setIssue] = useState<Issue | null>(null);
  const chosen = profiles.find((profile) => profile.id === profileId);
  const typedPrice = price.replace(/[\s,]/g, '');
  const whole = packs.length > 0 ? wholeUomId : null;
  const preview = previewTable(view.units, typedPrice, chosen?.current ?? null, whole);
  const hasBulk = preview?.some((row) => row.retailBulk !== null) ?? false;
  const busy = mutations.setTerms.isPending || mutations.completeProducts.isPending;
  const termsMissing = action.problem?.code === 'PRICE_MISSING';

  /** The terms to send, or null after naming what is wrong. */
  const terms = (): SetPriceTermsRequest | null => {
    setIssue(null);
    if (!WHOLE_MNT.test(typedPrice)) {
      setIssue('pricing.dialog.invalidPrice');
      return null;
    }
    if (profileId === undefined) {
      setIssue('pricing.dialog.profileRequired');
      return null;
    }
    if (packs.length > 0 && wholeUomId === null) {
      setIssue('pricing.dialog.wholeRequired');
      return null;
    }
    return {
      productId: view.productId,
      validFrom: pending ? view.today : validFrom,
      warehousePrice: typedPrice,
      profileId,
      wholeUomId: whole,
    };
  };
  const unchanged = (body: SetPriceTermsRequest) =>
    current !== null &&
    plainDecimal(current.warehousePrice) === body.warehousePrice &&
    current.profileId === body.profileId &&
    current.wholeUomId === body.wholeUomId;

  const store = async (body: SetPriceTermsRequest) => {
    await mutations.setTerms.mutateAsync({ key, ...body });
    // Saved: the next save is a new intent.
    setKey(randomUuid());
  };

  const save = async () => {
    const body = terms();
    if (!body) return;
    if (unchanged(body) && body.validFrom === view.today) {
      setIssue('pricing.dialog.noChanges');
      return;
    }
    if (await action.run(() => store(body))) {
      toast.success(t('pricing.dialog.saved'));
      onClose();
    }
  };

  const complete = async () => {
    const body = terms();
    if (!body) return;
    const ok = await action.run(async () => {
      if (!unchanged(body)) await store(body);
      await mutations.completeProducts.mutateAsync({
        key: completeKey,
        productIds: [view.productId],
      });
    });
    if (ok) {
      toast.success(t('pricing.saleReady.completed'));
      onClose();
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void (pending ? complete() : save());
      }}
    >
      {/* A refused completion says what it needs rather than the generic message. */}
      <ProblemAlert problem={termsMissing ? null : action.problem} />
      {termsMissing ? (
        <p className="text-sm text-destructive">{t('pricing.dialog.termsRequired')}</p>
      ) : null}
      {issue ? <p className="text-sm text-destructive">{t(issue)}</p> : null}
      <FormField
        label={t('pricing.dialog.warehousePrice')}
        htmlFor="price-warehouse"
        hint={t('pricing.dialog.warehousePriceHint', { unit: base?.uomName ?? '' })}
      >
        <Input
          id="price-warehouse"
          inputMode="numeric"
          autoComplete="off"
          className="font-mono sm:w-44"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </FormField>
      <FormField
        label={t('pricing.dialog.profile')}
        htmlFor="price-profile"
        hint={
          chosen
            ? chosen.current
              ? summary(chosen.current)
              : t('pricing.dialog.noValuesToday')
            : null
        }
      >
        {profiles.length === 0 ? (
          <p className="text-sm text-warning">{t('pricing.dialog.noProfiles')}</p>
        ) : (
          <NativeSelect
            id="price-profile"
            value={profileId === undefined ? '' : String(profileId)}
            onChange={(event) => {
              const id = Number.parseInt(event.target.value, 10);
              setProfileId(Number.isSafeInteger(id) ? id : undefined);
            }}
          >
            <option value="">{t('pricing.dialog.pickProfile')}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={String(profile.id)}>
                {profile.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {packs.length > 0 ? (
        <FormField
          label={t('pricing.dialog.wholeUnit')}
          htmlFor="price-whole"
          hint={t('pricing.dialog.wholeUnitHint')}
        >
          <NativeSelect
            id="price-whole"
            value={wholeUomId === null ? '' : String(wholeUomId)}
            onChange={(event) => {
              const id = Number.parseInt(event.target.value, 10);
              setWholeUomId(Number.isSafeInteger(id) ? id : null);
            }}
          >
            <option value="">{t('pricing.dialog.pickWhole')}</option>
            {packs.map((unit) => (
              <option key={unit.uomId} value={String(unit.uomId)}>
                {unitLabel(unit)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      ) : (
        <p className="text-sm text-muted-foreground">{t('pricing.dialog.noPacks')}</p>
      )}
      {pending ? (
        <p className="text-sm text-muted-foreground">
          {t('pricing.dialog.fromToday', { date: view.today })}
        </p>
      ) : (
        <FormField label={t('pricing.dialog.validFrom')} htmlFor="price-valid-from">
          <Input
            id="price-valid-from"
            type="date"
            min={view.today}
            value={validFrom}
            onChange={(event) => setValidFrom(event.target.value)}
            className="sm:w-44"
          />
        </FormField>
      )}
      {preview ? (
        <section aria-label={t('pricing.dialog.preview')} className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t('pricing.dialog.preview')}
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('pricing.card.columns.unit')}</TableHead>
                <TableHead className="text-right">{t('pricing.card.columns.wholesale')}</TableHead>
                <TableHead className="text-right">{t('pricing.card.columns.retail')}</TableHead>
                {hasBulk ? (
                  <TableHead className="text-right">
                    {t('pricing.card.columns.retailBulk')}
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((row) => {
                const unit = view.units.find((candidate) => candidate.productUnitId === row.unitId);
                return (
                  <TableRow key={row.unitId}>
                    <TableCell>{unit ? unitLabel(unit) : null}</TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono">
                        {t('pricing.money', { amount: formatMnt(row.wholesale.toFixed(0)) })}
                      </span>
                      <Badge variant="outline" className="ml-2">
                        {t(`pricing.card.bases.${row.wholesaleBasis}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {t('pricing.money', { amount: formatMnt(row.retail.toFixed(0)) })}
                    </TableCell>
                    {hasBulk ? (
                      <TableCell className="text-right font-mono">
                        {row.retailBulk
                          ? t('pricing.money', { amount: formatMnt(row.retailBulk.toFixed(0)) })
                          : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        {pending ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy || profiles.length === 0}
              onClick={() => void save()}
            >
              {t('common.save')}
            </Button>
            <Button type="submit" disabled={busy || profiles.length === 0}>
              <CircleCheck />
              {t('pricing.saleReady.complete')}
            </Button>
          </>
        ) : (
          <Button type="submit" disabled={busy || profiles.length === 0}>
            {t('common.save')}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
