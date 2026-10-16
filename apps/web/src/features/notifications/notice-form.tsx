import { zodResolver } from '@hookform/resolvers/zod';
import { NOTICE_KINDS, NOTICE_LIMITS, noticeTextLength } from '@tugeel/shared/notifications';
import { businessDate } from '@tugeel/shared/time';
import { ImagePlus, LoaderCircle, Package, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useApiClient } from '@/app/api-client-context';
import { DialogFormFooter, FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { ProductSummary } from '@/features/catalog/api';
import { ProductSearch } from '@/features/inventory/shared';
import { validToOf } from '@/features/pricing/helpers';
import { IMAGE_MAX_SIDE, resizeToJpeg } from '@/lib/image-resize';
import { problemFromError, settle } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { uploadFile } from '@/lib/upload';
import { randomUuid } from '@/lib/uuid';
import { type NoticeKind, useNoticeMutations } from './api';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCEPT = 'image/jpeg,image/png,image/webp';

const noticeSchema = (today: string) =>
  z
    .object({
      kind: z.enum(NOTICE_KINDS),
      title: z
        .string()
        .refine((value) => noticeTextLength(value) > 0, 'validation.required')
        .refine((value) => noticeTextLength(value) <= NOTICE_LIMITS.titleMax, 'validation.tooLong'),
      body: z
        .string()
        .refine((value) => noticeTextLength(value) > 0, 'validation.required')
        .refine((value) => noticeTextLength(value) <= NOTICE_LIMITS.bodyMax, 'validation.tooLong'),
      validFrom: z.string().regex(ISO_DATE, 'validation.date'),
      lastDay: z.string(),
      popup: z.boolean(),
    })
    .superRefine((values, ctx) => {
      if (ISO_DATE.test(values.validFrom) && values.validFrom < today) {
        ctx.addIssue({ code: 'custom', path: ['validFrom'], message: 'validation.notPast' });
      }
      if (values.lastDay !== '' && !ISO_DATE.test(values.lastDay)) {
        ctx.addIssue({ code: 'custom', path: ['lastDay'], message: 'validation.date' });
      } else if (values.lastDay !== '' && values.lastDay < values.validFrom) {
        ctx.addIssue({
          code: 'custom',
          path: ['lastDay'],
          message: 'validation.lastDayBeforeStart',
        });
      }
    });
type NoticeValues = z.infer<ReturnType<typeof noticeSchema>>;

interface Picture {
  fileId: number;
  previewUrl: string;
}

/**
 * «Шинэ мэдэгдэл» (ADR-0062 #1, notifications.send): kind, title, text, a picture resized in the
 * browser, up to 20 products on sale, the first and last day and the popup switch, with the
 * phone's popup drawn beside the form as it is typed. One Idempotency-Key per dialog.
 */
export function NoticeDialog(props: { onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const mutations = useNoticeMutations();
  const [today] = useState(businessDate);
  const [key] = useState(randomUuid);
  const schema = useMemo(() => noticeSchema(today), [today]);
  const form = useForm<NoticeValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: 'PROMOTION',
      title: '',
      body: '',
      validFrom: today,
      lastDay: '',
      popup: true,
    },
  });
  const watched = useWatch({ control: form.control });
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pictureFailed, setPictureFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewUrl = picture?.previewUrl;
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  const { errors, isSubmitting } = form.formState;

  const choosePicture = async (file: File) => {
    setPictureFailed(false);
    setUploading(true);
    try {
      const blob = await resizeToJpeg(file, IMAGE_MAX_SIDE);
      const fileId = await uploadFile(api, 'notifications.notice_image', blob);
      setPicture({ fileId, previewUrl: URL.createObjectURL(blob) });
    } catch {
      setPictureFailed(true);
    } finally {
      setUploading(false);
    }
  };

  const submit = form.handleSubmit(async (values) => {
    const created = await settle(
      mutations.create.mutateAsync({
        key,
        kind: values.kind,
        title: values.title.trim(),
        body: values.body.trim(),
        imageFileId: picture?.fileId ?? null,
        productIds: products.map((product) => product.id),
        validFrom: values.validFrom,
        validTo: values.lastDay === '' ? null : validToOf(values.lastDay),
        popup: values.popup,
      }),
    );
    if (!created) return;
    toast.success(t('notifications.sent'));
    props.onClose();
  });

  const full = products.length >= NOTICE_LIMITS.productsMax;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-4xl">
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{t('notifications.new')}</DialogTitle>
            <DialogDescription>{t('notifications.form.hint')}</DialogDescription>
          </DialogHeader>
          <ProblemAlert problem={problemFromError(mutations.create.error)} />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label={t('notifications.form.kind')} htmlFor="notice-kind">
                  <NativeSelect id="notice-kind" {...form.register('kind')}>
                    {NOTICE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`notifications.kinds.${kind}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <Controller
                  control={form.control}
                  name="popup"
                  render={({ field }) => (
                    <div className="flex items-center justify-between gap-3 self-end pb-1.5">
                      <Label htmlFor="notice-popup">{t('notifications.form.popup')}</Label>
                      <Switch
                        id="notice-popup"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </div>
                  )}
                />
              </div>
              <FormField
                label={t('notifications.form.title')}
                htmlFor="notice-title"
                hint={t('notifications.form.count', {
                  n: noticeTextLength(watched.title ?? ''),
                  max: NOTICE_LIMITS.titleMax,
                })}
                error={errors.title?.message}
              >
                <Input id="notice-title" autoComplete="off" {...form.register('title')} />
              </FormField>
              <FormField
                label={t('notifications.form.body')}
                htmlFor="notice-body"
                hint={t('notifications.form.count', {
                  n: noticeTextLength(watched.body ?? ''),
                  max: NOTICE_LIMITS.bodyMax,
                })}
                error={errors.body?.message}
              >
                <Textarea id="notice-body" rows={5} {...form.register('body')} />
              </FormField>
              <FormField
                label={t('notifications.form.image')}
                htmlFor="notice-image"
                hint={t('notifications.form.imageHint')}
                error={pictureFailed ? 'validation.imageUnreadable' : undefined}
              >
                <input
                  ref={fileInput}
                  id="notice-image"
                  type="file"
                  accept={ACCEPT}
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void choosePicture(file);
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  {picture ? (
                    <img
                      src={picture.previewUrl}
                      alt={t('notifications.form.image')}
                      className="h-16 w-28 rounded-md border object-cover"
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    {uploading ? <LoaderCircle className="animate-spin" /> : <ImagePlus />}
                    {uploading
                      ? t('notifications.form.uploading')
                      : picture
                        ? t('notifications.form.replaceImage')
                        : t('notifications.form.chooseImage')}
                  </Button>
                  {picture && !uploading ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPicture(null)}
                    >
                      <X />
                      {t('notifications.form.removeImage')}
                    </Button>
                  ) : null}
                </div>
              </FormField>
              <FormField
                label={t('notifications.form.products')}
                htmlFor="notice-products"
                hint={
                  full ? t('notifications.form.productsFull') : t('notifications.form.productsHint')
                }
              >
                {full ? null : (
                  <ProductSearch
                    id="notice-products"
                    saleReady
                    onPick={(product) =>
                      setProducts((list) =>
                        list.some((entry) => entry.id === product.id) ||
                        list.length >= NOTICE_LIMITS.productsMax
                          ? list
                          : [...list, product],
                      )
                    }
                  />
                )}
                {products.length > 0 ? (
                  <ol className="flex max-w-xl flex-col divide-y rounded-md border">
                    {products.map((product, index) => (
                      <li key={product.id} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="w-5 text-right font-mono text-xs text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="font-mono text-sm text-muted-foreground">
                          {product.sku}
                        </span>
                        <span className="text-sm">{product.name}</span>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="ml-auto text-muted-foreground"
                          aria-label={t('notifications.form.removeProduct', { name: product.name })}
                          onClick={() =>
                            setProducts((list) => list.filter((entry) => entry.id !== product.id))
                          }
                        >
                          <X />
                        </Button>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label={t('notifications.form.validFrom')}
                  htmlFor="notice-from"
                  error={errors.validFrom?.message}
                >
                  <Input id="notice-from" type="date" min={today} {...form.register('validFrom')} />
                </FormField>
                <FormField
                  label={t('notifications.form.lastDay')}
                  htmlFor="notice-last-day"
                  hint={t('notifications.form.lastDayHint')}
                  error={errors.lastDay?.message}
                >
                  <Input
                    id="notice-last-day"
                    type="date"
                    min={watched.validFrom || today}
                    {...form.register('lastDay')}
                  />
                </FormField>
              </div>
            </div>
            <PhonePreview
              kind={watched.kind ?? 'PROMOTION'}
              title={(watched.title ?? '').trim()}
              body={(watched.body ?? '').trim()}
              imageUrl={picture?.previewUrl ?? null}
              products={products.length}
            />
          </div>
          <DialogFormFooter
            pending={isSubmitting}
            disabled={uploading}
            submitLabel={t('notifications.send')}
            onCancel={props.onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The notice as the app pops it up (ADR-0062 #3), drawn while the admin types. */
function PhonePreview(props: {
  kind: NoticeKind;
  title: string;
  body: string;
  imageUrl: string | null;
  products: number;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('notifications.preview.title')} className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {t('notifications.preview.title')}
      </h3>
      <div className="flex min-h-[480px] items-center justify-center rounded-[36px] border-[6px] border-foreground/85 bg-foreground/45 p-4">
        <div className="w-full overflow-hidden rounded-2xl bg-card shadow-lg">
          {props.imageUrl ? (
            <img src={props.imageUrl} alt="" className="aspect-video w-full object-cover" />
          ) : (
            <div className="grid aspect-video w-full place-items-center bg-fill text-muted-foreground">
              <Package aria-hidden className="size-8" />
            </div>
          )}
          <div className="flex flex-col gap-2 p-4">
            <Badge variant="secondary" className="self-start">
              {t(`notifications.kinds.${props.kind}`)}
            </Badge>
            <p className="text-base font-semibold break-words">
              {props.title || t('notifications.preview.placeholderTitle')}
            </p>
            <p className="line-clamp-6 text-sm break-words whitespace-pre-line text-muted-foreground">
              {props.body || t('notifications.preview.placeholderBody')}
            </p>
            {props.products > 0 ? (
              <span className="mt-1 rounded-lg bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground">
                {t('notifications.preview.viewProducts', { n: props.products })}
              </span>
            ) : null}
            <span className="rounded-lg px-3 py-2 text-center text-sm text-link">
              {t('notifications.preview.close')}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
