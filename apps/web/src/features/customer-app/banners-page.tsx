import { zodResolver } from '@hookform/resolvers/zod';
import {
  BANNER_LINK_KINDS,
  BANNER_TITLE_MAX,
  type BannerLinkKind,
  type BannerState,
} from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ImageIcon,
  ImagePlus,
  LoaderCircle,
  Plus,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useApiClient } from '@/app/api-client-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  FilterBar,
  ListCard,
  RowAction,
  RowActions,
  RowActionSpacer,
  SegmentedControl,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BANNER_SIZE, cropToJpeg } from '@/lib/image-resize';
import { problemFromError, settle } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { uploadFile } from '@/lib/upload';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import { type ProductSummary, useCategories } from '@/features/catalog/api';
import { categoryPaths } from '@/features/catalog/category-tree';
import { ProductSearch } from '@/features/inventory/shared';
import { lastDayOf, validToOf } from '@/features/pricing/helpers';
import { useSegments } from '@/features/segments/api';
import { type Banner, useBannerMutations, useBanners } from './api';

const STATE_BADGES: Record<BannerState, 'success' | 'default' | 'secondary' | 'outline'> = {
  RUNNING: 'success',
  SCHEDULED: 'default',
  ENDED: 'secondary',
  ARCHIVED: 'outline',
};

const VIEWS = ['LIVE', 'ARCHIVED'] as const;
type View = (typeof VIEWS)[number];

/**
 * «Систем» → «Харилцагчийн апп» → «Баннер» (ADR-0092 #5, customer.home.manage): the banners
 * of «Bto300»'s home in the order the app shows them, with their link, period and state; moved
 * up or down, archived (asked first), or added in a dialog (`?new=1`). A banner is never edited.
 */
export function BannersPage() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('LIVE');
  const banners = useBanners(view === 'ARCHIVED');
  const mutations = useBannerMutations();
  const action = useAction();
  const [creating, setCreating] = useCreateParam();
  const [archiving, setArchiving] = useState<Banner | null>(null);
  const rows = banners.data ?? [];

  const move = (banner: Banner, direction: 'UP' | 'DOWN') =>
    void action.run(() => mutations.move.mutateAsync({ id: banner.id, direction }));
  const archive = async () => {
    if (!archiving) return;
    const ok = await action.run(() => mutations.archive.mutateAsync(archiving.id));
    if (!ok) return;
    setArchiving(null);
    toast.success(t('customerApp.banners.archived'));
  };

  return (
    <div>
      <PageHeader
        title={t('customerApp.banners.title')}
        description={t('customerApp.banners.description')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t('customerApp.banners.new')}
          </Button>
        }
      />
      <FilterBar>
        <SegmentedControl
          name={t('customerApp.banners.view')}
          options={VIEWS}
          value={view}
          label={(value) => t(`customerApp.banners.views.${value}`)}
          onChange={setView}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(banners.error)} />
      {archiving ? null : <ProblemAlert problem={action.problem} />}
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">{t('customerApp.banners.columns.picture')}</TableHead>
              <TableHead>{t('customerApp.banners.columns.title')}</TableHead>
              <TableHead>{t('customerApp.banners.columns.link')}</TableHead>
              <TableHead>{t('customerApp.banners.columns.period')}</TableHead>
              <TableHead>{t('customerApp.banners.columns.state')}</TableHead>
              {view === 'LIVE' ? (
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {banners.isPending ? <SkeletonRows columns={view === 'LIVE' ? 6 : 5} /> : null}
            {rows.map((banner, index) => (
              <TableRow key={banner.id}>
                <TableCell>
                  {banner.imageUrl ? (
                    <img
                      src={banner.imageUrl}
                      alt={banner.title}
                      className="aspect-[2/1] w-28 rounded-md border object-cover"
                    />
                  ) : (
                    <span className="flex aspect-[2/1] w-28 items-center justify-center rounded-md border bg-muted">
                      <ImageIcon aria-hidden className="size-4 text-muted-foreground" />
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-medium">{banner.title}</TableCell>
                <TableCell>
                  <BannerLink banner={banner} />
                </TableCell>
                <TableCell className="font-mono whitespace-nowrap">
                  {banner.validTo
                    ? t('customerApp.banners.period', {
                        from: banner.validFrom,
                        to: lastDayOf(banner.validTo),
                      })
                    : t('customerApp.banners.periodOpen', { from: banner.validFrom })}
                </TableCell>
                <TableCell>
                  <Badge variant={STATE_BADGES[banner.state]}>
                    {t(`customerApp.banners.states.${banner.state}`)}
                  </Badge>
                </TableCell>
                {view === 'LIVE' ? (
                  <RowActions>
                    {index > 0 ? (
                      <RowAction
                        icon={ArrowUp}
                        label={`${t('customerApp.banners.up')}: ${banner.title}`}
                        disabled={mutations.move.isPending}
                        onClick={() => move(banner, 'UP')}
                      />
                    ) : (
                      <RowActionSpacer />
                    )}
                    {index < rows.length - 1 ? (
                      <RowAction
                        icon={ArrowDown}
                        label={`${t('customerApp.banners.down')}: ${banner.title}`}
                        disabled={mutations.move.isPending}
                        onClick={() => move(banner, 'DOWN')}
                      />
                    ) : (
                      <RowActionSpacer />
                    )}
                    <RowAction
                      icon={Archive}
                      label={`${t('customerApp.banners.archive')}: ${banner.title}`}
                      destructive
                      onClick={() => setArchiving(banner)}
                    />
                  </RowActions>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {banners.isSuccess && rows.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title={
              view === 'LIVE'
                ? t('customerApp.banners.empty')
                : t('customerApp.banners.emptyArchived')
            }
            action={
              view === 'LIVE' ? (
                <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
                  <Plus />
                  {t('customerApp.banners.new')}
                </Button>
              ) : undefined
            }
          />
        ) : null}
      </ListCard>
      {creating ? <BannerDialog onClose={() => setCreating(false)} /> : null}
      <ConfirmDialog
        open={archiving !== null}
        title={t('customerApp.banners.archiveTitle', { title: archiving?.title ?? '' })}
        description={t('customerApp.banners.archiveDescription')}
        confirmLabel={t('customerApp.banners.archive')}
        variant="destructive"
        pending={mutations.archive.isPending}
        problem={action.problem}
        onConfirm={() => void archive()}
        onClose={() => {
          action.clear();
          setArchiving(null);
        }}
      />
    </div>
  );
}

/** What a tap opens, or that the target is gone (the app then shows the banner without it). */
function BannerLink({ banner }: { banner: Banner }) {
  const { t } = useTranslation();
  if (banner.linkKind === 'NONE') {
    return <span className="text-muted-foreground">{t('customerApp.banners.links.NONE')}</span>;
  }
  if (banner.linkBroken) {
    return (
      <Badge variant="warning" title={t('customerApp.banners.linkBrokenHint')}>
        {t('customerApp.banners.linkBroken')}
      </Badge>
    );
  }
  return (
    <span>
      {t('customerApp.banners.linkLabel', {
        kind: t(`customerApp.banners.links.${banner.linkKind}`),
        name: banner.linkName ?? '',
      })}
    </span>
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCEPT = 'image/jpeg,image/png,image/webp';

const bannerSchema = (today: string) =>
  z
    .object({
      title: z
        .string()
        .refine((value) => value.trim().length > 0, 'validation.required')
        .refine((value) => [...value.trim()].length <= BANNER_TITLE_MAX, 'validation.tooLong'),
      linkKind: z.enum(BANNER_LINK_KINDS),
      segmentId: z.string(),
      categoryId: z.string(),
      validFrom: z.string().regex(ISO_DATE, 'validation.date'),
      lastDay: z.string(),
    })
    .superRefine((values, ctx) => {
      if (values.linkKind === 'SEGMENT' && values.segmentId === '') {
        ctx.addIssue({ code: 'custom', path: ['segmentId'], message: 'validation.required' });
      }
      if (values.linkKind === 'CATEGORY' && values.categoryId === '') {
        ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'validation.required' });
      }
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
type BannerValues = z.infer<ReturnType<typeof bannerSchema>>;

interface Picture {
  fileId: number;
  previewUrl: string;
}

/**
 * «Баннер нэмэх» (ADR-0092 #5): the picture cut to 2:1 (1200×600) in the browser and uploaded at
 * once, a title (its alt text), what a tap opens — nothing, a product segment, a category or a
 * product on sale — and the first and last day. One Idempotency-Key per dialog.
 */
export function BannerDialog(props: { onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const mutations = useBannerMutations();
  const [today] = useState(businessDate);
  const [key] = useState(randomUuid);
  const schema = useMemo(() => bannerSchema(today), [today]);
  const form = useForm<BannerValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      linkKind: 'NONE',
      segmentId: '',
      categoryId: '',
      validFrom: today,
      lastDay: '',
    },
  });
  const watched = useWatch({ control: form.control });
  const linkKind: BannerLinkKind = watched.linkKind ?? 'NONE';
  const segments = useSegments('PRODUCT', { enabled: linkKind === 'SEGMENT' });
  const categories = useCategories();
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const [product, setProduct] = useState<ProductSummary | null>(null);
  const [productMissing, setProductMissing] = useState(false);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [pictureMissing, setPictureMissing] = useState(false);
  const [pictureFailed, setPictureFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
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
    setPictureMissing(false);
    setUploading(true);
    try {
      const blob = await cropToJpeg(file, BANNER_SIZE);
      const fileId = await uploadFile(api, 'customer.banner_image', blob);
      setPicture({ fileId, previewUrl: URL.createObjectURL(blob) });
    } catch {
      setPictureFailed(true);
    } finally {
      setUploading(false);
    }
  };

  /** The picture and the product are outside the form's schema: checked on every submit. */
  const checkOutside = () => {
    const needsProduct = form.getValues('linkKind') === 'PRODUCT' && product === null;
    setProductMissing(needsProduct);
    setPictureMissing(picture === null);
    return picture !== null && !needsProduct;
  };
  const submit = form.handleSubmit(async (values) => {
    if (!checkOutside() || !picture) return;
    const linkId =
      values.linkKind === 'SEGMENT'
        ? Number.parseInt(values.segmentId, 10)
        : values.linkKind === 'CATEGORY'
          ? Number.parseInt(values.categoryId, 10)
          : values.linkKind === 'PRODUCT'
            ? (product?.id ?? null)
            : null;
    const created = await settle(
      mutations.create.mutateAsync({
        key,
        imageFileId: picture.fileId,
        title: values.title.trim(),
        linkKind: values.linkKind,
        linkId,
        validFrom: values.validFrom,
        validTo: values.lastDay === '' ? null : validToOf(values.lastDay),
      }),
    );
    if (!created) return;
    toast.success(t('customerApp.banners.created'));
    props.onClose();
  }, checkOutside);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="md">
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{t('customerApp.banners.new')}</DialogTitle>
            <DialogDescription>{t('customerApp.banners.form.hint')}</DialogDescription>
          </DialogHeader>
          <ProblemAlert problem={problemFromError(mutations.create.error)} />
          <FormField
            label={t('customerApp.banners.form.picture')}
            htmlFor="banner-picture"
            hint={t('customerApp.banners.form.pictureHint')}
            error={
              pictureFailed
                ? 'validation.imageUnreadable'
                : pictureMissing
                  ? 'validation.required'
                  : undefined
            }
          >
            <input
              ref={fileInput}
              id="banner-picture"
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void choosePicture(file);
              }}
            />
            <div className="flex flex-col gap-2">
              {picture ? (
                <img
                  src={picture.previewUrl}
                  alt={t('customerApp.banners.form.picture')}
                  className="aspect-[2/1] w-full max-w-md rounded-md border object-cover"
                />
              ) : null}
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading ? <LoaderCircle className="animate-spin" /> : <ImagePlus />}
                  {uploading
                    ? t('customerApp.banners.form.uploading')
                    : picture
                      ? t('customerApp.banners.form.replace')
                      : t('customerApp.banners.form.choose')}
                </Button>
              </div>
            </div>
          </FormField>
          <FormField
            label={t('customerApp.banners.form.title')}
            htmlFor="banner-title"
            hint={t('customerApp.banners.form.titleHint', { max: BANNER_TITLE_MAX })}
            error={errors.title?.message}
          >
            <Input id="banner-title" autoComplete="off" {...form.register('title')} />
          </FormField>
          <FormField label={t('customerApp.banners.form.linkKind')} htmlFor="banner-link-kind">
            <NativeSelect id="banner-link-kind" {...form.register('linkKind')}>
              {BANNER_LINK_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`customerApp.banners.links.${kind}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {linkKind === 'SEGMENT' ? (
            <FormField
              label={t('customerApp.banners.links.SEGMENT')}
              htmlFor="banner-segment"
              hint={t('customerApp.banners.form.segmentHint')}
              error={errors.segmentId?.message}
            >
              <NativeSelect id="banner-segment" {...form.register('segmentId')}>
                <option value="">{t('customerApp.banners.form.chooseSegment')}</option>
                {(segments.data ?? []).map((segment) => (
                  <option key={segment.id} value={String(segment.id)}>
                    {segment.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
          {linkKind === 'CATEGORY' ? (
            <FormField
              label={t('customerApp.banners.links.CATEGORY')}
              htmlFor="banner-category"
              error={errors.categoryId?.message}
            >
              <NativeSelect id="banner-category" {...form.register('categoryId')}>
                <option value="">{t('customerApp.banners.form.chooseCategory')}</option>
                {[...paths.entries()]
                  .sort((a, b) => a[1].localeCompare(b[1], 'mn'))
                  .map(([id, path]) => (
                    <option key={id} value={String(id)}>
                      {path}
                    </option>
                  ))}
              </NativeSelect>
            </FormField>
          ) : null}
          {linkKind === 'PRODUCT' ? (
            <FormField
              label={t('customerApp.banners.links.PRODUCT')}
              htmlFor="banner-product"
              hint={t('customerApp.banners.form.productHint')}
              error={productMissing ? 'validation.required' : undefined}
            >
              {product ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
                  <span className="font-mono text-sm text-muted-foreground">{product.sku}</span>
                  <span className="text-sm">{product.name}</span>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="ml-auto text-muted-foreground"
                    aria-label={t('customerApp.banners.form.otherProduct')}
                    title={t('customerApp.banners.form.otherProduct')}
                    onClick={() => setProduct(null)}
                  >
                    <X />
                  </Button>
                </div>
              ) : (
                <ProductSearch
                  id="banner-product"
                  saleReady
                  pickLabel={t('customerApp.banners.form.pick')}
                  onPick={(picked) => {
                    setProduct(picked);
                    setProductMissing(false);
                  }}
                />
              )}
            </FormField>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label={t('customerApp.banners.form.validFrom')}
              htmlFor="banner-from"
              error={errors.validFrom?.message}
            >
              <Input id="banner-from" type="date" min={today} {...form.register('validFrom')} />
            </FormField>
            <FormField
              label={t('customerApp.banners.form.lastDay')}
              htmlFor="banner-last-day"
              hint={t('customerApp.banners.form.lastDayHint')}
              error={errors.lastDay?.message}
            >
              <Input
                id="banner-last-day"
                type="date"
                min={watched.validFrom || today}
                {...form.register('lastDay')}
              />
            </FormField>
          </div>
          <DialogFormFooter
            pending={isSubmitting}
            disabled={uploading}
            submitLabel={t('customerApp.banners.form.submit')}
            onCancel={props.onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
