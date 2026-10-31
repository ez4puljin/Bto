import { TriangleAlert } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatCount, formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCustomerAppAttention } from '@/features/customer-app/api';
import { requestOf, useAppSettings, useSaveAppSettings } from './api';

/**
 * «Апп» → «Аппын захиалга» (ADR-0127): whether app orders have a stage to land on (ADR-0079 #5)
 * and how many stores have the app open, beside the order minimum the app enforces.
 */
export function AppOrdersPage() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader
        title={t('appSettings.orders.title')}
        description={t('appSettings.orders.description')}
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <OrdersCard />
        <MinimumCard />
      </div>
    </div>
  );
}

/**
 * «Аппын захиалга»: whether a stage without an action takes the CUSTOMER_APP channel (ADR-0079 #5,
 * set in the boards' «Сувгийн тохиргоо») and how many stores have the app open. Read-only.
 */
function OrdersCard() {
  const { t } = useTranslation();
  const attention = useCustomerAppAttention(true);
  const data = attention.data;
  return (
    <Card role="region" aria-label={t('customerApp.orders.title')}>
      <CardHeader>
        <CardTitle>{t('customerApp.orders.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={problemFromError(attention.error)} onRetry={attention.refetch} />
        {attention.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {data ? (
          <>
            {data.ordersOpen ? (
              <div className="flex flex-col gap-1.5">
                <Badge variant="success" className="self-start">
                  {t('customerApp.orders.open')}
                </Badge>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {t('customerApp.orders.openHint')}
                </p>
              </div>
            ) : (
              <Alert className="border-transparent bg-warning-soft shadow-none!">
                <TriangleAlert aria-hidden className="text-warning" />
                <AlertTitle className="text-warning">{t('customerApp.orders.closed')}</AlertTitle>
                <AlertDescription className="text-warning">
                  {t('customerApp.orders.closedHint')}
                </AlertDescription>
              </Alert>
            )}
            <p className="text-sm">
              {t('customerApp.orders.accounts', { n: formatCount(data.activeAccounts) })}
            </p>
            <Button asChild variant="link" size="sm" className="self-start px-0">
              <Link to="/sales/boards/settings">{t('customerApp.orders.settings')}</Link>
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

const WHOLE_MNT = /^\d{1,12}$/;

/**
 * «Захиалгын доод дүн»: one whole-MNT field, empty for none, saved with the whole row. Users
 * without customer.home.manage read the amount.
 */
function MinimumCard() {
  const { t } = useTranslation();
  const canManage = useHasPermission('customer.home.manage');
  const settings = useAppSettings();
  const save = useSaveAppSettings();
  const action = useAction();
  const data = settings.data;
  const [value, setValue] = useState('');
  const [error, setError] = useState<'validation.wholeMnt' | undefined>();
  const stored = data?.minOrderAmount ?? '';
  useEffect(() => setValue(stored), [stored]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!data) return;
    const trimmed = value.trim();
    if (trimmed !== '' && !WHOLE_MNT.test(trimmed)) {
      setError('validation.wholeMnt');
      return;
    }
    setError(undefined);
    const ok = await action.run(() =>
      save.mutateAsync({
        ...requestOf(data),
        minOrderAmount: trimmed === '' ? null : trimmed,
      }),
    );
    if (ok) toast.success(t('appSettings.orders.minimum.saved'));
  };

  return (
    <Card role="region" aria-label={t('appSettings.orders.minimum.title')}>
      <CardHeader>
        <CardTitle>{t('appSettings.orders.minimum.title')}</CardTitle>
        <CardDescription>{t('appSettings.orders.minimum.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={problemFromError(settings.error)} onRetry={settings.refetch} />
        <ProblemAlert problem={action.problem} />
        {settings.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {data && !canManage ? (
          <p className="text-sm">
            {data.minOrderAmount
              ? t('appSettings.orders.minimum.current', { amount: formatMnt(data.minOrderAmount) })
              : t('appSettings.orders.minimum.none')}
          </p>
        ) : null}
        {data && canManage ? (
          <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
            <FormSection>
              <FormRow
                label={t('appSettings.orders.minimum.amount')}
                htmlFor="app-min-order"
                hint={t('appSettings.orders.minimum.hint')}
                error={error}
              >
                <Input
                  id="app-min-order"
                  inputMode="numeric"
                  autoComplete="off"
                  className="font-mono sm:w-48"
                  value={value}
                  onChange={(event) => {
                    setError(undefined);
                    setValue(event.target.value);
                  }}
                />
              </FormRow>
            </FormSection>
            <FormFooter>
              <Button type="submit" pending={save.isPending} disabled={value.trim() === stored}>
                {t('common.save')}
              </Button>
            </FormFooter>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
