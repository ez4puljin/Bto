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
import { StructurePage } from '@/features/identity/structure-page';
import { UserDetailPage } from '@/features/identity/user-detail-page';
import { UsersPage } from '@/features/identity/users-page';
import { AdjustmentPage, AdjustmentsPage } from '@/features/inventory/adjustments-pages';
import { BinsPage } from '@/features/inventory/bins-page';
import { LowStockPage } from '@/features/inventory/low-stock-page';
import { BinMovesPage } from '@/features/inventory/moves-page';
import { IssueConfirmPage } from '@/features/inventory/issue-confirm-page';
import { IssuePage, IssuesPage } from '@/features/inventory/issues-pages';
import { ReceiptPrintPage } from '@/features/inventory/receipt-print-page';
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
import { CustomerCategoriesPage } from '@/features/partners/customer-categories-page';
import { CustomersPage } from '@/features/partners/customers-page';
import {
  SupplierCreatePage,
  SupplierPage,
  SuppliersPage,
} from '@/features/partners/supplier-pages';
import { HomePage } from '@/features/home/home-page';
import { PurchaseOrderPrintPage, PurchaseOrdersPage } from '@/features/procurement/orders-pages';
import { PurchaseOrderDetailPage } from '@/features/procurement/order-detail-page';
import { PurchaseOrderOverviewPage } from '@/features/procurement/order-overview-page';
import { PurchaseOrderHistoryPage } from '@/features/procurement/order-history-page';
import { TrucksPage } from '@/features/procurement/trucks-page';
import { ReceiptReceivePage } from '@/features/inventory/receipt-receive-page';
import { ModulePage } from '@/features/home/module-page';
import { AiPage } from '@/features/ai/ai-page';
import { AccountLedgerPage, AccountsPage } from '@/features/finance/accounts-page';
import { OpeningCheckPage, OpeningCheckPrintPage } from '@/features/finance/opening-check-pages';
import { PeriodsPage } from '@/features/finance/periods-page';
import {
  TrialBalancePage,
  TrialBalancePrintPage,
  VatPrintPage,
  VatReportPage,
} from '@/features/finance/reports-pages';
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
import { AgingPage, AgingPrintPage } from '@/features/reports/aging-page';
import { DashboardPage, DashboardPrintPage } from '@/features/reports/dashboard-page';
import { ProfitPage, ProfitPrintPage } from '@/features/reports/profit-page';
import { StockPrintPage, StockReportPage } from '@/features/reports/stock-page';
import { SuppliersPrintPage, SuppliersReportPage } from '@/features/reports/suppliers-page';
import { AiReportsPage } from '@/features/ai/reports-page';
import { AppContactsPage } from '@/features/app-settings/contacts-page';
import { AppGeneralPage } from '@/features/app-settings/general-page';
import { AppHomePage } from '@/features/app-settings/home-page';
import { AppOrdersPage } from '@/features/app-settings/orders-page';
import { AppProductsPage } from '@/features/app-settings/products-page';
import { AppStoresPage } from '@/features/app-settings/stores-page';
import { AttendanceDashboardPage } from '@/features/hr/dashboard-page';
import { AttendanceDaysPage } from '@/features/hr/days-page';
import { AttendanceSetupPage } from '@/features/hr/setup-page';
import { BannersPage } from '@/features/customer-app/banners-page';
import { PosCashiersPage } from '@/features/pos/cashiers-page';
import { PosLoyaltyMembersPage } from '@/features/pos/loyalty-members-page';
import { PosQuickButtonsPage } from '@/features/pos/quick-buttons-page';
import { PosSalesPage } from '@/features/pos/sales-page';
import { PosSalePrintPage } from '@/features/pos/sale-print-page';
import { PosSettingsPage } from '@/features/pos/settings-page';
import { PosShiftsPage } from '@/features/pos/shifts-page';
import { PosTestTillPage } from '@/features/pos/test-till-page';
import { PosTillsPage } from '@/features/pos/tills-page';
import { PosVoidsPage } from '@/features/pos/voids-page';
import { PosVoucherPrintPage } from '@/features/pos/voucher-print-page';
import { PosVouchersPage } from '@/features/pos/vouchers-page';
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
    // A batch's coupon or voucher cards, or a partner's list of used vouchers (ADR-0110).
    path: '/pos/vouchers/:id/print',
    element: (
      <RequireAuth>
        <RequirePermission permission="pos.read">
          <PosVoucherPrintPage />
        </RequirePermission>
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    // A purchase order's sheets for the suppliers, one per supplier (ADR-0115).
    path: '/procurement/orders/:id/print',
    element: (
      <RequireAuth>
        <RequirePermission permission="procurement.orders.read">
          <PurchaseOrderPrintPage />
        </RequirePermission>
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    // A goods receipt for paper: the priced document or the warehouses' lists (ADR-0099 #6).
    path: '/inventory/receipts/:id/print/:kind',
    element: (
      <RequireAuth>
        <ReceiptPrintPage />
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    // The trial balance and the VAT report for paper (ADR-0105).
    path: '/finance/trial-balance/print',
    element: (
      <RequireAuth>
        <RequirePermission permission="finance.read">
          <TrialBalancePrintPage />
        </RequirePermission>
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    // The opening's sign-off with its signature lines (ADR-0106 #5).
    path: '/finance/opening-check/print',
    element: (
      <RequireAuth>
        <RequirePermission permission="finance.read">
          <OpeningCheckPrintPage />
        </RequirePermission>
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/finance/vat/print',
    element: (
      <RequireAuth>
        <RequirePermission permission="finance.read">
          <VatPrintPage />
        </RequirePermission>
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  // The management reports for paper (ADR-0108).
  ...reportPrintRoutes(),
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
          { index: true, element: <HomePage />, handle: { width: 'full' } },
          { path: 'm/:module', handle: { width: 'wide' }, element: <ModulePage /> },
          ...financeRoutes(),
          ...reportRoutes(),
          ...posRoutes(),
          ...appRoutes(),
          ...hrRoutes(),
          { path: 'system/status', handle: { width: 'reading' }, element: <SystemStatusPage /> },
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
            path: 'partners/customer-categories',
            handle: { width: 'reading' },
            element: (
              <RequirePermission permission="partners.customers.read">
                <CustomerCategoriesPage />
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
          // The keeper's count against the expected quantities, by scanner (ADR-0115).
          {
            path: 'inventory/receipts/:id/receive',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="inventory.receipts.manage">
                <ReceiptReceivePage />
              </RequirePermission>
            ),
          },
          // Purchase orders by supplier (ADR-0115): the list and one order with its grid.
          {
            path: 'procurement/orders',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="procurement.orders.read">
                <PurchaseOrdersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'procurement/orders/:id',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="procurement.orders.read">
                <PurchaseOrderOverviewPage />
              </RequirePermission>
            ),
          },
          {
            path: 'procurement/orders/:id/detail',
            handle: { width: 'full' },
            element: (
              <RequirePermission permission="procurement.orders.read">
                <PurchaseOrderDetailPage />
              </RequirePermission>
            ),
          },
          {
            path: 'procurement/orders/:id/history',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="procurement.orders.read">
                <PurchaseOrderHistoryPage />
              </RequirePermission>
            ),
          },
          {
            path: 'procurement/trucks',
            handle: { width: 'reading' },
            element: (
              <RequirePermission permission="procurement.orders.read">
                <TrucksPage />
              </RequirePermission>
            ),
          },
          {
            path: 'inventory/receipts/:id/costing',
            handle: { width: 'wide' },
            element: <Navigate to=".." relative="path" replace />,
          },
          // Goods issues (ADR-0081): one page for a new issue (new) and an existing one, like receipts.
          { path: 'inventory/issues', handle: { width: 'wide' }, element: <IssuesPage /> },
          { path: 'inventory/issues/:id', handle: { width: 'wide' }, element: <IssuePage /> },
          // The keeper's confirmation screen (ADR-0117): tick, scan, confirm or send back.
          {
            path: 'inventory/issues/:id/confirm',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="inventory.issues.confirm">
                <IssueConfirmPage />
              </RequirePermission>
            ),
          },
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
          {
            path: 'structure',
            handle: { width: 'wide' },
            element: (
              <RequirePermission permission="identity.org.manage">
                <StructurePage />
              </RequirePermission>
            ),
          },
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

/** The «Супермаркет» pages (ADR-0063 #8): reads behind pos.read, the settings and the test till behind pos.manage, the bonus card behind pos.loyalty.manage (ADR-0112). */
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
    { path: 'pos/voids', handle: { width: 'wide' }, element: read(<PosVoidsPage />) },
    { path: 'pos/vouchers', handle: { width: 'wide' }, element: read(<PosVouchersPage />) },
    {
      path: 'pos/members',
      handle: { width: 'wide' },
      element: (
        <RequirePermission permission="pos.loyalty.manage">
          <PosLoyaltyMembersPage />
        </RequirePermission>
      ),
    },
    { path: 'pos/tills', handle: { width: 'wide' }, element: read(<PosTillsPage />) },
    { path: 'pos/cashiers', handle: { width: 'wide' }, element: read(<PosCashiersPage />) },
    {
      path: 'pos/quick-buttons',
      handle: { width: 'wide' },
      element: read(<PosQuickButtonsPage />),
    },
    { path: 'pos/settings', handle: { width: 'reading' }, element: manage(<PosSettingsPage />) },
    ...(import.meta.env.DEV
      ? [{ path: 'pos/test-till', handle: { width: 'wide' }, element: manage(<PosTestTillPage />) }]
      : []),
  ];
}

/**
 * The «Апп» pages (ADR-0127): the two mobile apps' settings. The home, the assortment and the
 * general settings behind customer.home.manage; the orders page to the boards' keepers too; the
 * contacts to the settings' readers; the notices to their senders; the stores to the customers'
 * readers. The old «Систем» addresses redirect (bookmarks, the recent pages).
 */
function appRoutes(): RouteObject[] {
  const home = (element: ReactNode) => (
    <RequirePermission permission="customer.home.manage">{element}</RequirePermission>
  );
  return [
    { path: 'app/home', handle: { width: 'wide' }, element: home(<AppHomePage />) },
    { path: 'app/home/banners', handle: { width: 'wide' }, element: home(<BannersPage />) },
    { path: 'app/products', handle: { width: 'reading' }, element: home(<AppProductsPage />) },
    {
      path: 'app/orders',
      handle: { width: 'reading' },
      element: (
        <RequirePermission permission={['sales.boards.manage', 'customer.home.manage']}>
          <AppOrdersPage />
        </RequirePermission>
      ),
    },
    {
      path: 'app/contacts',
      handle: { width: 'reading' },
      element: (
        <RequirePermission permission="identity.settings.read">
          <AppContactsPage />
        </RequirePermission>
      ),
    },
    {
      path: 'app/notices',
      handle: { width: 'wide' },
      element: (
        <RequirePermission permission="notifications.send">
          <AppNoticesPage />
        </RequirePermission>
      ),
    },
    {
      path: 'app/stores',
      handle: { width: 'reading' },
      element: (
        <RequirePermission permission="partners.customers.read">
          <AppStoresPage />
        </RequirePermission>
      ),
    },
    { path: 'app/general', handle: { width: 'reading' }, element: home(<AppGeneralPage />) },
    {
      path: 'system/customer-app',
      handle: { width: 'wide' },
      element: <Navigate to="/app/home" replace />,
    },
    {
      path: 'system/customer-app/banners',
      handle: { width: 'wide' },
      element: <Navigate to="/app/home/banners" replace />,
    },
    {
      path: 'system/app-notices',
      handle: { width: 'wide' },
      element: <Navigate to="/app/notices" replace />,
    },
  ];
}

/**
 * The attendance pages (ADR-0131), every one behind hr.attendance.view: the setup (sites, the
 * schedule, the employees) reads to a viewer and is changed by hr.attendance.manage, which the menu
 * entry needs.
 */
function hrRoutes(): RouteObject[] {
  const view = (element: ReactNode) => (
    <RequirePermission permission="hr.attendance.view">{element}</RequirePermission>
  );
  return [
    {
      path: 'hr/attendance',
      handle: { width: 'wide' },
      element: view(<AttendanceDashboardPage />),
    },
    {
      path: 'hr/attendance/days',
      handle: { width: 'wide' },
      element: view(<AttendanceDaysPage />),
    },
    { path: 'hr/setup', handle: { width: 'reading' }, element: view(<AttendanceSetupPage />) },
  ];
}

/** The «Тайлан» pages (ADR-0108): the margins behind reports.margins.view, the rest behind reports.view. */
function reportRoutes(): RouteObject[] {
  const view = (element: ReactNode) => (
    <RequirePermission permission="reports.view">{element}</RequirePermission>
  );
  const margins = (element: ReactNode) => (
    <RequirePermission permission="reports.margins.view">{element}</RequirePermission>
  );
  return [
    { path: 'reports/dashboard', handle: { width: 'wide' }, element: view(<DashboardPage />) },
    { path: 'reports/aging', handle: { width: 'wide' }, element: view(<AgingPage />) },
    { path: 'reports/profit', handle: { width: 'wide' }, element: margins(<ProfitPage />) },
    { path: 'reports/stock', handle: { width: 'wide' }, element: view(<StockReportPage />) },
    {
      path: 'reports/suppliers',
      handle: { width: 'wide' },
      element: margins(<SuppliersReportPage />),
    },
  ];
}

/** The reports' paper, outside the shell like the finance print pages. */
function reportPrintRoutes(): RouteObject[] {
  const page = (
    path: string,
    permission: 'reports.view' | 'reports.margins.view',
    element: ReactNode,
  ) => ({
    path,
    element: (
      <RequireAuth>
        <RequirePermission permission={permission}>{element}</RequirePermission>
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
  });
  return [
    page('/reports/dashboard/print', 'reports.view', <DashboardPrintPage />),
    page('/reports/aging/print', 'reports.view', <AgingPrintPage />),
    page('/reports/profit/print', 'reports.margins.view', <ProfitPrintPage />),
    page('/reports/stock/print', 'reports.view', <StockPrintPage />),
    page('/reports/suppliers/print', 'reports.margins.view', <SuppliersPrintPage />),
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
    { path: 'finance/periods', handle: { width: 'wide' }, element: read(<PeriodsPage />) },
    {
      path: 'finance/trial-balance',
      handle: { width: 'wide' },
      element: read(<TrialBalancePage />),
    },
    { path: 'finance/vat', handle: { width: 'wide' }, element: read(<VatReportPage />) },
    {
      path: 'finance/opening-check',
      handle: { width: 'wide' },
      element: read(<OpeningCheckPage />),
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
