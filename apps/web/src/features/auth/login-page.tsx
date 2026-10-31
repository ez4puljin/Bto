import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useAuthSession, useAuthState } from '@/app/auth-context';
import { AuthLayout } from './auth-layout';
import { FieldError } from '@/components/field-error';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { safeNext } from '@/lib/auth/next';

/** The sign-in identifier (ADR-0128 #1): the registered phone, or a login name while no phone is set. */
const schema = z.object({
  login: z.string().trim().min(1, 'validation.required'),
  password: z.string().min(1, 'validation.required'),
});
type Values = z.infer<typeof schema>;

export function LoginPage() {
  const { t } = useTranslation();
  const session = useAuthSession();
  const state = useAuthState();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const reason = params.get('reason');
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { login: '', password: '' },
  });

  if (state.status === 'authenticated') return <Navigate to={next} replace />;

  const submit = form.handleSubmit(async (values) => {
    setProblem(null);
    const result = await session.login(values.login, values.password);
    if (result.ok) await navigate(next, { replace: true });
    else setProblem(result.problem);
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <AuthLayout title={t('auth.login.title')} description={t('auth.login.welcome')}>
      <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void submit(event)}>
        {reason === 'expired' ? (
          <Alert>
            <AlertDescription>{t('auth.login.expired')}</AlertDescription>
          </Alert>
        ) : null}
        {reason === 'logout' ? (
          <Alert>
            <AlertDescription>{t('auth.login.loggedOut')}</AlertDescription>
          </Alert>
        ) : null}
        <ProblemAlert problem={problem} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="login">{t('auth.login.phone')}</Label>
          <Input
            id="login"
            className="h-10"
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            aria-invalid={Boolean(errors.login)}
            aria-describedby="login-hint"
            {...form.register('login')}
          />
          <FieldError message={errors.login?.message} />
          <p id="login-hint" className="text-xs text-muted-foreground">
            {t('auth.login.phoneHint')}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">{t('auth.login.password')}</Label>
          <Input
            id="password"
            className="h-10"
            type="password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            {...form.register('password')}
          />
          <FieldError message={errors.password?.message} />
        </div>
        <Button type="submit" size="lg" className="mt-1 w-full" disabled={isSubmitting}>
          {t('auth.login.submit')}
        </Button>
        <Link to="/set-password" className="text-center text-[0.8125rem] text-link hover:underline">
          {t('auth.login.setPasswordLink')}
        </Link>
      </form>
    </AuthLayout>
  );
}
