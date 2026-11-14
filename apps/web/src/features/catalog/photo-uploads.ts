import type { ProblemDetails } from '@tugeel/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '@/app/api-client-context';
import type { ValidationMessage } from '@/lib/forms';
import { IMAGE_MAX_SIDE, resizeToJpeg, THUMB_MAX_SIDE } from '@/lib/image-resize';
import { problemFromError } from '@/lib/problem';
import { uploadFile } from '@/lib/upload';
import { randomUuid } from '@/lib/uuid';

/** At most this many photos per product (the API's MAX_PRODUCT_IMAGES). */
export const MAX_PHOTOS = 10;

/** A photo chosen in a form before the product exists, uploaded at once (ADR-0030). */
export interface PendingPhoto {
  key: string;
  /** Object URL of the thumbnail, for the preview. */
  preview: string;
  status: 'uploading' | 'ready' | 'failed';
  files: { imageFileId: number; thumbFileId: number } | null;
  /** Made by «AI ашиглах» from a photo (ADR-0198), not chosen as it is. */
  made?: boolean;
}

export type PhotoUploads = ReturnType<typeof usePhotoUploads>;

/** The form's message for its photos: at least one, all uploaded. */
export function photosMessage(photos: readonly PendingPhoto[]): ValidationMessage | null {
  if (photos.some((photo) => photo.status === 'uploading')) return 'validation.photosUploading';
  if (!photos.some((photo) => photo.status === 'ready')) return 'validation.photoRequired';
  return null;
}

/**
 * Photos of a form that creates a product: each file is scaled down to a photo and a thumbnail in
 * the browser and both are uploaded as soon as it is chosen, so saving only attaches them. The
 * previews' object URLs are released when a photo is removed, the form is reset or it unmounts.
 */
export function usePhotoUploads() {
  const api = useApiClient();
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const previews = useRef(new Set<string>());
  const count = useRef(0);

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const update = (key: string, change: Partial<PendingPhoto>) =>
    setPhotos((list) => list.map((photo) => (photo.key === key ? { ...photo, ...change } : photo)));

  const add = async (files: readonly File[]) => {
    setProblem(null);
    setUnsupported(false);
    for (const file of files) {
      if (count.current >= MAX_PHOTOS) break;
      let photo: Blob;
      let thumb: Blob;
      try {
        [photo, thumb] = await Promise.all([
          resizeToJpeg(file, IMAGE_MAX_SIDE),
          resizeToJpeg(file, THUMB_MAX_SIDE),
        ]);
      } catch {
        // HEIC on a desktop browser, a PDF, a broken file: skipped, the others still go.
        setUnsupported(true);
        continue;
      }
      const key = randomUuid();
      const preview = URL.createObjectURL(thumb);
      previews.current.add(preview);
      count.current += 1;
      setPhotos((list) => [...list, { key, preview, status: 'uploading', files: null }]);
      try {
        const imageFileId = await uploadFile(api, 'catalog.product_image', photo);
        const thumbFileId = await uploadFile(api, 'catalog.product_thumb', thumb);
        update(key, { status: 'ready', files: { imageFileId, thumbFileId } });
      } catch (error) {
        setProblem(problemFromError(error));
        update(key, { status: 'failed' });
      }
    }
  };

  /**
   * A picture made in the browser (the cut-out of «AI ашиглах», ADR-0198), put first so it is the
   * primary photo: uploaded like a chosen one. False when there is no room or the upload failed.
   */
  const addFirst = async (photo: Blob, thumb: Blob): Promise<boolean> => {
    if (count.current >= MAX_PHOTOS) return false;
    setProblem(null);
    const key = randomUuid();
    const preview = URL.createObjectURL(thumb);
    previews.current.add(preview);
    count.current += 1;
    setPhotos((list) => [{ key, preview, status: 'uploading', files: null, made: true }, ...list]);
    try {
      const imageFileId = await uploadFile(api, 'catalog.product_image', photo);
      const thumbFileId = await uploadFile(api, 'catalog.product_thumb', thumb);
      update(key, { status: 'ready', files: { imageFileId, thumbFileId } });
      return true;
    } catch (error) {
      setProblem(problemFromError(error));
      update(key, { status: 'failed' });
      return false;
    }
  };

  const remove = (key: string) => {
    const found = photos.find((photo) => photo.key === key);
    if (!found) return;
    URL.revokeObjectURL(found.preview);
    previews.current.delete(found.preview);
    count.current -= 1;
    setPhotos((list) => list.filter((photo) => photo.key !== key));
  };

  const reset = useCallback(() => {
    for (const url of previews.current) URL.revokeObjectURL(url);
    previews.current.clear();
    count.current = 0;
    setPhotos([]);
    setProblem(null);
    setUnsupported(false);
  }, []);

  return { photos, add, addFirst, remove, reset, problem, unsupported };
}
