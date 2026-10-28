import { useMutation } from '@tanstack/react-query';
import type { EdgeDaySummary, EdgePrintableReceipt } from '@tugeel/shared/pos';
import { createContext, useContext } from 'react';
import { useKiosk } from '../kiosk-context';

/** What the till's printer prints: a receipt, the day's summary (ADR-0111) or a test slip. */
export type PrintJob =
  | { kind: 'receipt'; printable: EdgePrintableReceipt }
  | { kind: 'daySummary'; summary: EdgeDaySummary; printedAt: string }
  | { kind: 'test'; tillName: string; printedAt: string };

interface PrintContextValue {
  /** Prints the receipt now; the lottery and the QR leave the page's memory once it is printed. */
  print: (printable: EdgePrintableReceipt) => void;
  /** Prints the day's summary with its last count; `printedAt` is the print time (ISO). */
  printDaySummary: (summary: EdgeDaySummary, printedAt: string) => void;
  /** «Хэвлэгч шалгах»: a short slip that proves the printer prints. */
  printTest: (tillName: string, printedAt: string) => void;
}

export const PrintContext = createContext<PrintContextValue | null>(null);

export function usePrint(): PrintContextValue {
  const value = useContext(PrintContext);
  if (!value) throw new Error('usePrint outside PrintProvider');
  return value;
}

/** «Дахин хэвлэх»: the edge decides whether it is the till's last receipt or a copy. */
export function useReprint() {
  const { client } = useKiosk();
  const { print } = usePrint();
  return useMutation({
    mutationFn: (clientId: string) => client.printReceipt(clientId),
    onSuccess: print,
  });
}
