import { ChevronRight, Plus, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { FormRow, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useSegments } from '@/features/segments/api';
import { requestOf, useAppSettings, useSaveAppSettings } from './api';

/**
 * «Апп» → «Аппын бараа» (ADR-0127, customer.home.manage): the assortment — the one PRODUCT
 * segment both apps («Bto300» and the staff app) sell from, or every sale-ready product. Saved on
 * change; a segment that was archived since is flagged and the apps show everything meanwhile.
 */
export function AppProductsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('customer.home.manage');
  const settings = useAppSettings();
  const segments = useSegments('PRODUCT');
  const save = useSaveAppSettings();
  const action = useAction();
  const data = settings.data;
  const live = segments.data ?? [];
  const chosen = data?.assortment.segmentId ?? null;
  // A broken (archived) segment is not among the live ones: keep it selectable so the field
  // shows what the row still says.
  const brokenChoice =
    data?.assortment.broken && chosen !== null && !live.some((segment) => segment.id === chosen)
      ? { id: chosen, name: data.assortment.segmentName ?? String(chosen) }
      : null;

  const choose = async (value: string) => {
    if (!data) return;
    const ok = await action.run(() =>
      save.mutateAsync({
        ...requestOf(data),
        assortmentSegmentId: value === '' ? null : Number.parseInt(value, 10),
      }),
    );
    if (ok) toast.success(t('appSettings.products.saved'));
  };

  return (
    <div>
      <PageHeader
        title={t('appSettings.products.title')}
        description={t('appSettings.products.description')}
      />
      <Card role="region" aria-label={t('appSettings.products.assortment')}>
        <CardHeader>
          <CardTitle>{t('appSettings.products.assortment')}</CardTitle>
          <CardDescription>{t('appSettings.products.assortmentHint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ProblemAlert problem={problemFromError(settings.error)} onRetry={settings.refetch} />
          <ProblemAlert problem={problemFromError(segments.error)} onRetry={segments.refetch} />
          <ProblemAlert problem={action.problem} />
          {settings.isPending ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : null}
          {data?.assortment.broken ? (
            <Alert className="border-transparent bg-warning-soft shadow-none!">
              <TriangleAlert aria-hidden className="text-warning" />
              <AlertTitle className="text-warning">{t('appSettings.products.broken')}</AlertTitle>
              <AlertDescription className="text-warning">
                {t('appSettings.products.brokenHint')}
              </AlertDescription>
            </Alert>
          ) : null}
          {data ? (
            <FormSection>
              <FormRow label={t('appSettings.products.assortment')} htmlFor="app-assortment">
                <NativeSelect
                  id="app-assortment"
                  className="sm:w-80"
                  value={chosen === null ? '' : String(chosen)}
                  disabled={!canManage || save.isPending || !segments.isSuccess}
                  onChange={(event) => void choose(event.target.value)}
                >
                  <option value="">{t('appSettings.products.all')}</option>
                  {brokenChoice ? (
                    <option value={String(brokenChoice.id)}>{brokenChoice.name}</option>
                  ) : null}
                  {live.map((segment) => (
                    <option key={segment.id} value={String(segment.id)}>
                      {segment.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormRow>
            </FormSection>
          ) : null}
          {data ? (
            <p className="text-sm">
              {t('appSettings.products.count', { n: formatCount(data.shopProductCount) })}
            </p>
          ) : null}
          {!canManage ? (
            <p className="text-[0.8125rem] text-muted-foreground">{t('appSettings.readOnly')}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {chosen !== null && !data?.assortment.broken ? (
              <Button asChild variant="link" size="sm" className="px-0">
                <Link to={`/segments/${chosen}`}>
                  {t('appSettings.products.openSegment')}
                  <ChevronRight />
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="link" size="sm" className="px-0">
              <Link to="/segments/new?entity=PRODUCT">
                <Plus />
                {t('appSettings.products.newSegment')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
