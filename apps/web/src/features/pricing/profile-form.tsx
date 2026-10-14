import { zodResolver } from '@hookform/resolvers/zod';
import { Decimal } from '@tugeel/shared/money';
import {
  MAX_PRICE_PROFILE_NAME,
  PRICE_ROUNDINGS,
  type PriceProfileIssue,
  type PriceProfileValues as ProfileValues,
  perBasePrices,
  priceProfileIssue,
} from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { DialogFormFooter, FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ValidationMessage } from '@/lib/forms';
import { formatMnt, plainDecimal } from '@/lib/money';
import { problemFromError, settle } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { randomUuid } from '@/lib/uuid';
import { type PriceProfile, type PriceProfileVersion, usePricingMutations } from './api';

/** The NUMERIC(5,2) markups and the NUMERIC(14,3) bulk quantity, as typed. */
const MARKUP = /^\d{1,3}(\.\d{1,2})?$/;
const BULK_QTY = /^\d{1,11}(\.\d{1,3})?$/;

const ISSUE_MESSAGES: Record<PriceProfileIssue, ValidationMessage> = {
  PERCENT_RANGE: 'validation.markup',
  BULK_PAIR: 'validation.bulkPair',
  BULK_QTY_RANGE: 'validation.bulkQty',
  BULK_NOT_BELOW_RETAIL: 'validation.bulkBelowRetail',
};

interface TypedValues {
  looseMarkupPct: string;
  retailMarkupPct: string;
  bulk: boolean;
  retailBulkMinQty: string;
  retailBulkMarkupPct: string;
  rounding: ProfileValues['rounding'];
}

/** The typed values as the shared rules take them, or null while a number is not one yet. */
function typedProfileValues(values: TypedValues): ProfileValues | null {
  const numbers = [values.looseMarkupPct, values.retailMarkupPct];
  if (!numbers.every((value) => MARKUP.test(value.trim()))) return null;
  if (
    values.bulk &&
    !(
      BULK_QTY.test(values.retailBulkMinQty.trim()) &&
      MARKUP.test(values.retailBulkMarkupPct.trim())
    )
  ) {
    return null;
  }
  return {
    looseMarkupPct: new Decimal(values.looseMarkupPct.trim()),
    retailMarkupPct: new Decimal(values.retailMarkupPct.trim()),
    retailBulkMinQty: values.bulk ? new Decimal(values.retailBulkMinQty.trim()) : null,
    retailBulkMarkupPct: values.bulk ? new Decimal(values.retailBulkMarkupPct.trim()) : null,
    rounding: values.rounding,
  };
}

/**
 * The profile's values (ADR-0048 #3): each number's shape here, the rules between them by the
 * shared `priceProfileIssue` — the api and the database check the same.
 */
const profileSchema = (creating: boolean) =>
  z
    .object({
      name: creating
        ? z
            .string()
            .trim()
            .min(1, 'validation.required')
            .max(MAX_PRICE_PROFILE_NAME, 'validation.tooLong')
        : z.string(),
      looseMarkupPct: z.string().trim().regex(MARKUP, 'validation.markup'),
      retailMarkupPct: z.string().trim().regex(MARKUP, 'validation.markup'),
      bulk: z.boolean(),
      retailBulkMinQty: z.string().trim(),
      retailBulkMarkupPct: z.string().trim(),
      rounding: z.enum(PRICE_ROUNDINGS),
      validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date'),
    })
    .superRefine((values, ctx) => {
      if (values.bulk && !BULK_QTY.test(values.retailBulkMinQty)) {
        ctx.addIssue({ code: 'custom', path: ['retailBulkMinQty'], message: 'validation.bulkQty' });
      }
      if (values.bulk && !MARKUP.test(values.retailBulkMarkupPct)) {
        ctx.addIssue({
          code: 'custom',
          path: ['retailBulkMarkupPct'],
          message: 'validation.markup',
        });
      }
      const typed = typedProfileValues(values);
      const problem = typed ? priceProfileIssue(typed) : null;
      if (problem) {
        ctx.addIssue({
          code: 'custom',
          path: [problem.field],
          message: ISSUE_MESSAGES[problem.issue],
        });
      }
    });
const CREATE_SCHEMA = profileSchema(true);
const VERSION_SCHEMA = profileSchema(false);
type ProfileFormValues = z.infer<typeof CREATE_SCHEMA>;

/** The values a new version starts from: the latest planned ones, else today's, else the last. */
function latestValues(profile: PriceProfile): PriceProfileVersion | null {
  return profile.scheduled.at(-1) ?? profile.current ?? profile.history[0] ?? null;
}

function defaultsOf(profile: PriceProfile | null, today: string): ProfileFormValues {
  const latest = profile ? latestValues(profile) : null;
  return {
    name: profile?.name ?? '',
    looseMarkupPct: latest ? plainDecimal(latest.looseMarkupPct) : '',
    retailMarkupPct: latest ? plainDecimal(latest.retailMarkupPct) : '',
    bulk: latest ? latest.retailBulkMinQty !== null : false,
    retailBulkMinQty: latest?.retailBulkMinQty ? plainDecimal(latest.retailBulkMinQty) : '',
    retailBulkMarkupPct: latest?.retailBulkMarkupPct
      ? plainDecimal(latest.retailBulkMarkupPct)
      : '',
    rounding: latest?.rounding ?? 'WHOLE',
    validFrom: today,
  };
}

/**
 * «Шинэ тохиргоо» (profile null) or «Шинэ утга оруулах» of a profile (ADR-0048 #3, pricing.manage):
 * the markups, the supermarket's bulk price behind a switch, the rounding and the day the values
 * start, with an example worked out as the values are typed. One Idempotency-Key per dialog.
 */
export function ProfileValuesDialog(props: { profile: PriceProfile | null; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = usePricingMutations();
  const creating = props.profile === null;
  const [today] = useState(businessDate);
  const [key] = useState(randomUuid);
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(creating ? CREATE_SCHEMA : VERSION_SCHEMA),
    defaultValues: defaultsOf(props.profile, today),
  });
  const watched = useWatch({ control: form.control });
  const bulk = watched.bulk ?? false;
  const typed = typedProfileValues({
    looseMarkupPct: watched.looseMarkupPct ?? '',
    retailMarkupPct: watched.retailMarkupPct ?? '',
    bulk,
    retailBulkMinQty: watched.retailBulkMinQty ?? '',
    retailBulkMarkupPct: watched.retailBulkMarkupPct ?? '',
    rounding: watched.rounding ?? 'WHOLE',
  });
  const example = typed && !priceProfileIssue(typed) ? typed : null;
  const mutation = creating ? mutations.createProfile : mutations.setProfileVersion;
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    const body = {
      looseMarkupPct: values.looseMarkupPct,
      retailMarkupPct: values.retailMarkupPct,
      retailBulkMinQty: values.bulk ? values.retailBulkMinQty : null,
      retailBulkMarkupPct: values.bulk ? values.retailBulkMarkupPct : null,
      rounding: values.rounding,
      validFrom: values.validFrom,
    };
    if (props.profile === null) {
      const created = await settle(
        mutations.createProfile.mutateAsync({ key, name: values.name, ...body }),
      );
      if (!created) return;
      toast.success(t('pricing.profiles.created'));
      void navigate(`/pricing/profiles/${created.id}`, { replace: true });
      return;
    }
    const saved = await settle(
      mutations.setProfileVersion.mutateAsync({ key, id: props.profile.id, ...body }),
    );
    if (!saved) return;
    toast.success(t('pricing.profiles.saved'));
    props.onClose();
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-xl">
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>
              {creating ? t('pricing.profiles.new') : t('pricing.profiles.setValues')}
            </DialogTitle>
            <DialogDescription>
              {props.profile === null
                ? t('pricing.profiles.newHint')
                : t('pricing.profiles.setValuesHint', { name: props.profile.name })}
            </DialogDescription>
          </DialogHeader>
          <ProblemAlert problem={problemFromError(mutation.error)} />
          {creating ? (
            <FormField
              label={t('pricing.profiles.fields.name')}
              htmlFor="profile-name"
              error={errors.name?.message}
            >
              <Input id="profile-name" autoComplete="off" {...form.register('name')} />
            </FormField>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label={t('pricing.profiles.fields.loose')}
              htmlFor="profile-loose"
              hint={t('pricing.profiles.fields.looseHint')}
              error={errors.looseMarkupPct?.message}
            >
              <Input
                id="profile-loose"
                inputMode="decimal"
                autoComplete="off"
                className="font-mono"
                {...form.register('looseMarkupPct')}
              />
            </FormField>
            <FormField
              label={t('pricing.profiles.fields.retail')}
              htmlFor="profile-retail"
              hint={t('pricing.profiles.fields.retailHint')}
              error={errors.retailMarkupPct?.message}
            >
              <Input
                id="profile-retail"
                inputMode="decimal"
                autoComplete="off"
                className="font-mono"
                {...form.register('retailMarkupPct')}
              />
            </FormField>
          </div>
          <Controller
            control={form.control}
            name="bulk"
            render={({ field }) => (
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="profile-bulk">{t('pricing.profiles.fields.bulk')}</Label>
                <Switch id="profile-bulk" checked={field.value} onCheckedChange={field.onChange} />
              </div>
            )}
          />
          {bulk ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label={t('pricing.profiles.fields.bulkQty')}
                htmlFor="profile-bulk-qty"
                hint={t('pricing.profiles.fields.bulkQtyHint')}
                error={errors.retailBulkMinQty?.message}
              >
                <Input
                  id="profile-bulk-qty"
                  inputMode="decimal"
                  autoComplete="off"
                  className="font-mono"
                  {...form.register('retailBulkMinQty')}
                />
              </FormField>
              <FormField
                label={t('pricing.profiles.fields.bulkPct')}
                htmlFor="profile-bulk-pct"
                error={errors.retailBulkMarkupPct?.message}
              >
                <Input
                  id="profile-bulk-pct"
                  inputMode="decimal"
                  autoComplete="off"
                  className="font-mono"
                  {...form.register('retailBulkMarkupPct')}
                />
              </FormField>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('pricing.profiles.fields.rounding')} htmlFor="profile-rounding">
              <NativeSelect id="profile-rounding" {...form.register('rounding')}>
                {PRICE_ROUNDINGS.map((rounding) => (
                  <option key={rounding} value={rounding}>
                    {t(`pricing.roundings.${rounding}`)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              label={t('pricing.profiles.fields.validFrom')}
              htmlFor="profile-valid-from"
              error={errors.validFrom?.message}
            >
              <Input
                id="profile-valid-from"
                type="date"
                min={today}
                {...form.register('validFrom')}
              />
            </FormField>
          </div>
          {example ? <ProfileExample values={example} /> : null}
          <DialogFormFooter pending={isSubmitting} onCancel={props.onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

const renameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'validation.required')
    .max(MAX_PRICE_PROFILE_NAME, 'validation.tooLong'),
});
type RenameValues = z.infer<typeof renameSchema>;

/** «Нэр солих»: products keep their profile; every page shows the new name. */
export function RenameProfileDialog(props: { profile: PriceProfile; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = usePricingMutations();
  const form = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name: props.profile.name },
  });
  const submit = form.handleSubmit(async ({ name }) => {
    const renamed = await settle(
      mutations.renameProfile.mutateAsync({ id: props.profile.id, name }),
    );
    if (!renamed) return;
    toast.success(t('pricing.profiles.renamed'));
    props.onClose();
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{t('pricing.profiles.rename')}</DialogTitle>
          </DialogHeader>
          <ProblemAlert problem={problemFromError(mutations.renameProfile.error)} />
          <FormField
            label={t('pricing.profiles.fields.name')}
            htmlFor="profile-rename"
            error={errors.name?.message}
          >
            <Input id="profile-rename" autoComplete="off" {...form.register('name')} />
          </FormField>
          <DialogFormFooter pending={isSubmitting} onCancel={props.onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The warehouse price the examples start from: 1,000₮ a base unit. */
const EXAMPLE_PRICE = new Decimal(1000);

/**
 * What a product with a warehouse price of 1,000₮ costs on each basis under a profile's values,
 * worked out by the shared `perBasePrices` as orders will be (the profile page and its dialogs).
 */
export function ProfileExample({ values }: { values: ProfileValues }) {
  const { t } = useTranslation();
  const prices = perBasePrices(EXAMPLE_PRICE, values);
  const money = (amount: Decimal) => t('pricing.money', { amount: formatMnt(amount.toFixed(0)) });
  const markup = (pct: Decimal) =>
    t('pricing.profiles.markup', { pct: plainDecimal(pct.toString()) });
  const rows = [
    {
      key: 'WAREHOUSE',
      basis: t('pricing.bases.WAREHOUSE'),
      markup: null,
      price: prices.warehouse,
    },
    {
      key: 'LOOSE',
      basis: t('pricing.bases.LOOSE'),
      markup: markup(values.looseMarkupPct),
      price: prices.loose,
    },
    {
      key: 'RETAIL',
      basis: t('pricing.bases.RETAIL'),
      markup: markup(values.retailMarkupPct),
      price: prices.retail,
    },
    ...(prices.retailBulk && values.retailBulkMinQty && values.retailBulkMarkupPct
      ? [
          {
            key: 'RETAIL_BULK',
            basis: t('pricing.profiles.bulkBasis', {
              qty: plainDecimal(values.retailBulkMinQty.toString()),
            }),
            markup: markup(values.retailBulkMarkupPct),
            price: prices.retailBulk,
          },
        ]
      : []),
  ];
  const title = t('pricing.profiles.example', { price: formatMnt(EXAMPLE_PRICE.toFixed(0)) });

  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('pricing.profiles.exampleColumns.basis')}</TableHead>
            <TableHead className="text-right">
              {t('pricing.profiles.exampleColumns.markup')}
            </TableHead>
            <TableHead className="text-right">
              {t('pricing.profiles.exampleColumns.price')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>{row.basis}</TableCell>
              <TableCell className="text-right font-mono">
                {row.markup ?? t('common.none')}
              </TableCell>
              <TableCell className="text-right font-mono">{money(row.price)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        {t('pricing.profiles.roundingNote', {
          rounding: t(`pricing.roundings.${values.rounding}`),
        })}
      </p>
    </section>
  );
}
