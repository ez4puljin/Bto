import { useQuery } from '@tanstack/react-query';
import type { components, ProblemDetails } from '@tugeel/api-client';
import { useState } from 'react';
import { useApiClient } from '@/app/api-client-context';
import { IMAGE_MAX_SIDE, resizeToJpeg, THUMB_MAX_SIDE } from '@/lib/image-resize';
import { problemFromError, unwrap } from '@/lib/problem';
import { blobOfBase64, composeProductPicture } from '@/lib/product-picture';
import { uploadFile } from '@/lib/upload';
import { KEYS } from './api';
import type { PhotoUploads } from './photo-uploads';

type Schemas = components['schemas'];
export type ProductAiProposal = Schemas['ProductAiProposal'];
export type ProductAiStatus = Schemas['ProductAiStatus'];

/** Photos one reading takes at most (the API's MAX_AI_PHOTOS). */
export const MAX_AI_PHOTOS = 8;

/** Where a run is: resizing and uploading the photos, the model reading, the picture being made. */
export type ProductAiPhase = 'idle' | 'uploading' | 'reading' | 'picture';

/** How the catalogue picture of a run came out. */
export type ProductAiPicture =
  /** Cut out of its background, with the logo when one is uploaded. */
  | 'made'
  /** The photo as it was taken: no background service is set, or it failed. */
  | 'original'
  /** No picture was added (the form's photos are full, or the upload failed). */
  | 'none';

export interface ProductAiOutcome {
  /** The values the form was filled with; null when the photos were not read. */
  proposal: ProductAiProposal | null;
  picture: ProductAiPicture;
  /** Why the photos were not read, or the picture not cut out: the form still works by hand. */
  readProblem: ProblemDetails | null;
  pictureProblem: ProblemDetails | null;
  /** Chosen files the browser could not open (HEIC on a desktop, a PDF). */
  unsupported: number;
}

/** The status query's key: the settings screen refreshes it after a key is saved. */
export const PRODUCT_AI_STATUS_KEY = [...KEYS.products, 'ai-status'] as const;

/** What «AI ашиглах» can do now; the panel says what is not set (ADR-0198). */
export function useProductAiStatus() {
  const api = useApiClient();
  return useQuery({
    queryKey: PRODUCT_AI_STATUS_KEY,
    staleTime: 60_000,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/product-registrations/ai', { signal })),
  });
}

/**
 * One run of «AI ашиглах» (ADR-0198): the chosen photos are scaled down and uploaded privately,
 * the server's model reads them and the proposal goes to `apply` (the form), then the photo that
 * shows the product's front is cut out of its background, drawn on white with the logo and put
 * first among the form's photos. Each step that cannot run leaves the form as it was: without a
 * model nothing is filled in, without a background service the photo is kept as taken.
 */
export function useProductAi(options: {
  status: ProductAiStatus | undefined;
  uploads: PhotoUploads;
  apply: (proposal: ProductAiProposal) => void;
}) {
  const api = useApiClient();
  const [phase, setPhase] = useState<ProductAiPhase>('idle');
  const [outcome, setOutcome] = useState<ProductAiOutcome | null>(null);
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const { status, uploads, apply } = options;

  const run = async (files: readonly File[]) => {
    if (phase !== 'idle' || !status) return;
    setOutcome(null);
    setProblem(null);
    setPhase('uploading');
    try {
      const photos: { blob: Blob; fileId: number }[] = [];
      let unsupported = 0;
      for (const file of files.slice(0, MAX_AI_PHOTOS)) {
        let blob: Blob;
        try {
          blob = await resizeToJpeg(file, IMAGE_MAX_SIDE);
        } catch {
          unsupported += 1;
          continue;
        }
        photos.push({ blob, fileId: await uploadFile(api, 'catalog.ai_photo', blob) });
      }
      const [first] = photos;
      if (!first) {
        setOutcome({
          proposal: null,
          picture: 'none',
          readProblem: null,
          pictureProblem: null,
          unsupported,
        });
        return;
      }

      let proposal: ProductAiProposal | null = null;
      let readProblem: ProblemDetails | null = null;
      if (status.read) {
        setPhase('reading');
        try {
          proposal = unwrap(
            await api.POST('/api/v1/product-registrations/ai/read', {
              body: { photoFileIds: photos.map((photo) => photo.fileId) },
            }),
          );
          apply(proposal);
        } catch (error) {
          readProblem = problemFromError(error);
        }
      }

      setPhase('picture');
      const front = (proposal ? photos[proposal.frontPhoto] : undefined) ?? first;
      let made: Blob | null = null;
      let pictureProblem: ProblemDetails | null = null;
      if (status.picture) {
        try {
          const cut = unwrap(
            await api.POST('/api/v1/product-registrations/ai/picture', {
              body: { photoFileId: front.fileId },
            }),
          );
          made = await composeProductPicture(
            blobOfBase64(cut.image, 'image/png'),
            proposal?.productBox ?? null,
            cut.stamp ? blobOfBase64(cut.stamp.data, cut.stamp.mediaType) : null,
          );
        } catch (error) {
          pictureProblem = problemFromError(error);
        }
      }
      const picture = made ?? front.blob;
      const added = await uploads.addFirst(picture, await resizeToJpeg(picture, THUMB_MAX_SIDE));
      setOutcome({
        proposal,
        picture: !added ? 'none' : made ? 'made' : 'original',
        readProblem,
        pictureProblem,
        unsupported,
      });
    } catch (error) {
      // An upload that failed, or anything unforeseen: nothing was filled in.
      setProblem(problemFromError(error));
    } finally {
      setPhase('idle');
    }
  };

  /** Forgets the last run's lines: the product they spoke of is registered. */
  const clear = () => {
    setOutcome(null);
    setProblem(null);
  };

  return { phase, outcome, problem, run, clear };
}
