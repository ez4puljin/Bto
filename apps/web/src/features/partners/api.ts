import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import type { SettlementGroup } from '@tugeel/shared/finance';
import { useApiClient } from '@/app/api-client-context';
import type { ListReadOptions } from '@/lib/list-read';
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
/** The «Апп» card's account (ADR-0079 #11); null while no phone is linked. */
export type CustomerAppAccount = Schemas['CustomerAppAccount'];
export type CustomerAppCode = Schemas['CustomerAppCode'];
export type AppAccountFilter = 'ACTIVE' | 'DISABLED' | 'NONE';
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
  /** A saved customer segment (ADR-0049). */
  segmentId?: number;
  /** The customer app account: open, closed or none (ADR-0079 #11). */
  app?: AppAccountFilter;
  /** «Мөрөн» or «Орон нутаг» (ADR-0101). */
  settlementGroup?: SettlementGroup;
}

export function useCustomers(filter: CustomerFilter, options: ListReadOptions = {}) {
  const api = useApiClient();
  const limit = options.limit ?? 50;
  return useInfiniteQuery({
    queryKey: [...KEYS.customers, 'list', filter, limit],
    enabled: options.enabled ?? true,
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
              segmentId: filter.segmentId,
              app: filter.app,
              settlementGroup: filter.settlementGroup,
              cursor: pageParam,
              limit,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: number, options: { enabled?: boolean } = {}) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.customers, id],
    enabled: options.enabled ?? true,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/customers/{id}', { params: { path: { id } }, signal })),
  });
}

/** The customer's app account (ADR-0079 #11): `{ account: null }` while no phone is linked. */
export function useCustomerAppAccount(customerId: number, enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.customers, customerId, 'app-account'],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/customers/{id}/app-account', {
          params: { path: { id: customerId } },
          signal,
        }),
      ).account,
  });
}

/**
 * The «Апп» card's writes (partners.customer_app.manage). The code is shown once and never kept:
 * its POST carries no Idempotency-Key, so a retry is a new code.
 */
export function useCustomerAppMutations(customerId: number) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = () => queryClient.invalidateQueries({ queryKey: KEYS.customers });
  const path = { params: { path: { id: customerId } } };
  return {
    link: useMutation({
      mutationFn: async (phone: string) =>
        unwrap(await api.PUT('/api/v1/customers/{id}/app-account', { ...path, body: { phone } })),
      onSuccess: changed,
    }),
    issueCode: useMutation({
      mutationFn: async () =>
        unwrap(await api.POST('/api/v1/customers/{id}/app-account/code', path)),
      onSuccess: changed,
    }),
    disable: useMutation({
      mutationFn: async () =>
        unwrap(await api.POST('/api/v1/customers/{id}/app-account/disable', path)),
      onSuccess: changed,
    }),
    enable: useMutation({
      mutationFn: async () =>
        unwrap(await api.POST('/api/v1/customers/{id}/app-account/enable', path)),
      onSuccess: changed,
    }),
  };
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

export function useSuppliers(
  filter: { q?: string; status?: PartnerStatus; segmentId?: number },
  options: ListReadOptions = {},
) {
  const api = useApiClient();
  const limit = options.limit ?? 50;
  return useInfiniteQuery({
    queryKey: [...KEYS.suppliers, 'list', filter, limit],
    enabled: options.enabled ?? true,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/suppliers', {
          params: {
            query: {
              q: filter.q || undefined,
              status: filter.status,
              segmentId: filter.segmentId,
              cursor: pageParam,
              limit,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** Given suppliers by id (a filter chip's names, ADR-0049), in one read; nothing when none. */
export function useSuppliersByIds(ids: readonly number[]) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.suppliers, 'ids', ids],
    enabled: ids.length > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/suppliers', {
          params: { query: { ids: [...ids], limit: 200 } },
          signal,
        }),
      ).data,
  });
}

export function useSupplier(id: number, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.suppliers, id],
    enabled,
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
