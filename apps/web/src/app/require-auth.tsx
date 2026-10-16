import type { Permission } from '@tugeel/shared/auth';
import { House } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuthState, useHasPermission } from '@/app/auth-context';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';

/** Renders its children for a logged-in user; otherwise sends them to /login and back. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const state = useAuthState();
  const location = useLocation();
  const { t } = useTranslation();
  if (state.status === 'unknown') {
    return (
      <p role="status" className="p-8 text-sm text-muted-foreground">
        {t('auth.checking')}
      </p>
    );
  }
  if (state.status === 'anonymous') {
    const params = new URLSearchParams({ next: `${location.pathname}${location.search}` });
    if (state.reason) params.set('reason', state.reason);
    return <Navigate to={`/login?${params.toString()}`} replace />;
  }
  return children;
}

/**
 * Hides a page from users without the permission; the API refuses them anyway (ADR-0027). The
 * refusal is a page of its own (ADR-0066): «Хандах эрхгүй» names the browser tab, the breadcrumb
 * still says where it was.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const allowed = useHasPermission(permission);
  const { t } = useTranslation();
  if (allowed) return children;
  return (
    <div>
      <PageHeader title={t('errors.forbiddenTitle')} description={t('errors.FORBIDDEN')} />
      <Button asChild variant="outline">
        <Link to="/">
          <House />
          {t('errors.goHome')}
        </Link>
      </Button>
    </div>
  );
}
