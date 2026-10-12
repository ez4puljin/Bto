import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type ListContact = Schemas['ListContact'];
/** A row of the customer list (ADR-0037). */
export type CustomerListItem = Schemas['CustomerListItem'];
export type CustomerSummary = Pick<
  CustomerListItem,
  'id' | 'code' | 'kind' | 'name' | 'regNo' | 'tin' | 'phone' | 'status' | 'creditHold'
>;
export type CustomerDetail = Schemas['CustomerDetail'];
export type CustomerAddress = Schemas['CustomerAddress'];
export type Contact = Schemas['Contact'];
export type CustomerCreate = Schemas['CustomerCreateRequest'];
export type CustomerUpdate = Schemas['CustomerUpdateRequest'];
export type CustomerCredit = Schemas['CustomerCreditRequest'];
export type AddressRequest = Schemas['CustomerAddressRequest'];
export type ContactRequest = Schemas['ContactRequest'];
/** A row of the supplier list (ADR-0037). */
export type SupplierListItem = Schemas['SupplierListItem'];
/** A supplier as pickers show it. */
export type SupplierSummary = Pick<
  SupplierListItem,
  'id' | 'code' | 'name' | 'tin' | 'phone' | 'status'
>;
export type SupplierDetail = Schemas['SupplierDetail'];
export type SupplierCreate = Schemas['SupplierCreateRequest'];
export type SupplierUpdate = Schemas['SupplierUpdateRequest'];
export type ProductSupplierLink = Schemas['ProductSupplierLink'];
export type CustomerKind = CustomerDetail['kind'];
export type PartnerStatus = CustomerDetail['status'];

export const KEYS = {
  customers: ['partners', 'customers'] as const,
  suppliers: ['partners', 'suppliers'] as const,
  productSuppliers: ['partners', 'product-suppliers'] as const,
};

/** Idempotent routes take the key from the caller: one key per user intent (ADR-0004). */
type Keyed<T> = T & { key: string };

export interface CustomerFilter {
  q?: string;
  kind?: CustomerKind;
  status?: PartnerStatus;
  creditHold?: boolean;
  tinPending?: boolean;
  gpsMissing?: boolean;
}

export function useCustomers(filter: CustomerFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.customers, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/customers', {
          params: {
            query: {
              q: filter.q || undefined,
              kind: filter.kind,
              status: filter.status,
              creditHold: filter.creditHold,
              tinPending: filter.tinPending,
              gpsMissing: filter.gpsMissing,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.customers, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/customers/{id}', { params: { path: { id } }, signal })),
  });
}

export function useNextCustomerCode() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.customers, 'next-code'],
    staleTime: 0,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/customers/next-code', { signal })).code,
  });
}

export function useSuppliers(filter: { q?: string; status?: PartnerStatus }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.suppliers, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/suppliers', {
          params: {
            query: {
              q: filter.q || undefined,
              status: filter.status,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useSupplier(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.suppliers, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/suppliers/{id}', { params: { path: { id } }, signal })),
  });
}

export function useNextSupplierCode() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.suppliers, 'next-code'],
    staleTime: 0,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/suppliers/next-code', { signal })).code,
  });
}

export function useSupplierProducts(id: number) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.suppliers, id, 'products'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/suppliers/{id}/products', {
          params: { path: { id }, query: { cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useProductSuppliers(productId: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.productSuppliers, productId],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/product-suppliers', { params: { query: { productId } }, signal }),
      ).data,
  });
}

/**
 * The supplier links of a page of products (the product list, ADR-0037): one request per page,
 * none while `enabled` is false. Under the same key prefix, so link changes refresh it.
 */
export function useProductSuppliersOf(productIds: readonly number[], enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.productSuppliers, 'of', productIds],
    enabled: enabled && productIds.length > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/product-suppliers', {
          params: { query: { productIds: [...productIds] } },
          signal,
        }),
      ).data,
  });
}

/** Mutations; each refreshes what it can change. */
export function usePartnersMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = (...keys: (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  const customersChanged = () => invalidate(KEYS.customers);
  const suppliersChanged = () => invalidate(KEYS.suppliers, KEYS.productSuppliers);

  return {
    createCustomer: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<CustomerCreate>) =>
        unwrap(
          await api.POST('/api/v1/customers', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: customersChanged,
    }),
    updateCustomer: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: CustomerUpdate }) =>
        unwrap(await api.PATCH('/api/v1/customers/{id}', { params: { path: { id } }, body })),
      onSuccess: customersChanged,
    }),
    setCredit: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: CustomerCredit }) =>
        unwrap(await api.PUT('/api/v1/customers/{id}/credit', { params: { path: { id } }, body })),
      onSuccess: customersChanged,
    }),
    addAddress: useMutation({
      mutationFn: async ({
        customerId,
        body,
      }: {
        customerId: number;
        body: AddressRequest & { isDefault?: boolean };
      }) =>
        unwrap(
          await api.POST('/api/v1/customers/{id}/addresses', {
            params: { path: { id: customerId } },
            body,
          }),
        ),
      onSuccess: customersChanged,
    }),
    updateAddress: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: AddressRequest }) =>
        unwrap(
          await api.PATCH('/api/v1/customer-addresses/{id}', { params: { path: { id } }, body }),
        ),
      onSuccess: customersChanged,
    }),
    defaultAddress: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/customer-addresses/{id}/default', { params: { path: { id } } }),
        ),
      onSuccess: customersChanged,
    }),
    archiveAddress: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/customer-addresses/{id}', { params: { path: { id } } })),
      onSuccess: customersChanged,
    }),
    addCustomerContact: useMutation({
      mutationFn: async ({ ownerId, body }: { ownerId: number; body: ContactRequest }) =>
        unwrap(
          await api.POST('/api/v1/customers/{id}/contacts', {
            params: { path: { id: ownerId } },
            body,
          }),
        ),
      onSuccess: customersChanged,
    }),
    updateCustomerContact: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: ContactRequest }) =>
        unwrap(
          await api.PATCH('/api/v1/customer-contacts/{id}', { params: { path: { id } }, body }),
        ),
      onSuccess: customersChanged,
    }),
    deleteCustomerContact: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/customer-contacts/{id}', { params: { path: { id } } })),
      onSuccess: customersChanged,
    }),
    createSupplier: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<SupplierCreate>) =>
        unwrap(
          await api.POST('/api/v1/suppliers', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: suppliersChanged,
    }),
    updateSupplier: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: SupplierUpdate }) =>
        unwrap(await api.PATCH('/api/v1/suppliers/{id}', { params: { path: { id } }, body })),
      onSuccess: suppliersChanged,
    }),
    addSupplierContact: useMutation({
      mutationFn: async ({ ownerId, body }: { ownerId: number; body: ContactRequest }) =>
        unwrap(
          await api.POST('/api/v1/suppliers/{id}/contacts', {
            params: { path: { id: ownerId } },
            body,
          }),
        ),
      onSuccess: suppliersChanged,
    }),
    updateSupplierContact: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: ContactRequest }) =>
        unwrap(
          await api.PATCH('/api/v1/supplier-contacts/{id}', { params: { path: { id } }, body }),
        ),
      onSuccess: suppliersChanged,
    }),
    deleteSupplierContact: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/supplier-contacts/{id}', { params: { path: { id } } })),
      onSuccess: suppliersChanged,
    }),
    linkSupplier: useMutation({
      mutationFn: async (body: { productId: number; supplierId: number }) =>
        unwrap(await api.POST('/api/v1/product-suppliers', { body })),
      onSuccess: suppliersChanged,
    }),
    mainSupplier: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/product-suppliers/{id}/main', { params: { path: { id } } })),
      onSuccess: suppliersChanged,
    }),
    unlinkSupplier: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/product-suppliers/{id}', { params: { path: { id } } })),
      onSuccess: suppliersChanged,
    }),
  };
}
