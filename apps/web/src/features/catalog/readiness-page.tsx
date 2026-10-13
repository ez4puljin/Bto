import { zodResolver } from '@hookform/resolvers/zod';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { problemFromError } from '@/lib/problem';
import { cn } from '@/lib/utils';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type AssignRequest,
  type Category,
  type ReadinessGap,
  useCatalogMutations,
  useCategories,
  useReadiness,
  useReadinessProducts,
} from './api';
import { categoryPaths, categoryTree } from './category-tree';
import { CLASSIFICATION_CODE, TAX_PRODUCT_CODE } from './product-schema';

const GAPS: readonly ReadinessGap[] = [
  'classificationCode',
  'taxProductCode',
  'measureUnit',
  'cityTax',
];
const isGap = (value: string): value is ReadinessGap => GAPS.some((gap) => gap === value);

/**
 * What e-Barimt receipts still miss, product by product, and bulk assignment by category that only
 * fills empty attributes (ADR-0015 #3). Must reach zero before delivery 3 prints receipts.
 */
export function ReadinessPage() {
  const { t } = useTranslation();
  const report = useReadiness();
  const categories = useCategories();
  const [gap, setGap] = useState<ReadinessGap | undefined>();
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const products = useReadinessProducts({ gap, categoryId });
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const rows = products.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('catalog.readiness.title')} meta={t('catalog.readiness.hint')} />
      <ProblemAlert problem={problemFromError(report.error ?? products.error)} />
      {report.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label={t('catalog.readiness.active')} value={report.data.activeProducts} />
          {GAPS.map((item) => (
            <Kpi
              key={item}
              label={t(`catalog.readiness.gaps.${item}`)}
              value={report.data.missing[item]}
              tone={report.data.missing[item] === 0 ? 'good' : 'warn'}
            />
          ))}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t('catalog.readiness.uomHint')}</p>

      <AssignCard categories={categories.data ?? []} />

      <FilterBar className="mb-0">
        <NativeSelect
          variant="filter"
          aria-label={t('catalog.readiness.missing')}
          value={gap ?? ''}
          onChange={(event) => setGap(isGap(event.target.value) ? event.target.value : undefined)}
        >
          <option value="">{t('catalog.readiness.anyGap')}</option>
          {GAPS.map((item) => (
            <option key={item} value={item}>
              {t(`catalog.readiness.gaps.${item}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('catalog.readiness.category')}
          value={categoryId === undefined ? '' : String(categoryId)}
          onChange={(event) =>
            setCategoryId(event.target.value ? Number.parseInt(event.target.value, 10) : undefined)
          }
        >
          <option value="">{t('catalog.products.allCategories')}</option>
          {tree.map((node) => (
            <option key={node.category.id} value={String(node.category.id)}>
              {node.path}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.products.columns.sku')}</TableHead>
              <TableHead>{t('catalog.products.columns.name')}</TableHead>
              <TableHead>{t('catalog.products.columns.category')}</TableHead>
              <TableHead>{t('catalog.readiness.missing')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.isPending ? <SkeletonRows columns={5} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.product.id} to={`/catalog/products/${row.product.id}`}>
                <TableCell className="font-mono">{row.product.sku}</TableCell>
                <TableCell className="whitespace-normal">
                  <Link to={`/catalog/products/${row.product.id}`} className="font-medium">
                    {row.product.name}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {paths.get(row.product.categoryId) ?? t('common.none')}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap gap-1">
                    {row.missing.map((item) => (
                      <Badge key={item} variant="warning">
                        {t(`catalog.readiness.gaps.${item}`)}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!products.isPending && rows.length === 0 ? (
          <EmptyState icon={CircleCheck} title={t('catalog.readiness.empty')} />
        ) : null}
        <LoadMore query={products} />
      </ListCard>
    </div>
  );
}

/** A number tile: green with «Бүрэн» at zero, amber while products still miss the attribute. */
function Kpi(props: { label: string; value: number; tone?: 'good' | 'warn' }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-card p-4 shadow-card ring-1 ring-black/[0.06]">
      <span className="flex items-start gap-1.5 text-[13px] leading-snug text-muted-foreground">
        {props.tone === 'good' ? (
          <CircleCheck aria-hidden className="mt-px size-3.5 shrink-0 text-success" />
        ) : null}
        {props.tone === 'warn' ? (
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
        ) : null}
        {props.label}
      </span>
      <span
        className={cn(
          'text-2xl font-semibold tracking-tight tabular-nums',
          props.tone === 'warn' && 'text-warning',
        )}
      >
        {props.value}
      </span>
      {props.tone === 'good' ? (
        <span className="text-xs text-success">{t('catalog.readiness.complete')}</span>
      ) : null}
    </div>
  );
}

const assignSchema = z
  .object({
    categoryId: z.string().min(1, 'validation.required'),
    includeSubcategories: z.boolean(),
    classificationCode: z
      .string()
      .trim()
      .refine(
        (value) => value === '' || CLASSIFICATION_CODE.test(value),
        'validation.classificationCode',
      ),
    taxProductCode: z
      .string()
      .trim()
      .refine((value) => value === '' || TAX_PRODUCT_CODE.test(value), 'validation.taxProductCode'),
    cityTax: z.enum(['keep', 'yes', 'no']),
  })
  .refine(
    (values) => values.classificationCode || values.taxProductCode || values.cityTax !== 'keep',
    { path: ['classificationCode'], message: 'validation.assignSomething' },
  );
type AssignValues = z.infer<typeof assignSchema>;

function assignBody(values: AssignValues): AssignRequest {
  return {
    categoryId: Number.parseInt(values.categoryId, 10),
    includeSubcategories: values.includeSubcategories,
    ...(values.classificationCode ? { classificationCode: values.classificationCode } : {}),
    ...(values.taxProductCode ? { taxProductCode: values.taxProductCode } : {}),
    ...(values.cityTax === 'keep' ? {} : { cityTax: values.cityTax === 'yes' }),
  };
}

/**
 * Bulk assignment: "count" shows how many products each value would fill, "apply" fills them.
 * A changed form must be counted again before it can be applied.
 */
function AssignCard({ categories }: { categories: readonly Category[] }) {
  const { t } = useTranslation();
  const mutations = useCatalogMutations();
  const action = useAction();
  const tree = useMemo(() => categoryTree(categories), [categories]);
  const [preview, setPreview] = useState<{
    values: AssignValues;
    counts: { classificationCode: number; taxProductCode: number; cityTax: number };
  } | null>(null);
  const [applied, setApplied] = useState<typeof preview>(null);
  const form = useForm<AssignValues>({
    resolver: zodResolver(assignSchema),
    defaultValues: {
      categoryId: '',
      includeSubcategories: true,
      classificationCode: '',
      taxProductCode: '',
      cityTax: 'keep',
    },
  });
  const categoryField = form.register('categoryId', {
    onChange: (event: { target: { value: string } }) => {
      const category = categories.find((item) => String(item.id) === event.target.value);
      if (category?.defaultClassificationCode && !form.getValues('classificationCode')) {
        form.setValue('classificationCode', category.defaultClassificationCode);
      }
    },
  });
  const count = form.handleSubmit(async (values) => {
    setApplied(null);
    setPreview(null);
    await action.run(async () => {
      const counts = await mutations.assign.mutateAsync({
        ...assignBody(values),
        dryRun: true,
        key: randomUuid(),
      });
      setPreview({ values, counts });
    });
  });
  const apply = async () => {
    if (!preview) return;
    await action.run(async () => {
      const counts = await mutations.assign.mutateAsync({
        ...assignBody(preview.values),
        key: randomUuid(),
      });
      setApplied({ values: preview.values, counts });
      setPreview(null);
    });
  };
  const { errors, isSubmitting } = form.formState;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('catalog.readiness.assign')}</CardTitle>
        <CardDescription>{t('catalog.readiness.assignHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          noValidate
          onChange={() => setPreview(null)}
          onSubmit={(event) => void count(event)}
        >
          <ProblemAlert problem={action.problem} />
          <FormSection>
            <FormRow
              label={t('catalog.readiness.category')}
              htmlFor="assign-category"
              error={errors.categoryId?.message}
            >
              <NativeSelect id="assign-category" {...categoryField}>
                <option value="">{t('catalog.product.chooseCategory')}</option>
                {tree.map((node) => (
                  <option key={node.category.id} value={String(node.category.id)}>
                    {node.path}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            <FormRow
              label={t('catalog.readiness.includeSubcategories')}
              htmlFor="assign-subcategories"
              align="center"
            >
              <Controller
                control={form.control}
                name="includeSubcategories"
                render={({ field }) => (
                  <Switch
                    id="assign-subcategories"
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      setPreview(null);
                      field.onChange(checked);
                    }}
                  />
                )}
              />
            </FormRow>
            <FormRow
              label={t('catalog.product.classificationCode')}
              htmlFor="assign-classification"
              error={errors.classificationCode?.message}
            >
              <Input
                id="assign-classification"
                inputMode="numeric"
                autoComplete="off"
                className="font-mono sm:w-44"
                {...form.register('classificationCode')}
              />
            </FormRow>
            <FormRow
              label={t('catalog.product.taxProductCode')}
              htmlFor="assign-tax-code"
              error={errors.taxProductCode?.message}
            >
              <Input
                id="assign-tax-code"
                inputMode="numeric"
                autoComplete="off"
                className="font-mono sm:w-28"
                {...form.register('taxProductCode')}
              />
            </FormRow>
            <FormRow label={t('catalog.product.cityTax')} htmlFor="assign-city-tax">
              <NativeSelect id="assign-city-tax" className="sm:w-56" {...form.register('cityTax')}>
                <option value="keep">{t('catalog.readiness.keep')}</option>
                <option value="yes">{t('catalog.product.cityTaxValues.yes')}</option>
                <option value="no">{t('catalog.product.cityTaxValues.no')}</option>
              </NativeSelect>
            </FormRow>
          </FormSection>
          {preview ? (
            <p role="status" className="px-1 text-sm">
              {t('catalog.readiness.preview', preview.counts)}
            </p>
          ) : null}
          {applied ? (
            <Alert>
              <AlertDescription>
                {t('catalog.readiness.done')}
                {': '}
                {t('catalog.readiness.preview', applied.counts)}
              </AlertDescription>
            </Alert>
          ) : null}
          <FormFooter>
            <Button type="submit" variant="secondary" disabled={isSubmitting}>
              {t('catalog.readiness.count')}
            </Button>
            <Button
              type="button"
              disabled={!preview || mutations.assign.isPending}
              onClick={() => void apply()}
            >
              {t('catalog.readiness.apply')}
            </Button>
          </FormFooter>
        </form>
      </CardContent>
    </Card>
  );
}
