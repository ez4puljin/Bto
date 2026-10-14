import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import type { ProblemDetails } from '@tugeel/api-client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { useAuthSession, useAuthState } from '@/app/auth-context';
import { FieldError } from '@/components/field-error';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { RoleName } from '@/components/role-name';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

/** The signed-in user's own page: profile, password change, sign-out everywhere. */
export function AccountPage() {
  const { t } = useTranslation();
  const session = useAuthSession();
  const state = useAuthState();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
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
      <Card>
        <CardHeader>
          <CardTitle>{me.fullName}</CardTitle>
          <CardDescription>
            {t('auth.account.sessionEnds', {
              time: formatUbDateTime(Date.parse(me.sessionExpiresAt)),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">{t('auth.account.username')}: </span>
            {me.username}
          </p>
          <p>
            <span className="text-muted-foreground">{t('auth.account.roles')}: </span>
            {me.roles.map((role, index) => (
              <span key={role.id}>
                {index > 0 ? ', ' : ''}
                <RoleName role={role} />
              </span>
            ))}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('auth.account.changePassword')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex max-w-sm flex-col gap-4"
            noValidate
            onSubmit={(event) => void submit(event)}
          >
            <ProblemAlert problem={problem} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="currentPassword">{t('auth.account.currentPassword')}</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                {...form.register('currentPassword')}
              />
              <FieldError message={errors.currentPassword?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="newPassword">{t('auth.account.newPassword')}</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                {...form.register('newPassword')}
              />
              <FieldError message={errors.newPassword?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">{t('auth.account.confirmPassword')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...form.register('confirmPassword')}
              />
              <FieldError message={errors.confirmPassword?.message} />
            </div>
            <Button type="submit" disabled={isSubmitting}>
              {t('auth.account.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('auth.account.logoutAll')}</CardTitle>
          <CardDescription>{t('auth.account.logoutAllHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => void logoutEverywhere()}>
            {t('auth.account.logoutAll')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
