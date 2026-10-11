import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { FieldError } from '@/components/field-error';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { AddressesCard } from './addresses-card';
import { type CustomerDetail, useCustomer, usePartnersMutations } from './api';
import { ContactsCard } from './contacts-card';
import { CustomerForm } from './customer-form';
import {
  type CreditFormValues,
  type CustomerFormValues,
  creditBody,
  creditSchema,
  creditValues,
  customerUpdateBody,
  customerValues,
} from './partner-schema';

/** One customer: data, credit terms, delivery addresses and contacts (SPEC §5.3). */
export function CustomerPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const canManage = useHasPermission('partners.customers.manage');
  const canCredit = useHasPermission('partners.credit.manage');
  const customer = useCustomer(id);
  const mutations = usePartnersMutations();
  /** Which form the last save came from; both remount with the stored values after a save. */
  const [saved, setSaved] = useState<'info' | 'credit' | null>(null);

  const loadProblem = problemFromError(customer.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!customer.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  const detail = customer.data;

  const save = async (values: CustomerFormValues) => {
    setSaved(null);
    try {
      await mutations.updateCustomer.mutateAsync({ id, body: customerUpdateBody(values, detail) });
      setSaved('info');
      return null;
    } catch (error) {
      return problemFromError(error);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={detail.name}
        actions={
          <Button variant="outline" asChild>
            <Link to="/partners/customers">{t('common.back')}</Link>
          </Button>
        }
      />
      <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-muted-foreground">{detail.code}</span>
        <Badge variant="outline">{t(`partners.kinds.${detail.kind}`)}</Badge>
        <Badge variant={detail.status === 'ACTIVE' ? 'secondary' : 'outline'}>
          {t(`partners.status.${detail.status}`)}
        </Badge>
        {detail.tinPending ? (
          <Badge variant="outline">{t('partners.customer.tinPending')}</Badge>
        ) : null}
        {detail.creditHold ? (
          <Badge variant="destructive">{t('partners.credit.held')}</Badge>
        ) : null}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('partners.customer.info')}</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerForm
            // A saved customer comes back with a new updatedAt: start from the stored values.
            key={detail.updatedAt}
            mode="edit"
            customer={detail}
            defaultValues={customerValues(detail)}
            readOnly={!canManage}
            submitLabel={t('common.save')}
            saved={saved === 'info'}
            onSubmit={save}
          />
        </CardContent>
      </Card>
      <CreditCard
        key={detail.updatedAt}
        customer={detail}
        canEdit={canCredit}
        saved={saved === 'credit'}
        onSubmit={() => setSaved(null)}
        onSaved={() => setSaved('credit')}
      />
      <AddressesCard customer={detail} canManage={canManage} />
      <ContactsCard
        contacts={detail.contacts}
        canManage={canManage}
        onAdd={(body) => mutations.addCustomerContact.mutateAsync({ ownerId: id, body })}
        onUpdate={(contactId, body) =>
          mutations.updateCustomerContact.mutateAsync({ id: contactId, body })
        }
        onDelete={(contactId) => mutations.deleteCustomerContact.mutateAsync(contactId)}
      />
    </div>
  );
}

/** The payment term in words: the customer's own days, the company setting, or not set yet. */
function useTermText() {
  const { t } = useTranslation();
  return (term: CustomerDetail['paymentTerm']) => {
    if (term.source === 'UNSET' || term.days === null) return t('partners.credit.termUnset');
    return term.source === 'CUSTOMER'
      ? t('partners.credit.termCustomer', { days: term.days })
      : t('partners.credit.termDefault', { days: term.days });
  };
}

/**
 * Credit terms (SPEC §5.3, §6): the limit (empty = not decided yet), the payment term (empty = the
 * company setting) and the hold. Accountants and admins change them; others only read them.
 */
function CreditCard(props: {
  customer: CustomerDetail;
  canEdit: boolean;
  saved: boolean;
  onSubmit: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { customer } = props;
  const termText = useTermText();
  const mutations = usePartnersMutations();
  const action = useAction();
  const form = useForm<CreditFormValues>({
    resolver: zodResolver(creditSchema),
    defaultValues: creditValues(customer),
  });
  const { errors, isSubmitting } = form.formState;
  const held = form.watch('creditHold');
  const submit = form.handleSubmit(async (values) => {
    props.onSubmit();
    const ok = await action.run(() =>
      mutations.setCredit.mutateAsync({ id: customer.id, body: creditBody(values) }),
    );
    if (ok) props.onSaved();
  });

  if (!props.canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('partners.credit.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{t('partners.credit.limit')}</dt>
            <dd>
              {customer.creditLimit === null
                ? t('partners.credit.limitUndecided')
                : formatMnt(customer.creditLimit)}
            </dd>
            <dt className="text-muted-foreground">{t('partners.credit.term')}</dt>
            <dd>{termText(customer.paymentTerm)}</dd>
            <dt className="text-muted-foreground">{t('partners.credit.hold')}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {customer.creditHold ? (
                <Badge variant="destructive">{t('partners.credit.held')}</Badge>
              ) : (
                t('partners.credit.open')
              )}
              {customer.creditHoldReason ? (
                <span className="text-muted-foreground">{customer.creditHoldReason}</span>
              ) : null}
            </dd>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{t('partners.credit.readOnly')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('partners.credit.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="credit-limit">{t('partners.credit.limit')}</Label>
              <Input
                id="credit-limit"
                inputMode="decimal"
                autoComplete="off"
                placeholder={t('partners.credit.limitUndecided')}
                {...form.register('creditLimit')}
              />
              <p className="text-xs text-muted-foreground">{t('partners.credit.limitHint')}</p>
              <FieldError message={errors.creditLimit?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="credit-term">{t('partners.credit.term')}</Label>
              <Input
                id="credit-term"
                inputMode="numeric"
                autoComplete="off"
                {...form.register('paymentTermDays')}
              />
              <p className="text-xs text-muted-foreground">
                {customer.paymentTerm.source === 'CUSTOMER'
                  ? t('partners.credit.termHint')
                  : `${t('partners.credit.termHint')}. ${termText(customer.paymentTerm)}`}
              </p>
              <FieldError message={errors.paymentTermDays?.message} />
            </div>
            <Controller
              control={form.control}
              name="creditHold"
              render={({ field }) => (
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Checkbox
                    id="credit-hold"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                  <Label htmlFor="credit-hold" className="font-normal">
                    {t('partners.credit.hold')}
                  </Label>
                </div>
              )}
            />
            {held ? (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="credit-hold-reason">{t('partners.credit.holdReason')}</Label>
                <Input
                  id="credit-hold-reason"
                  autoComplete="off"
                  {...form.register('creditHoldReason')}
                />
                <FieldError message={errors.creditHoldReason?.message} />
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
            {props.saved ? (
              <span role="status" className="text-sm text-muted-foreground">
                {t('common.saved')}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
