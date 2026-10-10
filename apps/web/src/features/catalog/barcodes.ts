import { classifyBarcode } from '@tugeel/shared/gtin';

/** The unique key of a stored barcode (ADR-0029), or null for an invalid code. */
export function barcodeKey(code: string): string | null {
  const classified = classifyBarcode(code);
  return classified.ok ? classified.value.lookupKey : null;
}
