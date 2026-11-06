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
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { DateInput } from '@/components/date-input';
import { FormRow, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { type Crumb, PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { StickyActions } from '@/components/sticky-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { formatCount, formatMnt, plainDecimal } from '@/lib/money';
import { problemFromError, settle } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { randomUuid } from '@/lib/uuid';
import {
  type PriceProfile,
  type PriceProfileVersion,
  usePriceProfile,
  usePricingMutations,
} from './api';

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
 * The profile as typed (ADR-0048 #3, ADR-0160): each number's shape here, the rules between them by
 * the shared `priceProfileIssue` — the api and the database check the same.
 */
const PROFILE_SCHEMA = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'validation.required')
      .max(MAX_PRICE_PROFILE_NAME, 'validation.tooLong'),
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
type ProfileFormValues = z.infer<typeof PROFILE_SCHEMA>;

/** The values a new version starts from: the latest planned ones, else today's, else the last. */
function latestValues(profile: PriceProfile): PriceProfileVersion | null {
  return profile.scheduled.at(-1) ?? profile.current ?? profile.history[0] ?? null;
}

function defaultsOf(profile: PriceProfile | null, today: string): ProfileFormValues {
  const latest = profile ? latestValues(profile) : null;
  return {
    name: profile?.name ?? '',
    // Whole packs and loose pieces alike at the warehouse price until someone says otherwise.
    looseMarkupPct: latest ? plainDecimal(latest.looseMarkupPct) : '0',
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
 * The products that have this profile, as the product list shows them with its filter on, in a new
 * tab so the form or page behind it stays as it was.
 */
export function ProfileProductsLink(props: { profile: PriceProfile }) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/catalog/products?profile=${props.profile.id}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-[0.8125rem] text-link underline-offset-4 hover:underline"
    >
      <ExternalLink aria-hidden className="size-3.5 shrink-0" />
      {t('pricing.profiles.viewProducts', { count: formatCount(props.profile.productsToday) })}
    </Link>
  );
}

/** «Шинэ тохиргоо» (pricing.manage). */
export function PriceProfileCreatePage() {
  return <ProfileForm profile={null} />;
}

/** «Засах»: its name, and new values from a day on for every product using it (ADR-0160). */
export function PriceProfileEditPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const profile = usePriceProfile(id);
  const loadProblem = problemFromError(profile.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!profile.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  return (
    <ProfileForm
      profile={profile.data}
      crumbs={[{ label: profile.data.name, to: `/pricing/profiles/${id}` }]}
    />
  );
}

/**
 * The profile's page form: its name, the markups, the supermarket's bulk price behind a switch, the
 * rounding and the day the values start, with an example worked out as the values are typed. One
 * Idempotency-Key per page.
 */
function ProfileForm(props: { profile: PriceProfile | null; crumbs?: readonly Crumb[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = usePricingMutations();
  const { profile } = props;
  const [today] = useState(businessDate);
  const [key] = useState(randomUuid);
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(PROFILE_SCHEMA),
    defaultValues: defaultsOf(profile, today),
  });
  const watched = useWatch({ control: form.control });
  const bulk = watched.bulk ?? false;
  const typing = {
    looseMarkupPct: watched.looseMarkupPct ?? '',
    retailMarkupPct: watched.retailMarkupPct ?? '',
    bulk,
    retailBulkMinQty: watched.retailBulkMinQty ?? '',
    retailBulkMarkupPct: watched.retailBulkMarkupPct ?? '',
    rounding: watched.rounding ?? 'WHOLE',
  };
  // While the bulk fields are being typed the example keeps its other rows.
  const typed = typedProfileValues(typing) ?? typedProfileValues({ ...typing, bulk: false });
  const example = typed && !priceProfileIssue(typed) ? typed : null;
  const mutation = profile ? mutations.updateProfile : mutations.createProfile;
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    const body = {
      name: values.name,
      looseMarkupPct: values.looseMarkupPct,
      retailMarkupPct: values.retailMarkupPct,
      retailBulkMinQty: values.bulk ? values.retailBulkMinQty : null,
      retailBulkMarkupPct: values.bulk ? values.retailBulkMarkupPct : null,
      rounding: values.rounding,
      validFrom: values.validFrom,
    };
    const saved = await settle(
      profile
        ? mutations.updateProfile.mutateAsync({ id: profile.id, body })
        : mutations.createProfile.mutateAsync({ key, ...body }),
    );
    if (!saved) return;
    toast.success(t(profile ? 'pricing.profiles.saved' : 'pricing.profiles.created'));
    void navigate(`/pricing/profiles/${saved.id}`, { replace: true });
  });

  return (
    <div>
      <PageHeader
        title={t(profile ? 'pricing.profiles.edit' : 'pricing.profiles.new')}
        crumbs={props.crumbs}
      />
      <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
        <ProblemAlert problem={problemFromError(mutation.error)} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <Card>
            <CardContent className="flex flex-col gap-5">
              <FormSection title={t('pricing.profiles.sectionGeneral')}>
                <FormRow
                  label={t('pricing.profiles.fields.name')}
                  htmlFor="profile-name"
                  error={errors.name?.message}
                >
                  <Input id="profile-name" autoComplete="off" {...form.register('name')} />
                </FormRow>
                <FormRow
                  label={t('pricing.profiles.fields.validFrom')}
                  htmlFor="profile-valid-from"
                  hint={
                    profile
                      ? t('pricing.profiles.setValuesHint', { name: profile.name })
                      : t('pricing.profiles.newHint')
                  }
                  error={errors.validFrom?.message}
                >
                  <Controller
                    control={form.control}
                    name="validFrom"
                    render={({ field }) => (
                      <DateInput
                        id="profile-valid-from"
                        className="sm:w-44"
                        min={today}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                </FormRow>
              </FormSection>
              <FormSection
                title={t('pricing.profiles.sectionSales')}
                description={t('pricing.profiles.sectionSalesHint')}
              >
                <FormRow
                  label={t('pricing.profiles.fields.loose')}
                  htmlFor="profile-loose"
                  hint={t('pricing.profiles.fields.looseHint')}
                  error={errors.looseMarkupPct?.message}
                >
                  <Input
                    id="profile-loose"
                    inputMode="decimal"
                    autoComplete="off"
                    className="w-40 font-mono"
                    {...form.register('looseMarkupPct')}
                  />
                </FormRow>
              </FormSection>
              <FormSection
                title={t('pricing.profiles.sectionRetail')}
                description={t('pricing.profiles.sectionRetailHint')}
              >
                <FormRow
                  label={t('pricing.profiles.fields.retail')}
                  htmlFor="profile-retail"
                  hint={t('pricing.profiles.fields.retailHint')}
                  error={errors.retailMarkupPct?.message}
                >
                  <Input
                    id="profile-retail"
                    inputMode="decimal"
                    autoComplete="off"
                    className="w-40 font-mono"
                    {...form.register('retailMarkupPct')}
                  />
                </FormRow>
                <FormRow label={t('pricing.profiles.fields.bulk')} htmlFor="profile-bulk">
                  <Controller
                    control={form.control}
                    name="bulk"
                    render={({ field }) => (
                      <Switch
                        id="profile-bulk"
                        className="sm:mt-2"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </FormRow>
                {bulk ? (
                  <>
                    <FormRow
                      label={t('pricing.profiles.fields.bulkQty')}
                      htmlFor="profile-bulk-qty"
                      hint={t('pricing.profiles.fields.bulkQtyHint')}
                      error={errors.retailBulkMinQty?.message}
                    >
                      <Input
                        id="profile-bulk-qty"
                        inputMode="decimal"
                        autoComplete="off"
                        className="w-40 font-mono"
                        {...form.register('retailBulkMinQty')}
                      />
                    </FormRow>
                    <FormRow
                      label={t('pricing.profiles.fields.bulkPct')}
                      htmlFor="profile-bulk-pct"
                      error={errors.retailBulkMarkupPct?.message}
                    >
                      <Input
                        id="profile-bulk-pct"
                        inputMode="decimal"
                        autoComplete="off"
                        className="w-40 font-mono"
                        {...form.register('retailBulkMarkupPct')}
                      />
                    </FormRow>
                  </>
                ) : null}
              </FormSection>
              <FormSection title={t('pricing.profiles.sectionRounding')}>
                <FormRow label={t('pricing.profiles.fields.rounding')} htmlFor="profile-rounding">
                  <NativeSelect
                    id="profile-rounding"
                    className="sm:w-56"
                    {...form.register('rounding')}
                  >
                    {PRICE_ROUNDINGS.map((rounding) => (
                      <option key={rounding} value={rounding}>
                        {t(`pricing.roundings.${rounding}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormRow>
              </FormSection>
            </CardContent>
          </Card>
          <Card className="lg:sticky lg:top-20">
            <CardContent className="flex flex-col gap-3">
              {example ? (
                <ProfileExample values={example} layout="list" />
              ) : (
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t('pricing.profiles.example', { price: formatMnt(EXAMPLE_PRICE.toFixed(0)) })}
                  </h3>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {t('pricing.profiles.exampleEmpty')}
                  </p>
                </div>
              )}
              {profile ? <ProfileProductsLink profile={profile} /> : null}
            </CardContent>
          </Card>
        </div>
        <StickyActions>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              void navigate(profile ? `/pricing/profiles/${profile.id}` : '/pricing/profiles')
            }
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {t('common.save')}
          </Button>
        </StickyActions>
      </form>
    </div>
  );
}

/** The warehouse price the examples start from: 1,000₮ a base unit. */
const EXAMPLE_PRICE = new Decimal(1000);

/**
 * What a product with a warehouse price of 1,000₮ costs on each basis under a profile's values,
 * worked out by the shared `perBasePrices` as orders will be (the profile page and its dialogs).
 * `list` is the narrow form of a dialog's side column: one line per basis.
 */
export function ProfileExample({
  values,
  layout = 'table',
}: {
  values: ProfileValues;
  layout?: 'table' | 'list';
}) {
  const { t } = useTranslation();
  const prices = perBasePrices(EXAMPLE_PRICE, values);
  const money = (amount: Decimal) => t('pricing.money', { amount: formatMnt(amount.toFixed(0)) });
  const markup = (pct: Decimal) =>
    t('pricing.profiles.markup', { pct: plainDecimal(pct.toString()) });
  const sales = [
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
  ];
  const retail = [
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
  const groups = [
    { key: 'SALES', title: t('pricing.profiles.sectionSales'), rows: sales },
    { key: 'RETAIL', title: t('pricing.profiles.sectionRetail'), rows: retail },
  ];
  const title = t('pricing.profiles.example', { price: formatMnt(EXAMPLE_PRICE.toFixed(0)) });
  const roundingNote = (
    <p className="text-xs text-muted-foreground">
      {t('pricing.profiles.roundingNote', {
        rounding: t(`pricing.roundings.${values.rounding}`),
      })}
    </p>
  );

  if (layout === 'list') {
    return (
      <section aria-label={title} className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-1">
            <h4 className="text-xs font-medium text-muted-foreground">{group.title}</h4>
            <ul className="divide-y divide-border/80 rounded-lg bg-background shadow-control ring-1 ring-black/[0.04]">
              {group.rows.map((row) => (
                <li key={row.key} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 text-[0.8125rem]">
                    <span>{row.basis}</span>
                    {row.markup ? (
                      <span className="ml-1.5 font-mono text-muted-foreground">{row.markup}</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[0.8125rem] font-medium">{money(row.price)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {roundingNote}
      </section>
    );
  }

  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
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
        {groups.map((group) => (
          <TableBody key={group.key}>
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={3}
                className="pt-3 pb-1 text-xs font-medium text-muted-foreground"
              >
                {group.title}
              </TableCell>
            </TableRow>
            {group.rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="whitespace-normal">{row.basis}</TableCell>
                <TableCell className="text-right font-mono">
                  {row.markup ?? t('common.none')}
                </TableCell>
                <TableCell className="text-right font-mono">{money(row.price)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        ))}
      </Table>
      {roundingNote}
    </section>
  );
}
