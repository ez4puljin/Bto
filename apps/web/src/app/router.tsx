import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { AppShell } from '@/app/app-shell';
import { NotFoundPage } from '@/app/not-found-page';
import { RequireAuth, RequirePermission } from '@/app/require-auth';
import { RouteErrorBoundary } from '@/app/route-error-boundary';
import { AccountPage } from '@/features/auth/account-page';
import { LoginPage } from '@/features/auth/login-page';
import { SetPasswordPage } from '@/features/auth/set-password-page';
import { BarcodeLookupPage } from '@/features/catalog/barcode-lookup-page';
import { CategoriesPage, UomsPage } from '@/features/catalog/masters-pages';
import { ProductCreatePage } from '@/features/catalog/product-create-page';
import { ProductPage } from '@/features/catalog/product-page';
import { ProductsPage } from '@/features/catalog/products-page';
import { ReadinessPage } from '@/features/catalog/readiness-page';
import { AuditPage } from '@/features/identity/audit-page';
import { CompanyPage } from '@/features/company/company-page';
import { BranchesPage, WarehousesPage } from '@/features/identity/org-pages';
import { RolesPage } from '@/features/identity/roles-page';
import { SettingsPage } from '@/features/identity/settings-page';
import { UserDetailPage } from '@/features/identity/user-detail-page';
import { UsersPage } from '@/features/identity/users-page';
import { AdjustmentPage, AdjustmentsPage } from '@/features/inventory/adjustments-pages';
import { BinsPage } from '@/features/inventory/bins-page';
import { LowStockPage } from '@/features/inventory/low-stock-page';
import { BinMovesPage } from '@/features/inventory/moves-page';
import { IssuePage, IssuesPage } from '@/features/inventory/issues-pages';
import { ReceiptPage, ReceiptsPage } from '@/features/inventory/receipts-pages';
import { MovementsPage } from '@/features/inventory/movements-page';
import { StockPage, StockProductPage } from '@/features/inventory/stock-pages';
import { StocktakePage, StocktakesPage } from '@/features/inventory/stocktakes-pages';
import { ImportPage, ImportsPage } from '@/features/imports/imports-pages';
import { AppNoticesPage } from '@/features/notifications/notice-pages';
import {
  DiscountProgramCreatePage,
  DiscountProgramEditPage,
} from '@/features/pricing/discount-form';
import { DiscountProgramPage, DiscountProgramsPage } from '@/features/pricing/discount-pages';
import { PendingProductsPage } from '@/features/pricing/pending-products-page';
import { PriceProfilePage, PriceProfilesPage } from '@/features/pricing/profile-pages';
import { PriceQuotePage } from '@/features/pricing/quote-page';
import { SalesOrderNewPage, SalesOrderPage } from '@/features/sales/orders-pages';
import { SalesBatchPrintPage, SalesOrderPrintPage } from '@/features/sales/print-page';
import { SalesSettingsPage } from '@/features/sales/settings-page';
import { SalesWorkPage } from '@/features/sales/work-page';
import { SegmentEditorPage, SegmentPage, SegmentsPage } from '@/features/segments/segment-pages';
import { TransferPage, TransfersPage } from '@/features/inventory/transfers-pages';
import { CustomerCreatePage } from '@/features/partners/customer-create-page';
import { CustomerPage } from '@/features/partners/customer-page';
import { CustomersPage } from '@/features/partners/customers-page';
import {
  SupplierCreatePage,
  SupplierPage,
  SuppliersPage,
} from '@/features/partners/supplier-pages';
import { HomePage } from '@/features/home/home-page';
import { AiPage } from '@/features/ai/ai-page';
import { AccountLedgerPage, AccountsPage } from '@/features/finance/accounts-page';
import { CashPage } from '@/features/finance/cash-page';
import { CustomerBalancesPage } from '@/features/finance/customer-balances-page';
import { CustomerLedgerPage } from '@/features/finance/customer-ledger-page';
import {
  SupplierBalancesPage,
  SupplierLedgerPage,
} from '@/features/finance/supplier-payables-pages';
import { FinanceSettingsPage } from '@/features/finance/finance-settings-page';
import { InvoicesPage } from '@/features/finance/invoices-page';
import { JournalPage } from '@/features/finance/journal-page';
import { PaymentsPage } from '@/features/finance/payments-page';
import { InvoicePrintPage, PaymentPrintPage } from '@/features/finance/print-pages';
import { AiReportsPage } from '@/features/ai/reports-page';
import { CustomerAppPage } from '@/features/customer-app/customer-app-page';
import { PosCashiersPage } from '@/features/pos/cashiers-page';
import { PosSalesPage } from '@/features/pos/sales-page';
import { PosSalePrintPage } from '@/features/pos/sale-print-page';
import { PosSettingsPage } from '@/features/pos/settings-page';
import { PosShiftsPage } from '@/features/pos/shifts-page';
import { PosTestTillPage } from '@/features/pos/test-till-page';
import { PosTillsPage } from '@/features/pos/tills-page';
import { SystemStatusPage } from '@/features/system/system-status-page';

/** React Router 7 data mode. Exported for createMemoryRouter in tests. */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorBoundary /> },
  { path: '/set-password', element: <SetPasswordPage />, errorElement: <RouteErrorBoundary /> },
  {
    // A document for paper, without the shell (ADR-0056 #7).
    path: '/sales/orders/:id/print/:kind',
    element: (
      <RequireAuth>
        <RequirePermission permission="sales.orders.read">
          <SalesOrderPrintPage />
        </RequirePermission>
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    // Several orders for paper, one per sheet (ADR-0057 #7).
    path: '/sales/print/:kind',
    element: (
      <RequireAuth>
        <RequirePermission permission="sales.orders.read">
          <SalesBatchPrintPage />
        </RequirePermission>
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    // An invoice or a voucher for paper, without the shell (ADR-0060 #11).
    path: '/finance/invoices/:id/print',
    element: (
      <RequireAuth>
        <RequirePermission permission="finance.read">
          <InvoicePrintPage />
        </RequirePermission>
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    // A copy of a till's receipt for paper, without the lottery or the QR (ADR-0063 #8).
    path: '/pos/sales/:id/print',
    element: (
      <RequireAuth>
        <RequirePermission permission="pos.read">
          <PosSalePrintPage />
        </RequirePermission>
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/finance/payments/:id/print',
    element: (
      <RequireAuth>
        <RequirePermission permission="finance.read">
          <PaymentPrintPage />
        </RequirePermission>
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        // A page that fails renders its error inside the shell, so the menu stays (ADR-0042).
        errorElement: <RouteErrorBoundary />,
        children: [
          { index: true, element: <HomePage />, handle: { width: 'wide' } },
          ...financeRoutes(),
          ...posRoutes(),
          { path: 'system/status', handle: { width: 'reading' }, element: <SystemStatusPage /> },
          {
            path: 'system/app-notices',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="notifications.send">
                <AppNoticesPage />
              </RequirePermission>
            ),
          },
          {
            path: 'system/customer-app',
            handle: { width: 'reading' },
            element: (
              <RequirePermission permission="identity.settings.read">
                <CustomerAppPage />
              </RequirePermission>
            ),
          },
          { path: 'account', handle: { width: 'reading' }, element: <AccountPage /> },
          { path: 'catalog/products', handle: { width: 'wide' }, element: <ProductsPage /> },
          {
            path: 'catalog/products/new',
            handle: { width: 'reading' },
            element: (
              <RequirePermission permission="catalog.products.register">
                <ProductCreatePage />
              </RequirePermission>
            ),
          },
          { path: 'catalog/products/:id', handle: { width: 'wide' }, element: <ProductPage /> },
          {
            path: 'catalog/pending',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="pricing.prices.manage">
                <PendingProductsPage />
              </RequirePermission>
            ),
          },
          { path: 'catalog/categories', handle: { width: 'wide' }, element: <CategoriesPage /> },
          { path: 'catalog/uoms', handle: { width: 'wide' }, element: <UomsPage /> },
          { path: 'catalog/scan', handle: { width: 'reading' }, element: <BarcodeLookupPage /> },
          {
            path: 'catalog/ebarimt',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="catalog.ebarimt.manage">
                <ReadinessPage />
              </RequirePermission>
            ),
          },
          {
            path: 'partners/customers',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="partners.customers.read">
                <CustomersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'partners/customers/new',
            handle: { width: 'reading' },
            element: (
              <RequirePermission permission="partners.customers.manage">
                <CustomerCreatePage />
              </RequirePermission>
            ),
          },
          {
            path: 'partners/customers/:id',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="partners.customers.read">
                <CustomerPage />
              </RequirePermission>
            ),
          },
          { path: 'partners/suppliers', handle: { width: 'wide' }, element: <SuppliersPage /> },
          {
            path: 'partners/suppliers/new',
            handle: { width: 'reading' },
            element: (
              <RequirePermission permission="partners.suppliers.manage">
                <SupplierCreatePage />
              </RequirePermission>
            ),
          },
          { path: 'partners/suppliers/:id', handle: { width: 'wide' }, element: <SupplierPage /> },
          { path: 'inventory/stock', handle: { width: 'wide' }, element: <StockPage /> },
          { path: 'inventory/stock/:id', handle: { width: 'wide' }, element: <StockProductPage /> },
          { path: 'inventory/movements', handle: { width: 'wide' }, element: <MovementsPage /> },
          { path: 'inventory/low-stock', handle: { width: 'wide' }, element: <LowStockPage /> },
          { path: 'inventory/receipts', handle: { width: 'wide' }, element: <ReceiptsPage /> },
          // One page for a new receipt (`new`) and an existing one, so the page that creates a
          // draft stays mounted when it takes the draft's address; `?new=1` on the list redirects
          // here. The old costing page is the receipt itself.
          { path: 'inventory/receipts/:id', handle: { width: 'wide' }, element: <ReceiptPage /> },
          {
            path: 'inventory/receipts/:id/costing',
            handle: { width: 'wide' },
            element: <Navigate to=".." relative="path" replace />,
          },
          // Goods issues (ADR-0081): one page for a new issue (new) and an existing one, like receipts.
          { path: 'inventory/issues', handle: { width: 'wide' }, element: <IssuesPage /> },
          { path: 'inventory/issues/:id', handle: { width: 'wide' }, element: <IssuePage /> },
          { path: 'pricing/profiles', handle: { width: 'wide' }, element: <PriceProfilesPage /> },
          {
            path: 'pricing/profiles/:id',
            handle: { width: 'reading' },
            element: <PriceProfilePage />,
          },
          {
            path: 'pricing/discounts',
            handle: { width: 'wide' },
            element: <DiscountProgramsPage />,
          },
          {
            path: 'pricing/discounts/new',
            handle: { width: 'reading' },
            element: (
              <RequirePermission permission="pricing.manage">
                <DiscountProgramCreatePage />
              </RequirePermission>
            ),
          },
          {
            path: 'pricing/discounts/:id',
            handle: { width: 'reading' },
            element: <DiscountProgramPage />,
          },
          {
            path: 'pricing/discounts/:id/edit',
            handle: { width: 'reading' },
            element: (
              <RequirePermission permission="pricing.manage">
                <DiscountProgramEditPage />
              </RequirePermission>
            ),
          },
          { path: 'pricing/quote', handle: { width: 'wide' }, element: <PriceQuotePage /> },
          {
            path: 'sales/boards',
            handle: { width: 'full' },
            element: (
              <RequirePermission permission="sales.orders.read">
                <SalesWorkPage />
              </RequirePermission>
            ),
          },
          {
            path: 'sales/boards/settings',
            handle: { width: 'full' },
            element: (
              <RequirePermission permission="sales.boards.manage">
                <SalesSettingsPage />
              </RequirePermission>
            ),
          },
          // The order list lives in the work page's list view (ADR-0057 #7).
          {
            path: 'sales/orders',
            handle: { width: 'full' },
            element: <Navigate to="/sales/boards?view=list" replace />,
          },
          {
            path: 'sales/orders/new',
            handle: { width: 'full' },
            element: (
              <RequirePermission permission="sales.orders.manage">
                <SalesOrderNewPage />
              </RequirePermission>
            ),
          },
          {
            path: 'sales/orders/:id',
            handle: { width: 'full' },
            element: (
              <RequirePermission permission="sales.orders.read">
                <SalesOrderPage />
              </RequirePermission>
            ),
          },
          { path: 'segments', handle: { width: 'wide' }, element: <SegmentsPage /> },
          {
            path: 'segments/new',
            handle: { width: 'reading' },
            element: (
              <RequirePermission permission="segments.manage">
                <SegmentEditorPage />
              </RequirePermission>
            ),
          },
          { path: 'segments/:id', handle: { width: 'reading' }, element: <SegmentPage /> },
          {
            path: 'segments/:id/edit',
            handle: { width: 'reading' },
            element: (
              <RequirePermission permission="segments.manage">
                <SegmentEditorPage />
              </RequirePermission>
            ),
          },
          {
            path: 'ai',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="ai.ask">
                <AiPage />
              </RequirePermission>
            ),
          },
          {
            path: 'ai/reports',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="ai.ask">
                <AiReportsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'imports',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="imports.manage">
                <ImportsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'imports/:id',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="imports.manage">
                <ImportPage />
              </RequirePermission>
            ),
          },
          { path: 'inventory/transfers', handle: { width: 'wide' }, element: <TransfersPage /> },
          { path: 'inventory/transfers/:id', handle: { width: 'wide' }, element: <TransferPage /> },
          { path: 'inventory/moves', handle: { width: 'wide' }, element: <BinMovesPage /> },
          {
            path: 'inventory/adjustments',
            handle: { width: 'wide' },
            element: <AdjustmentsPage />,
          },
          {
            path: 'inventory/adjustments/:id',
            handle: { width: 'wide' },
            element: <AdjustmentPage />,
          },
          { path: 'inventory/stocktakes', handle: { width: 'wide' }, element: <StocktakesPage /> },
          {
            path: 'inventory/stocktakes/:id',
            handle: { width: 'wide' },
            element: <StocktakePage />,
          },
          {
            path: 'inventory/bins',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="inventory.setup.manage">
                <BinsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'users',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="identity.users.read">
                <UsersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'users/:id',
            handle: { width: 'reading' },
            element: (
              <RequirePermission permission="identity.users.read">
                <UserDetailPage />
              </RequirePermission>
            ),
          },
          {
            path: 'roles',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="identity.users.read">
                <RolesPage />
              </RequirePermission>
            ),
          },
          { path: 'company', handle: { width: 'reading' }, element: <CompanyPage /> },
          { path: 'branches', handle: { width: 'wide' }, element: <BranchesPage /> },
          { path: 'warehouses', handle: { width: 'wide' }, element: <WarehousesPage /> },
          {
            path: 'settings',
            handle: { width: 'reading' },
            element: (
              <RequirePermission permission="identity.settings.read">
                <SettingsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'audit',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="identity.audit.read">
                <AuditPage />
              </RequirePermission>
            ),
          },
          { path: '*', handle: { width: 'reading' }, element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}

/** The «Супермаркет» pages (ADR-0063 #8): reads behind pos.read, the settings and the test till behind pos.manage. */
function posRoutes(): RouteObject[] {
  const read = (element: ReactNode) => (
    <RequirePermission permission="pos.read">{element}</RequirePermission>
  );
  const manage = (element: ReactNode) => (
    <RequirePermission permission="pos.manage">{element}</RequirePermission>
  );
  return [
    { path: 'pos/shifts', handle: { width: 'wide' }, element: read(<PosShiftsPage />) },
    { path: 'pos/sales', handle: { width: 'wide' }, element: read(<PosSalesPage />) },
    { path: 'pos/tills', handle: { width: 'wide' }, element: read(<PosTillsPage />) },
    { path: 'pos/cashiers', handle: { width: 'wide' }, element: read(<PosCashiersPage />) },
    { path: 'pos/settings', handle: { width: 'reading' }, element: manage(<PosSettingsPage />) },
    ...(import.meta.env.DEV
      ? [{ path: 'pos/test-till', handle: { width: 'wide' }, element: manage(<PosTestTillPage />) }]
      : []),
  ];
}

/** The «Санхүү» pages (ADR-0060 #11), every one behind finance.read; the settings behind their right. */
function financeRoutes(): RouteObject[] {
  const read = (element: ReactNode) => (
    <RequirePermission permission="finance.read">{element}</RequirePermission>
  );
  return [
    { path: 'finance/invoices', handle: { width: 'wide' }, element: read(<InvoicesPage />) },
    { path: 'finance/payments', handle: { width: 'wide' }, element: read(<PaymentsPage />) },
    { path: 'finance/cash', handle: { width: 'wide' }, element: read(<CashPage />) },
    {
      path: 'finance/customers',
      handle: { width: 'wide' },
      element: read(<CustomerBalancesPage />),
    },
    {
      path: 'finance/customers/:id',
      handle: { width: 'wide' },
      element: read(<CustomerLedgerPage />),
    },
    {
      path: 'finance/suppliers',
      handle: { width: 'wide' },
      element: read(<SupplierBalancesPage />),
    },
    {
      path: 'finance/suppliers/:id',
      handle: { width: 'wide' },
      element: read(<SupplierLedgerPage />),
    },
    { path: 'finance/journal', handle: { width: 'wide' }, element: read(<JournalPage />) },
    { path: 'finance/accounts', handle: { width: 'wide' }, element: read(<AccountsPage />) },
    {
      path: 'finance/accounts/:id',
      handle: { width: 'wide' },
      element: read(<AccountLedgerPage />),
    },
    {
      path: 'finance/settings',
      handle: { width: 'reading' },
      element: (
        <RequirePermission permission="finance.settings.manage">
          <FinanceSettingsPage />
        </RequirePermission>
      ),
    },
  ];
}
