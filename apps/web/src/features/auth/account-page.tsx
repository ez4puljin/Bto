import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import type { ProblemDetails } from '@tugeel/api-client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { useAuthSession, useAuthState } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FieldList } from '@/components/detail';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { RoleName } from '@/components/role-name';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatUbDateTime } from '@/lib/dayjs';
import { passwordMessage } from '@/lib/forms';
import { problemOf } from '@/lib/problem';
import { toast } from '@/lib/toast';

function passwordSchema(username: string) {
  return z
    .object({
      currentPassword: z.string().min(1, 'validation.required'),
      newPassword: z.string().min(1, 'validation.required'),
      confirmPassword: z.string().min(1, 'validation.required'),
    })
    .superRefine((values, context) => {
      const message = passwordMessage(values.newPassword, username);
      if (message) context.addIssue({ code: 'custom', path: ['newPassword'], message });
      if (values.confirmPassword !== values.newPassword) {
        context.addIssue({
          code: 'custom',
          path: ['confirmPassword'],
          message: 'validation.passwordsDiffer',
        });
      }
    });
}
type PasswordValues = z.infer<ReturnType<typeof passwordSchema>>;

/**
 * The signed-in user's own page: profile (the name as a row, not as a section label), password
 * change, sign-out everywhere.
 */
export function AccountPage() {
  const { t } = useTranslation();
  const session = useAuthSession();
  const state = useAuthState();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const [leaving, setLeaving] = useState(false);
  const username = state.status === 'authenticated' ? state.me.username : '';
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema(username)),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  if (state.status !== 'authenticated') return null;
  const { me } = state;

  const submit = form.handleSubmit(async (values) => {
    setProblem(null);
    const result = await session.client.POST('/api/v1/auth/password', {
      body: { currentPassword: values.currentPassword, newPassword: values.newPassword },
    });
    if (result.response.ok) {
      toast.success(t('auth.account.changed'));
      form.reset();
    } else {
      setProblem(problemOf(result.error));
    }
  });

  const logoutEverywhere = async () => {
    await session.logoutAll();
    queryClient.clear();
    await navigate('/login?reason=logout', { replace: true });
  };
  const { errors, isSubmitting } = form.formState;

  return (
    <div className="space-y-4">
      <PageHeader title={t('auth.account.title')} />
      <div className="flex max-w-3xl flex-col gap-5">
        <FieldList
          title={t('auth.account.profile')}
          items={[
            { label: t('auth.account.fullName'), value: me.fullName },
            {
              label: t('auth.account.username'),
              value: <span className="font-mono">{me.username}</span>,
            },
            {
              label: t('auth.account.roles'),
              value: me.roles.map((role, index) => (
                <span key={role.id}>
                  {index > 0 ? ', ' : ''}
                  <RoleName role={role} />
                </span>
              )),
            },
            {
              label: t('auth.account.session'),
              value: t('auth.account.sessionEnds', {
                time: formatUbDateTime(Date.parse(me.sessionExpiresAt)),
              }),
            },
          ]}
        />
        <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={problem} />
          <FormSection title={t('auth.account.changePassword')}>
            <FormRow
              label={t('auth.account.currentPassword')}
              htmlFor="currentPassword"
              error={errors.currentPassword?.message}
            >
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                className="sm:w-72"
                {...form.register('currentPassword')}
              />
            </FormRow>
            <FormRow
              label={t('auth.account.newPassword')}
              htmlFor="newPassword"
              error={errors.newPassword?.message}
            >
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                className="sm:w-72"
                {...form.register('newPassword')}
              />
            </FormRow>
            <FormRow
              label={t('auth.account.confirmPassword')}
              htmlFor="confirmPassword"
              error={errors.confirmPassword?.message}
            >
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                className="sm:w-72"
                {...form.register('confirmPassword')}
              />
            </FormRow>
          </FormSection>
          <FormFooter>
            <Button type="submit" disabled={isSubmitting}>
              {t('auth.account.submit')}
            </Button>
          </FormFooter>
        </form>
        <FormSection
          title={t('auth.account.logoutAll')}
          description={t('auth.account.logoutAllHint')}
        >
          <div className="px-3.5 py-3">
            <Button variant="outline" onClick={() => setLeaving(true)}>
              {t('auth.account.logoutAll')}
            </Button>
          </div>
        </FormSection>
      </div>
      <ConfirmDialog
        open={leaving}
        title={t('auth.account.logoutAllTitle')}
        description={t('auth.account.logoutAllHint')}
        confirmLabel={t('auth.account.logoutAll')}
        onConfirm={() => void logoutEverywhere()}
        onClose={() => setLeaving(false)}
      />
    </div>
  );
}
