import { zodResolver } from '@hookform/resolvers/zod';
import { PERMISSIONS, type Permission } from '@tugeel/shared/auth';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useHasPermission } from '@/app/auth-context';
import { CheckboxGroup } from '@/components/checkbox-group';
import { FieldError } from '@/components/field-error';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { RoleName } from '@/components/role-name';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { problemFromError, settle } from '@/lib/problem';
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

/** System roles (read-only) and custom roles an admin builds from permissions (ADR-0027 #5). */
export function RolesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('identity.roles.manage');
  const roles = useRoles();
  const mutations = useIdentityMutations();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);

  return (
    <div>
      <PageHeader
        title={t('roles.title')}
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
              <Plus />
              {t('roles.create')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(roles.error ?? mutations.deleteRole.error)} />
      <div className="grid gap-4 md:grid-cols-2">
        {(roles.data ?? []).map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <RoleName role={role} />
                <Badge variant={role.isSystem ? 'secondary' : 'outline'}>
                  {role.isSystem ? t('roles.systemBadge') : t('roles.customBadge')}
                </Badge>
              </CardTitle>
              <CardDescription>{t('roles.userCount', { count: role.userCount })}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {role.permissions.length ? (
                <ul className="list-inside list-disc">
                  {role.permissions.map((code) => (
                    <li key={code}>
                      <PermissionLabel code={code} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t('roles.noPermissions')}</p>
              )}
              {role.isSystem ? (
                <p className="text-xs text-muted-foreground">{t('roles.readOnly')}</p>
              ) : canManage ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(role)}>
                    {t('common.edit')}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setDeleting(role)}>
                    {t('common.delete')}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      {editing ? <RoleDialog role={editing} onClose={() => setEditing(null)} /> : null}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
      >
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('common.delete')}</DialogTitle>
            <DialogDescription>
              {t('roles.deleteConfirm', { name: deleting?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter closeLabel={t('common.cancel')}>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) {
                  mutations.deleteRole.mutate(deleting.id, {
                    onSettled: () => setDeleting(null),
                  });
                }
              }}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? t('roles.create') : t('roles.edit')}</DialogTitle>
          <DialogDescription>{t('roles.form.adminOnly')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert
          problem={problemFromError(mutations.createRole.error ?? mutations.updateRole.error)}
        />
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="role-name">{t('roles.form.name')}</Label>
            <Input id="role-name" {...form.register('name')} />
            <FieldError message={errors.name?.message} />
          </div>
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
