import { ImagePlus, LoaderCircle, X } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/field-error';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ValidationMessage } from '@/lib/forms';
import { MAX_PHOTOS, type PhotoUploads } from './photo-uploads';

const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * The photo grid of a create form: square previews in the order chosen (the first is the primary
 * photo), each with its upload state and a remove button, then a tile that adds more. The hidden
 * file input carries `id`, so the form row's label names it.
 */
export function PhotoPicker(props: {
  id: string;
  uploads: PhotoUploads;
  error?: ValidationMessage | null;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const { photos, add, remove, problem, unsupported } = props.uploads;
  const errorId = `${props.id}-error`;

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        id={props.id}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        aria-describedby={props.error ? errorId : undefined}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void add(files);
        }}
      />
      <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
        {photos.map((photo, index) => (
          <li
            key={photo.key}
            className="relative overflow-hidden rounded-xl bg-fill ring-1 ring-black/[0.06]"
          >
            <img
              src={photo.preview}
              alt={t('catalog.registration.photoAlt', { number: index + 1 })}
              className="aspect-square w-full object-cover"
            />
            {index === 0 && photo.status !== 'failed' ? (
              <Badge className="absolute top-1.5 left-1.5 bg-white/90 text-foreground shadow-sm backdrop-blur-sm">
                {t('catalog.images.primary')}
              </Badge>
            ) : null}
            {photo.status === 'uploading' ? (
              <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-xs text-muted-foreground">
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                <span className="sr-only">{t('catalog.registration.photoUploading')}</span>
              </div>
            ) : null}
            {photo.status === 'failed' ? (
              <div className="absolute inset-x-0 bottom-0 bg-danger-soft py-1 pr-8 pl-1.5 text-xs text-destructive">
                {t('catalog.registration.photoFailed')}
              </div>
            ) : null}
            <Button
              type="button"
              size="icon-xs"
              variant="secondary"
              className="absolute right-1.5 bottom-1.5 bg-white/90 shadow-sm backdrop-blur-sm"
              aria-label={t('catalog.registration.removePhoto', { number: index + 1 })}
              title={t('catalog.registration.removePhoto', { number: index + 1 })}
              onClick={() => remove(photo.key)}
            >
              <X />
            </Button>
          </li>
        ))}
        {photos.length < MAX_PHOTOS ? (
          <li>
            <button
              type="button"
              className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground focus-visible:border-ring focus-visible:outline-none"
              onClick={() => input.current?.click()}
            >
              <ImagePlus aria-hidden className="size-5 opacity-70" />
              {t('catalog.registration.addPhotos')}
            </button>
          </li>
        ) : null}
      </ul>
      <FieldError id={errorId} message={props.error ?? undefined} />
      {unsupported ? (
        <Alert variant="destructive">
          <AlertDescription>{t('catalog.images.unsupported')}</AlertDescription>
        </Alert>
      ) : null}
      <ProblemAlert problem={problem} />
    </div>
  );
}
