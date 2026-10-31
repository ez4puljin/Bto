import { zodResolver } from '@hookform/resolvers/zod';
import { isSystemRole } from '@tugeel/shared/auth';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { CheckboxGroup } from '@/components/checkbox-group';
import { DialogFormFooter, FormFooter, FormRow, FormSection } from '@/components/form';
import { RoleName } from '@/components/role-name';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBranches, useRoles, useWarehouses } from './api';

const userFormSchema = z.object({
  fullName: z.string().trim().min(1, 'validation.required').max(100),
  // The sign-in identifier (ADR-0128 #1): required, 8 Mongolian digits in any local form.
  phone: z
    .string()
    .trim()
    .min(1, 'validation.required')
    .refine((value) => normalizeMnPhone(value) !== null, 'validation.phone'),
  roleIds: z.array(z.number()),
  branchIds: z.array(z.number()),
  warehouseIds: z.array(z.number()),
});
export type UserFormValues = z.infer<typeof userFormSchema>;

/**
 * The roles in as many columns as their box holds (three in the create dialog, four on a wide
 * page): a container query on the box sets the columns of CheckboxGroup's grid (ADR-0066).
 */
const ROLE_COLUMNS = '@container @xl:[&>div]:grid-cols-3 @3xl:[&>div]:grid-cols-4';

/** Beside its label (FormRow's container from @md), a checkbox list starts on the label's line. */
const SCOPE_OFFSET = '@md:pt-2.5';

/** The roles the hint under «Дүр» names, by the job a non-technical admin registers (owner 2026-10-29). */
const HINTED_ROLES = { rep: 'SALES_REP', seller: 'POS_CASHIER', keeper: 'WAREHOUSE' } as const;

/**
 * Name, phone, roles and write scopes, settings-style (ADR-0043), in the order a staff
 * registration is filled: who, the phone they sign in with (ADR-0128: no login name is typed, the
 * internal one is generated), what they do, where they write (the warehouses first; «Салбараар»
 * only when the installation has two or more branches, ADR-0128 #7). Under the roles a hint names
 * the seeded role of a rep, a store seller and a keeper — only the roles this installation holds.
 * `lockAccess` when an admin edits themselves (the API refuses own role and scope changes).
 * `inDialog` ends the form with the dialog's footer, which stays in view while the sections scroll
 * (ADR-0066); on a page it ends with the page form's footer.
 */
export function UserForm(props: {
  defaultValues: UserFormValues;
  lockAccess?: boolean;
  submitLabel: string;
  onSubmit: (values: UserFormValues) => Promise<void>;
  onCancel: () => void;
  inDialog?: boolean;
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
  // One installation is one legal entity, usually one branch: the branch scope then says nothing
  // that «every warehouse» does not, so it appears only when a second branch exists.
  const branchOptions = (branches.data ?? []).map((branch) => ({
    value: branch.id,
    label: `${branch.code} · ${branch.name}`,
  }));
  const showBranches = branchOptions.length > 1;
  // The hint names the seeded roles as the list shows them; a job whose role is missing is left out.
  const seeded = new Set(
    (roles.data ?? []).flatMap((role) => (role.code && isSystemRole(role.code) ? [role.code] : [])),
  );
  const roleHint = Object.values(HINTED_ROLES).every((code) => seeded.has(code))
    ? t('users.form.roleHint', {
        rep: t(`roles.system.${HINTED_ROLES.rep}`),
        seller: t(`roles.system.${HINTED_ROLES.seller}`),
        keeper: t(`roles.system.${HINTED_ROLES.keeper}`),
      })
    : undefined;

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void submit(event)}>
      <FormSection title={t('users.form.sectionAccount')}>
        <FormRow
          label={t('users.form.fullName')}
          htmlFor="user-fullName"
          error={errors.fullName?.message}
        >
          <Input id="user-fullName" {...form.register('fullName')} />
        </FormRow>
        <FormRow
          label={t('users.form.phone')}
          htmlFor="user-phone"
          hint={t('users.form.phoneHint')}
          error={errors.phone?.message}
        >
          <Input
            id="user-phone"
            inputMode="tel"
            autoComplete="off"
            className="sm:w-56"
            {...form.register('phone')}
          />
        </FormRow>
      </FormSection>
      <fieldset disabled={props.lockAccess} className="flex min-w-0 flex-col gap-5">
        <FormSection title={t('users.form.roles')} description={roleHint}>
          <div className="px-3.5 py-3">
            <div className={ROLE_COLUMNS}>
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
            </div>
          </div>
        </FormSection>
        <FormSection title={t('users.form.scopes')} description={t('users.form.scopesHint')}>
          <FormRow label={t('users.form.scopeWarehouses')}>
            <div className={SCOPE_OFFSET}>
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
            </div>
          </FormRow>
          {showBranches ? (
            <FormRow label={t('users.form.scopeBranches')} hint={t('users.form.scopeBranchesHint')}>
              <div className={SCOPE_OFFSET}>
                <Controller
                  control={form.control}
                  name="branchIds"
                  render={({ field }) => (
                    <CheckboxGroup
                      name="scope-branch"
                      value={field.value}
                      onChange={field.onChange}
                      disabled={props.lockAccess}
                      options={branchOptions}
                    />
                  )}
                />
              </div>
            </FormRow>
          ) : null}
        </FormSection>
      </fieldset>
      {props.inDialog ? (
        <DialogFormFooter
          pending={isSubmitting}
          onCancel={props.onCancel}
          submitLabel={props.submitLabel}
        />
      ) : (
        <FormFooter>
          <Button type="button" variant="ghost" onClick={props.onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {props.submitLabel}
          </Button>
        </FormFooter>
      )}
    </form>
  );
}
