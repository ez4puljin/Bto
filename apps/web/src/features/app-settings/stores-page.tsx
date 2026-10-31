import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useCustomerAppAttention } from '@/features/customer-app/api';

const FILTERS = ['ACTIVE', 'DISABLED', 'NONE'] as const;

/**
 * «Апп» → «Дэлгүүрүүд» (ADR-0127, partners.customers.read): how many stores have the app open and
 * the customer list filtered by the app account (ADR-0079 #11); a store is linked from its own
 * page's «Апп» card.
 */
export function AppStoresPage() {
  const { t } = useTranslation();
  const attention = useCustomerAppAttention(true);
  return (
    <div>
      <PageHeader
        title={t('appSettings.stores.title')}
        description={t('appSettings.stores.description')}
      />
      <Card role="region" aria-label={t('appSettings.stores.title')}>
        <CardHeader>
          <CardTitle>{t('appSettings.stores.title')}</CardTitle>
          <CardDescription>{t('appSettings.stores.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ProblemAlert problem={problemFromError(attention.error)} onRetry={attention.refetch} />
          {attention.isPending ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : null}
          {attention.data ? (
            <p className="text-sm">
              {t('appSettings.stores.active', { n: formatCount(attention.data.activeAccounts) })}
            </p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {FILTERS.map((filter) => (
              <li key={filter}>
                <Button asChild variant="link" size="sm" className="px-0">
                  <Link to={`/partners/customers?app=${filter}`}>
                    {t(`appSettings.stores.links.${filter}`)}
                    <ChevronRight />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
