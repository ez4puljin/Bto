import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { DetailCard } from '@/components/detail';
import { FormField, FormFooter } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useOrdererCandidates, useSetSupplierOrderer, useSupplierOrderer } from './api';

/**
 * «Захиалагч» on a supplier's page (ADR-0115): the staff member who orders from this supplier and
 * types its quantities; managers choose them. Shown only to people who read purchase orders.
 */
export function SupplierOrdererCard({ supplierId }: { supplierId: number }) {
  const canRead = useHasPermission('procurement.orders.read');
  return canRead ? <OrdererCard supplierId={supplierId} /> : null;
}

function OrdererCard({ supplierId }: { supplierId: number }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('procurement.orders.manage');
  const orderer = useSupplierOrderer(supplierId);
  return (
    <DetailCard
      title={t('procurement.orderer.title')}
      canEdit={canManage && orderer.data !== undefined}
      view={
        <div className="flex flex-col gap-2">
          <ProblemAlert problem={problemFromError(orderer.error)} onRetry={orderer.refetch} />
          {orderer.isPending ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : orderer.data ? (
            <>
              <p className={orderer.data.fullName ? 'font-medium' : 'text-muted-foreground'}>
                {orderer.data.fullName ?? t('procurement.orderer.none')}
              </p>
              <p className="text-xs text-muted-foreground">{t('procurement.orderer.hint')}</p>
            </>
          ) : null}
        </div>
      }
      edit={(close) => (
        <OrdererForm
          supplierId={supplierId}
          current={orderer.data?.userId ?? null}
          onClose={close}
        />
      )}
    />
  );
}

function OrdererForm(props: { supplierId: number; current: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const candidates = useOrdererCandidates(true);
  const save = useSetSupplierOrderer(props.supplierId);
  const action = useAction();
  const [value, setValue] = useState(props.current === null ? '' : String(props.current));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void action
          .run(async () => {
            await save.mutateAsync(value === '' ? null : Number.parseInt(value, 10));
            toast.success(t('procurement.orderer.saved'));
          })
          .then((done) => done && props.onClose());
      }}
    >
      <ProblemAlert problem={problemFromError(candidates.error)} onRetry={candidates.refetch} />
      <ProblemAlert problem={action.problem} />
      <FormField label={t('procurement.orderer.field')} htmlFor={`orderer-${props.supplierId}`}>
        <NativeSelect
          id={`orderer-${props.supplierId}`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="">{t('procurement.orderer.none')}</option>
          {(candidates.data ?? []).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.fullName}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormFooter>
        <Button type="button" variant="ghost" onClick={props.onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" pending={save.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}
