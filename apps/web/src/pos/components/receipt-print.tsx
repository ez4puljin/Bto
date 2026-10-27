import type { EdgeDaySummary, EdgePrintableReceipt } from '@tugeel/shared/pos';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PAGE_RULES } from '@/lib/print-format';
import { DaySummarySlip, TestSlip } from './day-summary-slip';
import { type PrintJob, PrintContext } from './print-context';
import { ReceiptView } from './receipt';

/** The printout's own element, beside the app: everything else is hidden while printing. */
const PRINT_ROOT_ID = 'bto-receipt-print';

/**
 * The receipt printer is the till's Windows default printer (ADR-0065): the page prints the 80 mm
 * receipt with the browser's own printing. Chrome started with `--kiosk-printing` prints straight
 * away; without it the print dialog opens. The paper's width comes from the printer's driver.
 */
const PRINT_RULES = `${PAGE_RULES.MM80}
@media screen { #${PRINT_ROOT_ID} { display: none; } }
@media print {
  body > :not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { display: block; width: 72mm; margin: 0 auto; }
}`;

/** Holds the job being printed (a receipt, the day's summary, a test slip) and its 80 mm sheet. */
export function PrintProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [job, setJob] = useState<{ job: PrintJob; seq: number } | null>(null);
  const send = useCallback(
    (next: PrintJob) => setJob((current) => ({ job: next, seq: (current?.seq ?? 0) + 1 })),
    [],
  );
  const print = useCallback(
    (printable: EdgePrintableReceipt) => send({ kind: 'receipt', printable }),
    [send],
  );
  const printDaySummary = useCallback(
    (summary: EdgeDaySummary, printedAt: string) =>
      send({ kind: 'daySummary', summary, printedAt }),
    [send],
  );
  const printTest = useCallback(
    (tillName: string, printedAt: string) => send({ kind: 'test', tillName, printedAt }),
    [send],
  );
  useEffect(() => {
    if (!job) return;
    const frame = window.requestAnimationFrame(() => {
      window.print();
      // Chrome's print() returns once the page went to the printer (or its dialog closed).
      setJob((current) => (current?.seq === job.seq ? null : current));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [job]);
  const value = useMemo(
    () => ({ print, printDaySummary, printTest }),
    [print, printDaySummary, printTest],
  );
  const current = job?.job ?? null;
  const receipt = current?.kind === 'receipt' ? current.printable : null;
  return (
    <PrintContext.Provider value={value}>
      {children}
      {createPortal(
        <div id={PRINT_ROOT_ID} aria-hidden={job === null} data-testid="receipt-print">
          <style>{PRINT_RULES}</style>
          {receipt?.receipt.credit ? (
            // A credit slip (ADR-0109): the customer's copy and the store's, signed, one sheet each.
            <>
              <div style={{ breakAfter: 'page' }}>
                <ReceiptView
                  receipt={receipt.receipt}
                  copy={receipt.copy}
                  paper
                  label={t('posKiosk.print.sheet')}
                  copyLabel={t('posKiosk.receipt.copyCustomer')}
                />
              </div>
              <ReceiptView
                receipt={receipt.receipt}
                copy={receipt.copy}
                paper
                label={t('posKiosk.print.sheet')}
                copyLabel={t('posKiosk.receipt.copyStore')}
              />
            </>
          ) : receipt ? (
            <ReceiptView
              receipt={receipt.receipt}
              print={receipt.print}
              copy={receipt.copy}
              paper
              label={t('posKiosk.print.sheet')}
            />
          ) : current?.kind === 'daySummary' ? (
            <DaySummarySlip summary={current.summary} printedAt={current.printedAt} />
          ) : current?.kind === 'test' ? (
            <TestSlip tillName={current.tillName} printedAt={current.printedAt} />
          ) : null}
        </div>,
        document.body,
      )}
    </PrintContext.Provider>
  );
}
