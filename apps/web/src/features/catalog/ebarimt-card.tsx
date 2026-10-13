import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { DetailCard, FieldList } from '@/components/detail';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/app/auth-context';
import { plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { type ProductDetail, type ProductUnit, useCatalogMutations } from './api';
import {
  CITY_TAX_CHOICES,
  cityTaxChoice,
  ebarimtBody,
  type EbarimtFormValues,
  ebarimtSchema,
  ebarimtValues,
  VAT_TYPES,
} from './product-schema';

/** «хайрцаг (24 ш)» for a unit, its name for the base unit. */
function unitLabel(unit: ProductUnit, base: ProductUnit | undefined) {
  return unit.isBase || !base
    ? unit.uomName
    : `${unit.uomName} (${plainDecimal(unit.factorToBase)} ${base.uomName})`;
}

/**
 * A product's e-Barimt data on its page (ADR-0044 #6): VAT type, city tax, БҮНА and tax product
 * codes and each current unit's measure unit. Registration leaves them to the accountant, who
 * edits them here with catalog.ebarimt.manage (or fills them by category on the readiness page).
 */
export function EbarimtCard({ product }: { product: ProductDetail }) {
  const { t } = useTranslation();
  const canEdit = useHasPermission('catalog.ebarimt.manage');
  const current = product.units.filter((unit) => unit.supersededAt === null);
  const base = current.find((unit) => unit.isBase);
  return (
    <DetailCard
      title={t('catalog.ebarimtCard.title')}
      canEdit={canEdit}
      view={
        <div className="flex flex-col gap-5">
          <FieldList
            title={t('catalog.product.ebarimt')}
            items={[
              {
                label: t('catalog.product.vatType'),
                value: t(`catalog.product.vatTypes.${product.vatType}`),
              },
              {
                label: t('catalog.product.cityTax'),
                value: t(`catalog.product.cityTaxValues.${cityTaxChoice(product.cityTax)}`),
              },
              {
                label: t('catalog.product.classificationCode'),
                value: product.classificationCode ? (
                  <span className="font-mono">{product.classificationCode}</span>
                ) : null,
              },
              {
                label: t('catalog.product.taxProductCode'),
                value: product.taxProductCode ? (
                  <span className="font-mono">{product.taxProductCode}</span>
                ) : null,
              },
            ]}
          />
          <FieldList
            title={t('catalog.ebarimtCard.measureUnits')}
            items={current.map((unit) => ({
              label: unitLabel(unit, base),
              value: unit.effectiveMeasureUnit,
              hint:
                unit.measureUnit === null && unit.effectiveMeasureUnit
                  ? t('catalog.units.measureUnitDefault', { value: unit.effectiveMeasureUnit })
                  : undefined,
            }))}
          />
        </div>
      }
      edit={(close) => <EbarimtForm product={product} units={current} base={base} onDone={close} />}
    />
  );
}

function EbarimtForm(props: {
  product: ProductDetail;
  units: readonly ProductUnit[];
  base: ProductUnit | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useCatalogMutations();
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const form = useForm<EbarimtFormValues>({
    resolver: zodResolver(ebarimtSchema),
    defaultValues: ebarimtValues(props.product),
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (values) => {
    setProblem(null);
    try {
      await mutations.updateEbarimt.mutateAsync({
        id: props.product.id,
        body: ebarimtBody(values),
      });
      toast.success(t('catalog.ebarimtCard.saved'));
      props.onDone();
    } catch (error) {
      setProblem(problemFromError(error));
    }
  });

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={problem} />
      <FormSection title={t('catalog.product.ebarimt')}>
        <FormRow label={t('catalog.product.vatType')} htmlFor="ebarimt-vat">
          <NativeSelect id="ebarimt-vat" {...form.register('vatType')}>
            {VAT_TYPES.map((vatType) => (
              <option key={vatType} value={vatType}>
                {t(`catalog.product.vatTypes.${vatType}`)}
              </option>
            ))}
          </NativeSelect>
        </FormRow>
        <FormRow label={t('catalog.product.cityTax')} htmlFor="ebarimt-city-tax">
          <NativeSelect id="ebarimt-city-tax" {...form.register('cityTax')}>
            {CITY_TAX_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {t(`catalog.product.cityTaxValues.${choice}`)}
              </option>
            ))}
          </NativeSelect>
        </FormRow>
        <FormRow
          label={t('catalog.product.classificationCode')}
          htmlFor="ebarimt-classification"
          error={errors.classificationCode?.message}
        >
          <Input
            id="ebarimt-classification"
            inputMode="numeric"
            autoComplete="off"
            className="font-mono sm:w-44"
            {...form.register('classificationCode')}
          />
        </FormRow>
        <FormRow
          label={t('catalog.product.taxProductCode')}
          htmlFor="ebarimt-tax-code"
          error={errors.taxProductCode?.message}
        >
          <Input
            id="ebarimt-tax-code"
            inputMode="numeric"
            autoComplete="off"
            className="font-mono sm:w-28"
            {...form.register('taxProductCode')}
          />
        </FormRow>
      </FormSection>
      <FormSection
        title={t('catalog.ebarimtCard.measureUnits')}
        description={t('catalog.ebarimtCard.measureUnitsHint')}
      >
        {props.units.map((unit, index) => (
          <FormRow
            key={unit.id}
            label={unitLabel(unit, props.base)}
            htmlFor={`ebarimt-unit-${unit.id}`}
            error={errors.units?.[index]?.measureUnit?.message}
          >
            <Input
              id={`ebarimt-unit-${unit.id}`}
              autoComplete="off"
              className="sm:w-56"
              placeholder={unit.measureUnit === null ? (unit.effectiveMeasureUnit ?? '') : ''}
              {...form.register(`units.${index}.measureUnit`)}
            />
          </FormRow>
        ))}
      </FormSection>
      <FormFooter>
        <Button type="button" variant="ghost" onClick={props.onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}
