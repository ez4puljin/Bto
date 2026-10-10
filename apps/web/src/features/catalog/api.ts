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
export type Uom = Schemas['Uom'];
export type Category = Schemas['Category'];
export type Brand = Schemas['Brand'];
export type ProductSummary = Schemas['ProductSummary'];
export type ProductDetail = Schemas['ProductDetail'];
export type ProductUnit = Schemas['ProductUnit'];
export type Barcode = Schemas['Barcode'];
export type ProductImage = Schemas['ProductImage'];
export type ProductCreate = Schemas['ProductCreateRequest'];
export type ProductUpdate = Schemas['ProductUpdateRequest'];
export type UnitRequest = Schemas['UnitRequest'];
export type ReadinessReport = Schemas['ReadinessReport'];
export type ReadinessRow = Schemas['ReadinessRow'];
export type ReadinessGap = ReadinessRow['missing'][number];
export type AssignRequest = Schemas['ReadinessAssignRequest'];
export type BarcodeResolution = Schemas['BarcodeResolution'];
export type VatType = ProductDetail['vatType'];
export type ProductStatus = ProductDetail['status'];

export const KEYS = {
  uoms: ['catalog', 'uoms'] as const,
  categories: ['catalog', 'categories'] as const,
  brands: ['catalog', 'brands'] as const,
  products: ['catalog', 'products'] as const,
  readiness: ['catalog', 'readiness'] as const,
};

/**
 * Idempotent routes take the key from the caller: one key per user intent (a dialog, a click), resent
 * unchanged when the same intent is retried, so the server replays instead of acting twice (ADR-0004).
 */
type Keyed<T> = T & { key: string };

export function useUoms() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.uoms,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/uoms', { signal })).data,
  });
}

export function useCategories() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.categories,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/categories', { signal })).data,
  });
}

export function useBrands() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.brands,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/brands', { signal })).data,
  });
}

export interface ProductFilter {
  q?: string;
  categoryId?: number;
  brandId?: number;
  status?: ProductStatus;
}

export function useProducts(filter: ProductFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.products, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/products', {
          params: {
            query: {
              q: filter.q || undefined,
              categoryId: filter.categoryId,
              brandId: filter.brandId,
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

export function useProduct(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.products, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/products/{id}', { params: { path: { id } }, signal })),
  });
}

export function useNextSku(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.products, 'next-sku'],
    enabled,
    staleTime: 0,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/products/next-sku', { signal })).sku,
  });
}

export function useReadiness() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.readiness,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/catalog/ebarimt-readiness', { signal })),
  });
}

export function useReadinessProducts(filter: { gap?: ReadinessGap; categoryId?: number }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.readiness, 'products', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/catalog/ebarimt-readiness/products', {
          params: {
            query: { gap: filter.gap, categoryId: filter.categoryId, cursor: pageParam, limit: 50 },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** Looks a scanned code up (ADR-0029); a mutation because every scan is a new question. */
export function useBarcodeLookup() {
  const api = useApiClient();
  return useMutation({
    mutationFn: async (code: string) =>
      unwrap(await api.GET('/api/v1/barcodes/{code}', { params: { path: { code } } })),
  });
}

/** Mutations; each refreshes what it can change. */
export function useCatalogMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = (...keys: (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  const productChanged = () => invalidate(KEYS.products, KEYS.readiness);

  return {
    createUom: useMutation({
      mutationFn: async (body: Schemas['UomCreateRequest']) =>
        unwrap(await api.POST('/api/v1/uoms', { body })),
      onSuccess: () => invalidate(KEYS.uoms),
    }),
    updateUom: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: Schemas['UomUpdateRequest'] }) =>
        unwrap(await api.PATCH('/api/v1/uoms/{id}', { params: { path: { id } }, body })),
      onSuccess: () => invalidate(KEYS.uoms, KEYS.products, KEYS.readiness),
    }),
    deleteUom: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/uoms/{id}', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.uoms),
    }),
    createCategory: useMutation({
      mutationFn: async (body: Schemas['CategoryCreateRequest']) =>
        unwrap(await api.POST('/api/v1/categories', { body })),
      onSuccess: () => invalidate(KEYS.categories),
    }),
    updateCategory: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: Schemas['CategoryUpdateRequest'] }) =>
        unwrap(await api.PATCH('/api/v1/categories/{id}', { params: { path: { id } }, body })),
      onSuccess: () => invalidate(KEYS.categories),
    }),
    deleteCategory: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/categories/{id}', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.categories),
    }),
    createBrand: useMutation({
      mutationFn: async (body: Schemas['BrandRequest']) =>
        unwrap(await api.POST('/api/v1/brands', { body })),
      onSuccess: () => invalidate(KEYS.brands),
    }),
    updateBrand: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: Schemas['BrandRequest'] }) =>
        unwrap(await api.PATCH('/api/v1/brands/{id}', { params: { path: { id } }, body })),
      onSuccess: () => invalidate(KEYS.brands),
    }),
    deleteBrand: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/brands/{id}', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.brands),
    }),
    createProduct: useMutation({
      mutationFn: async (body: ProductCreate) =>
        unwrap(await api.POST('/api/v1/products', { body })),
      onSuccess: () => invalidate(KEYS.products, KEYS.readiness, KEYS.categories, KEYS.brands),
    }),
    updateProduct: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: ProductUpdate }) =>
        unwrap(await api.PATCH('/api/v1/products/{id}', { params: { path: { id } }, body })),
      onSuccess: () => invalidate(KEYS.products, KEYS.readiness, KEYS.categories, KEYS.brands),
    }),
    addUnit: useMutation({
      mutationFn: async ({ productId, body }: { productId: number; body: UnitRequest }) =>
        unwrap(
          await api.POST('/api/v1/products/{id}/units', {
            params: { path: { id: productId } },
            body,
          }),
        ),
      onSuccess: productChanged,
    }),
    updateUnit: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: Schemas['UnitUpdateRequest'] }) =>
        unwrap(await api.PATCH('/api/v1/product-units/{id}', { params: { path: { id } }, body })),
      onSuccess: productChanged,
    }),
    supersedeUnit: useMutation({
      mutationFn: async ({ id, factorToBase, key }: Keyed<{ id: number; factorToBase: string }>) =>
        unwrap(
          await api.POST('/api/v1/product-units/{id}/supersede', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { factorToBase },
          }),
        ),
      onSuccess: productChanged,
    }),
    retireUnit: useMutation({
      mutationFn: async ({ id, key }: Keyed<{ id: number }>) =>
        unwrap(
          await api.POST('/api/v1/product-units/{id}/retire', {
            params: { path: { id }, header: idempotencyKey(key) },
          }),
        ),
      onSuccess: productChanged,
    }),
    addBarcode: useMutation({
      mutationFn: async ({ unitId, code }: { unitId: number; code: string }) =>
        unwrap(
          await api.POST('/api/v1/product-units/{id}/barcodes', {
            params: { path: { id: unitId } },
            body: { code },
          }),
        ),
      onSuccess: productChanged,
    }),
    internalBarcode: useMutation({
      mutationFn: async ({ unitId, key }: Keyed<{ unitId: number }>) =>
        unwrap(
          await api.POST('/api/v1/product-units/{id}/internal-barcode', {
            params: { path: { id: unitId }, header: idempotencyKey(key) },
          }),
        ),
      onSuccess: productChanged,
    }),
    primaryBarcode: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/product-barcodes/{id}/primary', { params: { path: { id } } }),
        ),
      onSuccess: productChanged,
    }),
    deleteBarcode: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/product-barcodes/{id}', { params: { path: { id } } })),
      onSuccess: productChanged,
    }),
    attachImage: useMutation({
      mutationFn: async ({
        productId,
        imageFileId,
        thumbFileId,
      }: {
        productId: number;
        imageFileId: number;
        thumbFileId: number;
      }) =>
        unwrap(
          await api.POST('/api/v1/products/{id}/images', {
            params: { path: { id: productId } },
            body: { imageFileId, thumbFileId },
          }),
        ),
      onSuccess: productChanged,
    }),
    primaryImage: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/product-images/{id}/primary', { params: { path: { id } } })),
      onSuccess: productChanged,
    }),
    deleteImage: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/product-images/{id}', { params: { path: { id } } })),
      onSuccess: productChanged,
    }),
    assign: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<AssignRequest>) =>
        unwrap(
          await api.POST('/api/v1/catalog/ebarimt-readiness/assign', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: (_result, request) => (request.dryRun ? undefined : productChanged()),
    }),
  };
}
