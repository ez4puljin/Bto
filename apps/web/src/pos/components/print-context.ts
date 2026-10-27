import { useMutation } from '@tanstack/react-query';
import type { EdgePrintableReceipt } from '@tugeel/shared/pos';
import { createContext, useContext } from 'react';
import { useKiosk } from '../kiosk-context';

interface PrintContextValue {
  /** Prints the receipt now; the lottery and the QR leave the page's memory once it is printed. */
  print: (printable: EdgePrintableReceipt) => void;
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
