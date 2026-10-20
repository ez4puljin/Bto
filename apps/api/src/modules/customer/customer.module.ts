import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { FinanceModule } from '../finance';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { NotificationsModule } from '../notifications';
import { PartnersModule } from '../partners';
import { PricingModule } from '../pricing';
import { SalesModule } from '../sales';
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
import { CustomerSettingsController } from './controllers/customer-settings.controller';
import { AppBannersService } from './services/app-banners.service';
import { CompanyContactsService } from './services/company-contacts.service';
import { CustomerAccountService } from './services/customer-account.service';
import { CustomerAppOrdersService } from './services/customer-app-orders.service';
import { CustomerHomeService } from './services/customer-home.service';
import { CustomerShopService } from './services/customer-shop.service';

/**
 * The customer app «Bto300» (docs/modules/customer.md, ADR-0079, ADR-0082): one set of routes for
 * the store's token over the owners' public services — the home (ADR-0092), the shop, orders, the
 * account, the bell and «Холбоо барих» — plus the admins' contact list and banners. Nobody imports
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
    CustomerSettingsController,
    CustomerBannersController,
  ],
  providers: [
    AppBannersService,
    CompanyContactsService,
    CustomerHomeService,
    CustomerAccountService,
    CustomerAppOrdersService,
    CustomerShopService,
  ],
})
export class CustomerHttpModule {}
