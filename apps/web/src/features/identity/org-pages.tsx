import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Pencil, Plus, Warehouse as WarehouseIcon } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  ListCard,
  RowAction,
  RowActions,
  RowActionSpacer,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { problemFromError, settle } from '@/lib/problem';
import { useCreateParam } from '@/lib/use-create-param';
import {
  type Branch,
  useBranches,
  useIdentityMutations,
  useWarehouses,
  type Warehouse,
} from './api';

const ORG_CODE = /^[A-Z0-9][A-Z0-9_-]{0,15}$/;
const code = z.string().trim().toUpperCase().regex(ORG_CODE, 'validation.orgCode');
const optionalDigits = (
  digits: number,
  message: 'validation.branchNo' | 'validation.districtCode',
) =>
  z
    .string()
    .trim()
    .refine((value) => value === '' || new RegExp(`^\\d{${digits}}$`).test(value), message);
const STATUS = ['ACTIVE', 'INACTIVE'] as const;

const branchSchema = z.object({
  code,
  name: z.string().trim().min(1, 'validation.required').max(100),
  branchNo: optionalDigits(3, 'validation.branchNo'),
  districtCode: optionalDigits(4, 'validation.districtCode'),
  address: z.string().trim().max(300),
  status: z.enum(STATUS),
});
type BranchValues = z.infer<typeof branchSchema>;

/** «Идэвхтэй» as a switch beside its label, for the organisation's dialogs (ADR-0043). */
function ActiveSwitch(props: {
  id: string;
  value: (typeof STATUS)[number];
  onChange: (value: (typeof STATUS)[number]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={props.id}>{t('org.active')}</Label>
      <Switch
        id={props.id}
        checked={props.value === 'ACTIVE'}
        onCheckedChange={(checked) => props.onChange(checked ? 'ACTIVE' : 'INACTIVE')}
      />
    </div>
  );
}

/** Branches carry the e-Barimt branch number and district code (SPEC §5.1). */
export function BranchesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('identity.org.manage');
  const branches = useBranches();
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<Branch | null>(null);

  return (
    <div>
      <PageHeader
        title={t('org.branches.title')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('org.branches.create')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(branches.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('org.branches.code')}</TableHead>
              <TableHead>{t('org.branches.name')}</TableHead>
              <TableHead>{t('org.branches.branchNo')}</TableHead>
              <TableHead>{t('org.branches.districtCode')}</TableHead>
              <TableHead>{t('users.columns.status')}</TableHead>
              {canManage ? (
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.isPending ? <SkeletonRows columns={canManage ? 6 : 5} /> : null}
            {(branches.data ?? []).map((branch) => (
              <TableRow key={branch.id}>
                <TableCell className="font-mono">{branch.code}</TableCell>
                <TableCell className="font-medium">{branch.name}</TableCell>
                <TableCell className="font-mono">{branch.branchNo ?? t('common.none')}</TableCell>
                <TableCell className="font-mono">
                  {branch.districtCode ?? t('common.none')}
                </TableCell>
                <TableCell>
                  <Badge variant={branch.status === 'ACTIVE' ? 'success' : 'secondary'}>
                    {t(`org.status.${branch.status}`)}
                  </Badge>
                </TableCell>
                {canManage ? (
                  <RowActions>
                    <RowAction
                      label={t('common.editRecord', { name: branch.name })}
                      icon={Pencil}
                      onClick={() => setEditing(branch)}
                    />
                  </RowActions>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {branches.data?.length === 0 ? (
          <EmptyState icon={Building2} title={t('org.branches.empty')} />
        ) : null}
      </ListCard>
      {creating ? <BranchDialog branch="new" onClose={() => setCreating(false)} /> : null}
      {editing ? <BranchDialog branch={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function BranchDialog({ branch, onClose }: { branch: Branch | 'new'; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useIdentityMutations();
  const isNew = branch === 'new';
  const form = useForm<BranchValues>({
    resolver: zodResolver(branchSchema),
    defaultValues: isNew
      ? { code: '', name: '', branchNo: '', districtCode: '', address: '', status: 'ACTIVE' }
      : {
          code: branch.code,
          name: branch.name,
          branchNo: branch.branchNo ?? '',
          districtCode: branch.districtCode ?? '',
          address: branch.address ?? '',
          status: branch.status,
        },
  });
  const submit = form.handleSubmit(async (values) => {
    const body = {
      code: values.code,
      name: values.name,
      branchNo: values.branchNo || null,
      districtCode: values.districtCode || null,
      address: values.address || null,
    };
    const saved = await settle(
      isNew
        ? mutations.createBranch.mutateAsync(body)
        : mutations.updateBranch.mutateAsync({
            id: branch.id,
            body: { ...body, status: values.status },
          }),
    );
    if (saved) onClose();
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{isNew ? t('org.branches.create') : t('org.branches.edit')}</DialogTitle>
          </DialogHeader>
          <ProblemAlert
            problem={problemFromError(mutations.createBranch.error ?? mutations.updateBranch.error)}
          />
          <FormField
            label={t('org.branches.code')}
            htmlFor="branch-code"
            error={errors.code?.message}
          >
            <Input
              id="branch-code"
              autoCapitalize="characters"
              className="font-mono"
              {...form.register('code')}
            />
          </FormField>
          <FormField
            label={t('org.branches.name')}
            htmlFor="branch-name"
            error={errors.name?.message}
          >
            <Input id="branch-name" {...form.register('name')} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label={t('org.branches.branchNo')}
              htmlFor="branch-no"
              error={errors.branchNo?.message}
            >
              <Input
                id="branch-no"
                inputMode="numeric"
                className="font-mono"
                {...form.register('branchNo')}
              />
            </FormField>
            <FormField
              label={t('org.branches.districtCode')}
              htmlFor="branch-district"
              error={errors.districtCode?.message}
            >
              <Input
                id="branch-district"
                inputMode="numeric"
                className="font-mono"
                {...form.register('districtCode')}
              />
            </FormField>
          </div>
          <FormField label={t('org.branches.address')} htmlFor="branch-address">
            <Input id="branch-address" {...form.register('address')} />
          </FormField>
          {!isNew ? (
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <ActiveSwitch id="branch-status" value={field.value} onChange={field.onChange} />
              )}
            />
          ) : null}
          <DialogFormFooter pending={isSubmitting} onCancel={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

const warehouseSchema = z.object({
  code,
  name: z.string().trim().min(1, 'validation.required').max(100),
  kind: z.enum(['WHOLESALE', 'STORE']),
  branchId: z.string().min(1, 'validation.required'),
  status: z.enum(STATUS),
});
type WarehouseValues = z.infer<typeof warehouseSchema>;

/** Wholesale and store warehouses; TRANSIT (system) and VEHICLE (delivery 5) are read-only here. */
export function WarehousesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('identity.org.manage');
  const warehouses = useWarehouses();
  const branches = useBranches();
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const branchName = (id: number | null) =>
    branches.data?.find((branch) => branch.id === id)?.name ?? t('common.none');

  return (
    <div>
      <PageHeader
        title={t('org.warehouses.title')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('org.warehouses.create')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(warehouses.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('org.warehouses.code')}</TableHead>
              <TableHead>{t('org.warehouses.name')}</TableHead>
              <TableHead>{t('org.warehouses.kind')}</TableHead>
              <TableHead>{t('org.warehouses.branch')}</TableHead>
              <TableHead>{t('users.columns.status')}</TableHead>
              {canManage ? (
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {warehouses.isPending ? <SkeletonRows columns={canManage ? 6 : 5} /> : null}
            {(warehouses.data ?? []).map((warehouse) => {
              const editable = warehouse.kind === 'WHOLESALE' || warehouse.kind === 'STORE';
              const name = editable ? warehouse.name : t(`org.kinds.${warehouse.kind}`);
              return (
                <TableRow key={warehouse.id}>
                  <TableCell className="font-mono">{warehouse.code}</TableCell>
                  <TableCell className="font-medium">
                    {name}
                    {editable ? null : (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {t('org.warehouses.systemNote')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{t(`org.kinds.${warehouse.kind}`)}</TableCell>
                  <TableCell>{branchName(warehouse.branchId)}</TableCell>
                  <TableCell>
                    <Badge variant={warehouse.status === 'ACTIVE' ? 'success' : 'secondary'}>
                      {t(`org.status.${warehouse.status}`)}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <RowActions>
                      {editable ? (
                        <RowAction
                          label={t('common.editRecord', { name })}
                          icon={Pencil}
                          onClick={() => setEditing(warehouse)}
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
        {warehouses.data?.length === 0 ? (
          <EmptyState icon={WarehouseIcon} title={t('org.warehouses.empty')} />
        ) : null}
      </ListCard>
      {creating ? <WarehouseDialog warehouse="new" onClose={() => setCreating(false)} /> : null}
      {editing ? <WarehouseDialog warehouse={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function WarehouseDialog({
  warehouse,
  onClose,
}: {
  warehouse: Warehouse | 'new';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const branches = useBranches();
  const mutations = useIdentityMutations();
  const isNew = warehouse === 'new';
  const form = useForm<WarehouseValues>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: isNew
      ? { code: '', name: '', kind: 'WHOLESALE', branchId: '', status: 'ACTIVE' }
      : {
          code: warehouse.code,
          name: warehouse.name,
          kind: warehouse.kind === 'STORE' ? 'STORE' : 'WHOLESALE',
          branchId: String(warehouse.branchId ?? ''),
          status: warehouse.status,
        },
  });
  const submit = form.handleSubmit(async (values) => {
    const branchId = Number.parseInt(values.branchId, 10);
    const saved = await settle(
      isNew
        ? mutations.createWarehouse.mutateAsync({
            code: values.code,
            name: values.name,
            kind: values.kind,
            branchId,
          })
        : mutations.updateWarehouse.mutateAsync({
            id: warehouse.id,
            body: { code: values.code, name: values.name, branchId, status: values.status },
          }),
    );
    if (saved) onClose();
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>
              {isNew ? t('org.warehouses.create') : t('org.warehouses.edit')}
            </DialogTitle>
          </DialogHeader>
          <ProblemAlert
            problem={problemFromError(
              mutations.createWarehouse.error ?? mutations.updateWarehouse.error,
            )}
          />
          <FormField
            label={t('org.warehouses.code')}
            htmlFor="warehouse-code"
            error={errors.code?.message}
          >
            <Input
              id="warehouse-code"
              autoCapitalize="characters"
              className="font-mono"
              {...form.register('code')}
            />
          </FormField>
          <FormField
            label={t('org.warehouses.name')}
            htmlFor="warehouse-name"
            error={errors.name?.message}
          >
            <Input id="warehouse-name" {...form.register('name')} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('org.warehouses.kind')} htmlFor="warehouse-kind">
              <NativeSelect id="warehouse-kind" disabled={!isNew} {...form.register('kind')}>
                <option value="WHOLESALE">{t('org.kinds.WHOLESALE')}</option>
                <option value="STORE">{t('org.kinds.STORE')}</option>
              </NativeSelect>
            </FormField>
            <FormField
              label={t('org.warehouses.branch')}
              htmlFor="warehouse-branch"
              error={errors.branchId?.message}
            >
              <NativeSelect id="warehouse-branch" {...form.register('branchId')}>
                <option value="">{t('common.none')}</option>
                {(branches.data ?? []).map((branch) => (
                  <option key={branch.id} value={String(branch.id)}>
                    {branch.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
          {!isNew ? (
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <ActiveSwitch id="warehouse-status" value={field.value} onChange={field.onChange} />
              )}
            />
          ) : null}
          <DialogFormFooter pending={isSubmitting} onCancel={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
