import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, ArchiveRestore, CornerDownRight, Pencil, Plus, Tags } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  ListCard,
  ListTable,
  RowAction,
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import { type SupplierCategory, useSupplierCategories, useSupplierCategoryMutations } from './api';

/** The list's columns (ADR-0119); without the actions column for a reader. */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 12 },
  { key: 'suppliers', kind: 'count', width: 6.5 },
  { key: 'sortOrder', kind: 'count' },
  { key: 'status', kind: 'status' },
  { key: 'spacer', kind: 'spacer' },
  { key: 'actions', kind: 'actions', actions: 3 },
];
const READER_COLUMNS = COLUMNS.slice(0, -1);

type DialogState = { category: SupplierCategory } | { parentId: number | null };

/**
 * Supplier categories (ADR-0161): a tree, each child indented under its parent. A name opens the
 * suppliers of that category and everything below it; a retired one stays on its suppliers and
 * leaves the pickers. Every user reads them; `partners.suppliers.manage` keeps them.
 */
export function SupplierCategoriesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('partners.suppliers.manage');
  const categories = useSupplierCategories();
  const mutations = useSupplierCategoryMutations();
  const action = useAction();
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<DialogState | null>(null);
  const rows = categories.data ?? [];
  const dialog: DialogState | null = editing ?? (creating && canManage ? { parentId: null } : null);

  const toggle = (category: SupplierCategory) =>
    void action.run(async () => {
      const saved = await mutations.update.mutateAsync({
        id: category.id,
        body: { active: !category.active },
      });
      toast.success(
        t(
          saved.active
            ? 'partners.supplierCategories.reactivated'
            : 'partners.supplierCategories.retired',
          {
            name: saved.name,
          },
        ),
      );
    });

  return (
    <div>
      <PageHeader
        title={t('partners.supplierCategories.title')}
        description={t('partners.supplierCategories.description')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('partners.supplierCategories.create')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(categories.error) ?? action.problem} />
      <ListCard scroll>
        <ListTable columns={canManage ? COLUMNS : READER_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('partners.supplierCategories.name')}</TableHead>
              <TableHead className="text-right">
                {t('partners.supplierCategories.suppliers')}
              </TableHead>
              <TableHead className="text-right">
                {t('partners.supplierCategories.sortOrder')}
              </TableHead>
              <TableHead>{t('partners.supplierCategories.status')}</TableHead>
              <SpacerHead />
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.isPending ? <SkeletonRows columns={canManage ? 6 : 5} /> : null}
            {rows.map((category) => (
              <TableRow key={category.id}>
                <TableCell className="font-medium">
                  {/* Each level a step in; the parents above it say where it sits. */}
                  <div
                    className="flex min-w-0 items-center gap-1.5"
                    style={{ paddingLeft: `${category.depth * 1.25}rem` }}
                  >
                    {category.depth > 0 ? (
                      <CornerDownRight
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    ) : null}
                    <Link
                      to={`/partners/suppliers?category=${category.id}`}
                      aria-label={t('partners.supplierCategories.showSuppliers', {
                        name: category.path,
                      })}
                      className={
                        category.active
                          ? 'truncate underline-offset-4 hover:underline'
                          : 'truncate text-muted-foreground underline-offset-4 hover:underline'
                      }
                    >
                      {category.name}
                    </Link>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCount(category.supplierCount)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{category.sortOrder}</TableCell>
                <TableCell>
                  <Badge variant={category.active ? 'success' : 'outline'}>
                    {t(
                      category.active
                        ? 'partners.supplierCategories.active'
                        : 'partners.supplierCategories.inactive',
                    )}
                  </Badge>
                </TableCell>
                <SpacerCell />
                {canManage ? (
                  <RowActions>
                    <RowAction
                      icon={Plus}
                      label={t('partners.supplierCategories.addChild', { name: category.name })}
                      disabled={!category.active}
                      onClick={() => setEditing({ parentId: category.id })}
                    />
                    <RowAction
                      icon={Pencil}
                      label={t('common.editRecord', { name: category.name })}
                      onClick={() => setEditing({ category })}
                    />
                    <RowAction
                      icon={category.active ? Archive : ArchiveRestore}
                      label={t(
                        category.active
                          ? 'partners.supplierCategories.retire'
                          : 'partners.supplierCategories.reactivate',
                        { name: category.name },
                      )}
                      disabled={mutations.update.isPending}
                      onClick={() => toggle(category)}
                    />
                  </RowActions>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
        {!categories.isPending && rows.length === 0 ? (
          <EmptyState icon={Tags} title={t('partners.supplierCategories.empty')} />
        ) : null}
      </ListCard>
      {dialog ? (
        <CategoryDialog
          state={dialog}
          categories={rows}
          onClose={() => (editing ? setEditing(null) : setCreating(false))}
        />
      ) : null}
    </div>
  );
}

const categorySchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(80, 'validation.tooLong'),
  parentId: z.string(),
  sortOrder: z
    .string()
    .trim()
    .regex(/^[0-9]{0,6}$/, 'validation.sortOrder'),
});
type CategoryValues = z.infer<typeof categorySchema>;

/** The category and everything below it: none of them can become its parent. */
function selfAndBelow(categories: readonly SupplierCategory[], id: number): Set<number> {
  const found = new Set([id]);
  // Parents come before their children in the list, so one pass reaches the whole subtree.
  for (const category of categories) {
    if (category.parentId !== null && found.has(category.parentId)) found.add(category.id);
  }
  return found;
}

function CategoryDialog(props: {
  state: DialogState;
  categories: readonly SupplierCategory[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useSupplierCategoryMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const category = 'category' in props.state ? props.state.category : null;
  const startParent = category
    ? category.parentId
    : 'parentId' in props.state
      ? props.state.parentId
      : null;
  const form = useForm<CategoryValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: category?.name ?? '',
      parentId: startParent === null ? '' : String(startParent),
      sortOrder: category ? String(category.sortOrder) : '',
    },
  });
  const blocked = category ? selfAndBelow(props.categories, category.id) : new Set<number>();
  // A retired parent stays offered only where the category already sits.
  const parents = props.categories.filter(
    (entry) => !blocked.has(entry.id) && (entry.active || entry.id === startParent),
  );
  const submit = form.handleSubmit(async (values) => {
    const sortOrder = values.sortOrder === '' ? undefined : Number.parseInt(values.sortOrder, 10);
    const parentId = values.parentId === '' ? null : Number.parseInt(values.parentId, 10);
    const ok = await action.run(() =>
      category
        ? mutations.update.mutateAsync({
            id: category.id,
            body: { name: values.name, parentId, sortOrder },
          })
        : mutations.create.mutateAsync({ key, name: values.name, parentId, sortOrder }),
    );
    if (ok) {
      toast.success(t('partners.supplierCategories.saved'));
      props.onClose();
    }
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="sm" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {category
              ? t('partners.supplierCategories.edit')
              : t('partners.supplierCategories.create')}
          </DialogTitle>
          <DialogDescription>{t('partners.supplierCategories.description')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <FormField
            label={t('partners.supplierCategories.name')}
            htmlFor="supplier-category-name"
            error={errors.name?.message}
          >
            <Input
              id="supplier-category-name"
              autoComplete="off"
              maxLength={80}
              {...form.register('name')}
            />
          </FormField>
          <FormField
            label={t('partners.supplierCategories.parent')}
            htmlFor="supplier-category-parent"
          >
            <NativeSelect id="supplier-category-parent" {...form.register('parentId')}>
              <option value="">{t('partners.supplierCategories.noParent')}</option>
              {parents.map((entry) => (
                <option key={entry.id} value={String(entry.id)}>
                  {entry.path}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            label={t('partners.supplierCategories.sortOrder')}
            htmlFor="supplier-category-sort"
            hint={t('partners.supplierCategories.sortOrderHint')}
            error={errors.sortOrder?.message}
          >
            <Input
              id="supplier-category-sort"
              inputMode="numeric"
              autoComplete="off"
              className="w-32"
              {...form.register('sortOrder')}
            />
          </FormField>
          <DialogFormFooter pending={isSubmitting} onCancel={props.onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
