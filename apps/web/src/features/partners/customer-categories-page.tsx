import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, ArchiveRestore, Pencil, Plus, Tags } from 'lucide-react';
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
  RowAction,
  RowActions,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
} from '@/components/list';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import { type CustomerCategory, useCustomerCategories, useCustomerCategoryMutations } from './api';

/**
 * Customer categories (ADR-0107): the office's flat list, the Erkhet groups at the migration. A
 * name opens the customers of that category; a retired category stays on its customers and leaves
 * the pickers. Readers see the list; `partners.customers.manage` adds, renames, orders and retires.
 */
export function CustomerCategoriesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('partners.customers.manage');
  const categories = useCustomerCategories();
  const mutations = useCustomerCategoryMutations();
  const action = useAction();
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<CustomerCategory | null>(null);
  const dialog: CustomerCategory | 'new' | null = editing ?? (creating && canManage ? 'new' : null);
  const rows = categories.data ?? [];

  const toggle = (category: CustomerCategory) =>
    void action.run(async () => {
      const saved = await mutations.update.mutateAsync({
        id: category.id,
        body: { active: !category.active },
      });
      toast.success(
        t(saved.active ? 'partners.categories.reactivated' : 'partners.categories.retired', {
          name: saved.name,
        }),
      );
    });

  return (
    <div>
      <PageHeader
        title={t('partners.categories.title')}
        description={t('partners.categories.description')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('partners.categories.create')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(categories.error) ?? action.problem} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('partners.categories.name')}</TableHead>
              <TableHead className="text-right">{t('partners.categories.sortOrder')}</TableHead>
              <TableHead>{t('partners.categories.status')}</TableHead>
              <SpacerHead />
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.isPending ? <SkeletonRows columns={canManage ? 5 : 4} /> : null}
            {rows.map((category) => (
              <TableRow key={category.id}>
                <TableCell className="font-medium">
                  <Link
                    to={`/partners/customers?category=${category.id}`}
                    aria-label={t('partners.categories.showCustomers', { name: category.name })}
                    className={
                      category.active
                        ? 'underline-offset-4 hover:underline'
                        : 'text-muted-foreground underline-offset-4 hover:underline'
                    }
                  >
                    {category.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{category.sortOrder}</TableCell>
                <TableCell>
                  <Badge variant={category.active ? 'success' : 'outline'}>
                    {t(
                      category.active
                        ? 'partners.categories.active'
                        : 'partners.categories.inactive',
                    )}
                  </Badge>
                </TableCell>
                <SpacerCell />
                {canManage ? (
                  <RowActions>
                    <RowAction
                      icon={Pencil}
                      label={t('common.editRecord', { name: category.name })}
                      onClick={() => setEditing(category)}
                    />
                    <RowAction
                      icon={category.active ? Archive : ArchiveRestore}
                      label={t(
                        category.active
                          ? 'partners.categories.retire'
                          : 'partners.categories.reactivate',
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
        </Table>
        {!categories.isPending && rows.length === 0 ? (
          <EmptyState icon={Tags} title={t('partners.categories.empty')} />
        ) : null}
      </ListCard>
      {dialog ? (
        <CategoryDialog
          category={dialog}
          onClose={() => (editing ? setEditing(null) : setCreating(false))}
        />
      ) : null}
    </div>
  );
}

const categorySchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(80, 'validation.tooLong'),
  sortOrder: z
    .string()
    .trim()
    .regex(/^[0-9]{0,6}$/, 'validation.sortOrder'),
});
type CategoryValues = z.infer<typeof categorySchema>;

function CategoryDialog(props: { category: CustomerCategory | 'new'; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useCustomerCategoryMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const { category } = props;
  const isNew = category === 'new';
  const form = useForm<CategoryValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: isNew
      ? { name: '', sortOrder: '' }
      : { name: category.name, sortOrder: String(category.sortOrder) },
  });
  const submit = form.handleSubmit(async (values) => {
    const sortOrder = values.sortOrder === '' ? undefined : Number.parseInt(values.sortOrder, 10);
    const ok = await action.run(() =>
      isNew
        ? mutations.create.mutateAsync({ key, name: values.name, sortOrder })
        : mutations.update.mutateAsync({
            id: category.id,
            body: { name: values.name, sortOrder },
          }),
    );
    if (ok) {
      toast.success(t('partners.categories.saved'));
      props.onClose();
    }
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="sm" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {isNew ? t('partners.categories.create') : t('partners.categories.edit')}
          </DialogTitle>
          <DialogDescription>{t('partners.categories.description')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <FormField
            label={t('partners.categories.name')}
            htmlFor="category-name"
            error={errors.name?.message}
          >
            <Input
              id="category-name"
              autoComplete="off"
              maxLength={80}
              {...form.register('name')}
            />
          </FormField>
          <FormField
            label={t('partners.categories.sortOrder')}
            htmlFor="category-sort"
            hint={t('partners.categories.sortOrderHint')}
            error={errors.sortOrder?.message}
          >
            <Input
              id="category-sort"
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
