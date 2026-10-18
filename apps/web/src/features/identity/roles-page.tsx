import { zodResolver } from '@hookform/resolvers/zod';
import { isSystemRole, PERMISSIONS, type Permission } from '@tugeel/shared/auth';
import { Eye, Lock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useHasPermission } from '@/app/auth-context';
import { CheckboxGroup } from '@/components/checkbox-group';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  ListCard,
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
import { useDeleteConfirm } from '@/lib/use-delete-confirm';
import { type Role, useIdentityMutations, usePermissionCatalog, useRoles } from './api';

const roleSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(60),
  permissions: z.array(z.enum(PERMISSIONS)),
});
type RoleValues = z.infer<typeof roleSchema>;

function PermissionLabel({ code }: { code: Permission }) {
  const { t } = useTranslation();
  return <>{t(`permissions.${code}`)}</>;
}

/**
 * System roles (read-only) and custom roles an admin builds from permissions (ADR-0027 #5): a list
 * whose rows end with their icon actions (ADR-0043); the role opens in a dialog.
 */
export function RolesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('identity.roles.manage');
  const roles = useRoles();
  const mutations = useIdentityMutations();
  const [creating, setCreating] = useCreateParam();
  const [open, setOpen] = useState<Role | null>(null);
  const deletion = useDeleteConfirm<Role>((id) => mutations.deleteRole.mutateAsync(id));
  const rows = roles.data ?? [];
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
      <ProblemAlert problem={problemFromError(roles.error)} />
      <ListCard scroll>
        <Table>
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
                  {/* A kind, not a state: neutral outlines; the lock marks what cannot change. */}
                  <Badge variant="outline">
                    {role.isSystem ? <Lock aria-hidden /> : null}
                    {role.isSystem ? t('roles.systemBadge') : t('roles.customBadge')}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono">{role.permissions.length}</TableCell>
                <TableCell className="text-right font-mono">{role.userCount}</TableCell>
                <RowActions>
                  {role.isSystem || !canManage ? (
                    <>
                      <RowAction
                        label={`${t('roles.view')}: ${nameOf(role)}`}
                        icon={Eye}
                        onClick={() => setOpen(role)}
                      />
                      <RowActionSpacer />
                    </>
                  ) : (
                    <>
                      <RowAction
                        label={`${t('common.edit')}: ${nameOf(role)}`}
                        icon={Pencil}
                        onClick={() => setOpen(role)}
                      />
                      <RowAction
                        label={`${t('common.delete')}: ${nameOf(role)}`}
                        icon={Trash2}
                        destructive
                        onClick={() => deletion.ask(role)}
                      />
                    </>
                  )}
                </RowActions>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!roles.isPending && rows.length === 0 ? (
          <EmptyState icon={ShieldCheck} title={t('roles.empty')} />
        ) : null}
      </ListCard>
      {creating ? <RoleDialog role="new" onClose={() => setCreating(false)} /> : null}
      {open ? (
        open.isSystem || !canManage ? (
          <RolePermissionsDialog role={open} onClose={() => setOpen(null)} />
        ) : (
          <RoleDialog role={open} onClose={() => setOpen(null)} />
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
 * What a system role (or a role read by someone who cannot change it) may do: the permissions in
 * two columns; the dialog scrolls as a whole and keeps «Хаах» in view (ADR-0066).
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
          <DialogDescription>
            {role.isSystem ? t('roles.readOnly') : t('roles.userCount', { count: role.userCount })}
          </DialogDescription>
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
  const form = useForm<RoleValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: isNew
      ? { name: '', permissions: [] }
      : { name: role.name ?? '', permissions: role.permissions },
  });
  const submit = form.handleSubmit(async (values) => {
    const saved = await settle(
      isNew
        ? mutations.createRole.mutateAsync(values)
        : mutations.updateRole.mutateAsync({ id: role.id, body: values }),
    );
    if (saved) onClose();
  });
  const { errors, isSubmitting } = form.formState;
  const assignable = (catalog.data ?? []).filter((permission) => permission.assignable);

  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent size="lg">
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{isNew ? t('roles.create') : t('roles.edit')}</DialogTitle>
            <DialogDescription>{t('roles.form.adminOnly')}</DialogDescription>
          </DialogHeader>
          <ProblemAlert
            problem={problemFromError(mutations.createRole.error ?? mutations.updateRole.error)}
          />
          <FormField label={t('roles.form.name')} htmlFor="role-name" error={errors.name?.message}>
            <Input id="role-name" {...form.register('name')} />
          </FormField>
          {/* One scroller: the dialog itself, with «Болих» and «Хадгалах» kept in view (ADR-0066). */}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t('roles.form.permissions')}</legend>
            <Controller
              control={form.control}
              name="permissions"
              render={({ field }) => (
                <CheckboxGroup
                  name="permission"
                  value={field.value}
                  onChange={field.onChange}
                  options={assignable.map((permission) => ({
                    value: permission.code,
                    label: <PermissionLabel code={permission.code} />,
                  }))}
                />
              )}
            />
          </fieldset>
          <DialogFormFooter pending={isSubmitting} onCancel={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
