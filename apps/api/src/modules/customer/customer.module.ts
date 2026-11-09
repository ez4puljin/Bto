import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { FinanceModule } from '../finance';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { NotificationsModule } from '../notifications';
import { PartnersModule } from '../partners';
import { PricingModule } from '../pricing';
import { SalesLiveModule, SalesModule } from '../sales';
import { AppReleasesController } from './controllers/app-releases.controller';
import {
  CustomerAppMoneyController,
  CustomerAppNotificationsController,
  CustomerAppOrdersController,
  CustomerAppShopController,
  CustomerAppStoreController,
} from './controllers/customer-app.controller';
import {
  CustomerAppHomeController,
  CustomerBannersController,
} from './controllers/customer-home.controller';
import { CustomerAppLiveStockController } from './controllers/customer-live-stock.controller';
import { CustomerSettingsController } from './controllers/customer-settings.controller';
import { SalesRepHomeController } from './controllers/sales-rep-home.controller';
import { AppBannersService } from './services/app-banners.service';
import { AppReleasesService } from './services/app-releases.service';
import { CompanyContactsService } from './services/company-contacts.service';
import { CustomerAccountService } from './services/customer-account.service';
import { CustomerAppOrdersService } from './services/customer-app-orders.service';
import { CustomerHomeService } from './services/customer-home.service';
import { CustomerShopService } from './services/customer-shop.service';

/**
 * The customer app «Bto300» (docs/modules/customer.md, ADR-0079, ADR-0082): one set of routes for
 * the store's token over the owners' public services — the home (ADR-0092), the shop, orders, the
 * account, the bell and «Холбоо барих» — plus the admins' contact list and banners, and the same
 * shop window for the rep app's home (staff routes under `sales-rep`, 2026-10-23). Nobody imports
 * this module (api only).
 */
@Module({
  imports: [
    IdentityModule,
    CatalogModule,
    PartnersModule,
    InventoryModule,
    PricingModule,
    SalesModule,
    SalesLiveModule,
    FinanceModule,
    NotificationsModule,
  ],
  controllers: [
    CustomerAppStoreController,
    CustomerAppShopController,
    CustomerAppOrdersController,
    CustomerAppMoneyController,
    CustomerAppNotificationsController,
    CustomerAppHomeController,
    CustomerAppLiveStockController,
    CustomerSettingsController,
    CustomerBannersController,
    SalesRepHomeController,
    AppReleasesController,
  ],
  providers: [
    AppBannersService,
    AppReleasesService,
    CompanyContactsService,
    CustomerHomeService,
    CustomerAccountService,
    CustomerAppOrdersService,
    CustomerShopService,
  ],
})
export class CustomerHttpModule {}
