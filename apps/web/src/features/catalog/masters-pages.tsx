import { zodResolver } from '@hookform/resolvers/zod';
import { rangeOwner, SKU_PATTERN } from '@tugeel/shared/catalog';
import {
  Check,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  ImageIcon,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { useApiClient } from '@/app/api-client-context';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  ListCard,
  ListTable,
  RowAction,
  RowActionSpacer,
  RowActions,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { CATEGORY_PICTURE_SIZE, cropToJpeg } from '@/lib/image-resize';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { uploadFile } from '@/lib/upload';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { useDeleteConfirm } from '@/lib/use-delete-confirm';
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

/** The category list's columns (ADR-0119), the actions column added per the user's rights. */
const CATEGORY_COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 14 },
  { key: 'defaultCode', kind: 'code', width: 9 },
  { key: 'skuRange', kind: 'text', weight: 2, min: 10 },
  { key: 'products', kind: 'count', width: 7 },
  { key: 'appPicture', kind: 'image', width: 6 },
  { key: 'spacer', kind: 'spacer' },
];

/** The units' columns (ADR-0119); the actions column only for a manager. */
const UOM_COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 12 },
  { key: 'kind', kind: 'status' },
  { key: 'fractional', kind: 'icon', width: 7 },
  { key: 'measureUnit', kind: 'text', weight: 2, min: 10 },
  { key: 'spacer', kind: 'spacer' },
  { key: 'actions', kind: 'actions', actions: 2 },
];
const UOM_READER_COLUMNS = UOM_COLUMNS.slice(0, -1);

/** A muted «—» for an empty cell. */
function None() {
  const { t } = useTranslation();
  return <span className="text-muted-foreground">{t('common.none')}</span>;
}

/**
 * The category tree (SPEC §5.2): any depth, a default БҮНА code per category (ADR-0015 #3). Rows
 * show the tree with folders; a category with subcategories or products cannot be deleted. «Шинэ
 * ангилал» opens its dialog from the address (`?new=1`); a row adds a subcategory or edits.
 */
export function CategoriesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('catalog.products.manage');
  // «Bto300»'s category grid (ADR-0092 #6): top categories carry a picture.
  const canPicture = useHasPermission('customer.home.manage');
  const [picturing, setPicturing] = useState<Category | null>(null);
  const withActions = canManage || canPicture;
  const categories = useCategories();
  const mutations = useCatalogMutations();
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<{ category: Category } | { parentId: number } | null>(
    null,
  );
  const deletion = useDeleteConfirm<Category>((id) => mutations.deleteCategory.mutateAsync(id));
  const dialog = editing ?? (creating && canManage ? { parentId: null } : null);
  const columns = useMemo<readonly ColumnSpec[]>(
    () =>
      withActions
        ? [
            ...CATEGORY_COLUMNS,
            {
              key: 'actions',
              kind: 'actions',
              actions: (canPicture ? 1 : 0) + (canManage ? 3 : 0),
            },
          ]
        : CATEGORY_COLUMNS,
    [withActions, canPicture, canManage],
  );

  return (
    <div>
      <PageHeader
        title={t('catalog.categories.title')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('catalog.categories.create')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(categories.error)} onRetry={categories.refetch} />
      <ListCard scroll>
        <ListTable columns={columns}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.categories.name')}</TableHead>
              <TableHead>{t('catalog.categories.defaultCode')}</TableHead>
              <TableHead>{t('catalog.categories.skuRange')}</TableHead>
              <TableHead className="text-right">{t('catalog.products.title')}</TableHead>
              <TableHead>{t('catalog.categories.appPicture')}</TableHead>
              <SpacerHead />
              {withActions ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.isPending ? <SkeletonRows columns={withActions ? 7 : 6} /> : null}
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
                  <TableCell>
                    <RangeCell categories={categories.data ?? []} category={category} />
                  </TableCell>
                  <TableCell className="text-right">
                    {category.productCount > 0 ? (
                      <Link
                        to={`/catalog/products?category=${category.id}`}
                        className="text-link underline-offset-4 hover:underline"
                      >
                        {t('catalog.categories.products', {
                          count: formatCount(category.productCount),
                        })}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">
                        {t('catalog.categories.products', { count: formatCount(0) })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {category.imageUrl ? (
                      <img
                        src={category.imageUrl}
                        alt={t('catalog.categories.appPictureOf', { name: category.name })}
                        className="size-8 rounded-md border object-cover"
                      />
                    ) : depth === 0 ? (
                      <None />
                    ) : null}
                  </TableCell>
                  <SpacerCell />
                  {withActions ? (
                    <RowActions>
                      {canPicture && depth === 0 ? (
                        <RowAction
                          icon={ImageIcon}
                          label={`${t('catalog.categories.appPicture')}: ${category.name}`}
                          onClick={() => setPicturing(category)}
                        />
                      ) : canPicture ? (
                        <RowActionSpacer />
                      ) : null}
                      {canManage ? (
                        <>
                          <RowAction
                            icon={FolderPlus}
                            label={`${t('catalog.categories.addChild')}: ${category.name}`}
                            onClick={() => setEditing({ parentId: category.id })}
                          />
                          <RowAction
                            icon={Pencil}
                            label={t('common.editRecord', { name: category.name })}
                            onClick={() => setEditing({ category })}
                          />
                          {category.childCount === 0 && category.productCount === 0 ? (
                            <RowAction
                              icon={Trash2}
                              label={`${t('common.delete')}: ${category.name}`}
                              destructive
                              onClick={() => deletion.ask(category)}
                            />
                          ) : (
                            <RowActionSpacer />
                          )}
                        </>
                      ) : null}
                    </RowActions>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </ListTable>
        {categories.data?.length === 0 ? (
          <EmptyState icon={FolderTree} title={t('catalog.categories.empty')} />
        ) : null}
      </ListCard>
      {dialog ? (
        <CategoryDialog
          categories={categories.data ?? []}
          editing={dialog}
          onClose={() => (editing ? setEditing(null) : setCreating(false))}
        />
      ) : null}
      {picturing ? (
        <CategoryPictureDialog
          category={
            (categories.data ?? []).find((category) => category.id === picturing.id) ?? picturing
          }
          onClose={() => setPicturing(null)}
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

const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * «Апп-ын зураг» (ADR-0092 #6, customer.home.manage): a top category's picture on «Bto300»'s
 * category grid, cut square (512×512) in the browser and saved at once (the tree then shows it);
 * «Зураг устгах» takes it away (the app then shows one of the category's products).
 */
function CategoryPictureDialog(props: { category: Category; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const mutations = useCatalogMutations();
  const action = useAction();
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const shown = props.category.imageUrl;

  const choose = async (file: File) => {
    setFailed(false);
    setUploading(true);
    try {
      const blob = await cropToJpeg(file, CATEGORY_PICTURE_SIZE);
      const imageFileId = await uploadFile(api, 'catalog.category_image', blob);
      const ok = await action.run(() =>
        mutations.setCategoryImage.mutateAsync({ id: props.category.id, imageFileId }),
      );
      if (ok) {
        // The tree shows the new picture; the dialog has done its work.
        toast.success(t('catalog.categories.appPictureSaved'));
        props.onClose();
      }
    } catch {
      setFailed(true);
    } finally {
      setUploading(false);
    }
  };
  const remove = async () => {
    const ok = await action.run(() => mutations.removeCategoryImage.mutateAsync(props.category.id));
    if (!ok) return;
    toast.success(t('catalog.categories.appPictureRemoved'));
    props.onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <DialogHeader>
          <DialogTitle>
            {t('catalog.categories.appPictureTitle', { name: props.category.name })}
          </DialogTitle>
          <DialogDescription>{t('catalog.categories.appPictureHint')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        {failed ? (
          <p role="alert" className="text-sm text-destructive">
            {t('validation.imageUnreadable')}
          </p>
        ) : null}
        <div className="flex items-center gap-4">
          {shown ? (
            <img
              src={shown}
              alt={t('catalog.categories.appPictureOf', { name: props.category.name })}
              className="size-28 rounded-lg border object-cover"
            />
          ) : (
            <span className="flex size-28 items-center justify-center rounded-lg border bg-muted text-center text-xs text-muted-foreground">
              {t('catalog.categories.appPictureNone')}
            </span>
          )}
          <input
            ref={fileInput}
            id="category-picture"
            type="file"
            accept={ACCEPT}
            hidden
            aria-label={t('catalog.categories.appPicture')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void choose(file);
            }}
          />
        </div>
        <DialogFooter>
          {shown && !uploading ? (
            <Button
              type="button"
              variant="ghost"
              disabled={mutations.removeCategoryImage.isPending}
              onClick={() => void remove()}
            >
              <Trash2 />
              {t('catalog.categories.appPictureRemove')}
            </Button>
          ) : null}
          <Button type="button" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? <LoaderCircle className="animate-spin" /> : <ImagePlus />}
            {uploading
              ? t('catalog.categories.appPictureUploading')
              : shown
                ? t('catalog.categories.appPictureReplace')
                : t('catalog.categories.appPictureChoose')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A category's own code range, or the one it uses from an ancestor, muted with the ancestor's name
 * after it on the same line (ADR-0044 #1), so every row keeps one line.
 */
function RangeCell(props: { categories: readonly Category[]; category: Category }) {
  const { t } = useTranslation();
  const owner = rangeOwner(props.categories, props.category.id);
  if (!owner) return <None />;
  const text = `${owner.skuFrom ?? ''}–${owner.skuTo ?? ''}`;
  return owner.id === props.category.id ? (
    <span className="font-mono">{text}</span>
  ) : (
    <span className="text-muted-foreground">
      <span className="font-mono">{text}</span>
      <span className="ml-2 text-xs">
        {t('catalog.categories.inheritedFrom', { name: owner.name })}
      </span>
    </span>
  );
}

const optionalSku = z
  .string()
  .trim()
  .refine((value) => value === '' || SKU_PATTERN.test(value), 'validation.sku');

const categorySchema = z
  .object({
    name: z.string().trim().min(1, 'validation.required').max(100, 'validation.tooLong'),
    parentId: z.string(),
    defaultClassificationCode: optionalCode,
    skuFrom: optionalSku,
    skuTo: optionalSku,
  })
  .superRefine((values, context) => {
    if ((values.skuFrom === '') !== (values.skuTo === '')) {
      const path = values.skuFrom === '' ? 'skuFrom' : 'skuTo';
      context.addIssue({ code: 'custom', path: [path], message: 'validation.skuRangePair' });
      return;
    }
    if (
      SKU_PATTERN.test(values.skuFrom) &&
      SKU_PATTERN.test(values.skuTo) &&
      BigInt(values.skuFrom) > BigInt(values.skuTo)
    ) {
      context.addIssue({ code: 'custom', path: ['skuTo'], message: 'validation.skuRangeOrder' });
    }
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
      skuFrom: existing?.skuFrom ?? '',
      skuTo: existing?.skuTo ?? '',
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const body = {
      name: values.name,
      parentId: values.parentId ? Number.parseInt(values.parentId, 10) : null,
      defaultClassificationCode: values.defaultClassificationCode || null,
      skuFrom: values.skuFrom || null,
      skuTo: values.skuTo || null,
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
          <FormField
            label={t('catalog.categories.skuRange')}
            htmlFor="category-sku-from"
            hint={t('catalog.categories.skuRangeHint')}
            error={errors.skuFrom?.message ?? errors.skuTo?.message}
          >
            <div className="flex items-center gap-2">
              <Input
                id="category-sku-from"
                aria-label={t('catalog.categories.skuFrom')}
                inputMode="numeric"
                autoComplete="off"
                className="font-mono sm:w-36"
                {...form.register('skuFrom')}
              />
              <span aria-hidden className="text-muted-foreground">
                {'–'}
              </span>
              <Input
                aria-label={t('catalog.categories.skuTo')}
                inputMode="numeric"
                autoComplete="off"
                className="font-mono sm:w-36"
                {...form.register('skuTo')}
              />
            </div>
          </FormField>
          <DialogFormFooter pending={isSubmitting} onCancel={props.onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Units of measure: the system ones (ш, блок, хайрцаг, кг) and the admin's own. Each may carry the
 * e-Barimt measure unit that product units use by default. «Шинэ нэгж» opens from `?new=1`.
 */
export function UomsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('catalog.products.manage');
  const uoms = useUoms();
  const mutations = useCatalogMutations();
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<Uom | null>(null);
  const deletion = useDeleteConfirm<Uom>((id) => mutations.deleteUom.mutateAsync(id));
  const dialog: Uom | 'new' | null = editing ?? (creating && canManage ? 'new' : null);

  return (
    <div>
      <PageHeader
        title={t('catalog.uoms.title')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('catalog.uoms.create')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(uoms.error)} onRetry={uoms.refetch} />
      <ListCard scroll>
        <ListTable columns={canManage ? UOM_COLUMNS : UOM_READER_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.uoms.name')}</TableHead>
              <TableHead>{t('catalog.uoms.kind')}</TableHead>
              <TableHead>{t('catalog.uoms.fractional')}</TableHead>
              <TableHead>{t('catalog.uoms.measureUnit')}</TableHead>
              <SpacerHead />
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {uoms.isPending ? <SkeletonRows columns={canManage ? 6 : 5} /> : null}
            {(uoms.data ?? []).map((uom) => (
              <TableRow key={uom.id}>
                <TableCell className="font-medium">{uom.name}</TableCell>
                <TableCell>
                  <Badge variant={uom.code ? 'secondary' : 'outline'}>
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
                <SpacerCell />
                {canManage ? (
                  <RowActions>
                    <RowAction
                      icon={Pencil}
                      label={t('common.editRecord', { name: uom.name })}
                      onClick={() => setEditing(uom)}
                    />
                    {uom.code ? (
                      <RowActionSpacer />
                    ) : (
                      <RowAction
                        icon={Trash2}
                        label={`${t('common.delete')}: ${uom.name}`}
                        destructive
                        onClick={() => deletion.ask(uom)}
                      />
                    )}
                  </RowActions>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
      </ListCard>
      {dialog ? (
        <UomDialog uom={dialog} onClose={() => (editing ? setEditing(null) : setCreating(false))} />
      ) : null}
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
          <DialogFormFooter pending={isSubmitting} onCancel={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
