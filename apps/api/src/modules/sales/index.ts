// Public API of the sales module (docs/modules/sales.md). Other modules import only this file;
// named exports only (ESLint G2 rejects `export *`).
export { SalesHttpModule, SalesModule } from './sales.module';
export {
  type BackorderedLine,
  CREDIT_CHECKER,
  type CreditChecker,
  type CreditCheckInput,
  type CreditDecision,
  ORDER_LISTENER,
  type OrderCancelledNotice,
  type OrderConfirmedNotice,
  type OrderListener,
  SALE_LISTENER,
  SALE_SINK,
  type SaleListener,
  type SaleNotice,
  type SaleSink,
  type SaleSnapshot,
  type SoldLine,
  type SoldPart,
} from './hooks';
export {
  type CustomerOrderDetail,
  type CustomerOrderPage,
  type CustomerOrderRow,
  CustomerOrdersService,
} from './services/customer-orders.service';
export {
  type Access,
  type PipelineRights,
  type PipelineView,
  SalesAccessService,
  type StageRights,
  type StageView,
} from './services/sales-access.service';
export {
  type BoardNode,
  type PipelineSummary,
  SalesBoardsService,
} from './services/sales-boards.service';
export {
  type OrderCard,
  type OrderDetail,
  type OrderFilters,
  type OrderLine,
  type OrderQuery,
  type OrderSummary,
  SalesOrderQueryService,
  type StageCards,
} from './services/sales-order-query.service';
export {
  type RepProduct,
  type RepProductQuery,
  SalesRepShopService,
} from './services/sales-rep-shop.service';
export {
  CUSTOMER_APP_LABEL,
  type MoveResult,
  type OrderInput,
  type OrderLineInput,
  type PickLineInput,
  SalesOrdersService,
} from './services/sales-orders.service';
export {
  type PipelineDetail,
  type PipelineInput,
  SalesPipelinesService,
  type StageInput,
} from './services/sales-pipelines.service';
export {
  type ChannelDefault,
  type NumberFormat,
  ORDER_NUMBER_SCOPE,
  SalesSettingsService,
} from './services/sales-settings.service';
