import { Decimal } from '@tugeel/shared/money';
import { LOYALTY_LIMITS } from '@tugeel/shared/pos';
import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { DetailCard } from '@/components/detail';
import { FieldError } from '@/components/field-error';
import { FormFooter } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ValidationMessage } from '@/lib/forms';
import { formatMnt, plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type LoyaltyTier, useLoyaltyMutations, useLoyaltyTiers } from './loyalty-api';

interface Draft {
  key: string;
  id: number | null;
  name: string;
  fromAmount: string;
  percent: string;
}

const WHOLE = /^\d{1,12}$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;

/** A row's problems, by field; empty when the row can be saved. */
function rowErrors(row: Draft, repeated: boolean) {
  const errors: {
    name?: ValidationMessage;
    fromAmount?: ValidationMessage;
    percent?: ValidationMessage;
  } = {};
  const name = row.name.trim();
  if (name === '') errors.name = 'validation.required';
  else if (name.length > LOYALTY_LIMITS.maxTierName) errors.name = 'validation.tooLong';
  const from = row.fromAmount.trim();
  if (!WHOLE.test(from) || new Decimal(from).gt(LOYALTY_LIMITS.maxTierFrom)) {
    errors.fromAmount = 'validation.tierFrom';
  } else if (repeated) {
    errors.fromAmount = 'validation.tierFromRepeated';
  }
  const percent = row.percent.trim();
  if (!PERCENT.test(percent) || new Decimal(percent).lte(0) || new Decimal(percent).gt(100)) {
    errors.percent = 'validation.tierPercent';
  }
  return errors;
}

/**
 * «Бонус картын түвшин» (ADR-0112): from which lifetime spend a member earns which percentage.
 * Saved as a whole list, sorted by the threshold; a tier left out is retired. No tiers: nobody
 * earns.
 */
export function LoyaltyTiersCard() {
  const { t } = useTranslation();
  const tiers = useLoyaltyTiers();
  const canManage = useHasPermission('pos.manage');
  if (tiers.error) return <ProblemAlert problem={problemFromError(tiers.error)} />;
  if (!tiers.data) return null;
  const data = tiers.data;
  return (
    <DetailCard
      title={t('posLoyalty.tiers.title')}
      canEdit={canManage}
      view={<TiersView tiers={data} />}
      edit={(close) => <TiersForm tiers={data} onClose={close} />}
    />
  );
}

const byThreshold = <T extends { fromAmount: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => new Decimal(a.fromAmount).comparedTo(new Decimal(b.fromAmount)));

function TiersView({ tiers }: { tiers: LoyaltyTier[] }) {
  const { t } = useTranslation();
  if (tiers.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('posLoyalty.tiers.empty')}</p>;
  }
  return (
    <ol className="divide-y divide-border">
      {byThreshold(tiers).map((tier) => (
        <li key={tier.id} className="flex items-center gap-3 py-2 text-sm">
          <span className="flex-1 font-medium">{tier.name}</span>
          <span className="font-mono text-muted-foreground">
            {t('posLoyalty.tiers.example', {
              from: formatMnt(tier.fromAmount),
              percent: plainDecimal(tier.percent),
            })}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TiersForm({ tiers, onClose }: { tiers: LoyaltyTier[]; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useLoyaltyMutations();
  const action = useAction();
  const [rows, setRows] = useState<Draft[]>(() =>
    byThreshold(tiers).map((tier) => ({
      key: `id-${tier.id}`,
      id: tier.id,
      name: tier.name,
      fromAmount: new Decimal(tier.fromAmount).toFixed(0),
      percent: plainDecimal(tier.percent),
    })),
  );
  const [added, setAdded] = useState(0);
  const [checked, setChecked] = useState(false);
  const update = (key: string, patch: Partial<Draft>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const thresholds = rows.map((row) => row.fromAmount.trim());
  const errors = rows.map((row, index) =>
    rowErrors(row, thresholds.indexOf(thresholds[index] ?? '') !== index),
  );
  const valid = errors.every((error) => Object.keys(error).length === 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!valid) return;
    void action
      .run(async () => {
        await mutations.saveTiers.mutateAsync({
          tiers: byThreshold(
            rows.map((row) => ({
              id: row.id,
              name: row.name.trim(),
              fromAmount: row.fromAmount.trim(),
              percent: row.percent.trim(),
            })),
          ),
        });
        toast.success(t('posLoyalty.tiers.saved'));
      })
      .then((ok) => {
        if (ok) onClose();
      });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <p className="text-sm text-muted-foreground">{t('posLoyalty.tiers.hint')}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('posLoyalty.tiers.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            aria-hidden
            className="hidden gap-2 text-[13px] text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_12rem_7rem_2.25rem]"
          >
            <span>{t('posLoyalty.tiers.columns.name')}</span>
            <span>{t('posLoyalty.tiers.columns.from')}</span>
            <span>{t('posLoyalty.tiers.columns.percent')}</span>
            <span />
          </div>
          <ol className="space-y-2">
            {rows.map((row, index) => {
              const place = index + 1;
              const error = checked ? errors[index] : undefined;
              return (
                <li
                  key={row.key}
                  className="grid grid-cols-[minmax(0,1fr)_6rem_2.25rem] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_7rem_2.25rem]"
                >
                  <div className="col-span-3 flex flex-col gap-1 sm:col-span-1">
                    <Input
                      aria-label={t('posLoyalty.tiers.name', { place })}
                      maxLength={LOYALTY_LIMITS.maxTierName}
                      value={row.name}
                      onChange={(event) => update(row.key, { name: event.target.value })}
                    />
                    <FieldError message={error?.name} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Input
                      aria-label={t('posLoyalty.tiers.from', { place })}
                      inputMode="numeric"
                      className="font-mono"
                      value={row.fromAmount}
                      onChange={(event) => update(row.key, { fromAmount: event.target.value })}
                    />
                    <FieldError message={error?.fromAmount} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Input
                      aria-label={t('posLoyalty.tiers.percent', { place })}
                      inputMode="decimal"
                      className="font-mono"
                      value={row.percent}
                      onChange={(event) => update(row.key, { percent: event.target.value })}
                    />
                    <FieldError message={error?.percent} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('posLoyalty.tiers.remove', { place })}
                    onClick={() =>
                      setRows((current) => current.filter((other) => other.key !== row.key))
                    }
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={rows.length >= LOYALTY_LIMITS.maxTiers}
        onClick={() => {
          setRows((current) => [
            ...current,
            { key: `new-${added}`, id: null, name: '', fromAmount: '', percent: '' },
          ]);
          setAdded((count) => count + 1);
        }}
      >
        <Plus />
        {t('posLoyalty.tiers.add')}
      </Button>
      <ProblemAlert problem={action.problem} />
      <FormFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={mutations.saveTiers.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}
