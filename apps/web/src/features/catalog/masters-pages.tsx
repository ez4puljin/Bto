import { zodResolver } from '@hookform/resolvers/zod';
import { FolderTree, Plus, Tag } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FieldError } from '@/components/field-error';
import { NativeSelect } from '@/components/native-select';
import { EmptyState, ListCard } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import {
  type Brand,
  type Category,
  type Uom,
  useBrands,
  useCatalogMutations,
  useCategories,
  useUoms,
} from './api';
import { categoryTree, subtreeIds } from './category-tree';
import { CLASSIFICATION_CODE } from './product-schema';

const optionalCode = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || CLASSIFICATION_CODE.test(value),
    'validation.classificationCode',
  );

/** Deletes one master row after a confirmation; the API refuses rows still in use. */
function useDeleteConfirm<T extends { id: number; name: string }>(
  remove: (id: number) => Promise<unknown>,
) {
  const action = useAction();
  const [target, setTarget] = useState<T | null>(null);
  return {
    target,
    problem: action.problem,
    ask: (row: T) => {
      action.clear();
      setTarget(row);
    },
    close: () => setTarget(null),
    confirm: () => {
      if (!target) return;
      void action.run(() => remove(target.id)).then((ok) => (ok ? setTarget(null) : undefined));
    },
  };
}

/** The category tree (SPEC §5.2): any depth, a default БҮНА code per category (ADR-0015 #3). */
export function CategoriesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('catalog.products.manage');
  const categories = useCategories();
  const mutations = useCatalogMutations();
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const [editing, setEditing] = useState<
    { category: Category } | { parentId: number | null } | null
  >(null);
  const deletion = useDeleteConfirm<Category>((id) => mutations.deleteCategory.mutateAsync(id));

  return (
    <div>
      <PageHeader
        title={t('catalog.categories.title')}
        actions={
          canManage ? (
            <Button onClick={() => setEditing({ parentId: null })}>
              <Plus />
              {t('catalog.categories.create')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(categories.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.categories.name')}</TableHead>
              <TableHead>{t('catalog.categories.defaultCode')}</TableHead>
              <TableHead>{t('catalog.products.title')}</TableHead>
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tree.map(({ category, depth }) => (
              <TableRow key={category.id}>
                <TableCell style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}>
                  {category.name}
                </TableCell>
                <TableCell className="font-mono">
                  {category.defaultClassificationCode ?? t('common.none')}
                </TableCell>
                <TableCell>
                  {t('catalog.categories.products', { count: category.productCount })}
                </TableCell>
                {canManage ? (
                  <TableCell className="flex flex-wrap justify-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing({ parentId: category.id })}
                    >
                      {t('catalog.categories.addChild')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing({ category })}>
                      {t('common.edit')}
                    </Button>
                    {category.childCount === 0 && category.productCount === 0 ? (
                      <Button size="sm" variant="ghost" onClick={() => deletion.ask(category)}>
                        {t('common.delete')}
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {categories.data?.length === 0 ? (
          <EmptyState icon={FolderTree} title={t('catalog.categories.empty')} />
        ) : null}
      </ListCard>
      {editing ? (
        <CategoryDialog
          categories={categories.data ?? []}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deletion.target !== null}
        title={t('common.delete')}
        description={t('catalog.categories.deleteConfirm', { name: deletion.target?.name ?? '' })}
        confirmLabel={t('common.delete')}
        pending={mutations.deleteCategory.isPending}
        problem={deletion.problem}
        onClose={deletion.close}
        onConfirm={deletion.confirm}
      />
    </div>
  );
}

const categorySchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(100, 'validation.tooLong'),
  parentId: z.string(),
  defaultClassificationCode: optionalCode,
});
type CategoryValues = z.infer<typeof categorySchema>;

function CategoryDialog(props: {
  categories: readonly Category[];
  editing: { category: Category } | { parentId: number | null };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useCatalogMutations();
  const action = useAction();
  const existing = 'category' in props.editing ? props.editing.category : null;
  const parentId = existing
    ? existing.parentId
    : 'parentId' in props.editing
      ? props.editing.parentId
      : null;
  // A category cannot move under itself or its own subcategories (the API checks too).
  const excluded = existing ? subtreeIds(props.categories, existing.id) : new Set<number>();
  const options = categoryTree(props.categories).filter((node) => !excluded.has(node.category.id));
  const form = useForm<CategoryValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: existing?.name ?? '',
      parentId: parentId === null ? '' : String(parentId),
      defaultClassificationCode: existing?.defaultClassificationCode ?? '',
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const body = {
      name: values.name,
      parentId: values.parentId ? Number.parseInt(values.parentId, 10) : null,
      defaultClassificationCode: values.defaultClassificationCode || null,
    };
    const ok = await action.run(() =>
      existing
        ? mutations.updateCategory.mutateAsync({ id: existing.id, body })
        : mutations.createCategory.mutateAsync(body),
    );
    if (ok) props.onClose();
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {existing ? t('catalog.categories.edit') : t('catalog.categories.create')}
          </DialogTitle>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="category-name">{t('catalog.categories.name')}</Label>
            <Input id="category-name" autoComplete="off" {...form.register('name')} />
            <FieldError message={errors.name?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="category-parent">{t('catalog.categories.parent')}</Label>
            <NativeSelect id="category-parent" {...form.register('parentId')}>
              <option value="">{t('catalog.categories.root')}</option>
              {options.map((node) => (
                <option key={node.category.id} value={String(node.category.id)}>
                  {node.path}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="category-code">{t('catalog.categories.defaultCode')}</Label>
            <Input
              id="category-code"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono"
              {...form.register('defaultClassificationCode')}
            />
            <FieldError message={errors.defaultClassificationCode?.message} />
          </div>
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Brands: a name per brand; one in use by products cannot be deleted. */
export function BrandsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('catalog.products.manage');
  const brands = useBrands();
  const mutations = useCatalogMutations();
  const [editing, setEditing] = useState<Brand | 'new' | null>(null);
  const deletion = useDeleteConfirm<Brand>((id) => mutations.deleteBrand.mutateAsync(id));

  return (
    <div>
      <PageHeader
        title={t('catalog.brands.title')}
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
              <Plus />
              {t('catalog.brands.create')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(brands.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.brands.name')}</TableHead>
              <TableHead>{t('catalog.products.title')}</TableHead>
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(brands.data ?? []).map((brand) => (
              <TableRow key={brand.id}>
                <TableCell>{brand.name}</TableCell>
                <TableCell>{t('catalog.brands.products', { count: brand.productCount })}</TableCell>
                {canManage ? (
                  <TableCell className="flex flex-wrap justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(brand)}>
                      {t('common.edit')}
                    </Button>
                    {brand.productCount === 0 ? (
                      <Button size="sm" variant="ghost" onClick={() => deletion.ask(brand)}>
                        {t('common.delete')}
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {brands.data?.length === 0 ? (
          <EmptyState icon={Tag} title={t('catalog.brands.empty')} />
        ) : null}
      </ListCard>
      {editing ? <BrandDialog brand={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={deletion.target !== null}
        title={t('common.delete')}
        description={t('catalog.brands.deleteConfirm', { name: deletion.target?.name ?? '' })}
        confirmLabel={t('common.delete')}
        pending={mutations.deleteBrand.isPending}
        problem={deletion.problem}
        onClose={deletion.close}
        onConfirm={deletion.confirm}
      />
    </div>
  );
}

const brandSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(100, 'validation.tooLong'),
});

function BrandDialog({ brand, onClose }: { brand: Brand | 'new'; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useCatalogMutations();
  const action = useAction();
  const form = useForm<z.infer<typeof brandSchema>>({
    resolver: zodResolver(brandSchema),
    defaultValues: { name: brand === 'new' ? '' : brand.name },
  });
  const submit = form.handleSubmit(async ({ name }) => {
    const ok = await action.run(() =>
      brand === 'new'
        ? mutations.createBrand.mutateAsync({ name })
        : mutations.updateBrand.mutateAsync({ id: brand.id, body: { name } }),
    );
    if (ok) onClose();
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {brand === 'new' ? t('catalog.brands.create') : t('catalog.brands.edit')}
          </DialogTitle>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="brand-name">{t('catalog.brands.name')}</Label>
            <Input id="brand-name" autoComplete="off" {...form.register('name')} />
            <FieldError message={errors.name?.message} />
          </div>
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Units of measure: the system ones (ш, блок, хайрцаг, кг) and the admin's own. Each may carry the
 * e-Barimt measure unit that product units use by default.
 */
export function UomsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('catalog.products.manage');
  const uoms = useUoms();
  const mutations = useCatalogMutations();
  const [editing, setEditing] = useState<Uom | 'new' | null>(null);
  const deletion = useDeleteConfirm<Uom>((id) => mutations.deleteUom.mutateAsync(id));

  return (
    <div>
      <PageHeader
        title={t('catalog.uoms.title')}
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
              <Plus />
              {t('catalog.uoms.create')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(uoms.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.uoms.name')}</TableHead>
              <TableHead>{t('catalog.uoms.kind')}</TableHead>
              <TableHead>{t('catalog.uoms.fractional')}</TableHead>
              <TableHead>{t('catalog.uoms.measureUnit')}</TableHead>
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(uoms.data ?? []).map((uom) => (
              <TableRow key={uom.id}>
                <TableCell>{uom.name}</TableCell>
                <TableCell>
                  <Badge variant={uom.code ? 'secondary' : 'outline'}>
                    {uom.code ? t('catalog.uoms.system') : t('catalog.uoms.custom')}
                  </Badge>
                </TableCell>
                <TableCell>{uom.fractional ? t('common.yes') : t('common.no')}</TableCell>
                <TableCell>{uom.measureUnit ?? t('common.none')}</TableCell>
                {canManage ? (
                  <TableCell className="flex flex-wrap justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(uom)}>
                      {t('common.edit')}
                    </Button>
                    {uom.code ? null : (
                      <Button size="sm" variant="ghost" onClick={() => deletion.ask(uom)}>
                        {t('common.delete')}
                      </Button>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ListCard>
      {editing ? <UomDialog uom={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={deletion.target !== null}
        title={t('common.delete')}
        description={t('catalog.uoms.deleteConfirm', { name: deletion.target?.name ?? '' })}
        confirmLabel={t('common.delete')}
        pending={mutations.deleteUom.isPending}
        problem={deletion.problem}
        onClose={deletion.close}
        onConfirm={deletion.confirm}
      />
    </div>
  );
}

const uomSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(40, 'validation.tooLong'),
  fractional: z.boolean(),
  measureUnit: z.string().trim().max(50, 'validation.tooLong'),
});
type UomValues = z.infer<typeof uomSchema>;

function UomDialog({ uom, onClose }: { uom: Uom | 'new'; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useCatalogMutations();
  const action = useAction();
  const isNew = uom === 'new';
  const form = useForm<UomValues>({
    resolver: zodResolver(uomSchema),
    defaultValues: isNew
      ? { name: '', fractional: false, measureUnit: '' }
      : { name: uom.name, fractional: uom.fractional, measureUnit: uom.measureUnit ?? '' },
  });
  const submit = form.handleSubmit(async (values) => {
    const measureUnit = values.measureUnit || null;
    const ok = await action.run(() =>
      isNew
        ? mutations.createUom.mutateAsync({
            name: values.name,
            fractional: values.fractional,
            measureUnit,
          })
        : mutations.updateUom.mutateAsync({ id: uom.id, body: { name: values.name, measureUnit } }),
    );
    if (ok) onClose();
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{isNew ? t('catalog.uoms.create') : t('catalog.uoms.edit')}</DialogTitle>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="uom-name">{t('catalog.uoms.name')}</Label>
            <Input id="uom-name" autoComplete="off" {...form.register('name')} />
            <FieldError message={errors.name?.message} />
          </div>
          <Controller
            control={form.control}
            name="fractional"
            render={({ field }) => (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="uom-fractional"
                    checked={field.value}
                    disabled={!isNew}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                  <Label htmlFor="uom-fractional" className="font-normal">
                    {t('catalog.uoms.fractional')}
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">{t('catalog.uoms.fractionalHint')}</p>
              </div>
            )}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="uom-measure">{t('catalog.uoms.measureUnit')}</Label>
            <Input id="uom-measure" autoComplete="off" {...form.register('measureUnit')} />
            <FieldError message={errors.measureUnit?.message} />
          </div>
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
