import { useSyncExternalStore } from 'react';
import { type Brand, currentBrand, subscribeBrand } from './brand';

/** The brand in use (ADR-0127 #4): the office's name and colour, or nulls for the built-in ones. */
export function useBrand(): Brand {
  return useSyncExternalStore(subscribeBrand, currentBrand, currentBrand);
}
