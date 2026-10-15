import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { openPrint, orderPrintPath } from './pipelines-api';
import { usePrintFormat } from './print-format';
import { PrintFormatToggle } from './print-format-toggle';
import type { Mover } from './use-mover';

/** A move's question (the reason of a CANCEL stage) and, after it, the stage's documents. */
export function MoveDialogs({
  mover,
  showProblem = true,
}: {
  mover: Mover;
  showProblem?: boolean;
}) {
  const { t } = useTranslation();
  const [format, setFormat] = usePrintFormat();
  return (
    <>
      {showProblem ? (
        <ProblemAlert problem={mover.pending || mover.print ? null : mover.problem} />
      ) : null}
      <ConfirmDialog
        open={mover.pending !== null}
        title={t('sales.order.cancelTitle')}
        description={t('sales.order.cancelDescription')}
        confirmLabel={t('sales.order.cancel')}
        disabled={!mover.reason.trim()}
        pending={mover.busy}
        problem={mover.problem}
        onConfirm={() => mover.confirm()}
        onClose={() => mover.cancel()}
      >
        <FormField label={t('sales.order.cancelReason')} htmlFor="move-cancel-reason">
          <Textarea
            id="move-cancel-reason"
            rows={2}
            value={mover.reason}
            onChange={(event) => mover.setReason(event.target.value)}
          />
        </FormField>
      </ConfirmDialog>
      <Dialog
        open={mover.print !== null}
        onOpenChange={(open) => (open ? undefined : mover.closePrint())}
      >
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('sales.boards.printTitle')}</DialogTitle>
            <DialogDescription>{t('sales.boards.printDescription')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <PrintFormatToggle value={format} onChange={setFormat} />
            {(mover.print?.kinds ?? []).map((kind) => (
              <Button
                key={kind}
                variant="outline"
                onClick={() =>
                  mover.print && openPrint(orderPrintPath(mover.print.orderId, kind, format))
                }
              >
                <Printer />
                {t(`sales.printKinds.${kind}`)}
              </Button>
            ))}
          </div>
          <DialogFooter closeLabel={t('common.close')} />
        </DialogContent>
      </Dialog>
    </>
  );
}
