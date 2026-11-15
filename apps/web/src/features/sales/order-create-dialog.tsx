import { defaultDeliveryDate, PAYMENT_METHODS, type PaymentMethod } from '@tugeel/shared/sales';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogFormFooter, FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CustomerPicker, type PickedCustomer } from '@/features/partners/customer-picker';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import { useSalesOrderMutations } from './api';
import { useBoardTree, usePipeline } from './pipelines-api';

/**
 * «Шинэ захиалга» (ADR-0059, as erxes adds a deal): the customer, how they pay and the pipeline; the
 * draft is created at once with its number and no lines (a pickup for tomorrow), then the order
 * panel opens on its products. From a stage's «+» the order lands in that stage.
 */
export function OrderCreateDialog({
  open,
  pipelineId,
  stageId,
  onClose,
  onCreated,
}: {
  open: boolean;
  pipelineId: number | null;
  stageId: number | null;
  onClose: () => void;
  onCreated: (orderId: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open ? (
        <CreateForm
          key={`${pipelineId ?? 0}:${stageId ?? 0}`}
          pipelineId={pipelineId}
          stageId={stageId}
          onClose={onClose}
          onCreated={onCreated}
        />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function CreateForm({
  pipelineId: wanted,
  stageId,
  onClose,
  onCreated,
}: {
  pipelineId: number | null;
  stageId: number | null;
  onClose: () => void;
  onCreated: (orderId: number) => void;
}) {
  const { t } = useTranslation();
  const tree = useBoardTree();
  const landing = usePipeline(stageId ? wanted : null);
  const stageName = landing.data?.stages.find((stage) => stage.id === stageId)?.name;
  const mutations = useSalesOrderMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [pipelineId, setPipelineId] = useState<number | null>(wanted);
  const [checked, setChecked] = useState(false);
  const choosesPipeline = (tree.data ?? []).some((board) => board.pipelines.length > 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!customer) return;
    void action.run(async () => {
      const created = await mutations.create.mutateAsync({
        key,
        body: {
          customerId: customer.id,
          pipelineId,
          stageId: pipelineId === wanted ? stageId : null,
          fulfilment: 'PICKUP',
          deliveryDate: defaultDeliveryDate(),
          addressId: null,
          contactName: null,
          contactPhone: null,
          paymentMethod,
          note: null,
          lines: [],
        },
      });
      onCreated(created.id);
    });
  };

  return (
    <DialogContent closeLabel={t('common.close')} size="md">
      <DialogHeader>
        <DialogTitle>{t('sales.create.title')}</DialogTitle>
        <DialogDescription>{t('sales.create.description')}</DialogDescription>
      </DialogHeader>
      {/*
        The dialog fits a 600px high window (ADR-0201): the two selects share a row where the form
        is wide enough, what comes and goes stands on a label's line, and the customer list gives
        way in a short window (the dialog around it is about 20rem, 2rem its margins).
      */}
      <form className="@container flex flex-col gap-4" onSubmit={submit} noValidate>
        <FormField
          label={t('sales.order.customer')}
          htmlFor="create-order-customer"
          hintBeside
          hint={
            checked && !customer ? (
              <span role="alert" className="text-destructive">
                {t('sales.create.customerRequired')}
              </span>
            ) : undefined
          }
        >
          <div className="[&_ul]:max-h-[min(19rem,calc(100svh-23rem))] [&_ul]:overflow-y-auto">
            <CustomerPicker
              id="create-order-customer"
              value={customer}
              onChange={setCustomer}
              invalid={checked && !customer}
            />
          </div>
        </FormField>
        <div className={cn('grid gap-4 *:min-w-0', choosesPipeline && '@md:grid-cols-2')}>
          <FormField label={t('sales.order.paymentMethod')} htmlFor="create-order-payment">
            <NativeSelect
              id="create-order-payment"
              value={paymentMethod}
              onChange={(event) => {
                const value = PAYMENT_METHODS.find((entry) => entry === event.target.value);
                if (value) setPaymentMethod(value);
              }}
            >
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {t(`sales.paymentMethods.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {choosesPipeline ? (
            <FormField
              label={t('sales.order.pipeline')}
              htmlFor="create-order-pipeline"
              hintBeside
              hint={
                stageName && pipelineId === wanted
                  ? t('sales.order.stageFixed', { name: stageName })
                  : undefined
              }
            >
              <NativeSelect
                id="create-order-pipeline"
                value={pipelineId ?? ''}
                onChange={(event) => setPipelineId(Number.parseInt(event.target.value, 10) || null)}
              >
                <option value="">{t('sales.order.defaultPipeline')}</option>
                {(tree.data ?? []).map((board) => (
                  <optgroup key={board.id} label={board.name}>
                    {board.pipelines
                      .filter((pipeline) => pipeline.archivedAt === null)
                      .map((pipeline) => (
                        <option key={pipeline.id} value={pipeline.id}>
                          {pipeline.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
        </div>
        <ProblemAlert problem={action.problem} />
        <DialogFormFooter
          pending={mutations.create.isPending}
          onCancel={onClose}
          submitLabel={t('sales.create.create')}
        />
      </form>
    </DialogContent>
  );
}
