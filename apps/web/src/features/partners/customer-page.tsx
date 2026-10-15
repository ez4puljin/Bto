import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DetailCard, FieldList } from '@/components/detail';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { CustomerBalanceCard } from '@/features/finance/customer-balance-card';
import { AddressesCard } from './addresses-card';
import { type CustomerDetail, useCustomer, usePartnersMutations } from './api';
import { ContactsCard } from './contacts-card';
import { CustomerFacts, CustomerForm } from './customer-form';
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

  const loadProblem = problemFromError(customer.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!customer.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  const detail = customer.data;

  const save = async (values: CustomerFormValues, close: () => void) => {
    try {
      await mutations.updateCustomer.mutateAsync({ id, body: customerUpdateBody(values, detail) });
      toast.success(t('partners.customer.saved'));
      close();
      return null;
    } catch (error) {
      return problemFromError(error);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={detail.name}
        meta={
          <>
            <span className="font-mono">{detail.code}</span>
            <Badge variant="outline">{t(`partners.kinds.${detail.kind}`)}</Badge>
            <Badge variant={detail.status === 'ACTIVE' ? 'success' : 'secondary'}>
              {t(`partners.status.${detail.status}`)}
            </Badge>
            {detail.tinPending ? (
              <Badge variant="warning">{t('partners.customer.tinPending')}</Badge>
            ) : null}
            {detail.creditHold ? (
              <Badge variant="destructive">{t('partners.credit.held')}</Badge>
            ) : null}
          </>
        }
      />
      <DetailCard
        title={t('partners.customer.info')}
        canEdit={canManage}
        view={<CustomerFacts customer={detail} />}
        edit={(close) => (
          <CustomerForm
            mode="edit"
            customer={detail}
            defaultValues={customerValues(detail)}
            submitLabel={t('common.save')}
            onCancel={close}
            onSubmit={(values) => save(values, close)}
          />
        )}
      />
      <CreditCard customer={detail} canEdit={canCredit} />
      <CustomerBalanceCard customerId={id} />
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
 * company setting) and the hold. Read first; accountants and admins change them with «Засах»
 * (ADR-0042), others only read them.
 */
function CreditCard(props: { customer: CustomerDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const { customer } = props;
  const termText = useTermText();
  return (
    <DetailCard
      title={t('partners.credit.title')}
      canEdit={props.canEdit}
      view={
        <div className="flex flex-col gap-3">
          <FieldList
            items={[
              {
                label: t('partners.credit.limit'),
                value:
                  customer.creditLimit === null
                    ? t('partners.credit.limitUndecided')
                    : formatMnt(customer.creditLimit),
              },
              { label: t('partners.credit.term'), value: termText(customer.paymentTerm) },
              {
                label: t('partners.credit.status'),
                value: customer.creditHold ? (
                  <Badge variant="destructive">{t('partners.credit.held')}</Badge>
                ) : (
                  t('partners.credit.open')
                ),
                hint: customer.creditHoldReason,
              },
            ]}
          />
          {props.canEdit ? null : (
            <p className="text-xs text-muted-foreground">{t('partners.credit.readOnly')}</p>
          )}
        </div>
      }
      edit={(close) => <CreditForm customer={customer} onClose={close} />}
    />
  );
}

function CreditForm(props: { customer: CustomerDetail; onClose: () => void }) {
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
    const ok = await action.run(() =>
      mutations.setCredit.mutateAsync({ id: customer.id, body: creditBody(values) }),
    );
    if (ok) {
      toast.success(t('common.saved'));
      props.onClose();
    }
  });

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={action.problem} />
      <FormSection>
        <FormRow
          label={t('partners.credit.limit')}
          htmlFor="credit-limit"
          hint={t('partners.credit.limitHint')}
          error={errors.creditLimit?.message}
        >
          <Input
            id="credit-limit"
            inputMode="decimal"
            autoComplete="off"
            className="font-mono sm:w-44"
            placeholder={t('partners.credit.limitUndecided')}
            {...form.register('creditLimit')}
          />
        </FormRow>
        <FormRow
          label={t('partners.credit.term')}
          htmlFor="credit-term"
          hint={
            customer.paymentTerm.source === 'CUSTOMER'
              ? t('partners.credit.termHint')
              : `${t('partners.credit.termHint')}. ${termText(customer.paymentTerm)}`
          }
          error={errors.paymentTermDays?.message}
        >
          <Input
            id="credit-term"
            inputMode="numeric"
            autoComplete="off"
            className="font-mono sm:w-28"
            {...form.register('paymentTermDays')}
          />
        </FormRow>
        <FormRow label={t('partners.credit.hold')} htmlFor="credit-hold" align="center">
          <Controller
            control={form.control}
            name="creditHold"
            render={({ field }) => (
              <Switch id="credit-hold" checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
        </FormRow>
        {held ? (
          <FormRow
            label={t('partners.credit.holdReason')}
            htmlFor="credit-hold-reason"
            error={errors.creditHoldReason?.message}
          >
            <Input
              id="credit-hold-reason"
              autoComplete="off"
              {...form.register('creditHoldReason')}
            />
          </FormRow>
        ) : null}
      </FormSection>
      <FormFooter>
        <Button type="button" variant="ghost" onClick={props.onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}
