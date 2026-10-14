// Public API of the partners module (docs/modules/partners.md). Other modules import only this
// file; named exports only (ESLint G2 rejects `export *`).
export { PARTNER_SET_RESOLVER, type PartnerSetEntity, type PartnerSetResolver } from './hooks';
export { PartnersHttpModule, PartnersModule } from './partners.module';
export {
  type ContactInput,
  type SupplierContact,
  SupplierContactsService,
} from './services/contacts.service';
export {
  type AddressInput,
  type AddressSnapshot,
  CustomerAddressesService,
  type GpsSource,
} from './services/customer-addresses.service';
export {
  type CreditInput,
  type CreditTerms,
  type CustomerDetail,
  type CustomerInput,
  type CustomerPatch,
  type CustomerSummary,
  CustomersService,
  type LockedCustomer,
  type PartnerStatus,
  type PaymentTerm,
} from './services/customers.service';
export {
  type ProductSupplierLink,
  ProductSuppliersService,
  type SupplierProduct,
} from './services/product-suppliers.service';
export {
  type Supplier,
  type SupplierDetail,
  type SupplierInput,
  type SupplierPatch,
  type SupplierSummary,
  SuppliersService,
} from './services/suppliers.service';
