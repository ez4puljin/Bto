import { zodResolver } from '@hookform/resolvers/zod';
import { USERNAME_PATTERN } from '@tugeel/shared/auth';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { CheckboxGroup } from '@/components/checkbox-group';
import { FieldError } from '@/components/field-error';
import { RoleName } from '@/components/role-name';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBranches, useRoles, useWarehouses } from './api';

const userFormSchema = z.object({
  username: z.string().trim().toLowerCase().regex(USERNAME_PATTERN, 'validation.username'),
  fullName: z.string().trim().min(1, 'validation.required').max(100),
  phone: z
    .string()
    .trim()
    .refine((value) => value === '' || normalizeMnPhone(value) !== null, 'validation.phone'),
  roleIds: z.array(z.number()),
  branchIds: z.array(z.number()),
  warehouseIds: z.array(z.number()),
});
export type UserFormValues = z.infer<typeof userFormSchema>;

/**
 * Username, name, phone, roles and write scopes. `lockUsername` for existing users,
 * `lockAccess` when an admin edits themselves (the API refuses own role/scope changes).
 */
export function UserForm(props: {
  defaultValues: UserFormValues;
  lockUsername?: boolean;
  lockAccess?: boolean;
  submitLabel: string;
  onSubmit: (values: UserFormValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const roles = useRoles();
  const branches = useBranches();
  const warehouses = useWarehouses();
  const form = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: props.defaultValues,
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(props.onSubmit);

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="user-username">{t('users.form.username')}</Label>
          <Input
            id="user-username"
            autoCapitalize="none"
            disabled={props.lockUsername}
            {...form.register('username')}
          />
          <FieldError message={errors.username?.message} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="user-fullName">{t('users.form.fullName')}</Label>
          <Input id="user-fullName" {...form.register('fullName')} />
          <FieldError message={errors.fullName?.message} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="user-phone">{t('users.form.phone')}</Label>
          <Input id="user-phone" inputMode="tel" {...form.register('phone')} />
          <FieldError message={errors.phone?.message} />
        </div>
      </div>
      <fieldset className="flex flex-col gap-2" disabled={props.lockAccess}>
        <legend className="mb-2 text-sm font-medium">{t('users.form.roles')}</legend>
        <Controller
          control={form.control}
          name="roleIds"
          render={({ field }) => (
            <CheckboxGroup
              name="role"
              value={field.value}
              onChange={field.onChange}
              disabled={props.lockAccess}
              options={(roles.data ?? []).map((role) => ({
                value: role.id,
                label: <RoleName role={role} />,
              }))}
            />
          )}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2" disabled={props.lockAccess}>
        <legend className="mb-1 text-sm font-medium">{t('users.form.scopes')}</legend>
        <p className="text-sm text-muted-foreground">{t('users.form.scopesHint')}</p>
        <p className="text-sm">{t('users.form.scopeBranches')}</p>
        <Controller
          control={form.control}
          name="branchIds"
          render={({ field }) => (
            <CheckboxGroup
              name="scope-branch"
              value={field.value}
              onChange={field.onChange}
              disabled={props.lockAccess}
              options={(branches.data ?? []).map((branch) => ({
                value: branch.id,
                label: `${branch.code} · ${branch.name}`,
              }))}
            />
          )}
        />
        <p className="text-sm">{t('users.form.scopeWarehouses')}</p>
        <Controller
          control={form.control}
          name="warehouseIds"
          render={({ field }) => (
            <CheckboxGroup
              name="scope-warehouse"
              value={field.value}
              onChange={field.onChange}
              disabled={props.lockAccess}
              options={(warehouses.data ?? [])
                .filter((warehouse) => warehouse.kind !== 'TRANSIT')
                .map((warehouse) => ({
                  value: warehouse.id,
                  label: `${warehouse.code} · ${warehouse.name}`,
                }))}
            />
          )}
        />
      </fieldset>
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}
