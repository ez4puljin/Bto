import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { idempotencyKey } from '@tugeel/api-client';
import type { PriceRounding } from '@tugeel/shared/pricing';
import { useRef } from 'react';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';
import { randomUuid } from '@/lib/uuid';

export interface SupplierPriceRule {
  supplierId: number;
  supplierName: string;
  enabled: boolean;
  markupPct: string;
  markupAmount: string;
  rounding: PriceRounding;
  version: number;
  updatedAt: string;
}
export interface LocationPriceRule {
  warehouseId: number;
  warehouseName: string;
  enabled: boolean;
  priceType: 'BASE' | 'ADDITIONAL';
  markupPct: string;
  markupAmount: string;
  rounding: PriceRounding;
  version: number;
  updatedAt: string;
}
export interface BasePriceEvent {
  id: number;
  productId: number;
  sku: string;
  name: string;
  kind: 'RECEIPT' | 'MANUAL' | 'SKIPPED';
  reason: string | null;
  oldBasePrice: string | null;
  newBasePrice: string | null;
  overrodeManual: boolean;
  receiptId: number | null;
  receiptNumber: string | null;
  createdAt: string;
  createdBy: number | null;
  printedUnitPriceBase?: string | null;
  /** Future legacy manual schedules are recorded now without changing today's base price. */
  validFrom?: string;
}
export interface BasePriceView {
  productId: number;
  sku: string;
  name: string;
  basePrice: string | null;
  baseUomName?: string;
  source: 'RECEIPT' | 'MANUAL' | 'LEGACY' | null;
  lastEventId: number | null;
  receiptId: number | null;
  receiptNumber: string | null;
  history: BasePriceEvent[];
}
export interface SupplierRuleInput {
  expectedVersion: number;
  enabled: boolean;
  markupPct: string;
  markupAmount: string;
  rounding: PriceRounding;
}
export interface LocationRuleInput extends SupplierRuleInput {
  priceType: 'BASE' | 'ADDITIONAL';
}

export const SUPPLIER_PRICING_KEY = ['pricing', 'supplier-base'] as const;

export function useSupplierPriceRules() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...SUPPLIER_PRICING_KEY, 'suppliers'],
    queryFn: async ({ signal }) =>
      unwrap<SupplierPriceRule[]>(await api.GET('/api/v1/pricing/supplier-rules', { signal })),
  });
}

export function useLocationPriceRules() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...SUPPLIER_PRICING_KEY, 'locations'],
    queryFn: async ({ signal }) =>
      unwrap<LocationPriceRule[]>(await api.GET('/api/v1/pricing/location-rules', { signal })),
  });
}

export function useBasePrice(productId: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...SUPPLIER_PRICING_KEY, 'product', productId],
    enabled: productId !== null,
    queryFn: async ({ signal }) =>
      unwrap<BasePriceView>(
        await api.GET('/api/v1/pricing/base-prices/{productId}', {
          params: { path: { productId: productId ?? 0 } },
          signal,
        }),
      ),
  });
}

export function useReceiptPriceChanges(receiptId: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...SUPPLIER_PRICING_KEY, 'receipt', receiptId],
    enabled: receiptId !== null,
    queryFn: async ({ signal }) =>
      unwrap<BasePriceEvent[]>(
        await api.GET('/api/v1/pricing/receipt-price-changes/{receiptId}', {
          params: { path: { receiptId: receiptId ?? 0 } },
          signal,
        }),
      ),
  });
}

export function useSupplierPricingMutations() {
  const api = useApiClient();
  const cache = useQueryClient();
  type Kind = 'supplier' | 'location' | 'base';
  const intents = useRef<Record<Kind, { fingerprint: string; key: string } | null>>({
    supplier: null,
    location: null,
    base: null,
  });
  const headers = (kind: Kind, input: unknown) => {
    const fingerprint = JSON.stringify(input) ?? '';
    const previous = intents.current[kind];
    const intent =
      previous?.fingerprint === fingerprint ? previous : { fingerprint, key: randomUuid() };
    intents.current[kind] = intent;
    return idempotencyKey(intent.key);
  };
  const changed = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: SUPPLIER_PRICING_KEY }),
      cache.invalidateQueries({ queryKey: ['pricing', 'prices'] }),
      cache.invalidateQueries({ queryKey: ['notifications', 'mine'] }),
    ]);
  return {
    /** Explicitly reviewing a new server basis is a new intent, even if its amount stayed equal. */
    resetIntent: (kind: Kind) => {
      intents.current[kind] = null;
    },
    supplier: useMutation({
      mutationFn: async ({ supplierId, body }: { supplierId: number; body: SupplierRuleInput }) =>
        unwrap<SupplierPriceRule>(
          await api.PUT('/api/v1/pricing/supplier-rules/{supplierId}', {
            params: { path: { supplierId }, header: headers('supplier', { supplierId, body }) },
            body,
          }),
        ),
      onSuccess: () => {
        intents.current.supplier = null;
        return changed();
      },
    }),
    location: useMutation({
      mutationFn: async ({ warehouseId, body }: { warehouseId: number; body: LocationRuleInput }) =>
        unwrap<LocationPriceRule>(
          await api.PUT('/api/v1/pricing/location-rules/{warehouseId}', {
            params: { path: { warehouseId }, header: headers('location', { warehouseId, body }) },
            body,
          }),
        ),
      onSuccess: () => {
        intents.current.location = null;
        return changed();
      },
    }),
    base: useMutation({
      mutationFn: async (input: {
        productId: number;
        expectedPrice: string | null;
        expectedEventId: number | null;
        price: string;
        reason: string;
      }) =>
        unwrap<BasePriceView>(
          await api.PUT('/api/v1/pricing/base-prices/{productId}', {
            params: { path: { productId: input.productId }, header: headers('base', input) },
            body: {
              expectedPrice: input.expectedPrice,
              expectedEventId: input.expectedEventId,
              price: input.price,
              reason: input.reason,
            },
          }),
        ),
      onSuccess: () => {
        intents.current.base = null;
        return changed();
      },
    }),
  };
}
