import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { useAuthSession } from '@/app/auth-context';
import { AuthLayout } from '@/components/auth-layout';
import { FieldError } from '@/components/field-error';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { passwordMessage } from '@/lib/forms';

const schema = z
  .object({
    username: z.string().trim().min(1, 'validation.required'),
    code: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z][0-9A-Za-z -]{3,30}$/, 'validation.code'),
    newPassword: z.string().min(1, 'validation.required'),
    confirmPassword: z.string().min(1, 'validation.required'),
  })
  .superRefine((values, context) => {
    const message = passwordMessage(values.newPassword, values.username);
    if (message) context.addIssue({ code: 'custom', path: ['newPassword'], message });
    if (values.confirmPassword !== values.newPassword) {
      context.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'validation.passwordsDiffer',
      });
    }
  });
type Values = z.infer<typeof schema>;

/** A new user (or one who forgot the password) redeems the admin's one-time code (ADR-0027 #9). */
export function SetPasswordPage() {
  const { t } = useTranslation();
  const session = useAuthSession();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', code: '', newPassword: '', confirmPassword: '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setProblem(null);
    const result = await session.setupPassword(values.username, values.code, values.newPassword);
    if (result.ok) await navigate('/', { replace: true });
    else setProblem(result.problem);
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <AuthLayout title={t('auth.setPassword.title')} description={t('auth.setPassword.description')}>
      <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
        <ProblemAlert problem={problem} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="username">{t('auth.login.username')}</Label>
          <Input
            id="username"
            autoComplete="username"
            autoCapitalize="none"
            {...form.register('username')}
          />
          <FieldError message={errors.username?.message} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="code">{t('auth.setPassword.code')}</Label>
          <Input
            id="code"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            {...form.register('code')}
          />
          <FieldError message={errors.code?.message} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="newPassword">{t('auth.setPassword.newPassword')}</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            {...form.register('newPassword')}
          />
          <FieldError message={errors.newPassword?.message} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmPassword">{t('auth.setPassword.confirmPassword')}</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            {...form.register('confirmPassword')}
          />
          <FieldError message={errors.confirmPassword?.message} />
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {t('auth.setPassword.submit')}
        </Button>
        <Link to="/login" className="text-center text-sm text-muted-foreground underline">
          {t('auth.setPassword.backToLogin')}
        </Link>
      </form>
    </AuthLayout>
  );
}
