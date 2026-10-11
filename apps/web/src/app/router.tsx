import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { AppShell } from '@/app/app-shell';
import { NotFoundPage } from '@/app/not-found-page';
import { RequireAuth, RequirePermission } from '@/app/require-auth';
import { RouteErrorBoundary } from '@/app/route-error-boundary';
import { AccountPage } from '@/features/auth/account-page';
import { LoginPage } from '@/features/auth/login-page';
import { SetPasswordPage } from '@/features/auth/set-password-page';
import { BarcodeLookupPage } from '@/features/catalog/barcode-lookup-page';
import { BrandsPage, CategoriesPage, UomsPage } from '@/features/catalog/masters-pages';
import { ProductCreatePage } from '@/features/catalog/product-create-page';
import { ProductPage } from '@/features/catalog/product-page';
import { ProductsPage } from '@/features/catalog/products-page';
import { ReadinessPage } from '@/features/catalog/readiness-page';
import { AuditPage } from '@/features/identity/audit-page';
import { BranchesPage, WarehousesPage } from '@/features/identity/org-pages';
import { RolesPage } from '@/features/identity/roles-page';
import { SettingsPage } from '@/features/identity/settings-page';
import { UserDetailPage } from '@/features/identity/user-detail-page';
import { UsersPage } from '@/features/identity/users-page';
import { CustomerCreatePage } from '@/features/partners/customer-create-page';
import { CustomerPage } from '@/features/partners/customer-page';
import { CustomersPage } from '@/features/partners/customers-page';
import {
  SupplierCreatePage,
  SupplierPage,
  SuppliersPage,
} from '@/features/partners/supplier-pages';
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
      { path: 'catalog/products', element: <ProductsPage /> },
      {
        path: 'catalog/products/new',
        element: (
          <RequirePermission permission="catalog.products.manage">
            <ProductCreatePage />
          </RequirePermission>
        ),
      },
      { path: 'catalog/products/:id', element: <ProductPage /> },
      { path: 'catalog/categories', element: <CategoriesPage /> },
      { path: 'catalog/brands', element: <BrandsPage /> },
      { path: 'catalog/uoms', element: <UomsPage /> },
      { path: 'catalog/scan', element: <BarcodeLookupPage /> },
      {
        path: 'catalog/ebarimt',
        element: (
          <RequirePermission permission="catalog.ebarimt.manage">
            <ReadinessPage />
          </RequirePermission>
        ),
      },
      {
        path: 'partners/customers',
        element: (
          <RequirePermission permission="partners.customers.read">
            <CustomersPage />
          </RequirePermission>
        ),
      },
      {
        path: 'partners/customers/new',
        element: (
          <RequirePermission permission="partners.customers.manage">
            <CustomerCreatePage />
          </RequirePermission>
        ),
      },
      {
        path: 'partners/customers/:id',
        element: (
          <RequirePermission permission="partners.customers.read">
            <CustomerPage />
          </RequirePermission>
        ),
      },
      { path: 'partners/suppliers', element: <SuppliersPage /> },
      {
        path: 'partners/suppliers/new',
        element: (
          <RequirePermission permission="partners.suppliers.manage">
            <SupplierCreatePage />
          </RequirePermission>
        ),
      },
      { path: 'partners/suppliers/:id', element: <SupplierPage /> },
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
