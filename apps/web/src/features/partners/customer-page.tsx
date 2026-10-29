import { zodResolver } from '@hookform/resolvers/zod';
import { SETTLEMENT_GROUPS } from '@tugeel/shared/finance';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DetailCard, FieldList } from '@/components/detail';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { CustomerBalanceCard } from '@/features/finance/customer-balance-card';
import { AddressesCard } from './addresses-card';
import { type CustomerDetail, useCustomer, usePartnersMutations } from './api';
import { CustomerAppCard } from './customer-app-card';
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

/**
 * One customer: data and delivery addresses, then from `xl` on a side column with the credit
 * terms, the balance («Тооцоо», finance), the customer app («Апп», ADR-0079 #11) and the contacts
 * (SPEC §5.3, ADR-0066).
 */
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
    <div>
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
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
          <AddressesCard customer={detail} canManage={canManage} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <CreditCard customer={detail} canEdit={canCredit} />
          <CustomerBalanceCard customerId={id} />
          <CustomerAppCard customerId={id} />
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
      </div>
    </div>
  );
}

/**
 * Credit terms (SPEC §5.3, §6): the limit (empty = not decided yet), the settlement group its
 * invoices fall due by (ADR-0101) and the hold. Read first; accountants and admins change them
 * with «Засах» (ADR-0042), others only read them.
 */
function CreditCard(props: { customer: CustomerDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const { customer } = props;
  return (
    <DetailCard
      title={t('partners.credit.title')}
      canEdit={props.canEdit}
      view={
        <div className="flex flex-col gap-3">
          <FieldList
            items={[
              {
                // The value carries «₮» and «хоног»: the read view drops the form's units.
                label: t('partners.customers.columns.creditLimit'),
                value:
                  customer.creditLimit === null ? (
                    t('partners.credit.limitUndecided')
                  ) : (
                    <span className="font-mono">{formatTugrik(customer.creditLimit)}</span>
                  ),
              },
              {
                label: t('partners.settlement.group'),
                value: t(`partners.settlement.groups.${customer.settlementGroup}`),
                hint: t(`partners.settlement.rules.${customer.settlementGroup}`),
              },
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
          label={t('partners.settlement.group')}
          htmlFor="credit-settlement-group"
          hint={t(`partners.settlement.rules.${form.watch('settlementGroup')}`)}
        >
          <NativeSelect
            id="credit-settlement-group"
            className="sm:w-56"
            {...form.register('settlementGroup')}
          >
            {SETTLEMENT_GROUPS.map((value) => (
              <option key={value} value={value}>
                {t(`partners.settlement.groups.${value}`)}
              </option>
            ))}
          </NativeSelect>
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
