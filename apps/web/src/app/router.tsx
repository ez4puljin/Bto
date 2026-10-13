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
import { AdjustmentPage, AdjustmentsPage } from '@/features/inventory/adjustments-pages';
import { BinsPage } from '@/features/inventory/bins-page';
import { LowStockPage } from '@/features/inventory/low-stock-page';
import { ReceiptCostingPage } from '@/features/inventory/costing-page';
import { BinMovesPage } from '@/features/inventory/moves-page';
import { ReceiptCreatePage, ReceiptPage, ReceiptsPage } from '@/features/inventory/receipts-pages';
import { MovementsPage } from '@/features/inventory/movements-page';
import { StockPage, StockProductPage } from '@/features/inventory/stock-pages';
import { StocktakePage, StocktakesPage } from '@/features/inventory/stocktakes-pages';
import { ImportPage, ImportsPage } from '@/features/imports/imports-pages';
import { TransferPage, TransfersPage } from '@/features/inventory/transfers-pages';
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
      { path: 'catalog/products', element: <ProductsPage />, handle: { wide: true } },
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
        handle: { wide: true },
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
      { path: 'partners/suppliers', element: <SuppliersPage />, handle: { wide: true } },
      {
        path: 'partners/suppliers/new',
        element: (
          <RequirePermission permission="partners.suppliers.manage">
            <SupplierCreatePage />
          </RequirePermission>
        ),
      },
      { path: 'partners/suppliers/:id', element: <SupplierPage /> },
      { path: 'inventory/stock', element: <StockPage /> },
      { path: 'inventory/stock/:id', element: <StockProductPage /> },
      { path: 'inventory/movements', element: <MovementsPage />, handle: { wide: true } },
      { path: 'inventory/low-stock', element: <LowStockPage /> },
      { path: 'inventory/receipts', element: <ReceiptsPage /> },
      {
        path: 'inventory/receipts/new',
        element: (
          <RequirePermission permission="inventory.receipts.manage">
            <ReceiptCreatePage />
          </RequirePermission>
        ),
      },
      { path: 'inventory/receipts/:id', element: <ReceiptPage /> },
      {
        path: 'inventory/receipts/:id/costing',
        element: (
          <RequirePermission permission="inventory.costs.manage">
            <ReceiptCostingPage />
          </RequirePermission>
        ),
      },
      {
        path: 'imports',
        element: (
          <RequirePermission permission="imports.manage">
            <ImportsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'imports/:id',
        element: (
          <RequirePermission permission="imports.manage">
            <ImportPage />
          </RequirePermission>
        ),
      },
      { path: 'inventory/transfers', element: <TransfersPage /> },
      { path: 'inventory/transfers/:id', element: <TransferPage /> },
      { path: 'inventory/moves', element: <BinMovesPage /> },
      { path: 'inventory/adjustments', element: <AdjustmentsPage /> },
      { path: 'inventory/adjustments/:id', element: <AdjustmentPage /> },
      { path: 'inventory/stocktakes', element: <StocktakesPage /> },
      { path: 'inventory/stocktakes/:id', element: <StocktakePage /> },
      {
        path: 'inventory/bins',
        element: (
          <RequirePermission permission="inventory.setup.manage">
            <BinsPage />
          </RequirePermission>
        ),
      },
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
