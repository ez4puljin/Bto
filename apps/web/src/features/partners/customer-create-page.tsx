import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { problemFromError } from '@/lib/problem';
import { randomUuid } from '@/lib/uuid';
import { useNextCustomerCode, usePartnersMutations } from './api';
import { CustomerForm } from './customer-form';
import { type CustomerFormValues, customerCreateBody, emptyCustomer } from './partner-schema';

/**
 * A new customer with the first delivery address (SPEC §5.3). The code field starts with the next
 * free number; the office may type the code from the Excel sheet instead. One Idempotency-Key per
 * page: a resent save never creates a second customer.
 */
export function CustomerCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const nextCode = useNextCustomerCode();
  const mutations = usePartnersMutations();
  const [key] = useState(randomUuid);

  const create = async (values: CustomerFormValues) => {
    try {
      const customer = await mutations.createCustomer.mutateAsync({
        key,
        ...customerCreateBody(values, nextCode.data ?? ''),
      });
      await navigate(`/partners/customers/${customer.id}`);
      return null;
    } catch (error) {
      return problemFromError(error);
    }
  };
  const loadProblem = problemFromError(nextCode.error);

  return (
    <div>
      <PageHeader
        title={t('partners.customer.newTitle')}
        actions={
          <Button variant="outline" asChild>
            <Link to="/partners/customers">{t('common.back')}</Link>
          </Button>
        }
      />
      <ProblemAlert problem={loadProblem} />
      {nextCode.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <Card>
          <CardContent>
            <CustomerForm
              mode="create"
              defaultValues={emptyCustomer(nextCode.data ?? '')}
              submitLabel={t('common.save')}
              onSubmit={create}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
