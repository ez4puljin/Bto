import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { FieldError } from '@/components/field-error';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { problemFromError } from '@/lib/problem';
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
      <PageHeader title={t('catalog.readiness.title')} />
      <p className="-mt-2 text-sm text-muted-foreground">{t('catalog.readiness.hint')}</p>
      <ProblemAlert problem={problemFromError(report.error ?? products.error)} />
      {report.data ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Card size="sm">
            <CardHeader>
              <CardDescription>{t('catalog.readiness.active')}</CardDescription>
              <CardTitle className="text-2xl">{report.data.activeProducts}</CardTitle>
            </CardHeader>
          </Card>
          {GAPS.map((item) => (
            <Card key={item} size="sm">
              <CardHeader>
                <CardDescription>{t(`catalog.readiness.gaps.${item}`)}</CardDescription>
                <CardTitle className="text-2xl">{report.data.missing[item]}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t('catalog.readiness.uomHint')}</p>

      <AssignCard categories={categories.data ?? []} />

      <div className="grid gap-2 sm:grid-cols-2">
        <NativeSelect
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
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('catalog.products.columns.sku')}</TableHead>
            <TableHead>{t('catalog.products.columns.name')}</TableHead>
            <TableHead>{t('catalog.products.columns.category')}</TableHead>
            <TableHead>{t('catalog.readiness.missing')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.product.id}>
              <TableCell className="font-mono">{row.product.sku}</TableCell>
              <TableCell className="whitespace-normal">
                <Link
                  to={`/catalog/products/${row.product.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.product.name}
                </Link>
              </TableCell>
              <TableCell className="whitespace-normal text-muted-foreground">
                {paths.get(row.product.categoryId) ?? t('common.none')}
              </TableCell>
              <TableCell className="flex flex-wrap gap-1 whitespace-normal">
                {row.missing.map((item) => (
                  <Badge key={item} variant="outline">
                    {t(`catalog.readiness.gaps.${item}`)}
                  </Badge>
                ))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!products.isPending && rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t('catalog.readiness.empty')}</p>
      ) : null}
      {products.hasNextPage ? (
        <div>
          <Button
            variant="outline"
            disabled={products.isFetchingNextPage}
            onClick={() => void products.fetchNextPage()}
          >
            {t('common.loadMore')}
          </Button>
        </div>
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
          className="flex flex-col gap-3"
          noValidate
          onChange={() => setPreview(null)}
          onSubmit={(event) => void count(event)}
        >
          <ProblemAlert problem={action.problem} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="assign-category">{t('catalog.readiness.category')}</Label>
              <NativeSelect id="assign-category" {...categoryField}>
                <option value="">{t('catalog.product.chooseCategory')}</option>
                {tree.map((node) => (
                  <option key={node.category.id} value={String(node.category.id)}>
                    {node.path}
                  </option>
                ))}
              </NativeSelect>
              <FieldError message={errors.categoryId?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="assign-classification">
                {t('catalog.product.classificationCode')}
              </Label>
              <Input
                id="assign-classification"
                inputMode="numeric"
                autoComplete="off"
                className="font-mono"
                {...form.register('classificationCode')}
              />
              <FieldError message={errors.classificationCode?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="assign-tax-code">{t('catalog.product.taxProductCode')}</Label>
              <Input
                id="assign-tax-code"
                inputMode="numeric"
                autoComplete="off"
                className="font-mono"
                {...form.register('taxProductCode')}
              />
              <FieldError message={errors.taxProductCode?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="assign-city-tax">{t('catalog.product.cityTax')}</Label>
              <NativeSelect id="assign-city-tax" {...form.register('cityTax')}>
                <option value="keep">{t('catalog.readiness.keep')}</option>
                <option value="yes">{t('catalog.product.cityTaxValues.yes')}</option>
                <option value="no">{t('catalog.product.cityTaxValues.no')}</option>
              </NativeSelect>
            </div>
          </div>
          <Controller
            control={form.control}
            name="includeSubcategories"
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="assign-subcategories"
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    setPreview(null);
                    field.onChange(checked === true);
                  }}
                />
                <Label htmlFor="assign-subcategories" className="font-normal">
                  {t('catalog.readiness.includeSubcategories')}
                </Label>
              </div>
            )}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline" disabled={isSubmitting}>
              {t('catalog.readiness.count')}
            </Button>
            <Button
              type="button"
              disabled={!preview || mutations.assign.isPending}
              onClick={() => void apply()}
            >
              {t('catalog.readiness.apply')}
            </Button>
          </div>
          {preview ? (
            <p role="status" className="text-sm">
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
        </form>
      </CardContent>
    </Card>
  );
}
