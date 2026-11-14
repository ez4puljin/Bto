import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { File } from 'expo-file-system';
import { useSignedIn } from '../state/session';
import { ApiProblem, NETWORK, problemOf, unwrap } from './problem';

// «Бараа нэмэх» (ADR-0199): the lists the form chooses from, the photo upload, the reading and the
// finished image of «AI ашиглах», and the registration itself. Nothing is kept on the phone: a
// photo goes up as a private upload the moment it is used, and the form lives on the screen.

type Schemas = components['schemas'];
export type ProductAiStatus = Schemas['ProductAiStatus'];
export type ProductAiProposal = Schemas['ProductAiProposal'];
export type ProductAiImage = Schemas['ProductAiImage'];
export type RegistrationBody = Schemas['ProductRegistrationRequest'];
export type RegisteredProduct = Schemas['RegisteredProduct'];

const SUPPLIER_LIMIT = 30;

/** What «AI ашиглах» can do now: read photos, cut a picture out. */
export function useProductAiStatus() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['product-registration', 'ai-status'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/product-registrations/ai')),
    refetchOnMount: true,
  });
}

export function useRegistrationUoms() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['product-registration', 'uoms'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/uoms')).data,
  });
}

export function useRegistrationCategories() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['product-registration', 'categories'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/categories')).data,
    refetchOnMount: true,
  });
}

/** Active wholesale warehouses: a product's home is one of them (ADR-0044 #5). */
export function useHomeWarehouses() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['product-registration', 'warehouses'],
    queryFn: async () =>
      unwrap(await session.client.GET('/api/v1/warehouses')).data.filter(
        (warehouse) => warehouse.kind === 'WHOLESALE' && warehouse.status === 'ACTIVE',
      ),
  });
}

/** Active suppliers by name or code, for the picker. */
export function useSupplierSearch(q: string, enabled: boolean) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['product-registration', 'suppliers', q],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/suppliers', {
          params: { query: { ...(q ? { q } : {}), status: 'ACTIVE', limit: SUPPLIER_LIMIT } },
        }),
      ).data,
    enabled,
  });
}

/** The code the category suggests (ADR-0044 #1); asked again for every category and every save. */
export function useNextSku(categoryId: number | null) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['product-registration', 'next-sku', categoryId],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/products/next-sku', {
          params: { query: { categoryId: categoryId ?? 0 } },
        }),
      ).sku,
    enabled: categoryId !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * The calls of one run of «AI ашиглах». A photo is uploaded straight from its file (the camera's
 * JPEG, turned and scaled on the server); the reading and the image wait for outside services and
 * have their own, long time limit in the session.
 */
export function useProductAi() {
  const { session } = useSignedIn();

  const uploadPhoto = async (uri: string): Promise<number> => {
    const file = new File(uri);
    const issued = unwrap(
      await session.client.POST('/api/v1/files/presign', {
        body: { kind: 'catalog.ai_photo', contentType: 'image/jpeg', sizeBytes: file.size },
      }),
    );
    const url = issued.uploadUrl.startsWith('/')
      ? `${session.server}${issued.uploadUrl}`
      : issued.uploadUrl;
    let result: { status: number; body: string };
    try {
      result = await file.upload(url, { httpMethod: 'PUT', headers: issued.headers });
    } catch {
      throw new ApiProblem(NETWORK);
    }
    if (result.status < 200 || result.status >= 300) {
      throw new ApiProblem(problemOf(jsonOf(result.body), result.status));
    }
    return issued.fileId;
  };

  const read = async (photoFileIds: number[]): Promise<ProductAiProposal> =>
    unwrap(
      await session.client.POST('/api/v1/product-registrations/ai/read', {
        body: { photoFileIds },
      }),
    );

  const image = async (
    photoFileId: number,
    productBox: ProductAiProposal['productBox'],
  ): Promise<ProductAiImage> =>
    unwrap(
      await session.client.POST('/api/v1/product-registrations/ai/image', {
        body: { photoFileId, productBox },
      }),
    );

  return { uploadPhoto, read, image };
}

export function useRegisterProduct() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, body }: { key: string; body: RegistrationBody }) =>
      unwrap(
        await session.client.POST('/api/v1/product-registrations', {
          params: { header: idempotencyKey(key) },
          body,
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['shop'] }),
  });
}

/** A refusal's body as JSON, or null when it is none. */
function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
