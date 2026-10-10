import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/app/api-client-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IMAGE_MAX_SIDE, resizeToJpeg, THUMB_MAX_SIDE } from '@/lib/image-resize';
import { uploadFile } from '@/lib/upload';
import { useAction } from '@/lib/use-action';
import { type ProductDetail, type ProductImage, useCatalogMutations } from './api';

const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Product photos (ADR-0030): each file is scaled down in the browser to a photo and a thumbnail,
 * both uploaded through presigned URLs, then attached in one call. Phones offer the camera here.
 */
export function ImagesCard({ product, canManage }: { product: ProductDetail; canManage: boolean }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const mutations = useCatalogMutations();
  const action = useAction();
  const deleteAction = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [deleting, setDeleting] = useState<ProductImage | null>(null);

  const addFiles = async (files: readonly File[]) => {
    setUnsupported(false);
    action.clear();
    setUploading(true);
    try {
      for (const file of files) {
        let photo: Blob;
        let thumb: Blob;
        try {
          [photo, thumb] = await Promise.all([
            resizeToJpeg(file, IMAGE_MAX_SIDE),
            resizeToJpeg(file, THUMB_MAX_SIDE),
          ]);
        } catch {
          // HEIC on a desktop browser, a PDF, a broken file: nothing was uploaded.
          setUnsupported(true);
          break;
        }
        const ok = await action.run(async () => {
          const imageFileId = await uploadFile(api, 'catalog.product_image', photo);
          const thumbFileId = await uploadFile(api, 'catalog.product_thumb', thumb);
          await mutations.attachImage.mutateAsync({
            productId: product.id,
            imageFileId,
            thumbFileId,
          });
        });
        if (!ok) break;
      }
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('catalog.images.title')}</CardTitle>
        {canManage ? (
          <CardAction>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(event) => void addFiles(Array.from(event.target.files ?? []))}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => input.current?.click()}
            >
              <ImagePlus />
              {uploading ? t('catalog.images.uploading') : t('catalog.images.upload')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {unsupported ? (
          <Alert variant="destructive">
            <AlertDescription>{t('catalog.images.unsupported')}</AlertDescription>
          </Alert>
        ) : null}
        <ProblemAlert problem={action.problem} />
        {product.images.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('catalog.images.empty')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {product.images.map((image) => (
              <li key={image.id} className="flex flex-col gap-2 rounded-lg border p-2">
                {image.url ? (
                  <a href={image.url} target="_blank" rel="noreferrer">
                    <img
                      src={image.thumbUrl ?? image.url}
                      alt={t('catalog.images.alt', { name: product.name })}
                      loading="lazy"
                      className="aspect-square w-full rounded-md object-cover"
                    />
                  </a>
                ) : null}
                <div className="flex flex-wrap items-center gap-1">
                  {image.isPrimary ? (
                    <Badge variant="secondary">{t('catalog.images.primary')}</Badge>
                  ) : canManage ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        void action.run(() => mutations.primaryImage.mutateAsync(image.id))
                      }
                    >
                      {t('catalog.images.makePrimary')}
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="ml-auto"
                      aria-label={t('catalog.images.delete')}
                      onClick={() => {
                        deleteAction.clear();
                        setDeleting(image);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={deleting !== null}
        title={t('catalog.images.delete')}
        description={t('catalog.images.deleteConfirm')}
        confirmLabel={t('common.delete')}
        pending={mutations.deleteImage.isPending}
        problem={deleteAction.problem}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          void deleteAction
            .run(() => mutations.deleteImage.mutateAsync(deleting.id))
            .then((ok) => (ok ? setDeleting(null) : undefined));
        }}
      />
    </Card>
  );
}
