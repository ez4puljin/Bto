import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useHasPermission } from '@/app/auth-context';
import { FieldError } from '@/components/field-error';
import { EmptyState, ListCard, SkeletonRows } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { problemFromError, settle } from '@/lib/problem';
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

/** Branches carry the e-Barimt branch number and district code (SPEC §5.1). */
export function BranchesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('identity.org.manage');
  const branches = useBranches();
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);

  return (
    <div>
      <PageHeader
        title={t('org.branches.title')}
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
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
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t('common.editRecord', { name: branch.name })}
                      onClick={() => setEditing(branch)}
                    >
                      {t('common.edit')}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {branches.data?.length === 0 ? (
          <EmptyState icon={Building2} title={t('org.branches.empty')} />
        ) : null}
      </ListCard>
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
        <DialogHeader>
          <DialogTitle>{isNew ? t('org.branches.create') : t('org.branches.edit')}</DialogTitle>
        </DialogHeader>
        <ProblemAlert
          problem={problemFromError(mutations.createBranch.error ?? mutations.updateBranch.error)}
        />
        <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="branch-code">{t('org.branches.code')}</Label>
            <Input id="branch-code" autoCapitalize="characters" {...form.register('code')} />
            <FieldError message={errors.code?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="branch-name">{t('org.branches.name')}</Label>
            <Input id="branch-name" {...form.register('name')} />
            <FieldError message={errors.name?.message} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="branch-no">{t('org.branches.branchNo')}</Label>
              <Input id="branch-no" inputMode="numeric" {...form.register('branchNo')} />
              <FieldError message={errors.branchNo?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="branch-district">{t('org.branches.districtCode')}</Label>
              <Input id="branch-district" inputMode="numeric" {...form.register('districtCode')} />
              <FieldError message={errors.districtCode?.message} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="branch-address">{t('org.branches.address')}</Label>
            <Input id="branch-address" {...form.register('address')} />
          </div>
          {!isNew ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="branch-status">{t('users.columns.status')}</Label>
              <NativeSelect id="branch-status" {...form.register('status')}>
                {STATUS.map((status) => (
                  <option key={status} value={status}>
                    {t(`org.status.${status}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
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
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null);
  const branchName = (id: number | null) =>
    branches.data?.find((branch) => branch.id === id)?.name ?? t('common.none');

  return (
    <div>
      <PageHeader
        title={t('org.warehouses.title')}
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
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
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell>{t(`org.kinds.${warehouse.kind}`)}</TableCell>
                  <TableCell>{branchName(warehouse.branchId)}</TableCell>
                  <TableCell>
                    <Badge variant={warehouse.status === 'ACTIVE' ? 'success' : 'secondary'}>
                      {t(`org.status.${warehouse.status}`)}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      {editable ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={t('common.editRecord', { name })}
                          onClick={() => setEditing(warehouse)}
                        >
                          {t('common.edit')}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t('org.warehouses.systemNote')}
                        </span>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ListCard>
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
        <DialogHeader>
          <DialogTitle>{isNew ? t('org.warehouses.create') : t('org.warehouses.edit')}</DialogTitle>
        </DialogHeader>
        <ProblemAlert
          problem={problemFromError(
            mutations.createWarehouse.error ?? mutations.updateWarehouse.error,
          )}
        />
        <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="warehouse-code">{t('org.warehouses.code')}</Label>
            <Input id="warehouse-code" autoCapitalize="characters" {...form.register('code')} />
            <FieldError message={errors.code?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="warehouse-name">{t('org.warehouses.name')}</Label>
            <Input id="warehouse-name" {...form.register('name')} />
            <FieldError message={errors.name?.message} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="warehouse-kind">{t('org.warehouses.kind')}</Label>
              <NativeSelect id="warehouse-kind" disabled={!isNew} {...form.register('kind')}>
                <option value="WHOLESALE">{t('org.kinds.WHOLESALE')}</option>
                <option value="STORE">{t('org.kinds.STORE')}</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="warehouse-branch">{t('org.warehouses.branch')}</Label>
              <NativeSelect id="warehouse-branch" {...form.register('branchId')}>
                <option value="">{t('common.none')}</option>
                {(branches.data ?? []).map((branch) => (
                  <option key={branch.id} value={String(branch.id)}>
                    {branch.name}
                  </option>
                ))}
              </NativeSelect>
              <FieldError message={errors.branchId?.message} />
            </div>
          </div>
          {!isNew ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="warehouse-status">{t('users.columns.status')}</Label>
              <NativeSelect id="warehouse-status" {...form.register('status')}>
                {STATUS.map((status) => (
                  <option key={status} value={status}>
                    {t(`org.status.${status}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
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
