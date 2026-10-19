import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { CUSTOMER_ACCOUNT_GATE, IdentityModule } from '../identity';
import { CustomerAppAccountController } from './controllers/customer-app-account.controller';
import {
  CustomerAddressesController,
  CustomerContactsController,
  CustomersController,
} from './controllers/customers.controller';
import {
  ProductSuppliersController,
  SupplierContactsController,
  SuppliersController,
} from './controllers/suppliers.controller';
import { PartnerSegmentsService } from './services/partner-segments.service';
import { CustomerContactsService, SupplierContactsService } from './services/contacts.service';
import { CustomerAddressesService } from './services/customer-addresses.service';
import {
  CustomerAccountGateService,
  CustomerAppAccountsService,
} from './services/customer-app-accounts.service';
import { CustomersService } from './services/customers.service';
import { ProductSuppliersService } from './services/product-suppliers.service';
import { SuppliersService } from './services/suppliers.service';

const CORE_SERVICES = [
  CustomerAccountGateService,
  CustomerAddressesService,
  CustomerAppAccountsService,
  CustomerContactsService,
  CustomersService,
  PartnerSegmentsService,
  ProductSuppliersService,
  SupplierContactsService,
  SuppliersService,
];

/**
 * Partners services every process may use (api, worker jobs, imports). It imports CatalogModule
 * for product summaries (ADR-0032), never CatalogHttpModule.
 */
@Module({
  imports: [IdentityModule, CatalogModule],
  providers: [
    ...CORE_SERVICES,
    // identity asks whether a customer may use the app (ADR-0079 #2).
    { provide: CUSTOMER_ACCOUNT_GATE, useExisting: CustomerAccountGateService },
  ],
  exports: [...CORE_SERVICES, CUSTOMER_ACCOUNT_GATE],
})
export class PartnersModule {}

/** The HTTP side of partners (api only). */
@Module({
  imports: [PartnersModule],
  controllers: [
    CustomersController,
    CustomerAppAccountController,
    CustomerAddressesController,
    CustomerContactsController,
    SuppliersController,
    SupplierContactsController,
    ProductSuppliersController,
  ],
})
export class PartnersHttpModule {}
