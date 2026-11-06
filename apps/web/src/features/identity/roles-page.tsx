import { zodResolver } from '@hookform/resolvers/zod';
import {
  ADMIN_LOCKED_PERMISSIONS,
  isSystemRole,
  PERMISSIONS,
  type Permission,
  SYSTEM_ROLE_PERMISSIONS,
} from '@tugeel/shared/auth';
import { Eye, Pencil, Plus, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import { useHasPermission } from '@/app/auth-context';
import { CheckboxGroup } from '@/components/checkbox-group';
import { Combobox } from '@/components/combobox';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  RowActionSpacer,
  SkeletonRows,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { RoleName } from '@/components/role-name';
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { problemFromError, settle } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useCreateParam } from '@/lib/use-create-param';
import { useDeleteConfirm } from '@/lib/use-delete-confirm';
import { localPhone } from '@/features/partners/phone';
import { type Role, useIdentityMutations, usePermissionCatalog, useRoles, useUsers } from './api';
import { groupPermissions } from './permission-groups';
import { StaffPermissions } from './staff-permissions';

const roleSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(60),
  permissions: z.array(z.enum(PERMISSIONS)),
});
type RoleValues = z.infer<typeof roleSchema>;

/** The roles list's columns (ADR-0119). */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', kind: 'text', weight: 3, min: 12 },
  { key: 'kind', kind: 'status', width: 10 },
  { key: 'permissions', kind: 'count' },
  { key: 'users', kind: 'count' },
  { key: 'actions', kind: 'actions', actions: 2 },
];

function PermissionLabel({ code }: { code: Permission }) {
  const { t } = useTranslation();
  return <>{t(`permissions.${code}`)}</>;
}

/**
 * Every role with its rights, changed in a dialog by those who manage roles: custom ones an admin
 * builds (ADR-0027 #5) and the system ones too (ADR-0163), whose name stays and which cannot be
 * deleted. The bar's «Ажилтан» (`?user=`) narrows the list to that person's roles and shows every
 * right they hold or lack (ADR-0163 #5).
 */
export function RolesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('identity.roles.manage');
  const roles = useRoles();
  const mutations = useIdentityMutations();
  const [creating, setCreating] = useCreateParam();
  const [open, setOpen] = useState<Role | null>(null);
  const deletion = useDeleteConfirm<Role>((id) => mutations.deleteRole.mutateAsync(id));
  const [params, setParams] = useSearchParams();
  const users = useUsers({});
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = users;
  // The picker offers everybody, so a staff larger than one page is read to its end.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const staff = useMemo(() => users.data?.pages.flatMap((page) => page.data) ?? [], [users.data]);
  const staffOptions = useMemo(
    () =>
      staff.map((user) => ({
        value: String(user.id),
        label: user.fullName,
        ...(user.phone ? { hint: localPhone(user.phone), keys: [user.phone] } : {}),
      })),
    [staff],
  );
  const chosenId = params.get('user') ?? '';
  const chosen = staff.find((user) => String(user.id) === chosenId) ?? null;
  const pickUser = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('show');
        if (value) next.set('user', value);
        else next.delete('user');
        return next;
      },
      { replace: true },
    );
  const allRoles = roles.data ?? [];
  const rows = chosen ? allRoles.filter((role) => chosen.roleIds.includes(role.id)) : allRoles;
  const nameOf = (role: Role) =>
    role.code && isSystemRole(role.code)
      ? t(`roles.system.${role.code}`)
      : (role.name ?? role.code ?? '');

  return (
    <div>
      <PageHeader
        title={t('roles.title')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('roles.create')}
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <Combobox
          aria-label={t('roles.staff.filter')}
          value={chosenId}
          options={staffOptions}
          emptyLabel={t('roles.staff.all')}
          onChange={pickUser}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(roles.error)} onRetry={roles.refetch} />
      <ProblemAlert problem={problemFromError(users.error)} onRetry={users.refetch} />
      <ListCard scroll={!chosen}>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('roles.columns.name')}</TableHead>
              <TableHead>{t('roles.columns.kind')}</TableHead>
              <TableHead className="text-right">{t('roles.columns.permissions')}</TableHead>
              <TableHead className="text-right">{t('roles.columns.users')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('common.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.isPending ? <SkeletonRows columns={5} /> : null}
            {rows.map((role) => (
              <TableRow key={role.id}>
                <TableCell className="font-medium">
                  <RoleName role={role} />
                </TableCell>
                <TableCell>
                  {/* A kind, not a state: neutral outlines. */}
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline">
                      {role.isSystem ? t('roles.systemBadge') : t('roles.customBadge')}
                    </Badge>
                    {role.customized ? (
                      <Badge variant="secondary">{t('roles.customizedBadge')}</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono">{role.permissions.length}</TableCell>
                <TableCell className="text-right font-mono">{role.userCount}</TableCell>
                <RowActions>
                  <RowAction
                    label={`${canManage ? t('common.edit') : t('roles.view')}: ${nameOf(role)}`}
                    icon={canManage ? Pencil : Eye}
                    onClick={() => setOpen(role)}
                  />
                  {canManage && !role.isSystem ? (
                    <RowAction
                      label={`${t('common.delete')}: ${nameOf(role)}`}
                      icon={Trash2}
                      destructive
                      onClick={() => deletion.ask(role)}
                    />
                  ) : (
                    <RowActionSpacer />
                  )}
                </RowActions>
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
        {!roles.isPending && rows.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={chosen ? t('roles.staff.noRoles') : t('roles.empty')}
          />
        ) : null}
      </ListCard>
      {chosen ? (
        <div className="mt-4">
          <StaffPermissions user={chosen} roles={allRoles} />
        </div>
      ) : null}
      {creating ? <RoleDialog role="new" onClose={() => setCreating(false)} /> : null}
      {open ? (
        canManage ? (
          <RoleDialog role={open} onClose={() => setOpen(null)} />
        ) : (
          <RolePermissionsDialog role={open} onClose={() => setOpen(null)} />
        )
      ) : null}
      <ConfirmDialog
        open={deletion.target !== null}
        title={t('common.delete')}
        description={t('roles.deleteConfirm', {
          name: deletion.target ? nameOf(deletion.target) : '',
        })}
        confirmLabel={t('common.delete')}
        pending={deletion.pending}
        problem={deletion.problem}
        onClose={deletion.close}
        onConfirm={deletion.confirm}
      />
    </div>
  );
}

/**
 * What a role may do, for someone who cannot change it: the permissions in two columns; the dialog
 * scrolls as a whole and keeps «Хаах» in view (ADR-0066).
 */
function RolePermissionsDialog({ role, onClose }: { role: Role; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            <RoleName role={role} />
          </DialogTitle>
          <DialogDescription>{t('roles.userCount', { count: role.userCount })}</DialogDescription>
        </DialogHeader>
        {role.permissions.length ? (
          <ul className="list-inside list-disc gap-x-6 text-sm sm:columns-2 [&>li]:mb-1 [&>li]:break-inside-avoid">
            {role.permissions.map((code) => (
              <li key={code}>
                <PermissionLabel code={code} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('roles.noPermissions')}</p>
        )}
        <DialogFooter closeLabel={t('common.close')} />
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({ role, onClose }: { role: Role | 'new'; onClose: () => void }) {
  const { t } = useTranslation();
  const catalog = usePermissionCatalog();
  const mutations = useIdentityMutations();
  const isNew = role === 'new';
  // A system role's code: its name is the code's label, shown but not sent (ADR-0163 #1).
  const systemCode = !isNew && role.code && isSystemRole(role.code) ? role.code : null;
  const isAdmin = systemCode === 'ADMIN';
  const form = useForm<RoleValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: isNew
      ? { name: '', permissions: [] }
      : {
          name: systemCode ? t(`roles.system.${systemCode}`) : (role.name ?? ''),
          permissions: role.permissions,
        },
  });
  const submit = form.handleSubmit(async (values) => {
    const saved = await settle(
      isNew
        ? mutations.createRole.mutateAsync(values)
        : mutations.updateRole.mutateAsync({
            id: role.id,
            body: systemCode ? { permissions: values.permissions } : values,
          }),
    );
    if (saved) {
      toast.success(t('common.saved'));
      onClose();
    }
  });
  const { errors, isSubmitting } = form.formState;
  // The admin-only codes are shown only on ADMIN, ticked and locked (ADR-0163 #3).
  const offered = (catalog.data ?? []).filter((permission) => isAdmin || permission.assignable);
  const groups = groupPermissions(offered.map((permission) => permission.code));

  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent size="lg">
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{isNew ? t('roles.create') : t('roles.edit')}</DialogTitle>
            <DialogDescription>
              {systemCode && !isNew
                ? t('roles.form.systemHint', { count: role.userCount })
                : t('roles.form.adminOnly')}
            </DialogDescription>
          </DialogHeader>
          <ProblemAlert
            problem={problemFromError(mutations.createRole.error ?? mutations.updateRole.error)}
          />
          <FormField label={t('roles.form.name')} htmlFor="role-name" error={errors.name?.message}>
            <Input id="role-name" readOnly={systemCode !== null} {...form.register('name')} />
          </FormField>
          {/* One scroller: the dialog itself, with «Болих» and «Хадгалах» kept in view (ADR-0066). */}
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 flex w-full items-center justify-between gap-2 text-sm font-medium">
              {t('roles.form.permissions')}
              {systemCode ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    form.setValue('permissions', [...SYSTEM_ROLE_PERMISSIONS[systemCode]], {
                      shouldDirty: true,
                    })
                  }
                >
                  <Undo2 />
                  {t('roles.form.reset')}
                </Button>
              ) : null}
            </legend>
            {isAdmin ? (
              <p className="text-sm text-muted-foreground">{t('roles.form.adminLocked')}</p>
            ) : null}
            <Controller
              control={form.control}
              name="permissions"
              render={({ field }) => (
                <>
                  {groups.map(({ group, codes }) => (
                    <div key={group} className="flex flex-col gap-2">
                      <h3 className="text-[0.8125rem] font-semibold text-muted-foreground">
                        {t(`roles.groups.${group}`)}
                      </h3>
                      <CheckboxGroup
                        name="permission"
                        value={field.value}
                        onChange={field.onChange}
                        options={codes.map((code) => ({
                          value: code,
                          label: <PermissionLabel code={code} />,
                          disabled: isAdmin && ADMIN_LOCKED_PERMISSIONS.includes(code),
                        }))}
                      />
                    </div>
                  ))}
                </>
              )}
            />
          </fieldset>
          <DialogFormFooter pending={isSubmitting} onCancel={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
