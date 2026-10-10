import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { AppShell } from '@/app/app-shell';
import { NotFoundPage } from '@/app/not-found-page';
import { RequireAuth, RequirePermission } from '@/app/require-auth';
import { RouteErrorBoundary } from '@/app/route-error-boundary';
import { AccountPage } from '@/features/auth/account-page';
import { LoginPage } from '@/features/auth/login-page';
import { SetPasswordPage } from '@/features/auth/set-password-page';
import { AuditPage } from '@/features/identity/audit-page';
import { BranchesPage, WarehousesPage } from '@/features/identity/org-pages';
import { RolesPage } from '@/features/identity/roles-page';
import { SettingsPage } from '@/features/identity/settings-page';
import { UserDetailPage } from '@/features/identity/user-detail-page';
import { UsersPage } from '@/features/identity/users-page';
import { SystemStatusPage } from '@/features/system/system-status-page';

/** React Router 7 data mode. Exported for createMemoryRouter in tests. */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorBoundary /> },
  { path: '/set-password', element: <SetPasswordPage />, errorElement: <RouteErrorBoundary /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <Navigate to="/system/status" replace /> },
      { path: 'system/status', element: <SystemStatusPage /> },
      { path: 'account', element: <AccountPage /> },
      {
        path: 'users',
        element: (
          <RequirePermission permission="identity.users.read">
            <UsersPage />
          </RequirePermission>
        ),
      },
      {
        path: 'users/:id',
        element: (
          <RequirePermission permission="identity.users.read">
            <UserDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: 'roles',
        element: (
          <RequirePermission permission="identity.users.read">
            <RolesPage />
          </RequirePermission>
        ),
      },
      { path: 'branches', element: <BranchesPage /> },
      { path: 'warehouses', element: <WarehousesPage /> },
      {
        path: 'settings',
        element: (
          <RequirePermission permission="identity.settings.read">
            <SettingsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'audit',
        element: (
          <RequirePermission permission="identity.audit.read">
            <AuditPage />
          </RequirePermission>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
