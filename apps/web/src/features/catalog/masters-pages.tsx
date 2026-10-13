import { zodResolver } from '@hookform/resolvers/zod';
import {
  Check,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import {
  EmptyState,
  ListCard,
  RowAction,
  RowActionSpacer,
  RowActions,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { type Category, type Uom, useCatalogMutations, useCategories, useUoms } from './api';
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

/** «Болих» then «Хадгалах» at the foot of a master dialog. */
function SaveFooter({ pending, onCancel }: { pending: boolean; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" disabled={pending}>
        {t('common.save')}
      </Button>
    </DialogFooter>
  );
}

/** A muted «—» for an empty cell. */
function None() {
  const { t } = useTranslation();
  return <span className="text-muted-foreground">{t('common.none')}</span>;
}

/**
 * The category tree (SPEC §5.2): any depth, a default БҮНА code per category (ADR-0015 #3). Rows
 * show the tree with folders; a category with subcategories or products cannot be deleted.
 */
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
            {categories.isPending ? <SkeletonRows columns={canManage ? 4 : 3} /> : null}
            {tree.map(({ category, depth }) => {
              const Icon = category.childCount > 0 ? FolderOpen : Folder;
              return (
                <TableRow key={category.id}>
                  <TableCell>
                    <span
                      className="flex items-center gap-2"
                      style={{ paddingLeft: `${depth * 1.5}rem` }}
                    >
                      <Icon
                        aria-hidden
                        className={
                          depth === 0
                            ? 'size-4 shrink-0 text-primary'
                            : 'size-4 shrink-0 text-muted-foreground'
                        }
                      />
                      <span className={depth === 0 ? 'font-medium' : undefined}>
                        {category.name}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {category.defaultClassificationCode ? (
                      <span className="font-mono">{category.defaultClassificationCode}</span>
                    ) : (
                      <None />
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {t('catalog.categories.products', { count: category.productCount })}
                  </TableCell>
                  {canManage ? (
                    <RowActions>
                      <RowAction
                        icon={FolderPlus}
                        label={t('catalog.categories.addChild')}
                        onClick={() => setEditing({ parentId: category.id })}
                      />
                      <RowAction
                        icon={Pencil}
                        label={t('common.edit')}
                        onClick={() => setEditing({ category })}
                      />
                      {category.childCount === 0 && category.productCount === 0 ? (
                        <RowAction
                          icon={Trash2}
                          label={t('common.delete')}
                          destructive
                          onClick={() => deletion.ask(category)}
                        />
                      ) : (
                        <RowActionSpacer />
                      )}
                    </RowActions>
                  ) : null}
                </TableRow>
              );
            })}
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
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <FormField
            label={t('catalog.categories.name')}
            htmlFor="category-name"
            error={errors.name?.message}
          >
            <Input id="category-name" autoComplete="off" {...form.register('name')} />
          </FormField>
          <FormField label={t('catalog.categories.parent')} htmlFor="category-parent">
            <NativeSelect id="category-parent" {...form.register('parentId')}>
              <option value="">{t('catalog.categories.root')}</option>
              {options.map((node) => (
                <option key={node.category.id} value={String(node.category.id)}>
                  {node.path}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            label={t('catalog.categories.defaultCode')}
            htmlFor="category-code"
            error={errors.defaultClassificationCode?.message}
          >
            <Input
              id="category-code"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono sm:w-44"
              {...form.register('defaultClassificationCode')}
            />
          </FormField>
          <SaveFooter pending={isSubmitting} onCancel={props.onClose} />
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
            {uoms.isPending ? <SkeletonRows columns={canManage ? 5 : 4} /> : null}
            {(uoms.data ?? []).map((uom) => (
              <TableRow key={uom.id}>
                <TableCell className="font-medium">{uom.name}</TableCell>
                <TableCell>
                  <Badge variant={uom.code ? 'secondary' : 'default'}>
                    {uom.code ? t('catalog.uoms.system') : t('catalog.uoms.custom')}
                  </Badge>
                </TableCell>
                <TableCell>
                  {uom.fractional ? (
                    <>
                      <Check aria-hidden className="size-4 text-success" />
                      <span className="sr-only">{t('common.yes')}</span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden className="text-muted-foreground">
                        {t('common.none')}
                      </span>
                      <span className="sr-only">{t('common.no')}</span>
                    </>
                  )}
                </TableCell>
                <TableCell>{uom.measureUnit ?? <None />}</TableCell>
                {canManage ? (
                  <RowActions>
                    <RowAction
                      icon={Pencil}
                      label={t('common.edit')}
                      onClick={() => setEditing(uom)}
                    />
                    {uom.code ? (
                      <RowActionSpacer />
                    ) : (
                      <RowAction
                        icon={Trash2}
                        label={t('common.delete')}
                        destructive
                        onClick={() => deletion.ask(uom)}
                      />
                    )}
                  </RowActions>
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
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <FormField label={t('catalog.uoms.name')} htmlFor="uom-name" error={errors.name?.message}>
            <Input id="uom-name" autoComplete="off" {...form.register('name')} />
          </FormField>
          <Controller
            control={form.control}
            name="fractional"
            render={({ field }) => (
              <div className="flex items-start justify-between gap-4 rounded-xl border border-border/90 px-3.5 py-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="uom-fractional">{t('catalog.uoms.fractional')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('catalog.uoms.fractionalHint')}
                  </p>
                </div>
                <Switch
                  id="uom-fractional"
                  checked={field.value}
                  disabled={!isNew}
                  onCheckedChange={field.onChange}
                />
              </div>
            )}
          />
          <FormField
            label={t('catalog.uoms.measureUnit')}
            htmlFor="uom-measure"
            error={errors.measureUnit?.message}
          >
            <Input id="uom-measure" autoComplete="off" {...form.register('measureUnit')} />
          </FormField>
          <SaveFooter pending={isSubmitting} onCancel={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
