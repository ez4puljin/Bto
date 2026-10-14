import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
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
import { CustomersService } from './services/customers.service';
import { ProductSuppliersService } from './services/product-suppliers.service';
import { SuppliersService } from './services/suppliers.service';

const CORE_SERVICES = [
  CustomerAddressesService,
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
  providers: CORE_SERVICES,
  exports: CORE_SERVICES,
})
export class PartnersModule {}

/** The HTTP side of partners (api only). */
@Module({
  imports: [PartnersModule],
  controllers: [
    CustomersController,
    CustomerAddressesController,
    CustomerContactsController,
    SuppliersController,
    SupplierContactsController,
    ProductSuppliersController,
  ],
})
export class PartnersHttpModule {}
