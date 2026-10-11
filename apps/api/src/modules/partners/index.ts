// Public API of the partners module (docs/modules/partners.md). Other modules import only this file;
// named exports only (ESLint G2 rejects `export *`).
export { PartnersHttpModule, PartnersModule } from './partners.module';
export {
  type AddressInput,
  type AddressSnapshot,
  CustomerAddressesService,
  type GpsSource,
} from './services/customer-addresses.service';
export {
  type CreditTerms,
  type CustomerDetail,
  type CustomerSummary,
  CustomersService,
  type LockedCustomer,
  type PaymentTerm,
} from './services/customers.service';
