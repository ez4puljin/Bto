import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { FinanceModule } from '../finance';
import { IdentityModule } from '../identity';
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
import { CustomerSettingsController } from './controllers/customer-settings.controller';
import { CompanyContactsService } from './services/company-contacts.service';
import { CustomerAccountService } from './services/customer-account.service';
import { CustomerAppOrdersService } from './services/customer-app-orders.service';
import { CustomerShopService } from './services/customer-shop.service';

/**
 * The customer app «Bto300» (docs/modules/customer.md, ADR-0079, ADR-0082): one set of routes for
 * the store's token over the owners' public services — the shop, orders, the account, the bell and
 * «Холбоо барих» — plus the admins' contact list. Nobody imports this module (api only).
 */
@Module({
  imports: [
    IdentityModule,
    CatalogModule,
    PartnersModule,
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
    CustomerSettingsController,
  ],
  providers: [
    CompanyContactsService,
    CustomerAccountService,
    CustomerAppOrdersService,
    CustomerShopService,
  ],
})
export class CustomerHttpModule {}
