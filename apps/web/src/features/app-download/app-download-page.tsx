import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useApiClient } from '@/app/api-client-context';
import { AuthLayout } from '@/features/auth/auth-layout';
import { Button } from '@/components/ui/button';
import { unwrap } from '@/lib/problem';

type Variant = 'staff' | 'customer';
const VARIANTS: Variant[] = ['staff', 'customer'];

function useLatestRelease(variant: Variant) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['app-releases', variant],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/app-releases/{variant}', { params: { path: { variant } }, signal }),
      ),
  });
}

function AppCard({ variant }: { variant: Variant }) {
  const { t } = useTranslation();
  const query = useLatestRelease(variant);
  const release = query.data?.release ?? null;
  return (
    <section
      aria-label={t(`appDownload.${variant}.title`)}
      className="rounded-2xl border bg-card p-5 shadow-control"
    >
      <h2 className="text-base font-semibold">{t(`appDownload.${variant}.title`)}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t(`appDownload.${variant}.note`)}</p>
      <div className="mt-4">
        {query.isPending ? (
          <div role="status" aria-busy className="h-10 animate-pulse rounded-lg bg-muted" />
        ) : query.isError ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-destructive">{t('appDownload.error')}</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('appDownload.retry')}
            </Button>
          </div>
        ) : release ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {t('appDownload.version', { version: release.version })}
              {' · '}
              {t('appDownload.size', { size: (release.sizeBytes / 1024 / 1024).toFixed(1) })}
            </p>
            <Button asChild size="lg" className="w-full">
              <a href={`/api/v1/app-releases/${variant}/apk`} download>
                {t('appDownload.download')}
              </a>
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('appDownload.none')}</p>
        )}
      </div>
    </section>
  );
}

/** The public page where anyone downloads the two Android apps (no sign-in). */
export function AppDownloadPage() {
  const { t } = useTranslation();
  return (
    <AuthLayout title={t('appDownload.title')}>
      <div className="flex flex-col gap-4">
        {VARIANTS.map((variant) => (
          <AppCard key={variant} variant={variant} />
        ))}
        <p className="text-sm text-muted-foreground">{t('appDownload.installNote')}</p>
        <p className="text-sm font-medium">{t('appDownload.androidOnly')}</p>
        <Link to="/login" className="text-center text-[0.8125rem] text-link hover:underline">
          {t('appDownload.backToLogin')}
        </Link>
      </div>
    </AuthLayout>
  );
}
