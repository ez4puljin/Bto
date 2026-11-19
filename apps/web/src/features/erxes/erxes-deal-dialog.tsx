import { Link2Off } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProductSearch } from '@/features/inventory/shared';
import { CustomerPicker } from '@/features/partners/customer-picker';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type ErxesDeal, type ErxesDealLine, useErxesDeal, useErxesDealActions } from './api';
import { ErxesDealView } from './erxes-deal-view';
import { useIssueText } from './erxes-texts';

/** Reasons a person settles by choosing a Bto product for the line. */
const PRODUCT_REASONS = ['PRODUCT_NOT_FOUND', 'PRODUCT_AMBIGUOUS', 'UNIT_NOT_FOUND'];

/**
 * A deal of the list «Erxes-ээс ирсэн» (ADR-0218 #6): what erxes holds, why it waits, the
 * customer and the products a person may choose for it, and «Bto руу хуулах».
 */
export function ErxesDealDialog(props: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const deal = useErxesDeal(props.id);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="xl" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('erxes.deal.title')}</DialogTitle>
          <DialogDescription>{t('erxes.deal.dialogDescription')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert
          problem={problemFromError(deal.error)}
          onRetry={deal.error ? deal.refetch : undefined}
        />
        {deal.data ? <DealBody deal={deal.data} onClose={props.onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DealBody({ deal, onClose }: { deal: ErxesDeal; onClose: () => void }) {
  const { t } = useTranslation();
  const actions = useErxesDealActions();
  const action = useAction();
  const issueText = useIssueText();
  const [picking, setPicking] = useState<string | null>(null);
  const waiting = deal.status === 'WAITING';
  const busy =
    actions.choose.isPending ||
    actions.copy.isPending ||
    actions.dismiss.isPending ||
    actions.restore.isPending;
  const troubled = new Set(
    deal.issues.flatMap((issue) =>
      PRODUCT_REASONS.includes(issue.reason) && issue.erxesProductId ? [issue.erxesProductId] : [],
    ),
  );

  const copy = () =>
    void action.run(async () => {
      const after = await actions.copy.mutateAsync(deal.id);
      if (after.status === 'COPIED') toast.success(t('erxes.deal.copied'));
      else toast.warning(t('erxes.deal.stillWaiting'));
    });
  const chooseCustomer = (customerId: number | null) =>
    void action.run(() => actions.choose.mutateAsync({ id: deal.id, body: { customerId } }));
  const chooseUnit = (erxesProductId: string, productUnitId: number | null) =>
    void action.run(async () => {
      await actions.choose.mutateAsync({
        id: deal.id,
        body: { units: [{ erxesProductId, productUnitId }] },
      });
      setPicking(null);
    });
  const setAside = () =>
    void action.run(async () => {
      await actions.dismiss.mutateAsync(deal.id);
      toast.success(t('erxes.deal.dismissed'));
      onClose();
    });
  const takeBack = () => void action.run(() => actions.restore.mutateAsync(deal.id));

  const lineAction = (line: ErxesDealLine) => {
    const id = line.erxesProductId;
    if (!waiting || id === null || (!troubled.has(id) && !line.unit)) return null;
    if (picking === id) {
      return (
        <ProductSearch
          autoFocus
          className="mt-1 max-w-xs"
          pickLabel={t('erxes.deal.choose')}
          onPick={(product) => chooseUnit(id, product.baseUnit.id)}
        />
      );
    }
    return (
      <span className="ml-1 inline-flex gap-1">
        <Button type="button" size="sm" variant="outline" onClick={() => setPicking(id)}>
          {t(line.unit ? 'erxes.deal.changeProduct' : 'erxes.deal.chooseProduct')}
        </Button>
        {line.unit ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t('erxes.deal.clearProduct')}
            onClick={() => chooseUnit(id, null)}
          >
            <Link2Off />
          </Button>
        ) : null}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {waiting && deal.issues.length > 0 ? (
        <Alert>
          <AlertDescription>
            <p className="font-medium">{t('erxes.deal.whyWaiting')}</p>
            <ul className="mt-1 list-disc pl-5">
              {deal.issues.map((issue, index) => (
                <li key={`${issue.reason}-${index}`}>{issueText(issue)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {deal.status === 'COPIED' && deal.orderId !== null ? (
        <Alert>
          <AlertDescription>
            <Link
              to={`/sales/orders/${deal.orderId}`}
              className="text-link underline-offset-4 hover:underline"
            >
              {t('erxes.openOrder')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {waiting ? (
        <FormField
          label={t('erxes.deal.btoCustomer')}
          htmlFor="erxes-deal-customer"
          hint={t('erxes.deal.btoCustomerHint')}
        >
          <CustomerPicker
            id="erxes-deal-customer"
            searchFirst
            value={deal.customer}
            onChange={(customer) => chooseCustomer(customer?.id ?? null)}
          />
        </FormField>
      ) : null}
      <ErxesDealView deal={deal} lineAction={lineAction} />
      <ProblemAlert problem={action.problem} />
      <DialogFooter>
        {waiting ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={setAside}>
            {t('erxes.deal.dismiss')}
          </Button>
        ) : null}
        {deal.status === 'DISMISSED' ? (
          <Button type="button" variant="outline" disabled={busy} onClick={takeBack}>
            {t('erxes.deal.restore')}
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common.close')}
        </Button>
        {waiting ? (
          <Button type="button" pending={actions.copy.isPending} disabled={busy} onClick={copy}>
            {t('erxes.deal.copy')}
          </Button>
        ) : null}
      </DialogFooter>
    </div>
  );
}
