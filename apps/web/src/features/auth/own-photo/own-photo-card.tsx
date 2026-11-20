import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/app/api-client-context';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/features/hr/hr-kit';
import { CATEGORY_PICTURE_SIZE, cropToJpeg, UnsupportedImageError } from '@/lib/image-resize';
import { problemFromError, unwrap } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { uploadFile } from '@/lib/upload';

const ACCEPT = 'image/*';
const KEY = ['hr', 'me', 'profile'] as const;

/** The signed-in person's own photo: shown round, changed through «Зураг солих» (ADR-0209). */
export function OwnPhotoCard({ name }: { name: string }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const profile = useQuery({
    queryKey: KEY,
    queryFn: async () => unwrap(await api.GET('/api/v1/hr/me/profile')),
    staleTime: 15_000,
    retry: false,
  });
  const change = useMutation({
    mutationFn: async (file: File) => {
      const blob = await cropToJpeg(file, CATEGORY_PICTURE_SIZE);
      const fileId = await uploadFile(api, 'hr.employee_photo', blob);
      return unwrap(await api.PUT('/api/v1/hr/me/photo', { body: { fileId } }));
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(KEY, updated);
      void queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(t('auth.account.photoChanged'));
    },
  });
  const open = () => fileInput.current?.click();

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border/90 px-3.5 py-3">
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        hidden
        aria-label={t('auth.account.photoChange')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) change.mutate(file);
        }}
      />
      <button
        type="button"
        onClick={open}
        disabled={change.isPending}
        aria-label={t('auth.account.photoChange')}
        className="relative inline-flex min-h-11 min-w-11 shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
      >
        <Avatar name={name} src={profile.data?.photoUrl} className="size-20 text-xl" />
        <span className="absolute right-0 bottom-0 flex size-7 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
          <Camera className="size-3.5" aria-hidden />
        </span>
      </button>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Button type="button" variant="outline" pending={change.isPending} onClick={open}>
          <Camera />
          {t('auth.account.photoChange')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('auth.account.photoHint')}</p>
        {change.error instanceof UnsupportedImageError ? (
          <p role="alert" className="text-xs text-destructive">
            {t('validation.imageUnreadable')}
          </p>
        ) : (
          <ProblemAlert problem={problemFromError(change.error)} />
        )}
      </div>
    </div>
  );
}
